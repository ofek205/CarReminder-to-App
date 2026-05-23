-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-health.sql — Stream 4.5 Phase C
--
-- RPC: admin_health_status() — returns one row per "health probe".
-- Each probe checks a specific subsystem and returns a traffic-light
-- status (green / yellow / red) with a human-readable message.
--
-- Probes:
--   1. db_latency        — round-trip SELECT 1 timing
--   2. error_rate_24h    — app_errors count in last 24h
--   3. email_delivery    — email_events in last 2h (Resend webhook alive?)
--   4. pg_cron_health    — are cron jobs running on schedule?
--   5. storage_usage     — total rows in key tables
--   6. unack_alerts      — unacknowledged admin alerts
--
-- Gated by public.is_admin(). Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_health_status();

CREATE FUNCTION public.admin_health_status()
RETURNS TABLE (
  probe       text,
  status      text,           -- 'green', 'yellow', 'red'
  value       text,           -- human-readable metric
  message     text,           -- explanation
  checked_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now         timestamptz := now();
  v_start       timestamptz;
  v_latency_ms  numeric;
  v_err_count   bigint;
  v_email_events bigint;
  v_cron_last   timestamptz;
  v_unack       bigint;
  v_users_count bigint;
  v_vehicles_count bigint;
  v_docs_count  bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1. DB latency
  v_start := clock_timestamp();
  PERFORM 1;
  v_latency_ms := EXTRACT(milliseconds FROM clock_timestamp() - v_start);

  probe      := 'db_latency';
  value      := round(v_latency_ms, 1) || ' ms';
  checked_at := v_now;
  IF v_latency_ms < 50 THEN
    status  := 'green';
    message := 'תקין';
  ELSIF v_latency_ms < 200 THEN
    status  := 'yellow';
    message := 'זמן תגובה גבוה מהרגיל';
  ELSE
    status  := 'red';
    message := 'זמן תגובה חריג';
  END IF;
  RETURN NEXT;

  -- 2. Error rate (24h)
  SELECT COUNT(*) INTO v_err_count
  FROM public.app_errors
  WHERE created_at >= v_now - interval '24 hours'
    AND type NOT IN ('boot_stage')
    AND message NOT LIKE 'Lock was stolen%'
    AND message NOT LIKE 'Lock broken%';

  probe      := 'error_rate_24h';
  value      := v_err_count || ' שגיאות';
  checked_at := v_now;
  IF v_err_count < 10 THEN
    status  := 'green';
    message := 'שקט';
  ELSIF v_err_count < 50 THEN
    status  := 'yellow';
    message := 'יש שגיאות — כדאי לבדוק';
  ELSE
    status  := 'red';
    message := 'סופת שגיאות';
  END IF;
  RETURN NEXT;

  -- 3. Email delivery (Resend webhook)
  SELECT COUNT(*) INTO v_email_events
  FROM public.email_events
  WHERE created_at >= v_now - interval '2 hours';

  probe      := 'email_webhook';
  value      := v_email_events || ' אירועים (2 שעות)';
  checked_at := v_now;
  IF v_email_events > 0 THEN
    status  := 'green';
    message := 'Webhook פעיל';
  ELSE
    -- Check if any emails were sent in the last 2h. If none sent, silence
    -- is expected (no emails = no webhook events). Only flag as problem
    -- if emails were sent but no events came back.
    DECLARE v_emails_sent bigint;
    BEGIN
      SELECT COUNT(*) INTO v_emails_sent
      FROM public.email_send_log
      WHERE sent_at >= v_now - interval '2 hours';

      IF v_emails_sent > 0 THEN
        status  := 'red';
        message := 'נשלחו מיילים אבל לא חזרו אירועי webhook';
      ELSE
        status  := 'green';
        message := 'לא נשלחו מיילים — שקט תקין';
      END IF;
    END;
  END IF;
  RETURN NEXT;

  -- 4. pg_cron health — check actual cron.job_run_details
  SELECT MAX(d.start_time) INTO v_cron_last
  FROM cron.job_run_details d
  JOIN cron.job j ON j.jobid = d.jobid
  WHERE j.jobname = 'check-admin-alerts';

  probe      := 'pg_cron';
  checked_at := v_now;
  IF v_cron_last IS NULL THEN
    status  := 'yellow';
    value   := 'אין נתונים';
    message := 'לא נמצאו ריצות של cron — ייתכן שעדיין לא הופעל';
  ELSIF v_cron_last >= v_now - interval '10 minutes' THEN
    status  := 'green';
    value   := 'רץ לפני ' || round(EXTRACT(minutes FROM v_now - v_cron_last)) || ' דקות';
    message := 'תקין';
  ELSIF v_cron_last >= v_now - interval '30 minutes' THEN
    status  := 'yellow';
    value   := 'רץ לפני ' || round(EXTRACT(minutes FROM v_now - v_cron_last)) || ' דקות';
    message := 'ריצה אחרונה לפני יותר מ-10 דקות';
  ELSE
    status  := 'red';
    value   := 'רץ לפני ' || round(EXTRACT(hours FROM v_now - v_cron_last)) || ' שעות';
    message := 'pg_cron לא רץ כבר הרבה זמן';
  END IF;
  RETURN NEXT;

  -- 5. Storage / table sizes
  SELECT COUNT(*) INTO v_users_count FROM auth.users;
  SELECT COUNT(*) INTO v_vehicles_count FROM public.vehicles;
  SELECT COUNT(*) INTO v_docs_count FROM public.documents;

  probe      := 'storage';
  status     := 'green';
  value      := v_users_count || ' משתמשים, ' || v_vehicles_count || ' רכבים, ' || v_docs_count || ' מסמכים';
  message    := 'סטטיסטיקת גודל';
  checked_at := v_now;
  RETURN NEXT;

  -- 6. Unacknowledged alerts
  SELECT COUNT(*) INTO v_unack
  FROM public.admin_alerts
  WHERE acknowledged_at IS NULL;

  probe      := 'unack_alerts';
  value      := v_unack || ' התראות פתוחות';
  checked_at := v_now;
  IF v_unack = 0 THEN
    status  := 'green';
    message := 'אין התראות פתוחות';
  ELSIF v_unack <= 3 THEN
    status  := 'yellow';
    message := 'יש התראות שלא טופלו';
  ELSE
    status  := 'red';
    message := 'הרבה התראות פתוחות';
  END IF;
  RETURN NEXT;

END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_health_status() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — uncomment to verify:
--   SELECT * FROM public.admin_health_status();
-- ═══════════════════════════════════════════════════════════════════════════
