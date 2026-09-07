/**
 * localStorage layer behind useMyVehicles — the "instant list" cache.
 *
 * Lives in lib/ rather than inside the hook because WorkspaceContext has to
 * clear it on exitViewAs, and importing the hook from the context would close
 * a cycle: useMyVehicles → useAccountRole → WorkspaceContext → useMyVehicles.
 * Hoisting would have made that work by accident. This module imports nothing
 * but the view-as flag, so there is nothing to go wrong.
 *
 * KEY SHAPE
 *   cr_vehicles_v2:<userId>:<accountId>
 *
 * The userId segment is not cosmetic. Keyed on accountId alone, two people
 * signed into the same browser who share a workspace read each other's cache —
 * and once admin impersonation shipped it got worse: an admin viewing a
 * customer wrote that customer's plates and models to disk under the
 * CUSTOMER's account id, where nothing removed them on exit, on sign-out, or
 * when the session expired.
 *
 * Bump STORAGE_VERSION when the vehicles row shape changes. Old caches then
 * stop being read — but note they are not deleted by the bump alone, which is
 * why clearVehiclesCache() matches on the prefix and ignores the version.
 */

import { isViewAs } from '@/lib/viewAsState';

const KEY_PREFIX = 'cr_vehicles_';
const STORAGE_VERSION = 'v2';

/**
 * Matches ONLY versioned cache keys: cr_vehicles_v<n>[_ts]:<...>
 *
 * A plain `startsWith('cr_vehicles_')` looked equivalent and was not — it also
 * matches `cr_vehicles_sort`, the user's sort preference written by
 * src/pages/Vehicles.jsx. Sweeping on the bare prefix silently reset that for
 * every user on every launch. The `v<digits>:` shape is what makes a key ours.
 */
const CACHE_KEY_RE = /^cr_vehicles_v\d+(_ts)?:/;

// Dashboard.jsx keeps a SEPARATE vehicle cache under a hyphenated key
// (cr-vehicles-cache:<userId>:<accountId>, shape {ts,data}). It predates this
// module and is not one of ours to read or write, but exitViewAs must be able
// to wipe it too — otherwise an impersonated customer's vehicles written by an
// OLD build (before Dashboard's own view-as write-guard landed) survive on the
// admin's device. Matched only by clearVehiclesCache, never by the boot sweep:
// for a normal user this is a valid current cache, not stale.
const DASHBOARD_KEY_RE = /^cr-vehicles-cache:/;

const storageKey   = (userId, accountId) => `${KEY_PREFIX}${STORAGE_VERSION}:${userId}:${accountId}`;
const timestampKey = (userId, accountId) => `${KEY_PREFIX}${STORAGE_VERSION}_ts:${userId}:${accountId}`;

/** Keys matching `re` for which `predicate` is true. */
function keysMatching(re, predicate) {
  const found = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && re.test(k) && predicate(k)) found.push(k);
  }
  return found;
}

/**
 * Remove every cached vehicle list this app writes — both this module's
 * versioned keys and Dashboard's separate one, for any account.
 *
 * Matches by prefix rather than by current key shape on purpose: the v1 keys
 * older builds wrote hold a customer's vehicles under an account id that is
 * not the reader's, and a version bump would orphan them rather than delete
 * them. Called from exitViewAs so a support session leaves nothing behind.
 */
export function clearVehiclesCache() {
  try {
    keysMatching(CACHE_KEY_RE, () => true).forEach((k) => localStorage.removeItem(k));
    keysMatching(DASHBOARD_KEY_RE, () => true).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing cached, nothing to clear */ }
}

/**
 * Delete cached lists written under any version other than the current one.
 *
 * Runs once per app boot, on import. A version bump alone only makes old keys
 * unreadable, not absent — and the v1 keys are the ones that hold a customer's
 * vehicles on an admin's device, written before impersonation stopped
 * persisting them. Waiting for the next exitViewAs to sweep them would leave
 * that data on any machine where the admin never opens another session.
 *
 * Costs one localStorage enumeration at startup and is fully guarded, so a
 * browser with storage disabled simply skips it.
 */
function sweepOtherVersions() {
  try {
    const keep = `${KEY_PREFIX}${STORAGE_VERSION}`;
    keysMatching(CACHE_KEY_RE, (k) => !k.startsWith(keep)).forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing to sweep */ }
}

sweepOtherVersions();

export function readVehiclesFromStorage(userId, accountId) {
  if (!userId || !accountId) return undefined;
  try {
    const raw = localStorage.getItem(storageKey(userId, accountId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    // Defensive: only accept arrays. Anything else is treated as corrupt
    // and triggers a fresh fetch.
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function readTimestampFromStorage(userId, accountId) {
  if (!userId || !accountId) return 0;
  try {
    const raw = localStorage.getItem(timestampKey(userId, accountId));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeVehiclesToStorage(userId, accountId, vehicles) {
  if (!userId || !accountId || !Array.isArray(vehicles)) return;
  // Never persist someone else's vehicles to this device. The cache exists to
  // kill a 300-800 ms flicker on repeat visits, and an admin support session
  // is neither repeat nor theirs — so the right amount to write is none.
  // isViewAs() is a synchronous module read precisely so non-React callers
  // like this one can ask.
  if (isViewAs()) return;
  try {
    localStorage.setItem(storageKey(userId, accountId), JSON.stringify(vehicles));
    localStorage.setItem(timestampKey(userId, accountId), String(Date.now()));
  } catch {
    // Quota, private browsing, etc. — silent. The network path still
    // works; we just don't get the instant-mount benefit next time.
  }
}
