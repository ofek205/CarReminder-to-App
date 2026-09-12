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

// The first offline write against a SERVER row, enabled 2026-09-10 once
// updated_at existed on every offline-write table.
//
// `invalidates` doubles as the list key the drain refetches after a queued
// edit lands, and it is the SAME key MaintenanceSection already invalidates by
// hand after a save. One declaration, so the two cannot drift.
//
// WHY THE CONDITIONAL WRITE RUNS ONLINE TOO, not only on a replay:
//   An edit composed against a snapshot that has since been superseded should
//   not blindly overwrite, and that is as true with a connection as without
//   one. Two fleet managers on the same log is the ordinary case.
//
//   It costs one narrow window. MaintenanceSection invalidates without
//   awaiting (deliberately — awaiting an invalidation while offline can hang
//   on a paused refetch, which is the eternal spinner this project forbids),
//   so a user who reopens and re-saves the SAME log within a few hundred ms of
//   the previous save may still hold the pre-save updated_at and be refused.
//   They see "לא נשמר בשרת" and a retry succeeds. A visible, self-correcting
//   refusal is the right side of this trade: the alternative is a silent
//   overwrite, which is the exact class the seam refactor exists to close.
//
//   Without a base version it falls back to a plain update, so any caller that
//   does not supply one keeps today's behaviour exactly.
defineCommand('maintenance.update', {
  offlineCapable: true,
  outboxOp: 'update',
  conflict: 'detect',
  table: 'maintenance_logs',
  invalidates: (p) => [['maintenance-logs-v2', p?.vehicle_id]],
  // baseUpdatedAt is destructured OUT of the changes: it is the version being
  // checked against, not a column to write. Leaving it in would reach
  // sanitizeRow and then Postgres as an unknown column.
  run: ({ id, baseUpdatedAt, ...changes }) => (
    baseUpdatedAt
      ? db.maintenance_logs.updateIfUnchanged(id, changes, baseUpdatedAt)
      : db.maintenance_logs.update(id, changes)
  ),
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
