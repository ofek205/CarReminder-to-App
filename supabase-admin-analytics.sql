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
DROP FUNCTION IF EXISTS public.admin_analytics_summary(jsonb);

CREATE FUNCTION public.admin_analytics_summary(p_filters jsonb DEFAULT '{}'::jsonb)
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
  v_age_distribution jsonb;
  v_activation_funnel jsonb;
  v_kpi_north_star numeric;
  v_kpi_activation_rate numeric;
  v_kpi_power_users integer;
  v_kpi_churn_risk integer;

  -- ─────────────────────────────────────────────────────────────────
  -- FILTER VARS — derived from p_filters jsonb (Phase 2).
  -- p_filters shape:
  --   { date_range: '7d'|'30d'|'90d'|'12w'|'all',  (default '30d')
  --     vehicle_types: ['פרטי','מסחרי',...],        (default all)
  --     account_type: 'all'|'personal'|'business' (default all)
  --   }
  -- Frontend sends the filter object from the Filter Bar URL state.
  -- Backwards compat: empty jsonb {} → same behaviour as v1.
  -- ─────────────────────────────────────────────────────────────────
  v_date_range text   := COALESCE(p_filters->>'date_range', '30d');
  v_account_type text := COALESCE(p_filters->>'account_type', 'all');
  v_filter_vtypes text[] := CASE
    WHEN jsonb_typeof(p_filters->'vehicle_types') = 'array'
      AND jsonb_array_length(p_filters->'vehicle_types') > 0
    THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'vehicle_types'))
    ELSE NULL
  END;
  v_days_back int;    -- for daily series + day-window KPIs
  v_weeks_back int;   -- for weekly series + cohort
BEGIN
  -- Translate date_range token → numeric windows.
  v_days_back := CASE v_date_range
    WHEN '7d'  THEN 7
    WHEN '30d' THEN 30
    WHEN '90d' THEN 90
    WHEN '12w' THEN 84
    WHEN 'all' THEN 3650        -- 10 years = effectively "all"
    ELSE 30
  END;
  v_weeks_back := CASE v_date_range
    WHEN '7d'  THEN 1
    WHEN '30d' THEN 4
    WHEN '90d' THEN 13
    WHEN '12w' THEN 12
    WHEN 'all' THEN 520
    ELSE 12
  END;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. Daily signups (windowed by filter date_range)
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.day), '[]'::jsonb)
  INTO v_signups
  FROM (
    SELECT
      d.day::date AS day,
      COUNT(u.id) AS count
    FROM generate_series(
      (now() - (v_days_back || ' days')::interval)::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN auth.users u ON u.created_at::date = d.day
    GROUP BY d.day
  ) t;

  -- 2. Weekly active users (windowed by filter)
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.week_start), '[]'::jsonb)
  INTO v_wau
  FROM (
    SELECT
      date_trunc('week', d.day)::date AS week_start,
      COUNT(DISTINCT u.id) AS active_users
    FROM generate_series(
      (now() - (v_weeks_back || ' weeks')::interval)::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN auth.users u
      ON u.last_sign_in_at::date = d.day
    GROUP BY date_trunc('week', d.day)
  ) t;

  -- 3. Vehicles added per week (windowed; respects vehicle_types + account_type)
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.week_start), '[]'::jsonb)
  INTO v_vehicles_trend
  FROM (
    SELECT
      date_trunc('week', d.day)::date AS week_start,
      COUNT(v.id) AS count
    FROM generate_series(
      (now() - (v_weeks_back || ' weeks')::interval)::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN public.vehicles v ON v.created_at::date = d.day
      AND (v_filter_vtypes IS NULL OR COALESCE(v.vehicle_type, 'לא צוין') = ANY(v_filter_vtypes))
    LEFT JOIN public.accounts a ON a.id = v.account_id
      AND (v_account_type = 'all' OR a.type = v_account_type)
    WHERE v.id IS NULL OR a.id IS NOT NULL OR v_account_type = 'all'
    GROUP BY date_trunc('week', d.day)
  ) t;

  -- 4. Vehicle type distribution (respects account_type filter — but
  -- NOT vehicle_types filter, since this IS the chart that shows them).
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.count DESC), '[]'::jsonb)
  INTO v_vehicle_types
  FROM (
    SELECT
      COALESCE(v.vehicle_type, 'לא צוין') AS vehicle_type,
      COUNT(*) AS count
    FROM public.vehicles v
    LEFT JOIN public.accounts a ON a.id = v.account_id
    WHERE v_account_type = 'all' OR a.type = v_account_type
    GROUP BY v.vehicle_type
    ORDER BY count DESC
    LIMIT 10
  ) t;

  -- 5. Documents uploaded per week (windowed; respects account_type filter)
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.week_start), '[]'::jsonb)
  INTO v_docs_trend
  FROM (
    SELECT
      date_trunc('week', d.day)::date AS week_start,
      COUNT(doc.id) AS count
    FROM generate_series(
      (now() - (v_weeks_back || ' weeks')::interval)::date,
      now()::date,
      '1 day'
    ) AS d(day)
    LEFT JOIN public.documents doc ON doc.created_at::date = d.day
    LEFT JOIN public.accounts a ON a.id = doc.account_id
      AND (v_account_type = 'all' OR a.type = v_account_type)
    WHERE doc.id IS NULL OR a.id IS NOT NULL OR v_account_type = 'all'
    GROUP BY date_trunc('week', d.day)
  ) t;

  -- 6. Errors per day (windowed by filter; capped at 30d max — long
  -- error history is rarely useful and the chart becomes unreadable).
  BEGIN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.day), '[]'::jsonb)
    INTO v_errors_trend
    FROM (
      SELECT
        d.day::date AS day,
        COUNT(e.id) AS count
      FROM generate_series(
        (now() - (LEAST(v_days_back, 30) || ' days')::interval)::date,
        now()::date,
        '1 day'
      ) AS d(day)
      LEFT JOIN public.app_errors e ON e.created_at::date = d.day
      GROUP BY d.day
    ) t;
  EXCEPTION WHEN undefined_table THEN
    v_errors_trend := '[]'::jsonb;
  END;

  -- 7. Email engagement (last 30 days aggregate)
  -- Graceful: email_send_log / email_events may not exist yet.
  BEGIN
    SELECT jsonb_build_object(
      'sent',      (SELECT COUNT(*) FROM public.email_send_log WHERE sent_at >= now() - (v_days_back || ' days')::interval),
      'delivered', (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type = 'delivered' AND occurred_at >= now() - (v_days_back || ' days')::interval),
      'opened',    (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type = 'opened' AND occurred_at >= now() - (v_days_back || ' days')::interval),
      'clicked',   (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type = 'clicked' AND occurred_at >= now() - (v_days_back || ' days')::interval),
      'bounced',   (SELECT COUNT(DISTINCT send_log_id) FROM public.email_events WHERE event_type IN ('bounced','complained') AND occurred_at >= now() - (v_days_back || ' days')::interval)
    ) INTO v_email_stats;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    v_email_stats := '{"sent":0,"delivered":0,"opened":0,"clicked":0,"bounced":0}'::jsonb;
  END;

  -- 8. Signup cohort retention (weekly cohorts within filter window).
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.cohort_week), '[]'::jsonb)
  INTO v_cohorts
  FROM (
    SELECT
      date_trunc('week', u.created_at)::date AS cohort_week,
      COUNT(*) AS cohort_size,
      COUNT(*) FILTER (WHERE u.last_sign_in_at > u.created_at + interval '1 day') AS returned_d1,
      COUNT(*) FILTER (WHERE u.last_sign_in_at > u.created_at + interval '7 days') AS returned_d7,
      COUNT(*) FILTER (WHERE u.last_sign_in_at > u.created_at + interval '30 days') AS returned_d30
    FROM auth.users u
    WHERE u.created_at >= now() - (v_weeks_back || ' weeks')::interval
    GROUP BY date_trunc('week', u.created_at)
    HAVING COUNT(*) >= 1
  ) t;

  -- 9. Age distribution (all-time, from user_profiles.birth_date).
  -- Buckets: 18-24 / 25-34 / 35-44 / 45-54 / 55-64 / 65+ / unknown.
  -- "unknown" captures users who didn't fill their birth date — this is
  -- a critical "data quality" signal for admin (how complete is profile
  -- onboarding?). Order by bucket_rank so the pie slices come out in a
  -- stable order regardless of which buckets are populated.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('bucket', bucket, 'count', cnt) ORDER BY bucket_rank
  ), '[]'::jsonb)
  INTO v_age_distribution
  FROM (
    SELECT
      CASE
        WHEN p.birth_date IS NULL                                       THEN 'לא הוזן'
        WHEN p.birth_date > (now() - interval '25 years')::date         THEN '18-24'
        WHEN p.birth_date > (now() - interval '35 years')::date         THEN '25-34'
        WHEN p.birth_date > (now() - interval '45 years')::date         THEN '35-44'
        WHEN p.birth_date > (now() - interval '55 years')::date         THEN '45-54'
        WHEN p.birth_date > (now() - interval '65 years')::date         THEN '55-64'
        ELSE                                                                 '65+'
      END AS bucket,
      CASE
        WHEN p.birth_date IS NULL                                       THEN 99
        WHEN p.birth_date > (now() - interval '25 years')::date         THEN 1
        WHEN p.birth_date > (now() - interval '35 years')::date         THEN 2
        WHEN p.birth_date > (now() - interval '45 years')::date         THEN 3
        WHEN p.birth_date > (now() - interval '55 years')::date         THEN 4
        WHEN p.birth_date > (now() - interval '65 years')::date         THEN 5
        ELSE                                                                 6
      END AS bucket_rank,
      COUNT(*) AS cnt
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.user_id = u.id
    GROUP BY bucket, bucket_rank
  ) t;

  -- 10. Activation Funnel — 4 cumulative stages.
  -- Cohort = all signups in the last 30 days (so we measure activation
  -- of users who had a fair chance to complete the loop).
  -- Each step is a SUPERSET of prior steps reached, so the funnel is
  -- monotonically non-increasing.
  WITH cohort AS (
    SELECT u.id, u.created_at, u.email_confirmed_at
    FROM auth.users u
    WHERE u.created_at >= now() - (v_days_back || ' days')::interval
  ),
  with_vehicle AS (
    SELECT DISTINCT c.id
    FROM cohort c
    JOIN public.account_members am ON am.user_id = c.id
    JOIN public.vehicles v ON v.account_id = am.account_id
    WHERE v.created_at >= c.created_at
  ),
  with_reminder AS (
    SELECT DISTINCT c.id
    FROM cohort c
    JOIN public.account_members am ON am.user_id = c.id
    JOIN public.vehicles v ON v.account_id = am.account_id
    WHERE v.first_reminder_armed_at IS NOT NULL
      AND v.first_reminder_armed_at >= c.created_at
  ),
  with_doc AS (
    SELECT DISTINCT c.id
    FROM cohort c
    JOIN public.account_members am ON am.user_id = c.id
    JOIN public.documents d ON d.account_id = am.account_id
    WHERE d.created_at >= c.created_at
  )
  SELECT jsonb_build_array(
    jsonb_build_object('stage','signup',         'count', (SELECT COUNT(*) FROM cohort)),
    jsonb_build_object('stage','email_verified', 'count', (SELECT COUNT(*) FROM cohort WHERE email_confirmed_at IS NOT NULL)),
    jsonb_build_object('stage','first_vehicle',  'count', (SELECT COUNT(*) FROM with_vehicle)),
    jsonb_build_object('stage','first_reminder', 'count', (SELECT COUNT(*) FROM with_reminder)),
    jsonb_build_object('stage','first_document', 'count', (SELECT COUNT(*) FROM with_doc))
  )
  INTO v_activation_funnel;

  -- 11. North Star — Reminder-to-Return rate (30d).
  -- Approximation: per user, take the most-recent reminder email
  -- (notification_key starts with 'reminder_') sent in the last 30d
  -- and check if last_sign_in_at falls within 48h after it.
  -- Caveat documented in audit: auth.users.last_sign_in_at is
  -- overwritten on every login, so we only catch returns when the
  -- most-recent reminder was the trigger. Good enough as a directional
  -- KPI for 184 users; replace with per-session log later.
  BEGIN
    WITH last_reminder AS (
      SELECT DISTINCT ON (user_id) user_id, sent_at
      FROM public.email_send_log
      WHERE notification_key LIKE 'reminder_%'
        AND sent_at >= now() - (v_days_back || ' days')::interval
        AND user_id IS NOT NULL
      ORDER BY user_id, sent_at DESC
    ),
    sample AS (
      SELECT lr.user_id, lr.sent_at, u.last_sign_in_at
      FROM last_reminder lr
      JOIN auth.users u ON u.id = lr.user_id
    )
    SELECT
      CASE WHEN COUNT(*) = 0 THEN 0
           ELSE ROUND(
             100.0 * COUNT(*) FILTER (
               WHERE last_sign_in_at IS NOT NULL
                 AND last_sign_in_at >= sent_at
                 AND last_sign_in_at <  sent_at + interval '48 hours'
             ) / NULLIF(COUNT(*), 0), 1)
      END
    INTO v_kpi_north_star
    FROM sample;
  EXCEPTION WHEN undefined_table THEN
    v_kpi_north_star := 0;
  END;

  -- 12. Activation rate % — of last 30d signups, what % completed
  -- signup → first_vehicle → first_reminder → first_document. Mirrors
  -- the activation funnel's terminal stage.
  WITH cohort AS (
    SELECT u.id FROM auth.users u WHERE u.created_at >= now() - (v_days_back || ' days')::interval
  ),
  completed AS (
    SELECT DISTINCT c.id
    FROM cohort c
    JOIN public.account_members am ON am.user_id = c.id
    JOIN public.vehicles v ON v.account_id = am.account_id AND v.first_reminder_armed_at IS NOT NULL
    JOIN public.documents d ON d.account_id = am.account_id
  )
  SELECT CASE WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN 0
              ELSE ROUND(100.0 * (SELECT COUNT(*) FROM completed) / (SELECT COUNT(*) FROM cohort), 1)
         END
  INTO v_kpi_activation_rate;

  -- 13. Power users — users with 3+ vehicles AND 10+ documents.
  -- Vehicles counted across all owned/shared accounts to capture
  -- fleet managers who might split ownership. Documents same.
  SELECT COUNT(*)
  INTO v_kpi_power_users
  FROM (
    SELECT am.user_id,
           COUNT(DISTINCT v.id) AS vehicles,
           COUNT(DISTINCT d.id) AS documents
    FROM public.account_members am
    LEFT JOIN public.vehicles  v ON v.account_id = am.account_id
    LEFT JOIN public.documents d ON d.account_id = am.account_id
    WHERE am.status = 'פעיל'
    GROUP BY am.user_id
    HAVING COUNT(DISTINCT v.id) >= 3 AND COUNT(DISTINCT d.id) >= 10
  ) t;

  -- 14. Churn risk — registered >30d, ≤1 vehicle, no login in 14d.
  -- These are the candidates for a "we miss you" re-engagement campaign.
  SELECT COUNT(*)
  INTO v_kpi_churn_risk
  FROM auth.users u
  LEFT JOIN (
    SELECT am.user_id, COUNT(DISTINCT v.id) AS vehicles
    FROM public.account_members am
    LEFT JOIN public.vehicles v ON v.account_id = am.account_id
    WHERE am.status = 'פעיל'
    GROUP BY am.user_id
  ) vc ON vc.user_id = u.id
  WHERE u.created_at < now() - interval '30 days'
    AND COALESCE(vc.vehicles, 0) <= 1
    AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < now() - interval '14 days');

  -- Assemble
  v_result := jsonb_build_object(
    'signups_daily',         v_signups,
    'wau_weekly',            v_wau,
    'vehicles_weekly',       v_vehicles_trend,
    'vehicle_types',         v_vehicle_types,
    'documents_weekly',      v_docs_trend,
    'errors_daily',          v_errors_trend,
    'email_stats',           v_email_stats,
    'cohorts',               v_cohorts,
    'age_distribution',      v_age_distribution,
    'activation_funnel',     v_activation_funnel,
    'kpi_north_star_pct',    COALESCE(v_kpi_north_star, 0),
    'kpi_activation_rate_pct', COALESCE(v_kpi_activation_rate, 0),
    'kpi_power_users',       COALESCE(v_kpi_power_users, 0),
    'kpi_churn_risk',        COALESCE(v_kpi_churn_risk, 0),
    'filters_applied',       jsonb_build_object(
      'date_range',    v_date_range,
      'days_back',     v_days_back,
      'weeks_back',    v_weeks_back,
      'account_type',  v_account_type,
      'vehicle_types', COALESCE(to_jsonb(v_filter_vtypes), 'null'::jsonb)
    )
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_analytics_summary(jsonb) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — uncomment to verify:
--   -- Default (= last 30 days, no filters)
--   SELECT public.admin_analytics_summary();
--
--   -- Last 7 days only
--   SELECT public.admin_analytics_summary('{"date_range":"7d"}'::jsonb);
--
--   -- Business accounts only
--   SELECT public.admin_analytics_summary('{"account_type":"business"}'::jsonb);
--
--   -- Specific vehicle types
--   SELECT public.admin_analytics_summary(
--     '{"vehicle_types":["פרטי","מסחרי"]}'::jsonb
--   );
--
--   -- Verify filters_applied echo in response
--   SELECT public.admin_analytics_summary('{"date_range":"90d"}'::jsonb)->'filters_applied';
-- ═══════════════════════════════════════════════════════════════════════════
