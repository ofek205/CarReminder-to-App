/**
 * Profile / settings / notification-log write commands.
 *
 * profile.*         → user_profiles (phone, birth date, licence details)
 * reminderSettings.* → reminder_settings (the user's email/push reminder prefs)
 * reminderSnooze.*   → reminder_snoozes (per-vehicle "remind me later")
 * notificationLog.*  → notification_log (the in-app bell trail)
 *
 * create returns the created row — the settings/profile screens capture it to
 * hold the new row id for subsequent edits in the same session.
 *
 * offlineCapable: all single-row and owner-scoped. Note user_profiles holds PII
 * (phone / birth date / licence number), which is why it is excluded from the
 * persisted read-cache allowlist in §4 even though writing it offline is fine.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';

defineCommand('profile.create', {
  offlineCapable: true,
  table: 'user_profiles',
  run: (payload) => db.user_profiles.create(payload),
});

defineCommand('profile.update', {
  offlineCapable: true,
  table: 'user_profiles',
  run: ({ id, ...changes }) => db.user_profiles.update(id, changes),
});

defineCommand('reminderSettings.create', {
  offlineCapable: true,
  table: 'reminder_settings',
  run: (payload) => db.reminder_settings.create(payload),
});

defineCommand('reminderSettings.update', {
  offlineCapable: true,
  table: 'reminder_settings',
  run: ({ id, ...changes }) => db.reminder_settings.update(id, changes),
});

// Upsert on (user_id, vehicle_id, reminder_type): the entity layer has no
// ON CONFLICT support, so this one goes straight to supabase and — like
// repair.save — resolves to the raw { data, error } envelope the call site
// already branches on. Normalizing the envelope is a Phase-2 task.
defineCommand('reminderSnooze.upsert', {
  offlineCapable: true,
  table: 'reminder_snoozes',
  returnsEnvelope: true,
  run: ({ user_id, vehicle_id, reminder_type, snoozed_until }) =>
    supabase.from('reminder_snoozes').upsert(
      { user_id, vehicle_id, reminder_type, snoozed_until },
      { onConflict: 'user_id,vehicle_id,reminder_type' },
    ),
});

defineCommand('reminderSnooze.delete', {
  offlineCapable: true,
  table: 'reminder_snoozes',
  run: ({ id }) => db.reminder_snoozes.delete(id),
});

defineCommand('notificationLog.create', {
  offlineCapable: true,
  table: 'notification_log',
  run: (payload) => db.notification_log.create(payload),
});

defineCommand('notificationLog.markRead', {
  offlineCapable: true,
  table: 'notification_log',
  run: ({ id }) => db.notification_log.update(id, { is_read: true }),
});
