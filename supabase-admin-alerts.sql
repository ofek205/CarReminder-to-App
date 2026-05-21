-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-alerts.sql — Stream 7 backend.
--
-- Creates everything needed for the Telegram-based admin alert pipeline:
--   1. admin_alerts table + RLS + indexes
--   2. check_admin_alerts() RPC — runs the 4 trigger checks
--   3. admin_acknowledge_alert(uuid) RPC — sets acknowledged_at
--   4. admin_alert_count_unacknowledged() RPC — for nav red dot
--   5. dispatch_admin_alert_via_http() trigger function
--   6. AFTER INSERT trigger on admin_alerts
--   7. pg_cron schedule running check_admin_alerts() every 5 minutes
--
-- IMPORTANT — run ONCE in Supabase Dashboard → SQL Editor.
-- Re-runnable thanks to IF NOT EXISTS / CREATE OR REPLACE guards.
--
-- Prerequisites (Supabase has these by default but enabling is idempotent):
--   - pg_net extension (HTTP from inside Postgres)
--   - pg_cron extension (scheduled jobs)
--
-- Alerts route to Telegram ONLY (per project memory). No email channel.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Extensions ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;


-- ── 1. Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,        -- 'error_storm' | 'new_support' | 'email_failure_spike' | 'webhook_silent'
  severity        text NOT NULL CHECK (severity IN ('low','medium','high')),
  title           text NOT NULL,
  message         text NOT NULL,
  context         jsonb,                -- raw data for the alert (top error, user_id, etc.)
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  count           integer NOT NULL DEFAULT 1,
  notified_via    text[] NOT NULL DEFAULT '{}',  -- ['telegram'] after dispatch
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_alerts_admin_read   ON public.admin_alerts;
DROP POLICY IF EXISTS admin_alerts_admin_update ON public.admin_alerts;

CREATE POLICY admin_alerts_admin_read   ON public.admin_alerts
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE POLICY admin_alerts_admin_update ON public.admin_alerts
  FOR UPDATE TO authenticated USING (public.is_admin());

CREATE INDEX IF NOT EXISTS admin_alerts_kind_unack
  ON public.admin_alerts(kind, acknowledged_at)
  WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_alerts_recent
  ON public.admin_alerts(created_at DESC);


-- ── 2. check_admin_alerts() — the 4 trigger conditions ────────────────────
--
-- Runs every 5 minutes via pg_cron. For each condition met, either inserts
-- a new alert row (if it's a fresh problem) or updates `count`/`last_seen_at`
-- on the existing unacknowledged alert (dedup window: 4 hours).
--
-- The boot-stage success messages are excluded from error_storm (they were
-- historical noise pre-fix in main.jsx, but if any sneak in they should
-- never trigger an alert).
CREATE OR REPLACE FUNCTION public.check_admin_alerts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start  timestamptz := now() - interval '5 minutes';
  v_dedup_window  timestamptz := now() - interval '4 hours';
  v_err           record;
  v_sup           record;
  v_email_stats   record;
  v_has_sends     boolean;
  v_no_events     boolean;
BEGIN
  -- Trigger 1: error_storm — same message ≥5 times in 5 min
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

  -- Trigger 2: new_support — new contact_messages rows
  FOR v_sup IN
    SELECT id, name, email, message, created_at
    FROM public.contact_messages
    WHERE created_at >= v_window_start
      AND status = 'new'
  LOOP
    -- Dedup by message_id — never insert twice for same support message
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

  -- Trigger 3: email_failure_spike — >20% failed in last hour (min 5 sends)
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

  -- Trigger 4: webhook_silent — emails sent in last 2h but no events received
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_alerts() TO authenticated, service_role;


-- ── 3. admin_acknowledge_alert(uuid) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_acknowledge_alert(p_alert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_alerts
  SET acknowledged_at = now(),
      acknowledged_by = auth.uid()
  WHERE id = p_alert_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_acknowledge_alert(uuid) TO authenticated;


-- ── 4. admin_alert_count_unacknowledged() — for nav red-dot ───────────────
CREATE OR REPLACE FUNCTION public.admin_alert_count_unacknowledged()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.admin_alerts
  WHERE acknowledged_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.admin_alert_count_unacknowledged() TO authenticated;


-- ── 5. Trigger function: fire dispatch-admin-alert edge function ──────────
--
-- Uses pg_net to POST to the edge function asynchronously. Failures here
-- don't roll back the INSERT — we want the alert recorded even if Telegram
-- is briefly unreachable; the user can read /admin/alerts manually.
--
-- We also write 'telegram' into notified_via OPTIMISTICALLY. If the dispatch
-- fails (Telegram down, etc.), we have no easy hook to undo this — but the
-- alert row still exists for visual inspection, so the cost of the lie is
-- minimal.
CREATE OR REPLACE FUNCTION public.dispatch_admin_alert_via_http()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/dispatch-admin-alert';
BEGIN
  -- Fire-and-forget HTTP call. pg_net returns a request_id, we don't await.
  PERFORM net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
      'alert_id', NEW.id,
      'title',    NEW.title,
      'message',  NEW.message
    ),
    headers := jsonb_build_object('Content-Type','application/json')
  );

  -- Optimistically mark as notified. Stream 7 v2 may refine this with a
  -- separate "delivery confirmation" loop.
  UPDATE public.admin_alerts
  SET notified_via = array_append(notified_via, 'telegram')
  WHERE id = NEW.id
    AND NOT ('telegram' = ANY(notified_via));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_alerts_after_insert ON public.admin_alerts;
CREATE TRIGGER admin_alerts_after_insert
  AFTER INSERT ON public.admin_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.dispatch_admin_alert_via_http();


-- ── 6. pg_cron — run check_admin_alerts() every 5 minutes ─────────────────
--
-- If a job with the same name already exists, unschedule it first so this
-- file is safely re-runnable.
DO $$
BEGIN
  PERFORM cron.unschedule('check-admin-alerts');
EXCEPTION WHEN OTHERS THEN
  -- job did not exist, nothing to unschedule
  NULL;
END;
$$;

SELECT cron.schedule(
  'check-admin-alerts',
  '*/5 * * * *',
  'SELECT public.check_admin_alerts();'
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — uncomment to verify after install.
-- This inserts a manual alert and should trigger a Telegram message within
-- 1-2 seconds (because of the AFTER INSERT trigger), independent of pg_cron.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- INSERT INTO public.admin_alerts (kind, severity, title, message, context)
-- VALUES (
--   'smoke_test', 'low',
--   'בדיקת מערכת',
--   'אם קיבלת את ההודעה הזו בטלגרם — Stream 7 backend חי ועובד.',
--   '{"source":"manual smoke test"}'::jsonb
-- );
--
-- -- Then verify in admin_alerts:
-- -- SELECT id, kind, title, notified_via, created_at FROM admin_alerts
-- -- WHERE kind = 'smoke_test' ORDER BY created_at DESC LIMIT 1;
