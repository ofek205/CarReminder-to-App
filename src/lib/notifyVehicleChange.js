/**
 * notifyVehicleChange — fire-and-forget helper that notifies all
 * other parties of a shared vehicle when an edit happens.
 *
 * Backed by the SECURITY DEFINER RPC `public.notify_vehicle_change`.
 * The RPC is idempotent + a no-op when no other parties exist on the
 * vehicle, so we don't gate calls client-side — calling it for an
 * unshared vehicle is cheaper than running an extra share-count
 * lookup before every save.
 *
 * Failures are intentionally swallowed: the user just successfully
 * saved their data; surfacing a "couldn't notify others" toast on
 * top of that would be noise. We log in DEV so missed notifications
 * are visible during development.
 */

import { supabase } from './supabase';

/**
 * @param {string} vehicleId
 * @param {string} changeType  e.g. 'repair_added' | 'maintenance_updated' | 'document_added' | 'vehicle_updated'
 * @param {string} summary     short Hebrew sentence for the body
 */
export async function notifyVehicleChange(vehicleId, changeType, summary) {
  if (!vehicleId) return;
  try {
    await supabase.rpc('notify_vehicle_change', {
      p_vehicle_id: vehicleId,
      p_change_type: changeType,
      p_summary: summary || '',
    });
  } catch (e) {
    if (import.meta.env?.DEV) {
      console.warn('[notifyVehicleChange] failed:', e?.message);
    }
  }
}
