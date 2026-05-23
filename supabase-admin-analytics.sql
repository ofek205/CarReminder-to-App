-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-analytics.sql — Stream 1+3 (Event Tracking + Analytics)
--
-- RPC: admin_analytics_summary() — returns a JSONB blob with all the
-- time-series and aggregate data the /AdminAnalytics page needs.
--
-- Built on existing tables — no new event tracking infrastructure needed.
-- Queries: auth.users, vehicles, documents, app_errors, email_send_log,
-- email_events, account_members.
--
-- Gated by public.is_admin(). Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_analytics_summary();

CREATE FUNCTION public.admin_analytics_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_signups jsonb;
  v_wau jsonb;
  v_vehicles_trend jsonb;
  v_vehicle_types jsonb;
  v_docs_trend jsonb;
  v_errors_trend jsonb;
  v_email_stats jsonb;
  v_cohorts jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Daily signups (last 30 days)
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.day), '[]'::jsonb)
  INTO v_signups
  FROM (
    SELECT
      d.day::date AS day,
      COUNT(u.id) AS count
    FROM generate_series(
      (now() - interval '30 days')::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN auth.users u ON u.created_at::date = d.day
    GROUP BY d.day
  ) t;

  -- 2. Weekly active users (last 12 weeks)
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.week_start), '[]'::jsonb)
  INTO v_wau
  FROM (
    SELECT
      date_trunc('week', d.day)::date AS week_start,
      COUNT(DISTINCT u.id) AS active_users
    FROM generate_series(
      (now() - interval '12 weeks')::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN auth.users u
      ON u.last_sign_in_at::date = d.day
    GROUP BY date_trunc('week', d.day)
  ) t;

  -- 3. Vehicles added per week (last 12 weeks)
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.week_start), '[]'::jsonb)
  INTO v_vehicles_trend
  FROM (
    SELECT
      date_trunc('week', d.day)::date AS week_start,
      COUNT(v.id) AS count
    FROM generate_series(
      (now() - interval '12 weeks')::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN public.vehicles v ON v.created_at::date = d.day
    GROUP BY date_trunc('week', d.day)
  ) t;

  -- 4. Vehicle type distribution
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.count DESC), '[]'::jsonb)
  INTO v_vehicle_types
  FROM (
    SELECT
      COALESCE(vehicle_type, 'לא צוין') AS vehicle_type,
      COUNT(*) AS count
    FROM public.vehicles
    GROUP BY vehicle_type
    ORDER BY count DESC
    LIMIT 10
  ) t;

  -- 5. Documents uploaded per week (last 12 weeks)
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.week_start), '[]'::jsonb)
  INTO v_docs_trend
  FROM (
    SELECT
      date_trunc('week', d.day)::date AS week_start,
      COUNT(doc.id) AS count
    FROM generate_series(
      (now() - interval '12 weeks')::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN public.documents doc ON doc.created_at::date = d.day
    GROUP BY date_trunc('week', d.day)
  ) t;

  -- 6. Errors per day (last 14 days)
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.day), '[]'::jsonb)
  INTO v_errors_trend
  FROM (
    SELECT
      d.day::date AS day,
      COUNT(e.id) AS count
    FROM generate_series(
      (now() - interval '14 days')::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN public.app_errors e ON e.created_at::date = d.day
    GROUP BY d.day
  ) t;

  -- 7. Email engagement (last 30 days aggregate)
  SELECT jsonb_build_object(
    'sent',      (SELECT COUNT(*) FROM public.email_send_log WHERE sent_at >= now() - interval '30 days'),
    'delivered', (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type = 'email.delivered' AND received_at >= now() - interval '30 days'),
    'opened',    (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type = 'email.opened' AND received_at >= now() - interval '30 days'),
    'clicked',   (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type = 'email.clicked' AND received_at >= now() - interval '30 days'),
    'bounced',   (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type IN ('email.bounced','email.complained') AND received_at >= now() - interval '30 days')
  ) INTO v_email_stats;

  -- 8. Signup cohort retention (simplified: weekly cohorts, did they return?)
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.cohort_week), '[]'::jsonb)
  INTO v_cohorts
  FROM (
    SELECT
      date_trunc('week', u.created_at)::date AS cohort_week,
      COUNT(*) AS cohort_size,
      COUNT(*) FILTER (WHERE u.last_sign_in_at > u.created_at + interval '1 day') AS returned_d1,
      COUNT(*) FILTER (WHERE u.last_sign_in_at > u.created_at + interval '7 days') AS returned_d7,
      COUNT(*) FILTER (WHERE u.last_sign_in_at > u.created_at + interval '30 days') AS returned_d30
    FROM auth.users u
    WHERE u.created_at >= now() - interval '12 weeks'
    GROUP BY date_trunc('week', u.created_at)
    HAVING COUNT(*) >= 1
  ) t;

  -- Assemble
  v_result := jsonb_build_object(
    'signups_daily',     v_signups,
    'wau_weekly',        v_wau,
    'vehicles_weekly',   v_vehicles_trend,
    'vehicle_types',     v_vehicle_types,
    'documents_weekly',  v_docs_trend,
    'errors_daily',      v_errors_trend,
    'email_stats',       v_email_stats,
    'cohorts',           v_cohorts
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_analytics_summary() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — uncomment to verify:
--   SELECT public.admin_analytics_summary();
-- ═══════════════════════════════════════════════════════════════════════════
