/**
 * PIN lock. fast on-device unlock gate for the authenticated session.
 *
 * Why this exists: we already keep the Supabase session alive on-device
 * (see capacitor Preferences + autoRefreshToken wiring). That's convenient
 *. but if someone else picks up an unlocked phone, they're straight into
 * the app. A 4-6 digit PIN adds a local gate without re-entering a password.
 *
 * Security model:
 *   - We store a SHA-256 hash of (PIN + random salt). Never the PIN itself.
 *   - The salt is per-user and kept alongside the hash in localStorage.
 *   - This is NOT a crypto authenticator. it's a UX gate. Wiping the
 *     device, opening devtools, or re-installing the app all clear it.
 *   - "Forgot PIN" flow drops the gate and asks the user to re-login with
 *     their Supabase password.
 *
 * Brute-force protection:
 *   - 5 wrong attempts → 30-second lockout
 *   - 10 wrong attempts → full logout (forces password re-auth)
 */

// Per-user namespacing. Before the v2 keys we stored PIN data under a
// global prefix (cr_pin_hash_v1, cr_pin_salt_v1, …). If user A set a
// PIN and signed out, then user B signed in on the same device, the
// global hash still matched A's PIN — so user B was prompted for
// user A's PIN on every unlock. Catastrophic UX on shared devices.
//
// Now every key is scoped to a userId, set by `setActivePinUser(id)`
// from AuthContext on every auth-state change. When no user is active
// (logged out / app boot before session resolves) the public API
// no-ops cleanly — isPinEnabled() returns false, markUnlocked() is a
// silent skip, tryUnlock() refuses with 'no_pin_set'.
//
// Legacy v1 keys are intentionally left untouched: clearing them
// would log out anyone in the middle of an unlock against the old
// scheme. They naturally fall out of use once a user re-enables PIN
// on the device, and won't ever be read by the v2 codepath below.
const KEY_BASE = {
  hash:        'cr_pin_hash_v2',
  salt:        'cr_pin_salt_v2',
  enabled:     'cr_pin_enabled_v2',
  lastUnlock:  'cr_pin_unlocked_at_v2',
  failed:      'cr_pin_failed_count_v2',
  lockoutUntil:'cr_pin_lockout_until_v2',
};

let activeUserId = null;

/**
 * Legacy v1 keys cleanup — one-shot migration that runs the first
 * time the user opens v4.4.0+. The v1 schema (cr_pin_hash_v1, …)
 * was global to the device, so we can't safely auto-migrate it to
 * v2 per-user keys: in a multi-user device the wrong person would
 * inherit someone else's PIN. The safest principled path is to
 * DELETE the v1 keys + ask the user to re-enable PIN in Settings
 * (a Hebrew toast guides them — see PinLockCard subscribe path).
 *
 * Idempotent — once `cr_pin_migration_v2_done` is set, this skips.
 * Returns true if migration actually deleted v1 keys (so the
 * caller / UI can show a one-time toast); false otherwise.
 */
export function migrateLegacyPinKeysIfNeeded() {
  try {
    if (localStorage.getItem('cr_pin_migration_v2_done') === '1') return false;
    const hadV1 = !!localStorage.getItem('cr_pin_hash_v1');
    [
      'cr_pin_hash_v1', 'cr_pin_salt_v1', 'cr_pin_enabled_v1',
      'cr_pin_unlocked_at_v1', 'cr_pin_failed_count_v1', 'cr_pin_lockout_until_v1',
    ].forEach(k => { try { localStorage.removeItem(k); } catch {} });
    localStorage.setItem('cr_pin_migration_v2_done', '1');
    return hadV1;  // signal whether there was actually something to clean up
  } catch { return false; }
}

// Run the cleanup as soon as the module loads. Done at import time
// (not lazily) so the v1 keys are gone before any other PIN code
// path reads them — eliminates the brief race where v1 protection
// would have applied to the wrong user post-upgrade.
const _migratedV1KeysOnLoad = migrateLegacyPinKeysIfNeeded();

/**
 * True iff this module just deleted v1 PIN data on load. Used by
 * the auth bootstrap to surface a one-time "re-enable PIN" toast.
 * Read once and reset to false to keep the toast a single fire.
 */
let _pendingV1MigrationNotice = _migratedV1KeysOnLoad;
export function consumeV1MigrationNotice() {
  if (!_pendingV1MigrationNotice) return false;
  _pendingV1MigrationNotice = false;
  return true;
}

/**
 * Bind the PIN module to a Supabase user id. Call this from the
 * AuthContext SIGNED_IN / INITIAL_SESSION listener. Pass `null` on
 * sign-out to make every PIN operation no-op.
 */
export function setActivePinUser(userId) {
  activeUserId = (userId && typeof userId === 'string') ? userId : null;
}

function k(field) {
  if (!activeUserId) return null;     // signals "no user → no PIN ops"
  return `${KEY_BASE[field]}_${activeUserId}`;
}

// Auto-lock after this many ms of backgrounded app. 5 min balances
// "don't nag me to unlock every time I switch apps" with "lock if I
// left my phone on a table".
const AUTO_LOCK_MS = 5 * 60 * 1000;

// Brute-force limits
const MAX_FAIL_BEFORE_LOCKOUT = 5;
const LOCKOUT_DURATION_MS = 30 * 1000;
const MAX_FAIL_BEFORE_FULL_LOGOUT = 10;

//  Storage helpers — every accessor takes the field name (not the raw
//  key) and resolves to the per-user-scoped key via k(). When there's
//  no active user, the helpers return null/no-op so callers can keep
//  their existing shape without sprinkling guards everywhere.
const safeGet = (field) => {
  const key = k(field);
  if (!key) return null;
  try { return localStorage.getItem(key); } catch { return null; }
};
const safeSet = (field, v) => {
  const key = k(field);
  if (!key) return;
  try { localStorage.setItem(key, v); } catch {}
};
const safeRemove = (field) => {
  const key = k(field);
  if (!key) return;
  try { localStorage.removeItem(key); } catch {}
};

//  Hashing (WebCrypto SHA-256) 
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

//  Public API 

/** True if the user has enabled PIN lock. False when no user is active. */
export function isPinEnabled() {
  if (!activeUserId) return false;
  return safeGet('enabled') === '1' && !!safeGet('hash');
}

/** Mark the session as unlocked right now (used after successful PIN entry). */
export function markUnlocked() {
  safeSet('lastUnlock', String(Date.now()));
  safeSet('failed', '0');
  safeRemove('lockoutUntil');
}

/** True if we're inside the auto-unlock window (i.e. no PIN needed right now). */
export function isStillUnlocked() {
  if (!isPinEnabled()) return true;
  const last = Number(safeGet('lastUnlock') || 0);
  return Date.now() - last < AUTO_LOCK_MS;
}

/** Force the lock on (used when app goes to background, or on explicit "Lock now"). */
export function lockNow() {
  safeRemove('lastUnlock');
}

/** Set (or change) the PIN. Returns true on success. */
export async function setPin(pin) {
  if (!activeUserId) return false;
  if (!/^\d{4,8}$/.test(pin)) return false;
  const salt = randomSalt();
  const hash = await sha256(pin + ':' + salt);
  safeSet('salt', salt);
  safeSet('hash', hash);
  safeSet('enabled', '1');
  markUnlocked();
  return true;
}

/** Remove PIN entirely (e.g. user disabled lock in settings). */
export function clearPin() {
  safeRemove('hash');
  safeRemove('salt');
  safeRemove('enabled');
  safeRemove('lastUnlock');
  safeRemove('failed');
  safeRemove('lockoutUntil');
}

/**
 * Attempt to unlock with the given PIN.
 * Returns { ok, reason, lockoutMsRemaining, shouldLogout }
 */
export async function tryUnlock(pin) {
  if (!activeUserId) return { ok: false, reason: 'no_pin_set' };

  // Lockout check
  const lockoutUntil = Number(safeGet('lockoutUntil') || 0);
  if (lockoutUntil > Date.now()) {
    return { ok: false, reason: 'locked_out', lockoutMsRemaining: lockoutUntil - Date.now() };
  }

  const salt = safeGet('salt');
  const storedHash = safeGet('hash');
  if (!salt || !storedHash) return { ok: false, reason: 'no_pin_set' };

  const attemptHash = await sha256(pin + ':' + salt);
  if (attemptHash === storedHash) {
    markUnlocked();
    return { ok: true };
  }

  // Wrong PIN. bump fail counter
  const failed = Number(safeGet('failed') || 0) + 1;
  safeSet('failed', String(failed));

  if (failed >= MAX_FAIL_BEFORE_FULL_LOGOUT) {
    // Too many attempts. fall back to full logout
    clearPin();
    return { ok: false, reason: 'too_many_failures', shouldLogout: true };
  }
  if (failed >= MAX_FAIL_BEFORE_LOCKOUT) {
    const until = Date.now() + LOCKOUT_DURATION_MS;
    safeSet('lockoutUntil', String(until));
    return { ok: false, reason: 'locked_out', lockoutMsRemaining: LOCKOUT_DURATION_MS };
  }
  return {
    ok: false,
    reason: 'wrong_pin',
    attemptsRemaining: MAX_FAIL_BEFORE_LOCKOUT - failed,
  };
}
