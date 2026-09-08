/**
 * vehicleCapRoom — will adding N vehicles fit under this account's plan cap?
 *
 * docs/plan-monetization-implementation.md §3.4.ב ("חסימה מקדימה")
 *
 * ⚠️ A COURTESY CHECK, NOT THE ENFORCEMENT, AND THE DIFFERENCE DECIDES THE
 * FAIL DIRECTION. The real cap is a statement-level trigger on
 * public.vehicles (phase 4), which cannot be bypassed and is the only
 * authority. This read exists so the user is not walked into a dead end:
 * without it, a free account at its cap fills a long form (or waits through
 * a 200-row import that spends 200 gov API lookups) and is refused at the
 * very last step.
 *
 * So this FAILS OPEN. If the read fails, proceed and let the trigger decide.
 * The trigger's refusal is already mapped to a friendly modal
 * (src/lib/vehicleCapError.js), so the worst case of a failed pre-check is
 * the behaviour that existed before this file: refused at submit, with a
 * clear explanation. Failing closed would be strictly worse, because it
 * would block an account the database would have accepted.
 *
 * This is the OPPOSITE direction from plateQuotaGate, and for a reason
 * worth keeping straight: there the client IS the enforcement (the lookup
 * never touches our server), so its verdict is all there is. Here the client
 * is only trying to save the user a wasted journey.
 *
 * ⚠️ AND IT MUST NOT REIMPLEMENT THE RULE. `fits` is computed server-side by
 * vehicle_cap_room, which the phase-4 file wrote to mirror the trigger
 * exactly, grace and NULL-cap included. Deriving "fits" here from cap and
 * used would create a second copy of the rule that can disagree with the
 * database, and the phase-4 comment says what that costs: "the client shows
 * a refusal the database would have allowed, or the reverse."
 */

import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';

/** Returned when we could not get an answer. Always fits: see FAILS OPEN. */
const UNKNOWN = Object.freeze({
  fits: true,
  cap: null,
  used: null,
  adding: null,
  inGrace: false,
  known: false,
});

/**
 * @param {string} accountId the account the vehicles would be added to.
 * @param {number} adding how many are about to be added. Pass the real
 *   number for a bulk import: asking about 1 and then inserting 200 is the
 *   same class of mistake as counting a batch as one check.
 */
export async function checkVehicleCapRoom(accountId, adding = 1) {
  if (!accountId) return UNKNOWN;
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('vehicle_cap_room', { p_account_id: accountId, p_adding: adding }),
      'vehicle_cap_room',
    );
    if (error) throw error;
    if (!data || typeof data !== 'object') return UNKNOWN;

    return {
      // Only an explicit false is a refusal. A missing or unparseable `fits`
      // must not become one, or a shape change in the RPC would start
      // blocking users the database would accept.
      fits: data.fits !== false,
      cap: numOrNull(data.cap),
      used: numOrNull(data.used),
      adding: numOrNull(data.adding),
      inGrace: data.in_grace === true,
      known: true,
    };
  } catch (err) {
    // Includes the pre-migration case: before phase 4 is applied the
    // function does not exist, and the cap is not enforced anywhere either,
    // so allowing is also the correct answer.
    if (import.meta.env.DEV) {
      console.warn('[vehicleCapRoom] read failed, proceeding:', err?.message);
    }
    return UNKNOWN;
  }
}

/** See the note in plateQuotaGate: Number(null) is 0 and passes isFinite. */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Did the server actually tell us this will not fit? */
export function isCapRefusal(room) {
  return !!room && room.known === true && room.fits === false;
}
