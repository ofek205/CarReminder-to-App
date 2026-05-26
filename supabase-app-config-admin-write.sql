-- ==========================================================================
-- app_config — admin write policy
--
-- Added 2026-05-26 alongside the AdminAiUsage page. Until now, updates
-- to public.app_config required either a direct SQL dashboard write or
-- the service role — admins had to leave the app to flip a flag.
--
-- This migration adds an admin-only INSERT/UPDATE policy so the new
-- /AdminAiUsage screen can toggle flags from the UI. The public read
-- policy from supabase-app-config.sql is unchanged: anonymous + signed-
-- in users can still read.
--
-- Security:
--   • is_admin() is SECURITY DEFINER against a server-side allow-list,
--     so a tampered JWT can't grant itself admin.
--   • DELETE is intentionally NOT granted — flags are turned off by
--     setting value=false, not by removing the row. Keeps the audit
--     trail intact.
--   • The policy is FOR ALL (insert + update + select) gated on
--     is_admin() — admins can also see the rows the public policy
--     already exposes; this changes nothing for them. The point is
--     to let them WRITE.
-- ==========================================================================

DROP POLICY IF EXISTS app_config_admin_write ON public.app_config;
CREATE POLICY app_config_admin_write
  ON public.app_config
  FOR ALL
  TO authenticated
  USING       (public.is_admin())
  WITH CHECK  (public.is_admin());

-- Reload PostgREST so the new policy is honoured on the next query
-- without waiting for the schema cache to refresh on its own.
NOTIFY pgrst, 'reload schema';


-- ==========================================================================
-- VERIFY
--
-- As an admin, this should succeed:
--   UPDATE public.app_config
--      SET value = 'true'::jsonb, updated_at = NOW()
--    WHERE key = 'chat_attachments_enabled';
--
-- As a non-admin authenticated user, the same UPDATE should affect 0
-- rows (RLS hides the row from their UPDATE scope) but NOT throw — they
-- never see what they couldn't change.
-- ==========================================================================
