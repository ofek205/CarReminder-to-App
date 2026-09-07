/**
 * Detector for the personal-vehicle-cap block.
 *
 * The trigger enforce_personal_vehicle_cap (supabase-vehicle-cap-2026-07-25.sql)
 * raises, with errcode check_violation:
 *
 *   personal_vehicle_cap_reached: <count> of <cap> vehicles
 *
 * PostgREST surfaces the raised message on err.message, and sometimes copies
 * pieces onto err.details / err.hint. We scan all of them (plus a raw-string
 * fallback) so one detector serves EVERY vehicle-create path — dashboard,
 * AddVehicle, the scan wizard, bulk import. The "you hit the cap" experience
 * must be identical regardless of where the add came from.
 *
 * Note: while enforcement is gated off (app_config.personal_vehicle_cap_
 * enforce_from = null) this never fires, because the trigger returns early.
 * Wiring callers now means they light up the moment enforcement is enabled,
 * with no further client change.
 */
export function isVehicleCapError(err) {
  if (!err) return false;
  const haystack = [
    err.message,
    err.details,
    err.hint,
    err.error_description,
    typeof err === 'string' ? err : '',
  ].filter(Boolean).join(' ');
  return /personal_vehicle_cap_reached/i.test(haystack);
}
