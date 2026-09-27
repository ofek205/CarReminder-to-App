/**
 * Feature Flags helper.
 *
 * Single source of truth for "is this feature visible to the current
 * user?" checks. Implements the gating rule the team agreed on:
 *
 *   • admins ALWAYS see the feature (so QA can test before rollout)
 *   • users listed for that flag in public.feature_flag_allowlist see
 *     it too: a test account, or Apple's reviewer, neither of whom may
 *     be an admin (supabase-feature-flag-allowlist-2026-09-27.sql)
 *   • everyone else sees it only when the flag in public.app_config
 *     is set to true
 *
 * Backed by three reads, all cached:
 *   1. supabase.rpc('is_admin')             → cached for 60 s in this module
 *   2. supabase.from('app_config')...        → cached for 60 s per key
 *   3. supabase.rpc('my_allowlisted_flags') → cached for 60 s per user,
 *      one call for every flag
 *
 * Cache policy:
 *   • The React hook (useFeatureFlag below) uses the same module
 *     caches. The hook for admin status (useIsAdmin from
 *     src/hooks/useIsAdmin.js) uses React Query with a 10-minute
 *     staleTime. Both probes hit the same RPC. Keeping the module
 *     cache short (60 s) caps the worst-case drift between the two
 *     surfaces to one minute — acceptable for an admin-flag check.
 *
 * Defensive defaults:
 *   • By default, every error path returns FALSE for non-admins. A
 *     network blip must not silently expose a feature that is
 *     supposed to be hidden.
 *   • Callers that already have a live feature in production (e.g.,
 *     the AI scan gate, which has shipped with "default enabled" for
 *     months) can pass { defaultOnError: true } to preserve the
 *     legacy behaviour and avoid surprise "feature unavailable"
 *     dialogs during transient Supabase outages.
 *
 * Reactive invalidation:
 *   • Components mounted via useFeatureFlag(key) subscribe to a
 *     pub-sub bus. Calling invalidateFeatureFlagCache(key) (e.g.,
 *     after an admin toggles a switch in the admin screen) busts
 *     the cache AND triggers every subscribed hook to re-read the
 *     value, so the UI updates immediately on the current tab
 *     without waiting up to the TTL.
 *
 * Exports:
 *   • isFeatureEnabled(key, opts?) → Promise<boolean>
 *   • useFeatureFlag(key)          → { enabled, isLoading }
 *   • invalidateFeatureFlagCache(key?)
 *   • invalidateAdminCache()
 *
 * Return contract for useFeatureFlag:
 *   • enabled === null  → still resolving on first mount; UI should
 *                          show a skeleton or hide the gated element
 *   • enabled === true  → show the gated element
 *   • enabled === false → hide the gated element
 *   Important: writing `if (enabled)` collapses null to "hide", which
 *   is correct for first paint. Writing `if (enabled === false)` is
 *   different — it shows the element during the loading flash. Pick
 *   intentionally.
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { withTimeout } from './supabaseQuery';
import useIsAdmin from '@/hooks/useIsAdmin';
import { useAuth } from '@/components/shared/GuestContext';

const FLAG_CACHE_TTL_MS      = 60 * 1000;
const ADMIN_CACHE_TTL_MS     = 60 * 1000;
const ALLOWLIST_CACHE_TTL_MS = 60 * 1000;

// key → { value: boolean, cachedAt: number }
const flagCache  = new Map();
let adminCache   = null;
let adminCachedAt = 0;
let adminInFlight = null;

// In-flight promises per flag key — de-dupes concurrent calls so a
// burst of useFeatureFlag mounts only hits Postgres once.
const flagInFlight = new Map();

// Pub-sub for cache-busts. Each hook instance subscribes on mount and
// unsubscribes on unmount. When invalidateFeatureFlagCache fires, we
// notify every listener so the UI can re-read without waiting for the
// next TTL tick. Listener signature: (key | null) → void, where null
// means "all keys were busted" (useful for force-refresh-everything
// scenarios like a logout).
const flagListeners = new Set();
function notifyFlagListeners(key) {
  for (const cb of flagListeners) {
    try { cb(key); } catch { /* a listener bug must not crash others */ }
  }
}

async function probeIsAdmin() {
  const now = Date.now();
  if (adminCache !== null && now - adminCachedAt < ADMIN_CACHE_TTL_MS) {
    return adminCache;
  }
  if (adminInFlight) return adminInFlight;

  adminInFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('is_admin');
      if (error) throw error;
      adminCache = data === true;
    } catch (err) {

      if (import.meta.env?.DEV) console.warn('[featureFlags] is_admin probe failed:', err?.message);
      adminCache = false;
    } finally {
      adminCachedAt = Date.now();
      adminInFlight = null;
    }
    return adminCache;
  })();

  return adminInFlight;
}

// ⚠️ KEYED BY USER, BECAUSE THE ANSWER IS PER USER. The admin cache above
// is one value for the tab, which is tolerable for a 60 s probe. A list
// cached the same way would hand the previous account's flags to whoever
// signs in next on the same phone. So the cache remembers whose list it
// holds, and a different uid always asks again.
const NO_FLAGS = new Set();
let allowlistCache    = null;  // { uid, keys: Set<string>, cachedAt }
let allowlistInFlight = null;  // { uid, promise }

async function probeAllowlist(uid) {
  if (!uid) return NO_FLAGS;
  const now = Date.now();
  if (allowlistCache?.uid === uid && now - allowlistCache.cachedAt < ALLOWLIST_CACHE_TTL_MS) {
    return allowlistCache.keys;
  }
  if (allowlistInFlight?.uid === uid) return allowlistInFlight.promise;

  const promise = (async () => {
    // Fails closed: an error, a timeout, or the RPC not existing yet (the
    // client can ship before the SQL is applied) all mean "nothing listed".
    let keys = NO_FLAGS;
    try {
      const { data, error } = await withTimeout(
        supabase.rpc('my_allowlisted_flags'),
        'my_allowlisted_flags',
      );
      if (error) throw error;
      if (Array.isArray(data)) keys = new Set(data);
    } catch (err) {
      if (import.meta.env?.DEV) console.warn('[featureFlags] my_allowlisted_flags failed:', err?.message);
    }
    allowlistCache = { uid, keys, cachedAt: Date.now() };
    return keys;
  })();

  allowlistInFlight = { uid, promise };
  promise.finally(() => {
    if (allowlistInFlight?.promise === promise) allowlistInFlight = null;
  });
  return promise;
}

// isFeatureEnabled runs outside React, so it cannot use useAuth. Same
// source as aiConsentGate: the local session, no network round trip.
async function currentUid() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function isAllowlisted(key) {
  const keys = await probeAllowlist(await currentUid());
  return keys.has(key);
}

async function readFlag(key, { defaultOnError = false } = {}) {
  const now = Date.now();
  const hit = flagCache.get(key);
  if (hit && now - hit.cachedAt < FLAG_CACHE_TTL_MS) {
    return hit.value;
  }
  if (flagInFlight.has(key)) return flagInFlight.get(key);

  const promise = (async () => {
    let value = defaultOnError;
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value;
      // app_config.value is jsonb — Postgres returns true/false directly,
      // but tolerate the legacy string forms too. Missing row = treat as
      // false (or whatever defaultOnError says) so a typo in the key
      // doesn't silently expose the feature.
      if (raw === true || raw === 'true') {
        value = true;
      } else if (raw === false || raw === 'false') {
        value = false;
      } else {
        // Row missing → keep the caller's default. This is the same
        // behaviour as a network error: the caller knows whether
        // "missing" means "default on" (legacy features) or "default
        // off" (new features).
        value = defaultOnError;
      }
    } catch (err) {

      if (import.meta.env?.DEV) console.warn(`[featureFlags] read ${key} failed:`, err?.message);
      value = defaultOnError;
    } finally {
      flagCache.set(key, { value, cachedAt: Date.now() });
      flagInFlight.delete(key);
    }
    return value;
  })();

  flagInFlight.set(key, promise);
  return promise;
}

/**
 * Pure async check — admins always pass, others depend on the flag.
 * Safe to call from any context (services, lib code, event handlers).
 *
 * @param {string} key  Row key in public.app_config
 * @param {object} [opts]
 * @param {boolean} [opts.defaultOnError=false]
 *        What to return for non-admins when the row is missing OR the
 *        fetch fails. Default false (hide the feature) — pass true to
 *        preserve legacy "default enabled" behaviour for shipped
 *        features.
 */
export async function isFeatureEnabled(key, opts = {}) {
  if (!key) return false;
  // ignoreAdmin: for flags that switch on a RESTRICTION rather than
  // reveal a feature. The admin bypass exists so QA can see something
  // early, which inverts once the flag's meaning is "this rule now
  // applies": admins get enrolled in the rule before anyone has decided
  // to turn it on, and a rule that fails closed then breaks them alone.
  // See lib/aiConsentGate.js for the case that found this.
  //
  // The allowlist still applies there, and that is the point of it: a row
  // is someone deliberately enrolling one account in the rule first, which
  // is exactly what the admin bypass could not do safely.
  if (opts.ignoreAdmin === true) {
    const [flag, listed] = await Promise.all([
      readFlag(key, opts),
      isAllowlisted(key),
    ]);
    return flag === true || listed;
  }
  const [admin, flag, listed] = await Promise.all([
    probeIsAdmin(),
    readFlag(key, opts),
    isAllowlisted(key),
  ]);
  return admin === true || flag === true || listed;
}

/**
 * React hook wrapper. Uses useIsAdmin (which itself caches via React
 * Query) for the admin signal, and the module-level cache for the
 * flag value. Subscribes to invalidateFeatureFlagCache so an admin
 * flipping a toggle in the admin screen updates the current tab
 * immediately, not after the TTL.
 *
 * Returns:
 *   • enabled: boolean | null   (null = still resolving)
 *   • isLoading: boolean
 *
 * @param {string} key
 * @param {object} [opts]
 * @param {boolean} [opts.defaultOnError=false]
 *        See isFeatureEnabled. Forwarded to readFlag.
 */
export function useFeatureFlag(key, opts = {}) {
  const { defaultOnError = false } = opts;
  const isAdmin = useIsAdmin();
  // The signed-in user, so the list is re-read when the account changes.
  // A guest has no list.
  const { user, isGuest } = useAuth();
  const uid = isGuest ? null : (user?.id ?? null);
  // What was read, and for which key and user. An answer read for another
  // user counts as still loading: after a sign-in, the first render would
  // otherwise show the previous (signed-out) answer, false, and a listed
  // user would see the feature hidden and then appear.
  const [resolved, setResolved] = useState(null);  // { key, uid, flag, listed }

  useEffect(() => {
    let cancelled = false;

    // Waits for the list as well as the flag, for the same reason. Both
    // reads fail closed and neither rejects, and the list is one call
    // shared by every flag.
    const refresh = () => {
      Promise.all([
        readFlag(key, { defaultOnError }),
        probeAllowlist(uid),
      ]).then(([flag, keys]) => {
        if (!cancelled) setResolved({ key, uid, flag, listed: keys.has(key) });
      });
    };

    refresh();

    // Subscribe to pub-sub so external invalidations re-render us.
    const listener = (changedKey) => {
      if (changedKey === null || changedKey === key) refresh();
    };
    flagListeners.add(listener);
    return () => {
      cancelled = true;
      flagListeners.delete(listener);
    };
  }, [key, defaultOnError, uid]);

  const adminLoading = isAdmin === null;
  const flagLoading = resolved?.key !== key || resolved?.uid !== uid;
  if (adminLoading || flagLoading) {
    return { enabled: null, isLoading: true };
  }
  return {
    enabled: isAdmin === true || resolved.flag === true || resolved.listed === true,
    isLoading: false,
  };
}

/**
 * Force re-read of one flag (or all flags) on next call. ALSO notifies
 * every mounted useFeatureFlag hook for the affected key so the UI
 * updates without a refresh. Use after an admin flips a toggle.
 *
 * @param {string} [key]  Specific key to bust. Omit to clear everything.
 */
export function invalidateFeatureFlagCache(key) {
  if (key) {
    flagCache.delete(key);
    notifyFlagListeners(key);
  } else {
    flagCache.clear();
    // "Everything" includes whose flags are listed, so a force-refresh
    // also picks up a row added in the SQL editor a moment ago.
    allowlistCache = null;
    notifyFlagListeners(null);
  }
}

/**
 * Force re-read of the cached is_admin result on next call. Use when
 * a user's role changes mid-session (rare). Does NOT touch the React
 * Query cache used by useIsAdmin — call that hook's refetch separately
 * if you need both surfaces to refresh together.
 */
export function invalidateAdminCache() {
  adminCache = null;
  adminCachedAt = 0;
}
