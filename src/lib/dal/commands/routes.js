/**
 * Route write commands (business fleet: a route is a vehicle + ordered stops).
 *
 * All three are SECURITY DEFINER RPCs that re-check the caller's role, and all
 * three resolve to the raw { data, error } envelope their call sites already
 * branch on (`if (error) throw error`, plus create needs `data` for the new
 * route id). Same deliberate Phase-0 choice as repair.save / reminderSnooze.upsert
 * — normalizing the envelope is a Phase-2 task.
 *
 * OFFLINE BOUNDARY (§3 + the single-writer rule from §10.3):
 *   - updateStopStatus / addStopDocumentation are the driver's own field
 *     actions on their own assigned stop — single-writer, and exactly the
 *     "no signal at the delivery point" case. offlineCapable: true.
 *   - createWithStops is a manager action: transactional across routes +
 *     route_stops and depends on server-side geocoding of the addresses, so it
 *     cannot be replayed meaningfully offline. offlineCapable: false.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

defineCommand('route.createWithStops', {
  offlineCapable: false,
  table: 'routes',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ accountId, vehicleId, driverUserId, title, notes, scheduledFor, stops }) =>
    supabase.rpc('create_route_with_stops', {
      p_account_id:              accountId,
      p_vehicle_id:              vehicleId,
      p_assigned_driver_user_id: driverUserId,
      p_title:                   title,
      p_notes:                   notes,
      p_scheduled_for:           scheduledFor,
      p_stops:                   stops,
    }),
});

defineCommand('route.updateStopStatus', {
  offlineCapable: true,
  table: 'route_stops',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ stopId, status, note }) =>
    supabase.rpc('update_stop_status', {
      p_stop_id: stopId,
      p_status:  status,
      p_note:    note ?? null,
    }),
});

defineCommand('route.addStopDocumentation', {
  offlineCapable: true,
  table: 'route_stops',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ stopId, kind, payload }) =>
    supabase.rpc('add_stop_documentation', {
      p_stop_id: stopId,
      p_kind:    kind,
      p_payload: payload,
    }),
});
