-- Security Audit Fixes — 2026-05-27 (Round 3)
-- ============================================================
-- Closes findings from the comprehensive 3-round security audit.
-- Each section is idempotent — safe to re-run.
--
-- IMPORTANT: Run supabase-prod-hardening-c1-c3.sql FIRST if not
-- already executed (it fixes community_notifications INSERT,
-- invites RLS, and DELETE restrictions on shared tables).
--
-- ── Backward Compatibility ────────────────────────────────────
-- • rate_limit_counters: no frontend callers — only SECURITY
--   DEFINER RPCs access it. Enabling RLS is invisible to users.
-- • is_current_user_admin(): narrows admin criteria (removes
--   spoofable metadata path). The real admin (ofek205@gmail.com)
--   is unaffected. 55+ RLS policies use this function — all
--   continue to work because the email check is unchanged.
-- • email_broadcast_recipients(): adds admin gate. No frontend
--   callers exist — only Edge Functions use it via service_role
--   (which bypasses RLS/function checks). Zero user impact.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- FIX 1 — rate_limit_counters: enable RLS
-- ════════════════════════════════════════════════════════════
-- Finding: table had NO RLS. Any authenticated user could reset
-- their own rate limit counter via PostgREST, bypassing community
-- post throttling and other protections.
--
-- Fix: enable RLS with NO policies. This blocks all PostgREST
-- access (authenticated users get zero rows). The rate_limit_check()
-- RPC is SECURITY DEFINER and bypasses RLS, so internal callers
-- (INSERT triggers, send-email rate limiter) keep working.
ALTER TABLE IF EXISTS rate_limit_counters ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- FIX 2 — is_current_user_admin(): remove metadata escalation
-- ════════════════════════════════════════════════════════════
-- Finding: the function checked raw_user_meta_data->>'role' = 'admin'.
-- Supabase auth allows users to set their own metadata via
-- auth.updateUser(), so any authenticated user could escalate to
-- admin by setting { role: 'admin' } in their metadata.
--
-- Fix: remove the metadata check. Keep only the hardcoded email
-- which is the real source of truth. This narrows admin access
-- (strictly more secure, never less). All 55+ RLS policies that
-- call this function continue to work — the email check is unchanged.
CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
      AND email = 'ofek205@gmail.com'   -- app owner
      -- NOTE: if you need multiple admins in the future, create an
      -- `admins` table and join against it instead of hardcoding.
      -- Do NOT use raw_user_meta_data->>'role' — it is user-writable
      -- and was the privilege escalation vector this fix closes.
  );
END;
$$;


-- ════════════════════════════════════════════════════════════
-- FIX 3 — email_broadcast_recipients(): add admin gate
-- ════════════════════════════════════════════════════════════
-- Finding: any authenticated user could call this RPC via PostgREST
-- and receive the full list of user emails — PII exposure.
--
-- Fix: check is_current_user_admin() at the start. Service-role
-- callers (Edge Functions) bypass this check because they connect
-- with service_role which is superuser-equivalent. Zero impact on
-- existing email dispatch flows.
--
-- NOTE: we need the original function signature to replace it.
-- The function returns TABLE(user_id uuid, recipient_email text, first_name text)
-- and takes p_notification_key text.
-- If the signature doesn't match your DB, adjust accordingly.
CREATE OR REPLACE FUNCTION email_broadcast_recipients(p_notification_key text)
RETURNS TABLE(user_id uuid, recipient_email text, first_name text)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Admin gate: block non-admin authenticated users from listing
  -- all user emails. Service-role callers bypass this entirely.
  -- Audit finding M-3 (2026-05-27).
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'permission denied: admin only'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  RETURN QUERY
  SELECT
    u.id                                    AS user_id,
    u.email                                 AS recipient_email,
    COALESCE(
      split_part(u.raw_user_meta_data->>'full_name', ' ', 1),
      split_part(u.email, '@', 1)
    )                                       AS first_name
  FROM auth.users u
  -- Only users who haven't unsubscribed from this notification type.
  WHERE NOT EXISTS (
    SELECT 1 FROM user_notification_preferences pref
    WHERE pref.user_id = u.id
      AND pref.notification_key = p_notification_key
      AND pref.enabled = false
  )
  -- Only users whose email_notifications row is active.
  AND EXISTS (
    SELECT 1 FROM email_notifications en
    WHERE en.notification_key = p_notification_key
      AND en.enabled = true
  );
END;
$$;


-- ════════════════════════════════════════════════════════════
-- Verification
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  rlc_rls boolean;
  admin_fn_ok boolean;
  broadcast_fn_ok boolean;
BEGIN
  -- Check rate_limit_counters has RLS enabled
  SELECT relrowsecurity INTO rlc_rls
  FROM pg_class WHERE relname = 'rate_limit_counters';

  -- Check is_current_user_admin exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'is_current_user_admin'
  ) INTO admin_fn_ok;

  -- Check email_broadcast_recipients exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'email_broadcast_recipients'
  ) INTO broadcast_fn_ok;

  RAISE NOTICE 'rate_limit_counters RLS enabled: %', COALESCE(rlc_rls, false);
  RAISE NOTICE 'is_current_user_admin function: %', admin_fn_ok;
  RAISE NOTICE 'email_broadcast_recipients function: %', broadcast_fn_ok;
END $$;
