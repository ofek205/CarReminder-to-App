-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-app-errors-v2.sql — Phase 1 of observability upgrade.
--
-- Extends `app_errors` with the contextual columns the admin needs to
-- answer: "what was the user actually trying to do when this broke?"
--
-- Existing schema only had: type, message, stack, url, user_agent, user_id,
-- extra (jsonb), resolved, timestamp. That gave Ofek stack traces but no
-- way to know which page, what action, what the user did before the crash,
-- or how to correlate multiple errors from the same broken session.
--
-- New columns:
--   route        — explicit current route (was buried in `url`)
--   action       — short action label ("save_document", "delete_vehicle")
--   session_id   — correlation id, same value for all errors in one tab session
--   breadcrumbs  — last ~30 user actions before the error (jsonb array)
--   severity     — critical / error / warning / info (for triage + filtering)
--   app_version  — package.json version that produced the error (regressions)
--   count        — dedup counter (>1 when an aggregator collapses duplicates)
--   visible      — boolean: did the user SEE a toast/dialog? (toast.error wrapper)
--
-- All columns are nullable for backwards compat — old client without the
-- v2 reporter still inserts successfully. Existing rows get NULL.
--
-- Re-runnable. Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_errors
  ADD COLUMN IF NOT EXISTS route       text,
  ADD COLUMN IF NOT EXISTS action      text,
  ADD COLUMN IF NOT EXISTS session_id  text,
  ADD COLUMN IF NOT EXISTS breadcrumbs jsonb,
  ADD COLUMN IF NOT EXISTS severity    text,
  ADD COLUMN IF NOT EXISTS app_version text,
  ADD COLUMN IF NOT EXISTS count       integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS visible     boolean DEFAULT false;

-- Helpful indexes for the new admin queries.
CREATE INDEX IF NOT EXISTS app_errors_route_idx    ON public.app_errors (route);
CREATE INDEX IF NOT EXISTS app_errors_severity_idx ON public.app_errors (severity);
CREATE INDEX IF NOT EXISTS app_errors_visible_idx  ON public.app_errors (visible) WHERE visible = true;
CREATE INDEX IF NOT EXISTS app_errors_session_idx  ON public.app_errors (session_id);

COMMENT ON COLUMN public.app_errors.route       IS 'Current route when the error fired (e.g. "/AddVehicle"). Populated by crashReporter from window.location.pathname.';
COMMENT ON COLUMN public.app_errors.action      IS 'Short label of what the user was trying to do ("save_document", "delete_vehicle"). Populated by reportUserError or breadcrumbs.';
COMMENT ON COLUMN public.app_errors.session_id  IS 'Tab-session correlation id. Same value for every error from the same load. Lets admin group "all errors from this broken session".';
COMMENT ON COLUMN public.app_errors.breadcrumbs IS 'Ring buffer of the last ~30 user actions before the error: { kind, label, route, ts }.';
COMMENT ON COLUMN public.app_errors.severity    IS 'critical | error | warning | info. critical = crash, error = caught error shown to user, warning = recoverable, info = trace.';
COMMENT ON COLUMN public.app_errors.app_version IS 'package.json version at the moment the error fired. Lets admin pin regressions to a specific release.';
COMMENT ON COLUMN public.app_errors.visible     IS 'true if the user SAW the error (toast/dialog/banner). false if it was silent (caught in a handler).';
COMMENT ON COLUMN public.app_errors.count       IS 'Dedup counter — currently always 1; reserved for future aggregator that collapses identical messages.';


-- ═══════════════════════════════════════════════════════════════════════════
-- admin_user_visible_errors_top — list of the most-seen user-visible errors
-- in the last 24h. Powers the new "שגיאות שמשתמשים ראו" tab in AdminHealth.
-- Gated by is_admin().
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_user_visible_errors_top();

CREATE FUNCTION public.admin_user_visible_errors_top()
RETURNS TABLE (
  message    text,
  route      text,
  action     text,
  occurrences bigint,
  unique_users bigint,
  last_seen  timestamptz,
  sample_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    LEFT(e.message, 200)                  AS message,
    COALESCE(e.route, '?')                AS route,
    COALESCE(e.action, '?')               AS action,
    COUNT(*)                              AS occurrences,
    COUNT(DISTINCT e.user_id) FILTER (WHERE e.user_id IS NOT NULL) AS unique_users,
    MAX(e.created_at)                     AS last_seen,
    (array_agg(e.id ORDER BY e.created_at DESC))[1] AS sample_id
  FROM public.app_errors e
  WHERE e.created_at >= now() - interval '24 hours'
    AND e.visible = true
    AND e.message NOT LIKE 'Lock was stolen%'
    AND e.message NOT LIKE 'Lock broken%'
  GROUP BY LEFT(e.message, 200), e.route, e.action
  ORDER BY occurrences DESC, last_seen DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_user_visible_errors_top() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- admin_error_breadcrumbs(p_error_id uuid) — fetch full breadcrumbs + context
-- for a single error. Used by the drill-down sheet when admin clicks a row.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_error_breadcrumbs(uuid);

CREATE FUNCTION public.admin_error_breadcrumbs(p_error_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.app_errors%ROWTYPE;
  v_user_email text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.app_errors WHERE id = p_error_id;
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Look up the user's email for context (admin already has read access via
  -- is_current_user_admin RLS, but auth.users is restricted from authenticated
  -- role queries — we resolve it inside the SECURITY DEFINER function).
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_row.user_id;

  RETURN jsonb_build_object(
    'id',          v_row.id,
    'type',        v_row.type,
    'message',     v_row.message,
    'stack',       v_row.stack,
    'route',       v_row.route,
    'action',      v_row.action,
    'severity',    v_row.severity,
    'visible',     v_row.visible,
    'app_version', v_row.app_version,
    'user_email',  v_user_email,
    'session_id',  v_row.session_id,
    'breadcrumbs', COALESCE(v_row.breadcrumbs, '[]'::jsonb),
    'extra',       v_row.extra,
    'created_at',  v_row.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_error_breadcrumbs(uuid) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — uncomment to verify after running the migration:
--
--   -- Confirm the new columns exist:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='app_errors'
--      AND column_name IN ('route','action','session_id','breadcrumbs','severity','app_version','count','visible')
--    ORDER BY column_name;
--
--   -- Insert a sample row (won't break anything, just verifies the schema accepts it):
--   INSERT INTO public.app_errors (type, message, route, action, severity, visible, breadcrumbs)
--   VALUES ('smoke_test', 'pre-deploy verification', '/__test', 'noop', 'info', false, '[]'::jsonb);
--
--   -- Verify the top RPC works:
--   SELECT * FROM public.admin_user_visible_errors_top();
--
--   -- Cleanup the smoke row:
--   DELETE FROM public.app_errors WHERE type='smoke_test';
-- ═══════════════════════════════════════════════════════════════════════════
