/**
 * useAccountPlan — which monetization plan the ACTIVE ACCOUNT is on.
 *
 * Backed by the my_account_plan(uuid) RPC
 * (supabase-monetization-phase1-plans-2026-09-08.sql), which wraps
 * account_plan() behind the project's standard membership gate.
 *
 * ⚠️ THE HARD RULE THIS HOOK EXISTS TO ENFORCE
 *   A failed read must never look like an empty allowance. The obvious
 *   shape, returning `{ maxVehicles: 0 }` or falling back to the free plan
 *   on error, produces a screen reading "0 of 5 vehicles" for someone who
 *   may hold thirty. That is not a display glitch: it reports an
 *   entitlement the user does not have, or denies one they do.
 *
 *   So `plan` is null until it is genuinely known, and `isError` is the
 *   caller's cue to render a banner instead of numbers. There is no
 *   defaultOnError here on purpose.
 *
 *   The enforcement decision is NEVER made from this hook. Phase 4 enforces
 *   in a Postgres trigger. This is display only, and a client that believes
 *   it has a higher cap cannot grant itself one.
 *
 * Query Timeout Gate: the call is wrapped in withTimeout and the hook
 * exposes isError + refetch, so no consumer can end up on a stuck spinner.
 *
 * @see docs/ux-my-plan.md
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import useAccountRole from '@/hooks/useAccountRole';
import { useAuth } from '@/components/shared/GuestContext';

export const ACCOUNT_PLAN_QUERY_KEY = 'account-plan';

export default function useAccountPlan() {
  const { accountId } = useAccountRole();
  const { isGuest } = useAuth();

  const query = useQuery({
    queryKey: [ACCOUNT_PLAN_QUERY_KEY, accountId],
    queryFn: async () => {
      // Two reads, ONE query. The screen needs the limits and the
      // subscription state together: a plan with no status renders a card
      // that cannot say whether it is active, in grace, or cancelled, and
      // half a card is exactly the partial truth this hook exists to
      // prevent. Sharing one query key means one isLoading and one isError
      // for the whole picture.
      const { data: planData, error: planErr } = await withTimeout(
        supabase.rpc('my_account_plan', { p_account_id: accountId }),
        'account_plan',
      );
      if (planErr) throw planErr;
      // PostgREST returns an object for a scalar composite and an array if
      // the function ever becomes SETOF. Tolerate both rather than trusting
      // today's shape.
      const plan = Array.isArray(planData) ? planData[0] : planData;
      if (!plan) throw new Error('account_plan returned no row');

      const { data: sub, error: subErr } = await withTimeout(
        supabase
          .from('account_subscriptions')
          .select('plan, status, current_period_end, grace_until, source')
          .eq('account_id', accountId)
          .maybeSingle(),
        'account_subscription',
      );
      if (subErr) throw subErr;

      // A missing row is NOT an error. Accounts created after the phase-1
      // backfill have none until phase 2b writes one, and account_plan()
      // already resolves them to free. It does mean "no grace, no renewal
      // date", which is correct: an account that never had a plan has
      // never been over a limit either.
      return { plan, sub: sub || null };
    },
    // A guest has no account and therefore no plan. Disabled rather than
    // erroring, so the screen can show its guest state instead of a
    // failure the user cannot act on.
    enabled: !!accountId && !isGuest,
    staleTime: 60_000,
    retry: 1,
    retryDelay: 500,
  });

  const p = query.data?.plan || null;
  const s = query.data?.sub || null;

  return {
    // null until known. NEVER a fallback plan.
    plan: p ? {
      code:            p.plan,
      labelHe:         p.label_he,
      priceIlsMonth:   Number(p.price_ils_month),
      // null means unlimited, throughout. Kept as null rather than
      // normalised to Infinity or -1 so a caller that forgets to handle it
      // renders nothing, instead of rendering a wrong number.
      maxVehicles:     p.max_vehicles ?? null,
      aiDailyCap:      p.ai_daily_cap ?? null,
      aiLifetimeTeaser: p.ai_lifetime_teaser ?? null,
      plateChecksPerMonth: p.plate_checks_per_month ?? null,
      maxShares:       p.max_shares ?? null,
      businessUi:      !!p.business_ui,
    } : null,

    // Subscription state. All null when the account has no row yet, which
    // means free with no grace and no renewal date.
    subscription: s ? {
      status:           s.status,
      source:           s.source,
      currentPeriodEnd: s.current_period_end,
      graceUntil:       s.grace_until,
    } : null,

    // Whether the account is inside a grace window right now. Computed here
    // rather than at the call sites, so no screen invents its own opinion
    // about whether grace has expired.
    graceDaysLeft: graceDaysLeft(s?.grace_until),

    isGuest,
    // isLoading is false for a disabled query in React Query v5, so a guest
    // is never reported as loading forever.
    isLoading: query.isLoading,
    isError:   query.isError,
    refetch:   query.refetch,
  };
}

/**
 * Whole days remaining on a grace window, or null when there is no live
 * grace. Rounds UP, so the last partial day still reads as "1 day left"
 * instead of "0", which would tell someone their grace had expired while
 * it was still running.
 */
export function graceDaysLeft(graceUntil) {
  if (!graceUntil) return null;
  const end = new Date(graceUntil).getTime();
  if (!Number.isFinite(end)) return null;
  const ms = end - Date.now();
  if (ms <= 0) return null;                       // expired, not "0 days"
  return Math.ceil(ms / 86_400_000);
}

/**
 * Percent of an allowance consumed, or null when there is nothing to show.
 *
 * Exported and pure so the "never invent a number" rule is testable.
 * Returns null for an unlimited cap (nothing to fill), for a missing cap,
 * and for a count we do not have. A caller that gets null must render no
 * meter at all rather than an empty one.
 */
export function usagePercent(used, cap) {
  if (cap === null || cap === undefined) return null;   // unlimited
  if (!Number.isFinite(cap) || cap <= 0) return null;
  if (!Number.isFinite(used) || used < 0) return null;
  return Math.min(100, Math.round((used / cap) * 100));
}

/**
 * Severity of a usage level, as three named steps rather than a gradient so
 * the meaning is unambiguous: below 80% is fine, 80% and up is the
 * conversion moment, at or over the cap is the blocked state.
 */
export function usageLevel(pct) {
  if (pct === null || pct === undefined) return 'none';
  if (pct >= 100) return 'full';
  if (pct >= 80) return 'near';
  return 'ok';
}
