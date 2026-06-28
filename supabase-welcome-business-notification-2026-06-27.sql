-- ═══════════════════════════════════════════════════════════════════════════
-- Register the welcome_business email in the notification catalog — 2026-06-27
-- ═══════════════════════════════════════════════════════════════════════════
-- The "welcome to your business account" email is dispatched (best-effort) when
-- an admin approves a business-workspace request — AdminBusinessRequests.jsx,
-- via send-email with notification_key='welcome_business'.
--
-- This row registers that key in email_notifications so:
--   • the send is logged in email_send_log (FK -> email_notifications.key), and
--   • it shows up in /EmailCenter as a known, trackable notification type.
--
-- NOTE: the body is rendered IN CODE (buildApprovalEmail, premium deep-green +
-- gold numbered layout that doesn't fit the generic email shell), NOT as a
-- DB email_templates row. So there's no template to edit in EmailCenter and
-- the "send test" button there won't work for it — by design. If we later want
-- it EmailCenter-editable, the design would need to fit the shared shell.
--
-- Idempotent. Run ONCE in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.email_notifications
  (key, display_name, description, category, enabled, trigger_type, is_implemented)
VALUES (
  'welcome_business',
  'ברוכים הבאים לחשבון עסקי',
  'נשלח לבעל החשבון כשבקשה לחשבון עסקי מאושרת. מציג את היכולות המרכזיות לעסק. גוף המייל מרונדר בקוד (AdminBusinessRequests), לא כתבנית EmailCenter.',
  'transactional',
  true,
  'event',
  true
)
ON CONFLICT (key) DO NOTHING;

-- Verify:
--   SELECT key, display_name, category, enabled, is_implemented
--     FROM public.email_notifications WHERE key = 'welcome_business';
