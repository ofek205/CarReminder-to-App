-- =========================================================================
-- 2026-05-17 — flip welcome email to "implemented + enabled"
--
-- The welcome row in `email_notifications` shipped with is_implemented=false
-- in supabase-email-management.sql because the dispatcher wasn't wired
-- yet. As of v4.6.1 the dispatcher exists (AuthPage.dispatchWelcomeEmail
-- + src/lib/emailTemplates.js buildWelcomeEmail/Text). Flip both flags
-- so the admin UI displays it as active and so the (future) DB-template
-- path can rely on enabled=true to gate sends.
--
-- Idempotent: only updates the row. No-op if it has already been set.
-- =========================================================================

UPDATE public.email_notifications
   SET is_implemented = true,
       enabled        = true,
       updated_at     = now()
 WHERE key = 'welcome';

-- Verify:
--   SELECT key, display_name, enabled, is_implemented
--     FROM public.email_notifications
--    WHERE key = 'welcome';
