/**
 * Vehicle write commands.
 *
 * vehicle.update is the workhorse of the domain — it backs every owner field
 * edit (mileage, completion sheet, edit form, quick edits, scan wizard). It
 * routes to the db.vehicles entity layer (sanitize + withTimeout + throw).
 * offlineCapable: single-row, owner-scoped.
 *
 * Still to register as their call sites move onto the seam: the ONLINE-REQUIRED
 * `delete_vehicle_with_share_choice` (cascade + notifies every sharee, gated on
 * a server-computed shareCount) and the driver RPCs.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

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
