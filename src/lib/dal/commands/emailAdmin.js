/**
 * Email-admin write commands — the notification/template/trigger console, plus
 * the one user-facing row in the same area (per-user email subscriptions).
 *
 * All admin-console writes are offlineCapable: false (global config on other
 * people's mail). The exception is emailPrefs.setSubscription: that is the
 * user's OWN unsubscribe toggle, single-writer, safe offline.
 *
 * Every command resolves to the raw { data, error } envelope: the hook's
 * mutationFns already do `if (error) throw error`, and the template writes need
 * `data` back (they return the saved row).
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

const adminCfg = { offlineCapable: false, returnsEnvelope: true };

defineCommand('emailAdmin.setNotificationEnabled', {
  ...adminCfg, table: 'email_notifications',
  run: ({ key, enabled }) =>
    supabase.from('email_notifications').update({ enabled }).eq('key', key),
});

// Coordinates the dispatcher gate — the reminder cron filters on
// email_triggers.enabled, not email_notifications.enabled.
defineCommand('emailAdmin.setTriggerEnabled', {
  ...adminCfg, table: 'email_triggers', kind: 'rpc',
  run: ({ key, enabled }) =>
    supabase.rpc('set_email_trigger_enabled', {
      p_notification_key: key, p_enabled: enabled,
    }),
});

defineCommand('emailAdmin.upsertTemplate', {
  ...adminCfg, table: 'email_templates',
  run: (payload) =>
    supabase.from('email_templates')
      .upsert(payload, { onConflict: 'notification_key' })
      .select().single(),
});

defineCommand('emailAdmin.updateTemplate', {
  ...adminCfg, table: 'email_templates',
  run: ({ id, ...patch }) =>
    supabase.from('email_templates').update(patch).eq('id', id).select().single(),
});

defineCommand('emailAdmin.publishTemplate', {
  ...adminCfg, table: 'email_templates', kind: 'rpc',
  run: ({ templateId }) =>
    supabase.rpc('email_template_publish', { p_template_id: templateId }),
});

defineCommand('emailAdmin.upsertSettings', {
  ...adminCfg, table: 'email_settings',
  run: (payload) => supabase.from('email_settings').upsert(payload, { onConflict: 'id' }),
});

defineCommand('emailAdmin.upsertTrigger', {
  ...adminCfg, table: 'email_triggers',
  run: (payload) =>
    supabase.from('email_triggers').upsert(payload, { onConflict: 'notification_key' }),
});

// The user's own subscription toggle — their data, single-writer.
defineCommand('emailPrefs.setSubscription', {
  offlineCapable: true, returnsEnvelope: true, table: 'user_notification_preferences',
  run: ({ userId, notificationKey, subscribed }) =>
    supabase.from('user_notification_preferences').upsert(
      { user_id: userId, notification_key: notificationKey, email_enabled: subscribed },
      { onConflict: 'user_id,notification_key' },
    ),
});
