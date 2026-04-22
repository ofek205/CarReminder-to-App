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

const KEY_PIN_HASH = 'cr_pin_hash_v1';
const KEY_PIN_SALT = 'cr_pin_salt_v1';
const KEY_PIN_ENABLED = 'cr_pin_enabled_v1';
const KEY_LAST_UNLOCK = 'cr_pin_unlocked_at_v1';
const KEY_FAILED_COUNT = 'cr_pin_failed_count_v1';
const KEY_LOCKOUT_UNTIL = 'cr_pin_lockout_until_v1';

// Auto-lock after this many ms of backgrounded app. 5 min balances
// "don't nag me to unlock every time I switch apps" with "lock if I
// left my phone on a table".
const AUTO_LOCK_MS = 5 * 60 * 1000;

// Brute-force limits
const MAX_FAIL_BEFORE_LOCKOUT = 5;
const LOCKOUT_DURATION_MS = 30 * 1000;
const MAX_FAIL_BEFORE_FULL_LOGOUT = 10;

//  Storage helpers 
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const safeRemove = (k) => { try { localStorage.removeItem(k); } catch {} };

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

/** True if the user has enabled PIN lock. */
export function isPinEnabled() {
  return safeGet(KEY_PIN_ENABLED) === '1' && !!safeGet(KEY_PIN_HASH);
}

/** Mark the session as unlocked right now (used after successful PIN entry). */
export function markUnlocked() {
  safeSet(KEY_LAST_UNLOCK, String(Date.now()));
  safeSet(KEY_FAILED_COUNT, '0');
  safeRemove(KEY_LOCKOUT_UNTIL);
}

/** True if we're inside the auto-unlock window (i.e. no PIN needed right now). */
export function isStillUnlocked() {
  if (!isPinEnabled()) return true;
  const last = Number(safeGet(KEY_LAST_UNLOCK) || 0);
  return Date.now() - last < AUTO_LOCK_MS;
}

/** Force the lock on (used when app goes to background, or on explicit "Lock now"). */
export function lockNow() {
  safeRemove(KEY_LAST_UNLOCK);
}

/** Set (or change) the PIN. Returns true on success. */
export async function setPin(pin) {
  if (!/^\d{4,8}$/.test(pin)) return false;
  const salt = randomSalt();
  const hash = await sha256(pin + ':' + salt);
  safeSet(KEY_PIN_SALT, salt);
  safeSet(KEY_PIN_HASH, hash);
  safeSet(KEY_PIN_ENABLED, '1');
  markUnlocked();
  return true;
}

/** Remove PIN entirely (e.g. user disabled lock in settings). */
export function clearPin() {
  safeRemove(KEY_PIN_HASH);
  safeRemove(KEY_PIN_SALT);
  safeRemove(KEY_PIN_ENABLED);
  safeRemove(KEY_LAST_UNLOCK);
  safeRemove(KEY_FAILED_COUNT);
  safeRemove(KEY_LOCKOUT_UNTIL);
}

/**
 * Attempt to unlock with the given PIN.
 * Returns { ok, reason, lockoutMsRemaining, shouldLogout }
 */
export async function tryUnlock(pin) {
  // Lockout check
  const lockoutUntil = Number(safeGet(KEY_LOCKOUT_UNTIL) || 0);
  if (lockoutUntil > Date.now()) {
    return { ok: false, reason: 'locked_out', lockoutMsRemaining: lockoutUntil - Date.now() };
  }

  const salt = safeGet(KEY_PIN_SALT);
  const storedHash = safeGet(KEY_PIN_HASH);
  if (!salt || !storedHash) return { ok: false, reason: 'no_pin_set' };

  const attemptHash = await sha256(pin + ':' + salt);
  if (attemptHash === storedHash) {
    markUnlocked();
    return { ok: true };
  }

  // Wrong PIN. bump fail counter
  const failed = Number(safeGet(KEY_FAILED_COUNT) || 0) + 1;
  safeSet(KEY_FAILED_COUNT, String(failed));

  if (failed >= MAX_FAIL_BEFORE_FULL_LOGOUT) {
    // Too many attempts. fall back to full logout
    clearPin();
    return { ok: false, reason: 'too_many_failures', shouldLogout: true };
  }
  if (failed >= MAX_FAIL_BEFORE_LOCKOUT) {
    const until = Date.now() + LOCKOUT_DURATION_MS;
    safeSet(KEY_LOCKOUT_UNTIL, String(until));
    return { ok: false, reason: 'locked_out', lockoutMsRemaining: LOCKOUT_DURATION_MS };
  }
  return {
    ok: false,
    reason: 'wrong_pin',
    attemptsRemaining: MAX_FAIL_BEFORE_LOCKOUT - failed,
  };
}
