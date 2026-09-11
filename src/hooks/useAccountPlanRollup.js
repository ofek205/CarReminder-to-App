/**
 * useAccountPlanRollup — every account's plan, in one read, for admin screens.
 *
 * Two surfaces needed the same thing and neither could get it: /AdminPlans
 * lists only accounts whose plan is an EXCEPTION, so it could never say how
 * many accounts sit on each plan, and the users CRM is built on
 * `admin_user_list()`, which returns `primary_account_id` and no plan at all.
 *
 * ⚠️ DELIBERATELY NOT A NEW RPC. The RLS policy on account_subscriptions
 * already admits `public.is_admin()` for select (phase 1), so the rollup is a
 * plain read. Adding an RPC would have meant a migration Ofek has to apply
 * before either screen works, to fetch columns an admin may already read.
 *
 * ⚠️ AN ACCOUNT WITH NO ROW IS ON FREE, NOT MISSING. account_plan() resolves
 * the plan through `coalesce(..., 'free')`, so a missing subscription row is
 * not an absent plan, it is the free plan not yet written down. Callers get
 * `planFor()` rather than raw map access so that fallback lives in one place;
 * reading the map directly would make every call site reinvent it, and some
 * would render "unknown" for an account that is simply free.
 *
 * ⚠️ PLAIN `supabase`, NOT `adminSupabase`, AND THAT IS ON PURPOSE. During a
 * view-as session `supabase` is a proxy onto the target's plane, where
 * `is_admin()` is false by construction and this read would quietly return
 * nothing. It is safe here only because ViewAsRouteGuard closes every route
 * whose name starts with "Admin" for the duration, so these screens cannot be
 * open while impersonating. Both callers already read this way; using a
 * different client on one of them would imply a difference that does not
 * exist.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useIsAdmin from '@/hooks/useIsAdmin';

export const PLAN_ROLLUP_QUERY_KEY = 'admin-plan-rollup';

/** The plan an account is on, with the free fallback applied. */
export function planFor(byAccount, accountId) {
  if (!accountId) return null;
  return byAccount?.get(accountId) || 'free';
}

/**
 * Counts per plan code, including the accounts that have no row.
 *
 * @param rows      subscription rows, each { account_id, plan }
 * @param allAccountIds  optional: every account the caller knows about. When
 *        given, accounts absent from `rows` are counted as free rather than
 *        left out, which is what stops the summary under-reporting free.
 */
export function countByPlan(rows, allAccountIds) {
  const counts = {};
  const seen = new Set();
  for (const r of rows || []) {
    if (!r?.account_id) continue;
    seen.add(r.account_id);
    const plan = r.plan || 'free';
    counts[plan] = (counts[plan] || 0) + 1;
  }
  if (Array.isArray(allAccountIds)) {
    for (const id of allAccountIds) {
      if (id && !seen.has(id)) counts.free = (counts.free || 0) + 1;
    }
  }
  return counts;
}

export default function useAccountPlanRollup() {
  const isAdmin = useIsAdmin();

  const query = useQuery({
    queryKey: [PLAN_ROLLUP_QUERY_KEY],
    queryFn: async () => {
      // ⚠️ NO is_public FILTER on plan_limits here, unlike usePlanCatalog.
      // That filter is right for the customer-facing comparison, which must
      // not advertise a retired plan. It is wrong here: an account can still
      // BE on a retired plan, and filtering it out would leave the admin
      // looking at a blank where a real plan is.
      const [subs, plans] = await Promise.all([
        withTimeout(
          supabase.from('account_subscriptions').select('account_id, plan'),
          'admin_plan_rollup',
        ),
        withTimeout(
          supabase.from('plan_limits').select('plan, label_he, price_ils_month, sort_order').order('sort_order'),
          'admin_plan_labels',
        ),
      ]);
      if (subs.error) throw subs.error;
      if (plans.error) throw plans.error;
      return {
        rows: Array.isArray(subs.data) ? subs.data : [],
        plans: Array.isArray(plans.data) ? plans.data : [],
      };
    },
    // Admins only. Without this the read runs for every signed-in user and
    // comes back empty through RLS, which looks like "nobody has a plan".
    enabled: isAdmin === true,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 500,
  });

  const rows  = Array.isArray(query.data?.rows) ? query.data.rows : [];
  const plans = Array.isArray(query.data?.plans) ? query.data.plans : [];
  const byAccount = new Map(rows.map((r) => [r.account_id, r.plan || 'free']));
  const labels = new Map(plans.map((p) => [p.plan, p.label_he || p.plan]));

  return {
    rows,
    plans,
    byAccount,
    /**
     * Human label for a plan code, from plan_limits. Falls back to the code
     * itself rather than to a guess: seeing `p9` is a smaller failure than
     * seeing a price that came from a component instead of the table.
     */
    labelFor: (code) => (code ? labels.get(code) || code : ''),
    /** Rows actually present. Accounts with no row are NOT in here. */
    rowCount: rows.length,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
