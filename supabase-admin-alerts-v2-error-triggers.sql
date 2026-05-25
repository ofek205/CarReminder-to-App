-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-alerts-v2-error-triggers.sql
--
-- Extends check_admin_alerts() with 3 new trigger conditions that
-- leverage the v2 app_errors schema (route, action, visible, severity):
--
--   5. user_visible_error_spike — ≥5 visible=true errors in last 15 min.
--      Tells the admin: "real users are seeing error toasts RIGHT NOW".
--      Distinct from error_storm (which counts ALL errors regardless of
--      whether the user saw them).
--
--   6. slow_query_storm — ≥10 type='slow_query' errors in last 15 min.
--      Catches performance degradation before queries cross the 8s
--      timeout and become user-visible failures.
--
--   7. user_bug_report — fires on EVERY new user_report row.
--      Bug reports are rare and high-signal (a user took the time to
--      type out a complaint). Each one deserves its own alert; we do
--      not coalesce. Deduped by app_errors.id so re-running the check
--      never alerts twice on the same report.
--
-- All triggers dedup against existing unacknowledged alerts in a 4-hour
-- window (same pattern as the original 4 triggers).
--
-- Idempotent — CREATE OR REPLACE FUNCTION. Re-runnable.
-- Run ONCE in Supabase SQL Editor after supabase-admin-alerts.sql.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_admin_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start   timestamptz := now() - interval '5 minutes';
  v_dedup_window   timestamptz := now() - interval '4 hours';
  v_15min_window   timestamptz := now() - interval '15 minutes';
  v_err            record;
  v_sup            record;
  v_email_stats    record;
  v_has_sends      boolean;
  v_no_events      boolean;
  v_visible_count  integer;
  v_visible_top    text;
  v_slow_count     integer;
  v_slow_top       text;
  v_report         record;
BEGIN
  -- ── Trigger 1: error_storm — same message ≥5 times in 5 min ──────────────
  FOR v_err IN
    SELECT
      message,
      COUNT(*)         AS c,
      MAX(created_at)  AS last_at,
      MIN(created_at)  AS first_at,
      MAX(url)         AS last_url
    FROM public.app_errors
    WHERE created_at >= v_window_start
      AND message NOT IN (
        'non_critical_init_ok','splash_hide','non_critical_init_start',
        'react_mount_start','react_mount_rendered','env_check','boot_succeeded'
      )
      AND type NOT IN ('slow_query', 'user_visible')  -- handled by dedicated triggers below
    GROUP BY message
    HAVING COUNT(*) >= 5
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'error_storm'
        AND context->>'message' = v_err.message
        AND created_at >= v_dedup_window
        AND acknowledged_at IS NULL
    ) THEN
      UPDATE public.admin_alerts
      SET count         = count + v_err.c,
          last_seen_at  = v_err.last_at
      WHERE kind = 'error_storm'
        AND context->>'message' = v_err.message
        AND created_at >= v_dedup_window
        AND acknowledged_at IS NULL;
    ELSE
      INSERT INTO public.admin_alerts (
        kind, severity, title, message, context, first_seen_at, last_seen_at, count
      ) VALUES (
        'error_storm', 'high',
        'סופת שגיאות',
        format('%s פעמים אותה שגיאה ב-5 דקות אחרונות: "%s"', v_err.c, v_err.message),
        jsonb_build_object('message', v_err.message, 'last_url', v_err.last_url),
        v_err.first_at, v_err.last_at, v_err.c
      );
    END IF;
  END LOOP;

  -- ── Trigger 2: new_support — new contact_messages rows ──────────────────
  FOR v_sup IN
    SELECT id, name, email, message, created_at
    FROM public.contact_messages
    WHERE created_at >= v_window_start
      AND status = 'new'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'new_support'
        AND context->>'message_id' = v_sup.id::text
    ) THEN CONTINUE; END IF;

    INSERT INTO public.admin_alerts (
      kind, severity, title, message, context, first_seen_at, last_seen_at
    ) VALUES (
      'new_support', 'medium',
      'פנייה חדשה מתמיכה',
      format('%s שלח/ה: "%s"',
             COALESCE(NULLIF(v_sup.name,''), v_sup.email, 'משתמש'),
             substring(v_sup.message from 1 for 200)),
      jsonb_build_object('message_id', v_sup.id, 'email', v_sup.email),
      v_sup.created_at, v_sup.created_at
    );
  END LOOP;

  -- ── Trigger 3: email_failure_spike — >20% failed in last hour ────────────
  SELECT
    COUNT(*) FILTER (WHERE status IN ('failed','bounced'))  AS failed,
    COUNT(*)                                                AS total
  INTO v_email_stats
  FROM public.email_send_log
  WHERE sent_at >= now() - interval '1 hour';

  IF v_email_stats.total >= 5
     AND (v_email_stats.failed::float / NULLIF(v_email_stats.total,0)) > 0.2 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'email_failure_spike'
        AND created_at >= v_dedup_window
        AND acknowledged_at IS NULL
    ) THEN
      INSERT INTO public.admin_alerts (
        kind, severity, title, message, context, first_seen_at, last_seen_at
      ) VALUES (
        'email_failure_spike', 'high',
        'אחוז כשל גבוה במיילים',
        format('%s מתוך %s מיילים נכשלו בשעה האחרונה (%s%%)',
               v_email_stats.failed,
               v_email_stats.total,
               round((v_email_stats.failed::numeric / v_email_stats.total::numeric) * 100)),
        jsonb_build_object('failed', v_email_stats.failed, 'total', v_email_stats.total),
        now(), now()
      );
    END IF;
  END IF;

  -- ── Trigger 4: webhook_silent — emails sent but no events ────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.email_send_log WHERE sent_at >= now() - interval '2 hours'
  ) INTO v_has_sends;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.email_events WHERE occurred_at >= now() - interval '2 hours'
  ) INTO v_no_events;

  IF v_has_sends AND v_no_events THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'webhook_silent'
        AND created_at >= v_dedup_window
        AND acknowledged_at IS NULL
    ) THEN
      INSERT INTO public.admin_alerts (
        kind, severity, title, message, context, first_seen_at, last_seen_at
      ) VALUES (
        'webhook_silent', 'medium',
        'Resend webhook שקט',
        'נשלחו מיילים בשעתיים האחרונות אבל לא הגיע אף אירוע מ-Resend. ייתכן שה-webhook לא מחובר או ש-secret חסר.',
        '{}'::jsonb,
        now(), now()
      );
    END IF;
  END IF;

  -- ── Trigger 5 (NEW): user_visible_error_spike — ≥5 user-visible errors / 15min ──
  -- Counts only errors the user ACTUALLY SAW (toast.error → visible=true).
  -- These are the most actionable: real users frustrated right now.
  SELECT COUNT(*), MAX(LEFT(message, 120))
    INTO v_visible_count, v_visible_top
  FROM public.app_errors
  WHERE created_at >= v_15min_window
    AND visible = true;

  IF v_visible_count >= 5 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'user_visible_error_spike'
        AND created_at >= v_dedup_window
        AND acknowledged_at IS NULL
    ) THEN
      INSERT INTO public.admin_alerts (
        kind, severity, title, message, context, first_seen_at, last_seen_at, count
      ) VALUES (
        'user_visible_error_spike', 'high',
        'משתמשים רואים שגיאות',
        format('%s שגיאות שמשתמשים ראו ב-15 דקות אחרונות. דוגמה: "%s"',
               v_visible_count, COALESCE(v_visible_top, '?')),
        jsonb_build_object('count_15m', v_visible_count, 'sample_message', v_visible_top),
        now(), now(), v_visible_count
      );
    END IF;
  END IF;

  -- ── Trigger 6 (NEW): slow_query_storm — ≥10 slow queries / 15 min ─────────
  -- Catches perf degradation BEFORE queries cross the 8s timeout. Slow
  -- queries are warnings (didn't break the user yet) but a storm of them
  -- is a leading indicator of bigger trouble (DB load, network).
  SELECT COUNT(*), MAX(extra->>'label')
    INTO v_slow_count, v_slow_top
  FROM public.app_errors
  WHERE created_at >= v_15min_window
    AND type = 'slow_query';

  IF v_slow_count >= 10 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'slow_query_storm'
        AND created_at >= v_dedup_window
        AND acknowledged_at IS NULL
    ) THEN
      INSERT INTO public.admin_alerts (
        kind, severity, title, message, context, first_seen_at, last_seen_at, count
      ) VALUES (
        'slow_query_storm', 'medium',
        'queries איטיים',
        format('%s queries נמשכו מעל 3 שניות ב-15 דקות אחרונות. דוגמה: "%s"',
               v_slow_count, COALESCE(v_slow_top, '?')),
        jsonb_build_object('count_15m', v_slow_count, 'sample_label', v_slow_top),
        now(), now(), v_slow_count
      );
    END IF;
  END IF;

  -- ── Trigger 7 (NEW): user_bug_report — every new user_report row ─────────
  -- A user who took the time to type a bug description is a high-signal
  -- event. We surface EACH ONE as its own alert (no aggregation) so the
  -- admin sees the message text directly. Dedup is per-report (by id)
  -- via the context jsonb — re-running the check never alerts twice on
  -- the same report.
  FOR v_report IN
    SELECT
      e.id,
      e.message,
      e.user_id,
      e.route,
      e.created_at,
      e.extra
    FROM public.app_errors e
    WHERE e.created_at >= v_window_start
      AND e.type = 'user_report'
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.admin_alerts
      WHERE kind = 'user_bug_report'
        AND context->>'report_id' = v_report.id::text
    ) THEN CONTINUE; END IF;

    INSERT INTO public.admin_alerts (
      kind, severity, title, message, context, first_seen_at, last_seen_at
    ) VALUES (
      'user_bug_report', 'medium',
      'דיווח חדש ממשתמש',
      format('"%s"%s',
             substring(COALESCE(v_report.message, '') from 1 for 200),
             CASE WHEN v_report.route IS NOT NULL
                  THEN format(' (מתוך %s)', v_report.route)
                  ELSE '' END),
      jsonb_build_object(
        'report_id',     v_report.id,
        'user_id',       v_report.user_id,
        'route',         v_report.route,
        'context_note',  v_report.extra->>'context_note'
      ),
      v_report.created_at, v_report.created_at
    );
  END LOOP;

END;
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_alerts() TO authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — uncomment to verify:
--
-- 1. Manually trigger the check (should not error):
--    SELECT public.check_admin_alerts();
--
-- 2. Verify the function definition is the v2 version:
--    SELECT pg_get_functiondef('public.check_admin_alerts'::regprocedure)
--      ~ 'user_visible_error_spike' AS has_new_trigger;
-- ═══════════════════════════════════════════════════════════════════════════
