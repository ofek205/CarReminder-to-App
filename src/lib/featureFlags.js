/**
 * Feature Flags helper.
 *
 * Single source of truth for "is this feature visible to the current
 * user?" checks. Implements the gating rule the team agreed on:
 *
 *   • admins ALWAYS see the feature (so QA can test before rollout)
 *   • regular users see it only when the flag in public.app_config
 *     is set to true
 *
 * Backed by two reads, both cached:
 *   1. supabase.rpc('is_admin')           → cached for 60 s in this module
 *   2. supabase.from('app_config')...      → cached for 60 s per key
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
import useIsAdmin from '@/hooks/useIsAdmin';

const FLAG_CACHE_TTL_MS  = 60 * 1000;
const ADMIN_CACHE_TTL_MS = 60 * 1000;

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
  const [admin, flag] = await Promise.all([
    probeIsAdmin(),
    readFlag(key, opts),
  ]);
  return admin === true || flag === true;
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
  const [flagValue, setFlagValue] = useState(null);
  const [loadingFlag, setLoadingFlag] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingFlag(true);

    const refresh = () => {
      readFlag(key, { defaultOnError }).then((v) => {
        if (!cancelled) {
          setFlagValue(v);
          setLoadingFlag(false);
        }
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
  }, [key, defaultOnError]);

  const adminLoading = isAdmin === null;
  if (adminLoading || loadingFlag) {
    return { enabled: null, isLoading: true };
  }
  return {
    enabled: isAdmin === true || flagValue === true,
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
