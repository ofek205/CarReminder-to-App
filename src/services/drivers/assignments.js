/**
 * Driver-vehicle assignment helpers — works for BOTH:
 *   • registered drivers (driver_assignments.driver_user_id)
 *   • external drivers   (driver_assignments.external_driver_id)
 *
 * Server-side the two are stored in the same table, distinguished by
 * which of the two id columns is non-null. The XOR check is enforced
 * by the driver_assignments_one_driver_check constraint.
 */
import { supabase } from '@/lib/supabase';

/**
 * Assign a registered (auth.users-backed) driver to a vehicle.
 * Wraps the legacy assign_driver RPC.
 *
 * @param {object} args
 * @param {string} args.accountId
 * @param {string} args.vehicleId
 * @param {string} args.driverUserId
 * @param {?string} [args.validFrom]  ISO timestamp, default = now()
 * @param {?string} [args.validTo]    ISO timestamp, null = permanent
 */
export async function assignRegisteredDriver({
  accountId, vehicleId, driverUserId, validFrom = null, validTo = null,
}) {
  const { data, error } = await supabase.rpc('assign_driver', {
    p_account_id:     accountId,
    p_vehicle_id:     vehicleId,
    p_driver_user_id: driverUserId,
    p_valid_from:     validFrom || new Date().toISOString(),
    p_valid_to:       validTo,
  });
  if (error) throw error;
  return data;  // assignment id
}

/** Assign an external driver to a vehicle. */
export async function assignExternalDriver({
  accountId, vehicleId, externalDriverId, validFrom = null, validTo = null,
}) {
  const { data, error } = await supabase.rpc('assign_external_driver', {
    p_account_id:         accountId,
    p_vehicle_id:         vehicleId,
    p_external_driver_id: externalDriverId,
    p_valid_from:         validFrom || new Date().toISOString(),
    p_valid_to:           validTo,
  });
  if (error) throw error;
  return data;
}

/** End an assignment (universal — works for either kind). */
export async function endDriverAssignment(assignmentId) {
  if (!assignmentId) throw new Error('assignmentId required');
  const { error } = await supabase.rpc('end_driver_assignment', {
    p_assignment_id: assignmentId,
  });
  if (error) throw error;
  return true;
}

/**
 * List active assignments for an account. Used by the Drivers page +
 * VehicleDetail integration.
 *
 * Returns one row per assignment (no aggregation here — caller
 * groups by driver/vehicle as needed).
 */
export async function listActiveAssignments({ accountId } = {}) {
  if (!accountId) return [];
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('id, vehicle_id, driver_user_id, external_driver_id, valid_from, valid_to, status')
    .eq('account_id', accountId)
    .eq('status', 'active');
  if (error) throw error;
  return data || [];
}

/** Active assignments for a single external driver. Drives the detail page. */
export async function listAssignmentsForExternalDriver({ accountId, externalDriverId } = {}) {
  if (!accountId || !externalDriverId) return [];
  const { data, error } = await supabase
    .from('driver_assignments')
    .select('id, vehicle_id, valid_from, valid_to, status, created_at')
    .eq('account_id', accountId)
    .eq('external_driver_id', externalDriverId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
