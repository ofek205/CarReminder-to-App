-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-audit-log.sql — Stream 4.5 Phase A
--
-- Immutable admin audit log: every admin action gets a row here.
-- The table is append-only (UPDATE/DELETE revoked, enforced by trigger).
--
-- Components:
--   1. admin_audit_log table + RLS + immutability trigger
--   2. admin_log() — internal helper, called from other RPCs
--   3. admin_audit_log_list() — paginated read RPC for the UI
--   4. Refactored RPCs: admin_delete_account, admin_set_role,
--      admin_acknowledge_alert — now call admin_log() automatically
--
-- Gated by public.is_admin(). Run ONCE in Supabase SQL Editor.
-- Re-runnable thanks to CREATE OR REPLACE + IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. TABLE
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    uuid        NOT NULL DEFAULT auth.uid(),
  actor_email text        NOT NULL DEFAULT '',
  action      text        NOT NULL,
  target_type text,                           -- 'account', 'user', 'alert', etc.
  target_id   text,                           -- UUID or other identifier, stored as text for flexibility
  detail      jsonb       DEFAULT '{}'::jsonb, -- action-specific payload
  ip_address  text,                           -- from request headers when available
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'admin_audit_log' AND policyname = 'admin_read_audit_log'
  ) THEN
    CREATE POLICY admin_read_audit_log ON public.admin_audit_log
      FOR SELECT USING (public.is_admin());
  END IF;
END $$;

-- No INSERT/UPDATE/DELETE policies — only SECURITY DEFINER RPCs can write.
-- Revoke direct DML from all roles except the owner (postgres).
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_audit_log FROM anon;

-- Grant INSERT back only to postgres (SECURITY DEFINER functions run as postgres).
GRANT INSERT ON public.admin_audit_log TO postgres;
GRANT SELECT ON public.admin_audit_log TO authenticated;

-- Immutability trigger: block UPDATE and DELETE at the trigger level as a safety net.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is immutable — UPDATE and DELETE are not allowed'
    USING ERRCODE = '42501';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_mutation ON public.admin_audit_log;
CREATE TRIGGER trg_prevent_audit_mutation
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_log_mutation();


-- ───────────────────────────────────────────────────────────────────────────
-- 2. admin_log() — internal logging helper
-- ───────────────────────────────────────────────────────────────────────────
-- Called from other SECURITY DEFINER RPCs. NOT exposed to the client
-- directly (no GRANT to authenticated). Resolves actor_email automatically.

CREATE OR REPLACE FUNCTION public.admin_log(
  p_action      text,
  p_target_type text    DEFAULT NULL,
  p_target_id   text    DEFAULT NULL,
  p_detail      jsonb   DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = auth.uid();

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, target_id, detail)
  VALUES (auth.uid(), COALESCE(v_email, ''), p_action, p_target_type, p_target_id, p_detail);
END;
$$;

-- NOT granted to authenticated — only callable from other SECURITY DEFINER functions.


-- ───────────────────────────────────────────────────────────────────────────
-- 3. admin_audit_log_list() — paginated read for the UI
-- ───────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_audit_log_list(integer, integer, text, text);

CREATE FUNCTION public.admin_audit_log_list(
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0,
  p_action  text    DEFAULT NULL,
  p_actor   text    DEFAULT NULL
)
RETURNS TABLE (
  id          bigint,
  actor_id    uuid,
  actor_email text,
  action      text,
  target_type text,
  target_id   text,
  detail      jsonb,
  created_at  timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Count matching rows for pagination UI.
  SELECT COUNT(*) INTO v_total
  FROM public.admin_audit_log a
  WHERE (p_action IS NULL OR a.action = p_action)
    AND (p_actor  IS NULL OR a.actor_email ILIKE '%' || p_actor || '%');

  RETURN QUERY
  SELECT
    a.id,
    a.actor_id,
    a.actor_email,
    a.action,
    a.target_type,
    a.target_id,
    a.detail,
    a.created_at,
    v_total AS total_count
  FROM public.admin_audit_log a
  WHERE (p_action IS NULL OR a.action = p_action)
    AND (p_actor  IS NULL OR a.actor_email ILIKE '%' || p_actor || '%')
  ORDER BY a.created_at DESC
  LIMIT LEAST(p_limit, 200)
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_audit_log_list(integer, integer, text, text) TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. REFACTORED RPCs — now log every action automatically
-- ───────────────────────────────────────────────────────────────────────────

-- 4a. admin_delete_account — logs before cascading delete
CREATE OR REPLACE FUNCTION public.admin_delete_account(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_name text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT name INTO v_account_name FROM public.accounts WHERE id = p_account_id;

  PERFORM public.admin_log(
    'delete_account',
    'account',
    p_account_id::text,
    jsonb_build_object('account_name', COALESCE(v_account_name, ''))
  );

  DELETE FROM public.accounts WHERE id = p_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_account(uuid) TO authenticated;


-- 4b. admin_set_role — logs role change with before/after
CREATE OR REPLACE FUNCTION public.admin_set_role(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('admin', 'user') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  SELECT COALESCE(raw_user_meta_data->>'role', 'user')
  INTO v_old_role
  FROM auth.users
  WHERE id = p_user_id;

  UPDATE auth.users
  SET raw_user_meta_data = jsonb_set(
        COALESCE(raw_user_meta_data, '{}'::jsonb),
        '{role}',
        to_jsonb(p_role)
      )
  WHERE id = p_user_id;

  PERFORM public.admin_log(
    'set_role',
    'user',
    p_user_id::text,
    jsonb_build_object('old_role', COALESCE(v_old_role, 'user'), 'new_role', p_role)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, text) TO authenticated;


-- 4c. admin_acknowledge_alert — logs which alert was acknowledged
CREATE OR REPLACE FUNCTION public.admin_acknowledge_alert(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alert_title text;
  v_alert_kind  text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT title, kind INTO v_alert_title, v_alert_kind
  FROM public.admin_alerts
  WHERE id = p_alert_id;

  UPDATE public.admin_alerts
  SET acknowledged_at = now(),
      acknowledged_by = auth.uid()
  WHERE id = p_alert_id;

  PERFORM public.admin_log(
    'acknowledge_alert',
    'alert',
    p_alert_id::text,
    jsonb_build_object('title', COALESCE(v_alert_title, ''), 'kind', COALESCE(v_alert_kind, ''))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_acknowledge_alert(uuid) TO authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- INDEX — speeds up filtered queries on action + created_at
-- ───────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action_created
  ON public.admin_audit_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON public.admin_audit_log (created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — uncomment to verify:
--   SELECT * FROM public.admin_audit_log_list(10, 0, NULL, NULL);
-- ═══════════════════════════════════════════════════════════════════════════
