-- ═══════════════════════════════════════════════════════════════════════════
-- admin_health_drilldown(p_probe text)
--
-- Returns up to 20 detail rows for a given health probe.
-- Used by the AdminHealth drill-down UI.
-- Gated by is_admin(). Run in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_health_drilldown(text);

CREATE FUNCTION public.admin_health_drilldown(p_probe text)
RETURNS TABLE (
  item_key    text,
  item_label  text,
  item_value  text,
  item_extra  text,
  item_time   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_probe = 'error_rate_24h' THEN
    RETURN QUERY
      SELECT
        e.type::text                          AS item_key,
        LEFT(e.message, 120)::text            AS item_label,
        COUNT(*)::text                        AS item_value,
        e.url::text                           AS item_extra,
        MAX(e.created_at)                     AS item_time
      FROM public.app_errors e
      WHERE e.created_at >= now() - interval '24 hours'
        AND e.type NOT IN ('boot_stage')
        AND e.message NOT LIKE 'Lock was stolen%'
        AND e.message NOT LIKE 'Lock broken%'
      GROUP BY e.type, LEFT(e.message, 120), e.url
      ORDER BY COUNT(*) DESC
      LIMIT 15;

  ELSIF p_probe = 'email_webhook' THEN
    RETURN QUERY
      SELECT
        ev.event_type::text                   AS item_key,
        COALESCE(ev.recipient_email, '')::text AS item_label,
        ev.event_type::text                   AS item_value,
        COALESCE(ev.message_id, '')::text     AS item_extra,
        ev.occurred_at                        AS item_time
      FROM public.email_events ev
      ORDER BY ev.occurred_at DESC
      LIMIT 15;

  ELSIF p_probe = 'pg_cron' THEN
    RETURN QUERY
      SELECT
        j.jobname::text                       AS item_key,
        j.jobname::text                       AS item_label,
        d.status::text                        AS item_value,
        COALESCE(d.return_message, '')::text  AS item_extra,
        d.start_time                          AS item_time
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
      ORDER BY d.start_time DESC
      LIMIT 15;

  ELSIF p_probe = 'storage' THEN
    RETURN QUERY
      SELECT * FROM (
        SELECT 'users'::text, 'משתמשים'::text, COUNT(*)::text, ''::text, now()
        FROM auth.users
        UNION ALL
        SELECT 'vehicles'::text, 'כלי רכב'::text, COUNT(*)::text, ''::text, now()
        FROM public.vehicles
        UNION ALL
        SELECT 'documents'::text, 'מסמכים'::text, COUNT(*)::text, ''::text, now()
        FROM public.documents
        UNION ALL
        SELECT 'expenses'::text, 'הוצאות'::text, COUNT(*)::text, ''::text, now()
        FROM public.expenses
        UNION ALL
        SELECT 'app_errors'::text, 'שגיאות'::text, COUNT(*)::text, ''::text, now()
        FROM public.app_errors
        UNION ALL
        SELECT 'email_send_log'::text, 'מיילים שנשלחו'::text, COUNT(*)::text, ''::text, now()
        FROM public.email_send_log
      ) sub;

  ELSIF p_probe = 'unack_alerts' THEN
    RETURN QUERY
      SELECT
        a.kind::text                          AS item_key,
        a.title::text                         AS item_label,
        a.severity::text                      AS item_value,
        LEFT(a.message, 200)::text            AS item_extra,
        a.created_at                          AS item_time
      FROM public.admin_alerts a
      WHERE a.acknowledged_at IS NULL
      ORDER BY a.created_at DESC
      LIMIT 15;

  ELSE
    -- db_latency or unknown: no detail rows
    RETURN;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_health_drilldown(text) TO authenticated;
