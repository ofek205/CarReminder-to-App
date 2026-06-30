/**
 * Vehicle write commands.
 *
 * vehicle.update is the workhorse of the domain — it backs every owner field
 * edit (mileage, completion sheet, edit form, quick edits, scan wizard). It
 * routes to the db.vehicles entity layer (sanitize + withTimeout + throw).
 * offlineCapable: single-row, owner-scoped.
 *
 * Migrated incrementally — additional vehicle commands (create, delete, and the
 * online-required deleteWithShareChoice / driver RPCs) are registered as their
 * call sites move onto the seam, so each command lands with its first consumer.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('vehicle.update', {
  offlineCapable: true,
  table: 'vehicles',
  run: ({ id, ...changes }) => db.vehicles.update(id, changes),
});
