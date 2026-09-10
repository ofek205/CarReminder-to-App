/**
 * usePlanCatalog — every plan the product currently sells.
 *
 * Distinct from useAccountPlan, which answers "what does THIS account get".
 * This one answers "what is on offer", and the two are read from the same
 * table on purpose: docs/spec-monetization-plans-v2.md §5.1 requires the
 * comparison screen to be built from plan_limits so marketing and
 * enforcement cannot contradict each other. A number typed into a component
 * is a number that will disagree with the database the first time a limit is
 * tuned, and tuning by UPDATE with no deploy is the whole point of the table.
 *
 * ⚠️ FILTERS is_public, AND THAT IS NOT OPTIONAL. A retired plan stays in
 * plan_limits because live subscriptions reference it by foreign key
 * (phase 2b added the column for exactly this). Without the filter the screen
 * would advertise a plan nobody can buy and nobody maintains.
 *
 * ⚠️ NO `enabled` GATE. plan_limits is granted to anon as well as
 * authenticated, and the guest state of the comparison screen is one of the
 * few places a signed-out visitor is genuinely being asked to understand the
 * offer. Gating this on a session would blank the screen for exactly the
 * audience it converts.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';

export const PLAN_CATALOG_QUERY_KEY = 'plan-catalog';

/**
 * Same field names as useAccountPlan's `plan`, so a row from either source
 * can be read by the same rendering code. NULL means unlimited throughout,
 * and is preserved rather than coerced: 0 would mean "none allowed", the
 * exact opposite.
 */
function normalize(row) {
  return {
    code:                row.plan,
    labelHe:             row.label_he,
    priceIlsMonth:       Number(row.price_ils_month),
    maxVehicles:         row.max_vehicles ?? null,
    aiDailyCap:          row.ai_daily_cap ?? null,
    aiLifetimeTeaser:    row.ai_lifetime_teaser ?? null,
    plateChecksPerMonth: row.plate_checks_per_month ?? null,
    maxShares:           row.max_shares ?? null,
    businessUi:          !!row.business_ui,
    sortOrder:           Number(row.sort_order),
  };
}

export default function usePlanCatalog() {
  const query = useQuery({
    queryKey: [PLAN_CATALOG_QUERY_KEY],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase
          .from('plan_limits')
          .select('plan, label_he, price_ils_month, max_vehicles, ai_daily_cap, ai_lifetime_teaser, plate_checks_per_month, max_shares, business_ui, sort_order')
          .eq('is_public', true)
          .order('sort_order', { ascending: true }),
        'plan_catalog',
      );
      if (error) throw error;
      return (Array.isArray(data) ? data : []).map(normalize);
    },
    // Half an hour: this table changes when a price is tuned, which is a
    // deliberate human act a few times a year, not something to poll for.
    staleTime: 30 * 60_000,
    retry: 1,
    retryDelay: 500,
  });

  const plans = Array.isArray(query.data) ? query.data : [];

  return {
    plans,
    /** The zero-price plan. */
    free: plans.find((p) => p.priceIlsMonth === 0) || null,
    /**
     * Everything with a price, in sort order. Their limits are identical
     * apart from maxVehicles today, but the screen reads each value from the
     * SELECTED plan rather than assuming that, so a future divergence shows
     * up on screen instead of being silently flattened.
     */
    paid: plans.filter((p) => p.priceIlsMonth > 0),
    isLoading: query.isLoading,
    isError:   query.isError,
    refetch:   query.refetch,
  };
}
