-- ════════════════════════════════════════════════════════════════════════
-- Marketing unsubscribe — legal compliance (Israel תיקון 40 / GDPR / CAN-SPAM)
--
-- Adds a one-click, login-free opt-out from MARKETING email. Marketing here =
-- the marketing_* notification types, the no-vehicle nudge, and broadcasts
-- (per product decision). Transactional / reminder / auth email is NOT
-- affected — those keep a "manage preferences" link instead.
--
-- This file is the DB foundation:
--   1. email_marketing_optout — source of truth for "this user opted out of
--      marketing". Also the audit record (when + how).
--   2. record_marketing_unsubscribe() — SECURITY DEFINER, called by the
--      public `unsubscribe` edge function (service role) to record an opt-out.
--      Idempotent.
--   3. is_marketing_unsubscribed() — convenience predicate used by the
--      audience RPCs (admin_no_vehicle_nudge_list, email_broadcast_recipients)
--      to EXCLUDE opted-out users. Enforcement at the audience layer means a
--      single choke point — no marketing send can leak past it.
--
-- The unsubscribe LINK token is a stateless HMAC computed by the edge
-- functions (sender signs, unsubscribe verifies) using a shared secret —
-- no token column needed here. See supabase/functions/unsubscribe.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Opt-out table (source of truth + audit) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_marketing_optout (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text,                       -- snapshot for audit (user may change email later)
  unsubscribed_at  timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL DEFAULT 'email_link'  -- 'email_link' | 'list_unsubscribe' | 'admin' | 'in_app'
);

COMMENT ON TABLE public.email_marketing_optout IS
  'One row per user who opted out of marketing email. Presence = do not send marketing. Proof-of-compliance audit (Israel תיקון 40).';

ALTER TABLE public.email_marketing_optout ENABLE ROW LEVEL SECURITY;

-- Admins can read the list (for the EmailCenter "unsubscribed" count).
DROP POLICY IF EXISTS "admins read marketing optout" ON public.email_marketing_optout;
CREATE POLICY "admins read marketing optout" ON public.email_marketing_optout
  FOR SELECT TO authenticated USING (public.is_admin());

-- Writes happen ONLY via the SECURITY DEFINER function below (service role
-- from the edge function). No direct client writes.

-- ── 2. Record an opt-out (idempotent) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_marketing_unsubscribe(
  p_user_id uuid,
  p_source  text DEFAULT 'email_link'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.email_marketing_optout (user_id, email, source)
  SELECT p_user_id, u.email, COALESCE(p_source, 'email_link')
    FROM auth.users u
   WHERE u.id = p_user_id
  ON CONFLICT (user_id) DO NOTHING;   -- idempotent: a second click is a no-op
END;
$$;

-- Callable by service_role (edge function). Not granted to anon/authenticated
-- directly — the edge function holds the service role key.
GRANT EXECUTE ON FUNCTION public.record_marketing_unsubscribe(uuid, text) TO service_role;

-- ── 3. Predicate for the audience RPCs ──────────────────────────────────────
-- STABLE so it can be inlined in the marketing audience queries' WHERE.
CREATE OR REPLACE FUNCTION public.is_marketing_unsubscribed(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.email_marketing_optout o WHERE o.user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_marketing_unsubscribed(uuid) TO authenticated, service_role;
