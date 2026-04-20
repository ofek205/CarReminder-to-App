/**
 * useEmailAdmin — React-Query hooks for the admin Email Center.
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
 * Access is gated by RLS — these hooks will simply return empty/error
 * for non-admins, and the UI uses useIsAdmin() to hide itself anyway.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const K = {
  notifications: ['email-admin', 'notifications'],
  template:      (key) => ['email-admin', 'template', key],
  settings:      ['email-admin', 'settings'],
};

// ── Notifications (the 7 types) ────────────────────────────────────────────

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

// ── Templates ─────────────────────────────────────────────────────────────

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
      // Upsert on the UNIQUE constraint — works for first save or edits.
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

// ── Kill switch + global settings ─────────────────────────────────────────

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
