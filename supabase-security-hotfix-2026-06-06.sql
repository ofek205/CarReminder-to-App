-- ═══════════════════════════════════════════════════════════════════════════
-- Security hotfix — pre-production audit blockers M1, M2, M3 — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- All three were CONFIRMED LIVE-EXPLOITABLE on production during the audit and
-- have been applied to the DB. This file is the authoritative, re-runnable
-- record. Idempotent.
--
-- M1 — email_dispatch_candidates was EXECUTE-able by PUBLIC/anon/authenticated:
--      any logged-in user could harvest EVERY user's email + plate + due dates
--      (cross-tenant PII / GDPR). It is a service-role batch RPC.
-- M2 — email_log_attempt likewise: a user could forge email_send_log dedup rows
--      and permanently suppress other users' reminder emails.
-- M3 — is_current_user_admin() trusted client-writable raw_user_meta_data->>'role'
--      → self-elevation to admin. Now delegates to the email-allow-list is_admin().
-- ═══════════════════════════════════════════════════════════════════════════

-- M1 + M2 — lock the batch RPCs to service_role only (REVOKE from PUBLIC is the
-- key: functions default to GRANT EXECUTE TO PUBLIC, which authenticated inherits).
REVOKE EXECUTE ON FUNCTION public.email_dispatch_candidates(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_log_attempt(uuid, text, text, date, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.email_dispatch_candidates(text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.email_log_attempt(uuid, text, text, date, text, text, jsonb) TO service_role;

-- M3 — make is_current_user_admin() safe regardless of which RLS policy calls it.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT public.is_admin() $$;

-- Verify (expect: auth/anon = false, service = true; admin fn delegates):
--   select proname, has_function_privilege('authenticated', oid, 'EXECUTE')
--     from pg_proc where proname in ('email_dispatch_candidates','email_log_attempt');
--   select prosrc from pg_proc where proname='is_current_user_admin';
