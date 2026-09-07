/**
 * Vehicle write commands.
 *
 * vehicle.update is the workhorse of the domain — it backs every owner field
 * edit (mileage, completion sheet, edit form, quick edits, scan wizard). It
 * routes to the db.vehicles entity layer (sanitize + withTimeout + throw).
 * offlineCapable: single-row, owner-scoped.
 *
 * The RPC-backed commands at the bottom resolve to the raw { data, error }
 * envelope their call sites already branch on.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';

defineCommand('vehicle.update', {
  offlineCapable: true,
  table: 'vehicles',
  run: ({ id, ...changes }) => db.vehicles.update(id, changes),
});

// Returns the created row — callers need the new id (to attach a scanned
// document, to map guest→account ids during signup migration, etc.).
defineCommand('vehicle.create', {
  offlineCapable: true,
  table: 'vehicles',
  run: (payload) => db.vehicles.create(payload),
});

// Plain delete — only used on the UNSHARED path. A shared vehicle goes through
// delete_vehicle_with_share_choice instead (online-required: it cascades to
// every sharee and notifies them).
defineCommand('vehicle.delete', {
  offlineCapable: true,
  table: 'vehicles',
  run: ({ id }) => db.vehicles.delete(id),
});

// ── RPC-backed (envelope) ──────────────────────────────────────────────────

// ONLINE-REQUIRED: cascades the delete to every sharee and sends each one a
// 'share_deleted' notification. Which path the UI takes is gated on a
// server-computed shareCount, so this can never be replayed from an outbox.
defineCommand('vehicle.deleteWithShareChoice', {
  offlineCapable: false,
  table: 'vehicles',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ vehicleId, mode }) =>
    supabase.rpc('delete_vehicle_with_share_choice', {
      p_vehicle_id: vehicleId, p_mode: mode,
    }),
});

// ONLINE-REQUIRED: a deliberate multi-row desk import (spreadsheet paste), not
// a field action — and it is transactional server-side.
defineCommand('vehicle.bulkAdd', {
  offlineCapable: false,
  table: 'vehicles',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ accountId, vehicles }) =>
    supabase.rpc('bulk_add_vehicles', { p_account_id: accountId, p_vehicles: vehicles }),
});

// OFFLINE-CAPABLE (§10.3 single-writer): a driver reading the odometer on the
// vehicle assigned to them — the canonical "no signal in the parking garage"
// write. The server still enforces the km-cannot-decrease rule and the role.
defineCommand('vehicle.driverUpdateMileage', {
  offlineCapable: true,
  table: 'vehicles',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ vehicleId, newKm }) =>
    supabase.rpc('driver_update_mileage', { p_vehicle_id: vehicleId, p_new_km: newKm }),
});

// OFFLINE-CAPABLE: same reasoning — the driver logging something about their
// own assigned vehicle while out on the road.
defineCommand('vehicle.driverLogEvent', {
  offlineCapable: true,
  table: 'vehicles',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ vehicleId, kind: eventKind, title, description, cost }) =>
    supabase.rpc('driver_log_vehicle_event', {
      p_vehicle_id: vehicleId, p_kind: eventKind,
      p_title: title, p_description: description, p_cost: cost,
    }),
});
