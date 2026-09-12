/**
 * Usage counting for the monetization quotas. Phase 3: COUNT, DO NOT BLOCK.
 *
 * Nothing here refuses anything. The point of counting first is to learn
 * what real usage looks like before a cap is chosen, so that "3 plate checks
 * a month" is a decision made from a report instead of from complaints.
 *
 * @see docs/plan-monetization-implementation.md §3
 * @see supabase-monetization-phase3-counters-2026-09-08.sql
 */

import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';

// Feature names, matching feature_usage_counters.feature's CHECK.
//
// ⚠️ AI_ADVISOR belongs here even though the client never WRITES it: the
// advisor counter is incremented server-side in ai-proxy, but /MyPlan reads
// it to render the meter. This is not the exemption list that was
// deliberately moved to supabase/functions/_shared/aiQuota.ts. That list
// decides what is free and must live where it is enforced; this is just the
// row's name. Getting it wrong is silent, not exploitable: an undefined
// feature matches no row and the meter reads a permanent zero.
export const AI_ADVISOR = 'ai_advisor';
// The community forum's expert reply. A separate bucket from AI_ADVISOR
// because the free plan's lifetime teaser is measured against the advisor
// alone: the forum reply fires when a user posts rather than when they ask,
// so charging it to the teaser would spend a free user's single question on
// something they never requested. The paid plans' daily ceiling sums both,
// which is why /MyPlan's daily meter reads them together. The routing lives
// in supabase/functions/_shared/aiQuota.ts, where it is enforced.
export const AI_FORUM = 'ai_forum';
export const PLATE_CHECK = 'plate_check';


/**
 * The plate-lookup call sites, and whether each one is charged.
 *
 * Exported as data rather than left as prose because phase 3's only job is
 * measurement, and a call site that is silently not counted makes the
 * resulting numbers wrong in the direction that sets the cap too low.
 *
 * ⚠️ AddVehicle's "search plate" button is the one that matters most. It is
 * an explicit, user-initiated lookup returning the full specification, so
 * leaving it uncounted would mean a free user pulling unlimited full-spec
 * lookups just by opening /AddVehicle and searching without saving.
 */
export const PLATE_LOOKUP_SITES = Object.freeze({
  vehicle_check:      { counted: true,  why: 'the canonical "check a plate" feature' },
  add_vehicle_search: { counted: true,  why: 'explicit user lookup returning the full spec' },
  add_accident:       { counted: true,  why: 'third-party plate lookup that fills the form' },
  bulk_add:           { counted: true,  why: 'N lookups per import, the largest single harvest' },
  // Not user-initiated, so not charged. Someone who already paid for a
  // lookup must not be charged again when the app refreshes it by itself.
  auto_enrich:        { counted: false, why: 'runs on page open, not requested' },
  save_enrich:        { counted: false, why: 'enrichment on save, already charged at search' },
  cron:               { counted: false, why: 'gov-sync / recalls / test-renewals' },
});

/** Should a lookup from this call site be counted? Unknown sites count. */
export function plateLookupCounts(site) {
  const entry = PLATE_LOOKUP_SITES[site];
  // Deny-by-default again: a call site added later without a decision is
  // counted rather than silently free.
  if (!entry) return true;
  return entry.counted;
}

/**
 * Record one unit of usage. Fire-and-forget, and NEVER throws.
 *
 * ⚠️ COUNTING MUST NOT BE ABLE TO BREAK THE FEATURE IT COUNTS. In phase 3
 * nothing is enforced, so a failed count costs a row of analytics; letting
 * it reject would cost the user their plate check. Phase 5 is where a
 * failure has to become a decision, and it will make that decision on the
 * server, where it cannot be skipped.
 *
 * @param {string} accountId
 * @param {'ai_advisor'|'plate_check'} feature
 * @param {'lifetime'|'month'|'day'} horizon
 * @returns {Promise<number|null>} the new count, or null if it did not land
 */
export async function bumpUsage(accountId, feature, horizon, delta = 1) {
  if (!accountId) return null;
  // Clamped here too, matching the server. A bulk import of 200 vehicles is
  // one call rather than 200, and the server refuses anything outside
  // 1..500 so a bad local value cannot corrupt a counter.
  const n = Number(delta);
  if (!Number.isInteger(n) || n < 1 || n > 500) return null;
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('bump_my_feature_usage', {
        p_account_id: accountId,
        p_feature: feature,
        p_horizon: horizon,
        p_delta: n,
      }),
      'bump_usage',
    );
    if (error) throw error;
    return typeof data === 'number' ? data : null;
  } catch {
    // Silent on purpose. Before the phase-3 migration this RPC does not
    // exist, and every call would otherwise log an error on a path the user
    // takes constantly.
    return null;
  }
}

/**
 * Count a plate lookup, if this call site is charged.
 *
 * The lookup itself is a direct browser fetch to data.gov.il with no edge
 * function in the path (§3.2), so this is the only place it can be counted.
 * That also means it is skippable by a determined user; §3.2 accepts this
 * knowingly, because what is sold is the formatted report and the plate data
 * is public regardless.
 */
export function countPlateLookup(accountId, site, howMany = 1) {
  if (!plateLookupCounts(site)) return Promise.resolve(null);
  return bumpUsage(accountId, PLATE_CHECK, 'month', howMany);
}
