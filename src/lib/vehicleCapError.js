/**
 * Detector for a vehicle-cap block.
 *
 * ⚠️ THERE ARE NOW TWO CAPS, WITH DIFFERENT ANSWERS.
 *
 *   personal_vehicle_cap_reached   enforce_personal_vehicle_cap
 *                                  (supabase-vehicle-cap-2026-07-25.sql).
 *                                  The pre-monetization personal cap, whose
 *                                  ceiling is accounts.vehicle_cap and whose
 *                                  answer is "open a business account".
 *
 *   vehicle_plan_cap_exceeded      enforce_vehicle_plan_cap_stmt
 *                                  (supabase-monetization-phase4-...sql).
 *                                  The plan cap, whose ceiling is
 *                                  plan_limits.max_vehicles and whose answer
 *                                  is a paid PLAN. A business account is not
 *                                  the answer any more, because ₪9 already
 *                                  includes the business interface (spec ח-2).
 *
 * Telling them apart matters: showing accounts.vehicle_cap after a refusal at
 * the plan cap would print "5 of 10" and offer a product the user may already
 * be entitled to. Hence vehicleCapKind() alongside the boolean.
 *
 * PostgREST surfaces the raised message on err.message and sometimes copies
 * pieces onto err.details / err.hint, so all of them are scanned plus a raw
 * string fallback. One detector serves EVERY vehicle-create path, which is
 * what keeps the wall identical no matter where the add came from.
 */

const PLAN_CAP = /vehicle_plan_cap_exceeded/i;
const PERSONAL_CAP = /personal_vehicle_cap_reached/i;

function haystack(err) {
  if (!err) return '';
  return [
    err.message,
    err.details,
    err.hint,
    err.error_description,
    typeof err === 'string' ? err : '',
  ].filter(Boolean).join(' ');
}

/**
 * Which cap refused this, or null when the error is something else.
 *
 * ⚠️ THE PLAN CAP IS CHECKED FIRST, DELIBERATELY. If a future message
 * somehow carried both, the plan cap is the one whose remedy is correct
 * under the current product: sending someone to open a business account for
 * a plan-cap refusal is the mistake this function exists to prevent.
 *
 * @returns {'plan'|'personal'|null}
 */
export function vehicleCapKind(err) {
  const h = haystack(err);
  if (!h) return null;
  if (PLAN_CAP.test(h)) return 'plan';
  if (PERSONAL_CAP.test(h)) return 'personal';
  return null;
}

/**
 * Was this any kind of vehicle-cap block?
 *
 * Kept as a boolean so the three existing call sites keep working unchanged,
 * and widened to cover the plan cap so they light up when phase 4's flag is
 * turned on instead of falling through to a generic failure.
 */
export function isVehicleCapError(err) {
  return vehicleCapKind(err) !== null;
}
