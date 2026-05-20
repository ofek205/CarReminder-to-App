-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-05-20 — Fix app_errors RLS read/update policies
--
-- Background:
--   The original supabase-add-app-errors.sql created policies that try to
--   read auth.users directly:
--
--     USING (
--       (SELECT email FROM auth.users WHERE id = auth.uid()) = 'ofek205@gmail.com'
--       OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
--     )
--
--   The authenticated role doesn't have SELECT permission on auth.users
--   by default — Supabase locks that schema down. Result: the RLS check
--   itself errors with "permission denied for table users", so the
--   admin can't read app_errors at all. The Admin → Bugs tab in
--   /AdminDashboard falls back to localStorage with an amber "Supabase
--   לא זמין" badge and the error "permission denied for table users".
--
-- Fix:
--   Use the existing public.is_current_user_admin() RPC (defined in
--   supabase-email-center-full-control.sql). It's a SECURITY DEFINER
--   function that reads the admin list with the elevated privileges of
--   the function owner, so the authenticated caller doesn't need any
--   direct rights on auth.users.
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS app_errors_admin_read ON public.app_errors;
CREATE POLICY app_errors_admin_read ON public.app_errors FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

DROP POLICY IF EXISTS app_errors_admin_update ON public.app_errors;
CREATE POLICY app_errors_admin_update ON public.app_errors FOR UPDATE TO authenticated
  USING (public.is_current_user_admin());

-- The INSERT policy stays as-is (anyone may insert so anonymous errors
-- are still captured before login). No change needed there.

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Run while signed in as an admin in the Supabase Dashboard SQL Editor or
-- from your authenticated app client:
--
--   SELECT public.is_current_user_admin() AS am_i_admin;
--   -- Expected: true
--
--   SELECT count(*) FROM public.app_errors;
--   -- Expected: works without "permission denied"
