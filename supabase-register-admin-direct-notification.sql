-- ════════════════════════════════════════════════════════════════════════
-- Register the 'admin_direct' notification key.
--
-- BUG: admin 1:1 messages (sent from the "כתוב למשתמש" form in
-- AdminUserDrawer) call send-email with notification_key='admin_direct'.
-- The Edge Function then writes a row to email_send_log for the dashboard
-- "sent" stat + history. But email_send_log.notification_key is
--   NOT NULL REFERENCES public.email_notifications(key)
-- and 'admin_direct' was never registered in email_notifications — so the
-- INSERT fails the foreign key. The function swallows that error in a
-- try/catch (so the email itself still goes out), which is exactly why
-- admin-direct sends NEVER appear in the EmailCenter send log.
--
-- FIX: register the key. Same pattern used for 'reminder_no_vehicles'.
-- After this runs, every admin 1:1 message is logged and shows in the log.
--
-- (Delivery is independent — the email is sent via Resend BEFORE the log
-- write — so this only restores the missing audit-log rows, it doesn't
-- change whether the email arrives.)
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO public.email_notifications
  (key, display_name, description, category, enabled, trigger_type, is_implemented)
VALUES (
  'admin_direct',
  'הודעת אדמין ישירה',
  'מייל 1:1 שאדמין שולח למשתמש ספציפי מתוך כרטיס המשתמש (כולל התראת פעמון).',
  'transactional',
  true,
  'manual',
  true
)
ON CONFLICT (key) DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  description    = EXCLUDED.description,
  category       = EXCLUDED.category,
  enabled        = EXCLUDED.enabled,
  trigger_type   = EXCLUDED.trigger_type,
  is_implemented = EXCLUDED.is_implemented,
  updated_at     = now();
