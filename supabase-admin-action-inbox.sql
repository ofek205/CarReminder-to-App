-- ════════════════════════════════════════════════════════════════════════
-- admin_action_inbox() — single-round-trip feed for the new Admin Home
-- ("בית" / Today) screen.
--
-- WHY: the admin home asks one question — "what needs me right now, and is
-- the product healthy?". Rather than firing 4-7 separate count queries from
-- the client (each its own round-trip + its own stuck-loading risk), this
-- one SECURITY DEFINER RPC returns every action-queue count plus a few
-- lightweight product KPIs in a single jsonb payload.
--
-- The health strip on the same screen reads the EXISTING admin_health_status()
-- RPC separately (it already exists and is cached on its own staleTime).
--
-- Counts returned:
--   business_requests_pending — business_workspace_requests.status = 'pending'
--   messages_new              — contact_messages.status = 'new'
--   alerts_unack              — admin_alerts.acknowledged_at IS NULL
--   bugs_open                 — app_errors unresolved in the last 7 days
--                               (matches the Bugs tab's default 7d+unresolved
--                                view so the count == what the admin sees on
--                                click-through)
-- KPIs returned:
--   total_users               — count(auth.users)  (matches AdminUsers hero)
--   signups_today             — auth.users created since midnight (server tz)
--   signups_7d                — auth.users created in the last 7 days
--
-- SECURITY: admin-only. Mirrors admin_alert_count_unacknowledged() exactly —
-- SECURITY DEFINER + an explicit is_admin() gate that raises 42501 for anyone
-- else. The client useIsAdmin() check is UX only; this is the real gate.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_action_inbox()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'business_requests_pending',
      (SELECT count(*)::int FROM public.business_workspace_requests
        WHERE status = 'pending'),
    'messages_new',
      (SELECT count(*)::int FROM public.contact_messages
        WHERE status = 'new'),
    'alerts_unack',
      (SELECT count(*)::int FROM public.admin_alerts
        WHERE acknowledged_at IS NULL),
    'bugs_open',
      (SELECT count(*)::int FROM public.app_errors
        WHERE resolved IS NOT TRUE
          AND created_at >= now() - interval '7 days'),
    'total_users',
      (SELECT count(*)::int FROM auth.users),
    'signups_today',
      (SELECT count(*)::int FROM auth.users
        WHERE created_at >= date_trunc('day', now())),
    'signups_7d',
      (SELECT count(*)::int FROM auth.users
        WHERE created_at >= now() - interval '7 days')
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_action_inbox() TO authenticated;
