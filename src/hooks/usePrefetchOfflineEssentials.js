/**
 * Warm the offline cache with data the user has not opened yet.
 *
 * WHY THIS EXISTS
 *
 * Offline READS only ever show what was actually fetched while online — there
 * is no way to produce a row the device never downloaded. In practice that made
 * offline "works for the screens I happened to visit": open Documents for the
 * first time with no signal and the screen loads (its chunk is pre-cached) but
 * renders an empty list, which reads as data loss rather than as absence.
 *
 * Test and insurance dates needed nothing: they live on the vehicle row, and
 * `useMyVehicles` does `select('*')`, so `my-vehicles` already carries them into
 * the persisted cache. Verified against a real account — the snapshot held
 * `user-workspaces` and `my-vehicles`. Documents were the actual gap.
 *
 * THE KEY HAS TO MATCH EXACTLY, or this silently caches something no screen
 * ever reads: bandwidth spent, nothing gained, and it would still LOOK like it
 * worked. The key mirrors Documents.jsx:1198 part for part —
 * `['documents', accountId, vehicleIdParam, restrictToDriverAssignments,
 * driverAssignedVehicleIds?.join(',')]` — which for the default unfiltered view
 * of a non-driver is `[..., null, false, undefined]`. (React Query hashes with
 * JSON.stringify, where a `null` and an `undefined` in the same array position
 * are equivalent, so those two are interchangeable here. The expressions are
 * kept literal anyway, so a future reader can compare them against the page
 * without having to know that.)
 *
 * DRIVERS ARE SKIPPED on purpose. A restricted driver's key includes the list
 * of vehicles assigned to them, which resolves in its own async query, so a
 * boot-time prefetch would key against `null` and miss. Their documents are
 * also a much smaller set that the page filters client-side. Prefetching the
 * wrong key is worse than not prefetching: it costs data and buys nothing.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { documentsListKey } from '@/lib/queryKeys';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useOnlineStatus from '@/hooks/useOnlineStatus';

export default function usePrefetchOfflineEssentials() {
  const queryClient = useQueryClient();
  const { accountId } = useAccountRole();
  const { isBusiness, isDriver, canManageRoutes } = useWorkspaceRole();
  const isOnline = useOnlineStatus();

  const restrictToDriverAssignments = isBusiness && isDriver && !canManageRoutes;

  useEffect(() => {
    // Only ever runs online: offline there is nothing to fetch, and the whole
    // point is to have already done this before the connection went away.
    if (!isOnline || !accountId) return;
    if (restrictToDriverAssignments) return;

    // Same shape as the page's own queryFn, including the 200-row cap.
    queryClient.prefetchQuery({
      // Same builder the page uses, so these cannot drift apart.
      queryKey: documentsListKey({ accountId }),
      queryFn: () => db.documents.filter(
        { account_id: accountId },
        { order: { column: 'created_at', ascending: false }, limit: 200 },
      ),
    }).catch(() => {
      // Best-effort by definition. A failed warm-up must be invisible: the page
      // still fetches for itself, and offline simply falls back to the empty
      // state it showed before.
    });
  }, [isOnline, accountId, restrictToDriverAssignments, queryClient]);
}
