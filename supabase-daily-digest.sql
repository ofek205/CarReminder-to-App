-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-daily-digest.sql — Daily Telegram digest at 20:00 Israel time
--
-- 1. RPC get_daily_digest() — returns JSONB with today's stats + highlights
-- 2. pg_cron job "daily-digest" — fires the send-daily-digest Edge Function
--
-- Prerequisites:
--   • Edge Function "send-daily-digest" deployed with secrets:
--     TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DISPATCH_SECRET,
--     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
--   • dispatch_secret in vault.decrypted_secrets (already exists)
--
-- Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. RPC ────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_daily_digest();

CREATE FUNCTION public.get_daily_digest()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today            date := CURRENT_DATE;
  v_signups          int;
  v_vehicles         int;
  v_documents        int;
  v_errors           int;
  v_unack_alerts     int;
  v_new_support      int;
  v_total_users      int;
  v_total_vehicles   int;
  v_deleted_today    int;
  v_bounces_today    int;
  v_highlights       jsonb := '[]'::jsonb;
  v_alert_highlights jsonb;
BEGIN
  -- Today's activity
  SELECT COUNT(*) INTO v_signups
    FROM auth.users WHERE created_at::date = v_today;

  SELECT COUNT(*) INTO v_vehicles
    FROM public.vehicles WHERE created_at::date = v_today;

  SELECT COUNT(*) INTO v_documents
    FROM public.documents WHERE created_at::date = v_today;

  SELECT COUNT(*) INTO v_errors
    FROM public.app_errors WHERE created_at::date = v_today;

  -- Open items
  SELECT COUNT(*) INTO v_unack_alerts
    FROM public.admin_alerts WHERE acknowledged_at IS NULL;

  SELECT COUNT(*) INTO v_new_support
    FROM public.contact_messages
    WHERE status = 'new' OR status IS NULL;

  -- Totals
  SELECT COUNT(*) INTO v_total_users    FROM auth.users;
  SELECT COUNT(*) INTO v_total_vehicles FROM public.vehicles;

  -- ── Highlights ──

  -- High/medium unack'd alerts
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    INTO v_alert_highlights
    FROM (
      SELECT 'alert'::text AS type, title AS text, severity
      FROM public.admin_alerts
      WHERE acknowledged_at IS NULL
        AND severity IN ('high', 'medium')
      ORDER BY created_at DESC
      LIMIT 5
    ) t;
  v_highlights := v_alert_highlights;

  -- Error spike
  IF v_errors > 10 THEN
    v_highlights := v_highlights || jsonb_build_array(
      jsonb_build_object('type', 'error_spike',
                         'text', v_errors || ' שגיאות היום — כדאי לבדוק')
    );
  END IF;

  -- Deleted accounts today
  SELECT COUNT(*) INTO v_deleted_today
    FROM public.admin_audit_log
    WHERE action = 'delete_account' AND created_at::date = v_today;
  IF v_deleted_today > 0 THEN
    v_highlights := v_highlights || jsonb_build_array(
      jsonb_build_object('type', 'deleted',
                         'text', v_deleted_today || ' חשבונות נמחקו היום')
    );
  END IF;

  -- Email bounces today
  SELECT COUNT(*) INTO v_bounces_today
    FROM public.email_events
    WHERE event_type IN ('email.bounced', 'email.complained')
      AND received_at::date = v_today;
  IF v_bounces_today > 0 THEN
    v_highlights := v_highlights || jsonb_build_array(
      jsonb_build_object('type', 'bounces',
                         'text', v_bounces_today || ' מיילים חזרו היום')
    );
  END IF;

  RETURN jsonb_build_object(
    'date',           to_char(v_today, 'DD/MM/YYYY'),
    'signups',        v_signups,
    'vehicles',       v_vehicles,
    'documents',      v_documents,
    'errors',         v_errors,
    'unack_alerts',   v_unack_alerts,
    'new_support',    v_new_support,
    'total_users',    v_total_users,
    'total_vehicles', v_total_vehicles,
    'highlights',     v_highlights
  );
END;
$$;

-- Called by service role from Edge Function — no GRANT to authenticated.


-- ── 2. pg_cron ────────────────────────────────────────────────────────────

-- Remove previous job if exists (idempotent)
SELECT cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'daily-digest';

SELECT cron.schedule(
  'daily-digest',
  '0 17 * * *',   -- 17:00 UTC = 20:00 IDT (Israel summer). See UPDATE below.
  $cron$
  SELECT net.http_post(
    url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/send-daily-digest',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Dispatch-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'dispatch_secret' LIMIT 1)
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- 17:00 UTC = 20:00 IDT (summer) / 19:00 IST (winter).
-- When clocks change in October, update to '0 18 * * *' for 20:00 IST.


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST — uncomment to verify the RPC:
--   SELECT get_daily_digest();
--
-- To test the full pipeline manually (after deploying the Edge Function):
--   SELECT net.http_post(
--     url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/send-daily-digest',
--     headers := jsonb_build_object(
--       'Content-Type',      'application/json',
--       'X-Dispatch-Secret', '<your-dispatch-secret>'
--     ),
--     body    := '{}'::jsonb
--   );
-- ═══════════════════════════════════════════════════════════════════════════
