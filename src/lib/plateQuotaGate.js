/**
 * plateQuotaGate — may this account run another plate check this month?
 *
 * docs/plan-monetization-implementation.md §3.2
 *
 * ⚠️ THIS GATE IS BYPASSABLE, BY DESIGN, AND THAT IS NOT A DEFECT TO FIX
 * LATER. The plate lookup is a fetch from this browser straight to
 * data.gov.il (src/services/vehicleLookup.js:121). No request of ours is in
 * the path, so there is nothing server-side to refuse — unlike the vehicle
 * cap and share cap (database triggers) or the AI quota (checked inside
 * ai-proxy before a provider is called).
 *
 * What that means in practice:
 *   • The dataset is public and free. It was never ours to sell, and what
 *     the paid plans actually sell is the app's handling of it:
 *     normalisation, insights, test policy, ownership history, saving.
 *   • Anyone who opens DevTools can call the lookup directly. Accepted.
 *   • So DO NOT put anything that must not be bypassed behind this, and do
 *     not read a passing verdict here as proof a check was paid for.
 *
 * The COUNT still lives on the server, and that part matters: a counter in
 * localStorage would reset when the user clears their browser and would
 * disagree between their phone and their laptop.
 *
 * ⚠️ FAILS OPEN. A failed read allows the check. Same direction as
 * aiScanGate and for the same reason: this is a commercial gate on a public
 * dataset, not a security boundary, and a Supabase blip must not tell a
 * paying user their plate check is unavailable. Contrast with the vehicle
 * and share caps, which fail closed because there the refusal IS the
 * product promise.
 */

import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { capWallAction } from '@/lib/billingGate';

/**
 * A number, or null for "not a number" INCLUDING null and undefined.
 *
 * ⚠️ NOT Number.isFinite(Number(v)). Number(null) is 0 and Number('') is 0,
 * both of which pass isFinite, so a NULL limit would arrive as 0. That is
 * the exact inversion of what NULL means in plan_limits (unlimited), and it
 * is not merely a display bug: limit 0 with remaining 0 makes the batch
 * check below refuse every lookup on an unlimited paid plan.
 */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Shape returned when we could not get an answer. Always allowed. */
const UNKNOWN = Object.freeze({
  allowed: true,
  reason: null,
  limit: null,
  used: null,
  remaining: null,
  known: false,
});

/**
 * Ask the server whether this caller may run `howMany` more plate checks.
 *
 * @param {number} howMany how many checks are about to happen. 1 for the
 *   single-plate surfaces; the row count for a bulk import, because a batch
 *   of 200 that reports as one check would let a 3-a-month account consume
 *   200 and stay "within" its cap.
 * @returns {Promise<{allowed:boolean, reason:string|null, limit:number|null,
 *   used:number|null, remaining:number|null, known:boolean}>}
 *   `known: false` means we could not tell and defaulted to allowing.
 */
export async function checkPlateQuota(howMany = 1) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('my_plate_quota'),
      'my_plate_quota',
    );
    if (error) throw error;
    if (!data || typeof data !== 'object') return UNKNOWN;

    // The flag is off, or the plan is unlimited, or there is no account.
    if (data.allowed === true && data.reason == null) {
      // A NULL limit is unlimited. Report it as known so a caller can say
      // "unlimited" rather than showing nothing.
      const limit = numOrNull(data.limit);
      const used = numOrNull(data.used);
      const remaining = numOrNull(data.remaining);

      // Already at or under the cap for ONE check, but a bulk batch can
      // still overrun it. Decided here rather than in SQL because the
      // server answers "may you do one more", and only the caller knows how
      // many it is about to do.
      if (limit !== null && remaining !== null && howMany > remaining) {
        return {
          allowed: false,
          reason: 'plate_quota_reached',
          limit, used, remaining,
          known: true,
        };
      }
      return { allowed: true, reason: null, limit, used, remaining, known: true };
    }

    return {
      allowed: false,
      reason: typeof data.reason === 'string' ? data.reason : 'plate_quota_reached',
      limit: numOrNull(data.limit),
      used: numOrNull(data.used),
      remaining: numOrNull(data.remaining),
      known: true,
    };
  } catch (err) {
    // Includes the pre-migration case, where the function does not exist.
    // Not reported: an expected degraded state is not an error worth a row.
    if (import.meta.env.DEV) {
      console.warn('[plateQuotaGate] read failed, allowing:', err?.message);
    }
    return UNKNOWN;
  }
}

/**
 * Is this a refusal from the plate quota, as opposed to any other failure?
 *
 * Kept as a predicate so the four call sites do not each re-derive it from
 * a string, which is how the share dialog ended up showing raw error codes
 * to users when four of seven live codes went unmapped.
 */
export function isPlateQuotaRefusal(verdict) {
  return !!verdict && verdict.allowed === false && verdict.reason === 'plate_quota_reached';
}

/**
 * The words for a plate-quota refusal, decided ONCE.
 *
 * ⚠️ THIS EXISTS SO THE ANTI-STEERING RULE LIVES IN ONE PLACE. Four surfaces
 * can hit this wall (VehicleCheck, AddVehicle, AddAccident, BulkAddVehicles),
 * and App Store Guideline 3.1.1(a) covers PROSE, not just controls: on iOS
 * none of them may mention that a paid plan exists. Four copies of that
 * judgement is four chances for one of them to be wrong, and the one that is
 * wrong is a review rejection. So the platform question is asked here, from
 * capWallAction, the same source the vehicle-cap wall and the share-cap
 * toast use.
 *
 * Stating the user's OWN limit is fine on every platform: that is a fact
 * about the account they have, not a pitch for one they do not.
 *
 * @returns {{title:string, body:string, cta:'plan'|null}} `cta` is non-null
 *   only where a link is permitted, which today is the web alone.
 */
export function plateQuotaCopy(verdict) {
  const { cta, mayMentionPlans } = capWallAction('plan');
  const limit = verdict?.limit;
  const used = verdict?.used;
  // Only claim numbers the server gave us. `known: false` means the read
  // failed, and "0 מתוך 0" reads as a bug rather than as a limit.
  const hasNumbers = Number.isFinite(limit) && Number.isFinite(used);

  const parts = [];
  parts.push(hasNumbers
    ? `השתמשת ב-${used} מתוך ${limit} הבדיקות שלך לחודש הזה.`
    : 'הבדיקות שלך לחודש הזה נוצלו.');
  parts.push('המכסה מתאפסת ב-1 בחודש.');
  if (mayMentionPlans) parts.push('במסלול בתשלום הבדיקות ללא הגבלה.');

  return {
    title: 'נוצלו בדיקות הרכב לחודש הזה',
    body: parts.join(' '),
    cta: cta === 'plan' ? 'plan' : null,
  };
}
