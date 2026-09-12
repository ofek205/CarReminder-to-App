/**
 * useFeatureUsage — how much of each metered allowance the active account
 * has consumed in the CURRENT period.
 *
 * Backed by my_feature_usage(uuid)
 * (supabase-monetization-phase3-counters-2026-09-08.sql), which returns one
 * row per (feature, period_key) and only for features that have usage.
 *
 * ⚠️ SEPARATE FROM useAccountPlan, DELIBERATELY. The plan and the
 * subscription share one query because a card that knows the plan but not
 * the status cannot render at all. Usage is different: it ENHANCES rows
 * that already display their limit. So if this read fails, the limits still
 * show and only the numbers go missing, which is a strictly better outcome
 * than blanking the card.
 *
 * ⚠️ AND THE DISTINCTION THAT MATTERS: "no row" is not "unknown".
 *   query succeeded, no row for a feature  ->  0 used. True and safe.
 *   query failed                           ->  null. Show NO number.
 * Collapsing those two would render "0 of 3 used" for someone who has
 * used all three, which reports an allowance they do not have. Same rule
 * the whole /MyPlan screen is built around.
 *
 * @see docs/plan-monetization-implementation.md §3
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useAccountRole from '@/hooks/useAccountRole';
import { useAuth } from '@/components/shared/GuestContext';

export const FEATURE_USAGE_QUERY_KEY = 'feature-usage';

/**
 * pickUsed(rows, feature, horizon) -> number | null
 *
 * Exported as a pure function so the null-vs-zero rule above can be tested
 * without rendering the hook. The hook's used() just delegates here.
 */
export function pickUsed(rows, feature, horizon) {
  if (!Array.isArray(rows)) return null;            // loading or failed
  const row = rows.find((r) => r?.feature === feature && r?.horizon === horizon);
  // No row is a genuine zero: a counter row only exists once used.
  if (!row) return 0;
  const n = Number(row.used);
  return Number.isFinite(n) ? n : 0;
}

/**
 * sumUsed(rows, features, horizon) -> number | null
 *
 * The same contract as pickUsed, over several buckets at once.
 *
 * Needed because one displayed meter can be bounded by more than one
 * counter: the paid plans' daily AI ceiling is checked in SQL against
 * ai_advisor AND ai_forum together, so a meter reading only ai_advisor would
 * show a smaller number than the ceiling it is drawn against, and the user
 * would be refused at what the screen showed as room to spare.
 *
 * Keeps null meaning "not read" rather than collapsing to 0, exactly as
 * pickUsed does: a partial sum is still an unknown sum. An empty feature
 * list is also null, not 0, because summing nothing is not evidence of zero
 * usage.
 */
export function sumUsed(rows, features, horizon) {
  if (!Array.isArray(rows)) return null;            // loading or failed
  if (!Array.isArray(features) || features.length === 0) return null;
  let total = 0;
  for (const f of features) {
    const row = rows.find((r) => r?.feature === f && r?.horizon === horizon);
    if (!row) continue;                              // genuine zero
    const n = Number(row.used);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Horizons, matching the `horizon` label my_feature_usage() returns.
 *
 * ⚠️ MATCHED ON THE LABEL, NEVER ON period_key. ai_advisor comes back as
 * two rows in one result, lifetime and today, and telling them apart from
 * period_key alone would mean recomputing Israel-time dates in the browser
 * and getting DST right. The server labels them; the client just reads.
 */
export const LIFETIME = 'lifetime';
export const MONTH = 'month';
export const DAY = 'day';

export default function useFeatureUsage() {
  const { accountId } = useAccountRole();
  const { isGuest } = useAuth();

  const query = useQuery({
    queryKey: [FEATURE_USAGE_QUERY_KEY, accountId],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('my_feature_usage', { p_account_id: accountId }),
        'feature_usage',
      );
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: !!accountId && !isGuest,
    // Shorter than the plan's 60s: a user who just asked a question expects
    // the meter to move when they come back to this screen.
    staleTime: 15_000,
    retry: 1,
    retryDelay: 500,
  });

  const rows = query.data;

  return {
    /**
     * used(feature, horizon) -> number | null
     *
     * A number when the read succeeded, including 0 for a feature with no
     * row. null ONLY when the read has not succeeded, which the caller must
     * render as no number rather than as zero.
     */
    used: (feature, horizon) => pickUsed(rows, feature, horizon),
    /** Several buckets at once. See sumUsed above for why this exists. */
    usedSum: (features, horizon) => sumUsed(rows, features, horizon),
    isLoading: query.isLoading,
    isError:   query.isError,
    refetch:   query.refetch,
  };
}
