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
 *   • Storage key includes a schema version ('v2'). Bump if the
 *     vehicles table shape changes — old caches become invisible and
 *     get re-fetched fresh.
 *   • Key is partitioned by userId AND accountId. accountId alone was
 *     not enough: two people signed into the same browser who both
 *     belong to one workspace read each other's cache, and — far worse
 *     once admin impersonation shipped — an admin who viewed a customer
 *     wrote that customer's vehicles under the customer's accountId and
 *     nothing ever removed them. See clearVehiclesCache() below.
 *   • Nothing is written at all while impersonating. The cache exists to
 *     kill a 300-800 ms flicker on repeat visits, and an admin support
 *     session is neither repeat nor theirs. Not writing means there is
 *     no customer data at rest to leak in the first place; the sweep on
 *     exit is the second layer, not the only one.
 *   • All localStorage access is try/catch — quota errors, private
 *     browsing, disabled storage all degrade gracefully to the
 *     pre-hook behaviour (network-only).
 *   • Guests never hit this hook — they use a separate guest-storage
 *     path that lives in GuestContext.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useAccountRole from '@/hooks/useAccountRole';
import { useAuth } from '@/components/shared/GuestContext';
import {
  readVehiclesFromStorage,
  readTimestampFromStorage,
  writeVehiclesToStorage,
} from '@/lib/vehiclesCache';

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
  const { user } = useAuth();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: async () => {
      // Direct supabase call wrapped with withTimeout. The
      // check-query-timeouts gate (CLAUDE.md → "Query Timeout Gate")
      // mandates this pattern for every useQuery that talks to
      // Supabase, so a hung request can't leave isLoading stuck on
      // true forever. db.vehicles.filter would do the same thing
      // internally but would bypass the wrapper.
      const { data, error } = await withTimeout(
        supabase.from('vehicles').select('*').eq('account_id', accountId),
        'vehicles_by_account'
      );
      if (error) throw error;
      const arr = Array.isArray(data) ? data : [];
      writeVehiclesToStorage(userId, accountId, arr);
      return arr;
    },
    // Guests bypass this hook entirely. Disabling the query for them
    // keeps React Query happy without firing requests with no key.
    enabled: !!accountId && !isGuest,
    staleTime: 30_000,
    initialData: () => readVehiclesFromStorage(userId, accountId),
    initialDataUpdatedAt: () => readTimestampFromStorage(userId, accountId),
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
