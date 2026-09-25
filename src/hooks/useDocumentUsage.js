/**
 * useDocumentUsage — how many documents this account holds, as the document
 * cap trigger counts them, backed by my_document_usage()
 * (supabase-plans-redesign-2026-09-25.sql).
 *
 * ⚠️ NOT A CLIENT-SIDE COUNT, FOR THE SAME REASON AS useVehicleCapacity.
 * documents_select_via_share lets a user SEE documents their own account does
 * not hold, so counting visible rows answers a different question from the
 * one the trigger enforces. A meter reading "3 מתוך 5" while the trigger
 * counts seven is a fabricated headroom, which is worse than no meter.
 *
 * ⚠️ `count` IS NULL WHENEVER THE NUMBER IS NOT KNOWN, AND CALLERS HIDE THE
 * METER THEN. That covers the window before the SQL file is applied (the RPC
 * does not exist yet), a guest, and a failed call. Every one of those is an
 * expected degraded state rather than a fault, so nothing here reports an
 * error: the screen simply shows the vehicles meter alone, exactly as it did
 * before this hook existed.
 *
 * Query Timeout Gate: the Supabase call is wrapped in withTimeout.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useAccountRole from '@/hooks/useAccountRole';
import { useAuth } from '@/components/shared/GuestContext';

export const DOCUMENT_USAGE_QUERY_KEY = 'document-usage';

export default function useDocumentUsage() {
  const { accountId } = useAccountRole();
  const { isGuest } = useAuth();

  const query = useQuery({
    queryKey: [DOCUMENT_USAGE_QUERY_KEY, accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('my_document_usage', { p_account_id: accountId }),
        'document_usage',
      );
      if (error) throw error;
      return typeof data === 'number' ? data : null;
    },
    enabled: !!accountId && !isGuest,
    staleTime: 30_000,
    // One attempt. The likeliest failure today is "function does not exist",
    // which a retry cannot fix and would only delay the screen settling.
    retry: false,
  });

  return {
    count: query.isSuccess ? query.data : null,
    isLoading: query.isLoading,
  };
}
