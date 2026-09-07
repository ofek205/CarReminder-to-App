/**
 * Maintenance write commands — service/repair log rows + the per-user
 * maintenance-reminder preferences ("templates").
 *
 * maintenance_logs was written via raw supabase.from(...) with no {error}
 * check, so DB failures were swallowed and the save still looked successful.
 * Routing through db.maintenance_logs gives it sanitize + withTimeout +
 * throw-on-error; both call sites already have try/catch + toastError, so the
 * failure now surfaces properly instead of silently losing the entry.
 *
 * offlineCapable: single-row, owner-scoped. (Receipt-file uploads are a
 * separate concern — Phase 5's upload queue.)
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';

defineCommand('maintenance.create', {
  offlineCapable: true,
  table: 'maintenance_logs',
  run: (payload) => db.maintenance_logs.create(payload),
});

defineCommand('maintenance.update', {
  offlineCapable: true,
  table: 'maintenance_logs',
  run: ({ id, ...changes }) => db.maintenance_logs.update(id, changes),
});

defineCommand('maintenance.delete', {
  offlineCapable: true,
  table: 'maintenance_logs',
  run: ({ id }) => db.maintenance_logs.delete(id),
});

defineCommand('maintPref.create', {
  offlineCapable: true,
  table: 'maintenance_reminder_prefs',
  run: (payload) => db.maintenance_reminder_prefs.create(payload),
});

defineCommand('maintPref.update', {
  offlineCapable: true,
  table: 'maintenance_reminder_prefs',
  run: ({ id, ...changes }) => db.maintenance_reminder_prefs.update(id, changes),
});

defineCommand('maintPref.delete', {
  offlineCapable: true,
  table: 'maintenance_reminder_prefs',
  run: ({ id }) => db.maintenance_reminder_prefs.delete(id),
});
