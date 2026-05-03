/**
 * useVehicleExpenses — React hook for the Expenses page.
 *
 * Wraps the read service with @tanstack/react-query so the Expenses
 * screen can ask for "rows + totals for vehicle X in period Y" without
 * touching pagination / aggregation logic itself.
 *
 * Phase 2 (aggregate mode):
 *   • accountId is required.
 *   • vehicleId may be null → returns aggregate totals + rows across
 *     every vehicle the user can see in that account, plus a per-vehicle
 *     breakdown under totals.by_vehicle.
 *
 * Returns:
 *   {
 *     rows, totals, isLoading, isError, error,
 *     hasMore, fetchMore, isFetchingMore,
 *     refetch, queryKey,        // expose key for callers to invalidate after writes
 *   }
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { listVehicleExpenses } from '@/services/expenses';

const PAGE_SIZE = 30;

/**
 * Period helpers — turn the user's filter selection into a {from, to}
 * pair the RPC understands. All inclusive.
 */
export function periodToRange(period) {
  if (!period) return null;
  if (period.type === 'year') {
    const y = period.year;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (period.type === 'month') {
    const y = period.year;
    const m = String(period.month).padStart(2, '0');
    const lastDay = new Date(y, period.month, 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
  }
  if (period.type === 'range') {
    return { from: period.from, to: period.to };
  }
  return null;
}

export function defaultYearPeriod() {
  return { type: 'year', year: new Date().getFullYear() };
}

export default function useVehicleExpenses({ accountId, vehicleId, period, categories }) {
  const range = useMemo(() => periodToRange(period), [period]);
  const cats  = useMemo(
    () => (Array.isArray(categories) && categories.length ? categories.slice().sort() : null),
    [categories]
  );

  // queryKey explicitly includes the (possibly null) vehicleId so
  // switching between aggregate / single-vehicle gets its own cache slot.
  const queryKey = useMemo(
    () => ['vehicle-expenses', accountId, vehicleId ?? '__all__', range?.from, range?.to, cats],
    [accountId, vehicleId, range, cats]
  );

  const queryClient = useQueryClient();

  // Aggregate mode (vehicleId === null) is enabled too — only accountId
  // is required to fire the query.
  const enabled = !!(accountId && range?.from && range?.to);

  const q = useInfiniteQuery({
    queryKey,
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listVehicleExpenses({
      accountId,
      vehicleId,
      from: range.from,
      to:   range.to,
      categories: cats,
      page: pageParam,
      pageSize: PAGE_SIZE,
    }),
    getNextPageParam: (lastPage, allPages) =>
      lastPage?.hasMore ? allPages.length : undefined,
    staleTime: 30 * 1000,
  });

  // Flatten pages → single row array, but keep totals/has_more from the
  // FIRST page only (the totals are filter-aware and identical across
  // pages — no point re-aggregating per page).
  const rows   = useMemo(
    () => (q.data?.pages || []).flatMap(p => p?.rows || []),
    [q.data]
  );
  const totals = q.data?.pages?.[0]?.totals || {
    total: 0, count: 0, by_category: {}, by_source: {}, by_vehicle: {},
  };

  // Invalidate every cached slice for this account regardless of
  // vehicleId — a write in one slice (e.g. adding an expense to vehicle
  // X) should also refresh the aggregate slice.
  const invalidate = () => queryClient.invalidateQueries({
    queryKey: ['vehicle-expenses', accountId],
  });

  return {
    rows,
    totals,
    isLoading:    q.isLoading,
    isError:      q.isError,
    error:        q.error,
    hasMore:      !!q.hasNextPage,
    fetchMore:    q.fetchNextPage,
    isFetchingMore: q.isFetchingNextPage,
    refetch:      q.refetch,
    invalidate,
    queryKey,
  };
}
