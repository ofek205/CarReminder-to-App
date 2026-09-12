/**
 * useVehicleCapacity — single source of truth for "how full is this personal
 * account", backed by the my_vehicle_capacity() RPC
 * (supabase-vehicle-cap-2026-07-25.sql).
 *
 * Why a server RPC and not a client-side count (edge-cases doc P1-8):
 *   - Shared vehicles must NOT count toward the owner's cap. A merged
 *     owned+shared list would over-count and show a false "full".
 *   - The cap itself lives on accounts.vehicle_cap (frozen per account).
 *   The UI never derives capacity by counting — it asks the server.
 *
 * Returns:
 *   { accountType, count, cap, remaining, isCapped, isGrandfathered,
 *     isLoading, isError, refetch }
 *
 * For a business account isCapped is false and cap/remaining are null.
 * Guests and unresolved accounts return the idle default (isCapped false).
 *
 * Query Timeout Gate: the Supabase call is wrapped in withTimeout, and the
 * hook exposes isError + refetch so any consumer can show a retry instead of
 * a stuck spinner.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useAccountRole from '@/hooks/useAccountRole';
import { useAuth } from '@/components/shared/GuestContext';

export const VEHICLE_CAPACITY_QUERY_KEY = 'vehicle-capacity';

export default function useVehicleCapacity() {
  const { accountId } = useAccountRole();
  const { isGuest } = useAuth();

  const query = useQuery({
    queryKey: [VEHICLE_CAPACITY_QUERY_KEY, accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('my_vehicle_capacity', { p_account_id: accountId }),
        'vehicle_capacity',
      );
      if (error) throw error;
      return data || null;
    },
    enabled: !!accountId && !isGuest,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 500,
  });

  const d = query.data || {};
  return {
    accountType:     d.account_type ?? null,
    count:           d.count ?? 0,
    cap:             d.cap ?? null,
    remaining:       d.remaining ?? null,
    isCapped:        !!d.is_capped,
    isGrandfathered: !!d.is_grandfathered,
    isLoading:       query.isLoading,
    isError:         query.isError,
    refetch:         query.refetch,
  };
}
