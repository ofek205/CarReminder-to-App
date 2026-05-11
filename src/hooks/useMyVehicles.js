/**
 * useMyVehicles — single source of truth for "the list of vehicles
 * in the active workspace".
 *
 * Why this exists
 * ---------------
 * ~12 screens fetched vehicles independently, each issuing the same
 * Supabase query and waiting for the network round-trip. Cold-boot
 * users saw an empty list flicker for 300-800 ms on every screen.
 * This hook adds a localStorage-backed "instant" layer on top of the
 * existing React Query cache, so warm boots show vehicles immediately
 * and only the very first launch on a fresh install has any latency.
 *
 * What it does
 * ------------
 * 1. Reads vehicles via React Query with queryKey ['vehicles', accountId].
 *    That key is identical to what existing screens already use, so the
 *    in-memory cache is shared (no duplicate network calls between
 *    pages within a session).
 * 2. On mount, seeds React Query's `initialData` from localStorage —
 *    pages render the last-known list synchronously, with no flicker.
 * 3. On every successful fetch, writes the fresh list back to
 *    localStorage so the next cold boot starts instant too.
 * 4. staleTime of 30 s keeps background refetches reasonable while
 *    still catching missed cache invalidations within a half-minute.
 *
 * Safety
 * ------
 *   • Storage key includes a schema version ('v1'). Bump if the
 *     vehicles table shape changes — old caches become invisible and
 *     get re-fetched fresh.
 *   • Key is partitioned by accountId so workspace switches don't
 *     show the wrong account's vehicles even for a split second.
 *   • All localStorage access is try/catch — quota errors, private
 *     browsing, disabled storage all degrade gracefully to the
 *     pre-hook behaviour (network-only).
 *   • Guests never hit this hook — they use a separate guest-storage
 *     path that lives in GuestContext.
 */

import { useQuery } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import useAccountRole from '@/hooks/useAccountRole';

const STORAGE_VERSION = 'v1';
const storageKey = (accountId) => `cr_vehicles_${STORAGE_VERSION}:${accountId}`;
const timestampKey = (accountId) => `cr_vehicles_${STORAGE_VERSION}_ts:${accountId}`;

function readVehiclesFromStorage(accountId) {
  if (!accountId) return undefined;
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    // Defensive: only accept arrays. Anything else is treated as corrupt
    // and triggers a fresh fetch.
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readTimestampFromStorage(accountId) {
  if (!accountId) return 0;
  try {
    const raw = localStorage.getItem(timestampKey(accountId));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeVehiclesToStorage(accountId, vehicles) {
  if (!accountId || !Array.isArray(vehicles)) return;
  try {
    localStorage.setItem(storageKey(accountId), JSON.stringify(vehicles));
    localStorage.setItem(timestampKey(accountId), String(Date.now()));
  } catch {
    // Quota, private browsing, etc. — silent. The network path still
    // works; we just don't get the instant-mount benefit next time.
  }
}

/**
 * @returns {{
 *   vehicles: Array,
 *   data: Array,
 *   isLoading: boolean,
 *   isError: boolean,
 *   error: Error | null,
 *   refetch: () => Promise<unknown>,
 * }}
 */
export default function useMyVehicles() {
  const { accountId, isGuest } = useAccountRole();

  const query = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: async () => {
      const list = await db.vehicles.filter({ account_id: accountId });
      const arr = Array.isArray(list) ? list : [];
      writeVehiclesToStorage(accountId, arr);
      return arr;
    },
    // Guests bypass this hook entirely. Disabling the query for them
    // keeps React Query happy without firing requests with no key.
    enabled: !!accountId && !isGuest,
    staleTime: 30_000,
    initialData: () => readVehiclesFromStorage(accountId),
    initialDataUpdatedAt: () => readTimestampFromStorage(accountId),
  });

  // Always return an array so callers can `.map` without guarding.
  const vehicles = Array.isArray(query.data) ? query.data : [];

  return {
    vehicles,
    data: vehicles,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
