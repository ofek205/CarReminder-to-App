/**
 * useEmailAdmin. React-Query hooks for the admin Email Center.
 *
 * One file, multiple exports, so every piece of the admin UI can import
 * from a single entry point:
 *
 *   import {
 *     useEmailNotifications,
 *     useEmailTemplate,
 *     useSaveEmailTemplate,
 *     useToggleNotification,
 *     useEmailSettings,
 *     useToggleKillSwitch,
 *   } from '@/hooks/useEmailAdmin';
 *
 * Access is gated by RLS. these hooks will simply return empty/error
 * for non-admins, and the UI uses useIsAdmin() to hide itself anyway.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const K = {
  notifications: ['email-admin', 'notifications'],
  template:      (key) => ['email-admin', 'template', key],
  settings:      ['email-admin', 'settings'],
  triggers:      ['email-admin', 'triggers'],
  sendLog:       ['email-admin', 'send-log'],
  events:        (logId) => ['email-admin', 'events', logId],
  stats:         (days) => ['email-admin', 'stats', days],
  versions:      (tplId) => ['email-admin', 'versions', tplId],
  myPrefs:       ['email-prefs', 'me'],
};

//  Notifications (the 7 types) 

export function useEmailNotifications() {
  return useQuery({
    queryKey: K.notifications,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_notifications')
        .select('*')
        .order('category', { ascending: true })
        .order('display_name', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

export function useToggleNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, enabled }) => {
      const { error } = await supabase
        .from('email_notifications')
        .update({ enabled })
        .eq('key', key);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K.notifications }),
  });
}

//  Templates 

export function useEmailTemplate(notificationKey) {
  return useQuery({
    queryKey: K.template(notificationKey),
    enabled: !!notificationKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_templates')
        .select('*')
        .eq('notification_key', notificationKey)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 15_000,
  });
}

export function useSaveEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (template) => {
      // Caller validates first (emailValidate.js). We just persist.
      const payload = {
        notification_key: template.notification_key,
        subject:          template.subject,
        preheader:        template.preheader || null,
        title:            template.title,
        body_html:        template.body_html,
        cta_label:        template.cta_label || null,
        cta_url:          template.cta_url || null,
        footer_note:      template.footer_note || null,
        from_name:        template.from_name || 'CarReminder',
        from_email:       template.from_email || 'no-reply@car-reminder.app',
        reply_to:         template.reply_to || null,
        variables:        Array.isArray(template.variables) ? template.variables : [],
      };
      // Upsert on the UNIQUE constraint. works for first save or edits.
      const { data, error } = await supabase
        .from('email_templates')
        .upsert(payload, { onConflict: 'notification_key' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: K.template(saved.notification_key) });
    },
  });
}

//  Kill switch + global settings 

export function useEmailSettings() {
  return useQuery({
    queryKey: K.settings,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data || { id: 1, emails_paused: false };
    },
    staleTime: 5_000,
  });
}

export function useToggleKillSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paused, reason }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        id: 1,
        emails_paused: paused,
        pause_reason: paused ? (reason || 'Paused by admin') : null,
        paused_at: paused ? new Date().toISOString() : null,
        paused_by: paused ? user?.id || null : null,
      };
      const { error } = await supabase
        .from('email_settings')
        .upsert(payload, { onConflict: 'id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K.settings }),
  });
}

//  Triggers (Phase 2 automation) 

export function useEmailTriggers() {
  return useQuery({
    queryKey: K.triggers,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_triggers')
        .select('*')
        .order('notification_key');
      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
  });
}

export function useSaveTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (trigger) => {
      const payload = {
        notification_key: trigger.notification_key,
        enabled:          !!trigger.enabled,
        days_before:      Math.max(0, Math.min(365, Number(trigger.days_before) || 0)),
        cooldown_days:    Math.max(0, Math.min(365, Number(trigger.cooldown_days) || 0)),
      };
      // Audience conditions are optional. only patch when caller provided.
      if (trigger.conditions !== undefined) {
        payload.conditions = trigger.conditions || {};
      }
      const { error } = await supabase
        .from('email_triggers')
        .upsert(payload, { onConflict: 'notification_key' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K.triggers }),
  });
}

// Manual invocation of the Edge Function. `keys` = which notifications to
// process (omit to process all enabled triggers). `dryRun=true` counts
// matches without actually sending. useful for "how many would go out".
export function useRunDispatcher() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ keys, dryRun = false } = {}) => {
      const { data, error } = await supabase.functions.invoke('dispatch-reminder-emails', {
        body: { keys, dryRun },
      });
      if (error) {
        let detail = error.message;
        try { const body = await error.context?.json?.(); if (body?.error) detail = body.error; } catch {}
        throw new Error(detail);
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: K.triggers });
      qc.invalidateQueries({ queryKey: K.sendLog });
    },
  });
}

//  Send log (recent history) 

export function useSendLog({ limit = 50, notificationKey } = {}) {
  return useQuery({
    queryKey: [...K.sendLog, { limit, notificationKey }],
    queryFn: async () => {
      let q = supabase
        .from('email_send_log')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit);
      if (notificationKey) q = q.eq('notification_key', notificationKey);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    staleTime: 10_000,
  });
}

//  Events (Phase 3: Resend webhook) 

// Timeline of events for a single send_log row (delivered → opened →
// clicked → …). Used by the row-expanded detail in SendLogTab.
export function useSendEvents(sendLogId) {
  return useQuery({
    queryKey: K.events(sendLogId),
    enabled: !!sendLogId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_events')
        .select('*')
        .eq('send_log_id', sendLogId)
        .order('occurred_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30_000,
  });
}

// 30-day rollup for the dashboard strip at the top of EmailCenter.
export function useEmailStats({ days = 30 } = {}) {
  return useQuery({
    queryKey: K.stats(days),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('email_stats_recent', { p_days: days });
      if (error) throw error;
      return Array.isArray(data) ? (data[0] || null) : data;
    },
    staleTime: 60_000,
  });
}

//  Version history (Phase 3) 

// List of snapshots for a template, newest first. The auto-snapshot
// trigger in SQL writes one row per content-changing UPDATE.
export function useTemplateVersions(templateId) {
  return useQuery({
    queryKey: K.versions(templateId),
    enabled: !!templateId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_template_versions')
        .select('*')
        .eq('template_id', templateId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    staleTime: 10_000,
  });
}

// Publish the current draft. snapshots the row into published_snapshot
// and stamps published_at/by. The dispatcher's get_email_template() RPC
// returns the PUBLISHED content, so in-flight drafts never go to users.
export function usePublishTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, notificationKey }) => {
      const { error } = await supabase.rpc('email_template_publish', { p_template_id: templateId });
      if (error) throw error;
      return { templateId, notificationKey };
    },
    onSuccess: ({ notificationKey }) => {
      qc.invalidateQueries({ queryKey: K.template(notificationKey) });
    },
  });
}

// Revert the current template row to the state of a historical snapshot.
// The revert itself writes a NEW snapshot (auto-trigger on UPDATE) so
// nothing is lost. you can always "un-revert" from history.
export function useRevertToVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, snapshot }) => {
      if (!snapshot) throw new Error('snapshot is required');
      const patch = {
        subject:     snapshot.subject,
        preheader:   snapshot.preheader,
        title:       snapshot.title,
        body_html:   snapshot.body_html,
        cta_label:   snapshot.cta_label,
        cta_url:     snapshot.cta_url,
        footer_note: snapshot.footer_note,
        from_name:   snapshot.from_name,
        from_email:  snapshot.from_email,
        reply_to:    snapshot.reply_to,
        variables:   snapshot.variables,
      };
      const { data, error } = await supabase
        .from('email_templates')
        .update(patch)
        .eq('id', templateId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: K.versions(row.id) });
      qc.invalidateQueries({ queryKey: K.template(row.notification_key) });
    },
  });
}

//  User-facing email preferences (Phase 4) 

const ALWAYS_EMAIL_KEYS = new Set(['invite']);

// Hook for the end-user NotificationPreferences page. Returns the full
// list of notifications + the current user's prefs merged in. Notifications
// with category='auth' are excluded (users can't opt out of auth emails).
export function useMyEmailPreferences() {
  return useQuery({
    queryKey: K.myPrefs,
    queryFn: async () => {
      const [{ data: notifs, error: e1 }, { data: prefs, error: e2 }, { data: { user } }] = await Promise.all([
        supabase
          .from('email_notifications')
          .select('key, display_name, description, category, enabled')
          .neq('category', 'auth')
          .order('category', { ascending: true }),
        supabase.from('user_notification_preferences').select('*'),
        supabase.auth.getUser(),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const prefsMap = Object.fromEntries((prefs || []).map(p => [p.notification_key, p]));
      return {
        userId: user?.id || null,
        items: (notifs || []).map(n => ({
          ...n,
          mandatory: ALWAYS_EMAIL_KEYS.has(n.key),
          // Merge: mandatory emails stay on; explicit preference wins for
          // optional emails; no row means opt-out until the user turns it on.
          subscribed: ALWAYS_EMAIL_KEYS.has(n.key)
            ? true
            : prefsMap[n.key] ? !!prefsMap[n.key].email_enabled : false,
          raw: prefsMap[n.key] || null,
        })),
      };
    },
    staleTime: 30_000,
  });
}

export function useUpdateMyEmailPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, notificationKey, subscribed }) => {
      if (!userId) throw new Error('not signed in');
      if (ALWAYS_EMAIL_KEYS.has(notificationKey)) return;
      const { error } = await supabase
        .from('user_notification_preferences')
        .upsert(
          { user_id: userId, notification_key: notificationKey, email_enabled: subscribed },
          { onConflict: 'user_id,notification_key' }
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K.myPrefs }),
  });
}

//  Broadcast (marketing / announcements) 

// Fire a manual broadcast to every opted-in recipient for a notification.
// Admin-triggered only. Respects: kill switch, notification.enabled,
// per-user preferences, one-per-day idempotency on (user, key, today).
export function useRunBroadcast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ notificationKey, dryRun = false }) => {
      if (!notificationKey) throw new Error('notificationKey is required');
      const { data, error } = await supabase.functions.invoke('dispatch-broadcast', {
        body: { notificationKey, dryRun },
      });
      if (error) {
        let detail = error.message;
        try { const b = await error.context?.json?.(); if (b?.error) detail = b.error; } catch {}
        throw new Error(detail);
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: K.sendLog });
      qc.invalidateQueries({ queryKey: K.stats(30) });
    },
  });
}
