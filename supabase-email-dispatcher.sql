-- ═══════════════════════════════════════════════════════════════════════════
-- Email Management Center — Phase 2 (Automation / Dispatcher)
--
-- Run ONCE in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Prerequisite: supabase-email-management.sql already applied.
-- Prerequisite: supabase-admin-functions.sql already applied (for
--               is_current_user_admin()).
--
-- Creates:
--   • email_triggers               — configurable rules per notification
--   • email_send_log               — idempotency + history
--   • dispatch_reminder_emails_*   — helper RPCs used by the Edge Function
--
-- After running this file you ALSO need to:
--   1. Deploy the Edge Function `dispatch-reminder-emails`
--      (supabase/functions/dispatch-reminder-emails/index.ts)
--   2. Schedule it with pg_cron — see the block at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Tables ─────────────────────────────────────────────────────────────────

-- One row per reminder-type notification. Controls WHEN we dispatch that
-- notification and how often per user. Seeded below with sensible defaults
-- that mirror the existing in-app push-notification timing.
CREATE TABLE IF NOT EXISTS public.email_triggers (
  notification_key  text PRIMARY KEY REFERENCES public.email_notifications(key) ON DELETE CASCADE,
  enabled           boolean NOT NULL DEFAULT false,
  days_before       int NOT NULL DEFAULT 14 CHECK (days_before >= 0 AND days_before <= 365),
  cooldown_days     int NOT NULL DEFAULT 7 CHECK (cooldown_days >= 0 AND cooldown_days <= 365),
  last_run_at       timestamptz,
  last_run_stats    jsonb,                    -- {sent, skipped, errors, matched}
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_email_triggers_updated_at ON public.email_triggers;
CREATE TRIGGER trg_email_triggers_updated_at
  BEFORE UPDATE ON public.email_triggers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The idempotency journal. Every dispatched email lands here. A UNIQUE
-- constraint on (user_id, notification_key, reference_date) means the
-- dispatcher can run five times in the same hour and the user still gets
-- exactly ONE email. `reference_date` is the expiry / trigger date — for
-- reminder_insurance it's the insurance_due_date; this makes "one email
-- per insurance renewal" automatic across runs, cron misfires, manual
-- re-runs, etc.
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_key  text NOT NULL REFERENCES public.email_notifications(key) ON DELETE CASCADE,
  recipient_email   text NOT NULL,
  reference_date    date,                     -- expiry / trigger date (nullable for event-based)
  sent_at           timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'sent'
                     CHECK (status IN ('sent','queued','failed','skipped')),
  error             text,
  message_id        text,                     -- Resend message id
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT email_send_log_idempotency
    UNIQUE (user_id, notification_key, reference_date)
);

CREATE INDEX IF NOT EXISTS email_send_log_user_idx
  ON public.email_send_log(user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS email_send_log_recent_idx
  ON public.email_send_log(sent_at DESC);


-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_triggers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_send_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage triggers" ON public.email_triggers;
CREATE POLICY "admins manage triggers" ON public.email_triggers
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Users can see their OWN send log (useful for "my sent emails" view).
-- Admins can see everything.
DROP POLICY IF EXISTS "admins read all send log" ON public.email_send_log;
CREATE POLICY "admins read all send log" ON public.email_send_log
  FOR SELECT TO authenticated
  USING (public.is_current_user_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "admins write send log" ON public.email_send_log;
CREATE POLICY "admins write send log" ON public.email_send_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_current_user_admin());

DROP POLICY IF EXISTS "admins update send log" ON public.email_send_log;
CREATE POLICY "admins update send log" ON public.email_send_log
  FOR UPDATE TO authenticated
  USING (public.is_current_user_admin());


-- ── Seed default triggers ──────────────────────────────────────────────────
-- These mirror the in-app push-notification defaults from reminder_settings.
-- All disabled by default — admin flips them on in /EmailCenter when the
-- templates and dispatcher are both live.
INSERT INTO public.email_triggers (notification_key, enabled, days_before, cooldown_days) VALUES
  ('reminder_insurance',   false, 14, 7),
  ('reminder_test',        false, 14, 7),
  ('reminder_license',     false, 21, 14),
  ('reminder_maintenance', false,  7, 14)
ON CONFLICT (notification_key) DO NOTHING;


-- ── Dispatcher RPCs ────────────────────────────────────────────────────────
-- The Edge Function does the HTTP call to Resend + template rendering, but
-- all DB access goes through these SECURITY DEFINER RPCs so the function
-- runs with service-role-level data access even when RLS is strict.

-- Candidates for a single trigger run. Pure SQL (UNION ALL per notification
-- type) instead of plpgsql with dynamic SQL — Supabase's plpgsql_check was
-- tripping on the original variable names. The filter `p_notification_key =
-- 'reminder_x' AND …` keeps exactly one UNION branch active per call.
DROP FUNCTION IF EXISTS public.email_dispatch_candidates(text);

CREATE FUNCTION public.email_dispatch_candidates(p_notification_key text)
RETURNS TABLE (
  user_id          uuid,
  recipient_email  text,
  vehicle_id       uuid,
  vehicle_name     text,
  license_plate    text,
  reference_date   date,
  days_left        int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  WITH trig AS (
    SELECT days_before, cooldown_days
      FROM public.email_triggers
     WHERE notification_key = p_notification_key AND enabled = true
  ),
  raw AS (
    SELECT
      am.user_id,
      u.email                                                              AS recipient_email,
      v.id                                                                 AS vehicle_id,
      COALESCE(v.nickname, v.manufacturer || ' ' || COALESCE(v.model,''))  AS vehicle_name,
      v.license_plate,
      v.insurance_due_date                                                 AS reference_date,
      (v.insurance_due_date - current_date)::int                           AS days_left
    FROM public.vehicles v
    JOIN public.account_members am ON am.account_id = v.account_id AND am.role = 'בעלים'
    JOIN auth.users u              ON u.id = am.user_id
    JOIN public.reminder_settings rs ON rs.user_id = am.user_id AND rs.email_enabled = true
    CROSS JOIN trig
    WHERE p_notification_key = 'reminder_insurance'
      AND v.insurance_due_date = current_date + trig.days_before

    UNION ALL

    SELECT
      am.user_id,
      u.email,
      v.id,
      COALESCE(v.nickname, v.manufacturer || ' ' || COALESCE(v.model,'')),
      v.license_plate,
      v.test_due_date,
      (v.test_due_date - current_date)::int
    FROM public.vehicles v
    JOIN public.account_members am ON am.account_id = v.account_id AND am.role = 'בעלים'
    JOIN auth.users u              ON u.id = am.user_id
    JOIN public.reminder_settings rs ON rs.user_id = am.user_id AND rs.email_enabled = true
    CROSS JOIN trig
    WHERE p_notification_key = 'reminder_test'
      AND v.test_due_date = current_date + trig.days_before
  )
  SELECT r.*
    FROM raw r
    CROSS JOIN trig t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.email_send_log esl
      WHERE esl.user_id = r.user_id
        AND esl.notification_key = p_notification_key
        AND esl.reference_date  = r.reference_date
        AND esl.sent_at > now() - (t.cooldown_days || ' days')::interval
   );
$$;

GRANT EXECUTE ON FUNCTION public.email_dispatch_candidates(text) TO service_role, authenticated;


-- Record a dispatch attempt atomically. Returns true if the row was
-- inserted (email should be sent), false if a duplicate was blocked.
-- This is the idempotency lock — even if the Edge Function is invoked
-- twice concurrently, only one wins the INSERT and actually sends.
DROP FUNCTION IF EXISTS public.email_log_attempt(uuid, text, text, date, text, text, jsonb);

CREATE FUNCTION public.email_log_attempt(
  p_user_id         uuid,
  p_notification    text,
  p_recipient       text,
  p_reference_date  date,
  p_status          text,
  p_message_id      text DEFAULT NULL,
  p_metadata        jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.email_send_log
    (user_id, notification_key, recipient_email, reference_date, status, message_id, metadata)
  VALUES
    (p_user_id, p_notification, p_recipient, p_reference_date, p_status, p_message_id, p_metadata)
  ON CONFLICT (user_id, notification_key, reference_date) DO NOTHING;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_log_attempt(uuid, text, text, date, text, text, jsonb) TO service_role, authenticated;


-- Update the trigger's run stats after a dispatch cycle finishes.
DROP FUNCTION IF EXISTS public.email_trigger_record_run(text, jsonb);

CREATE FUNCTION public.email_trigger_record_run(
  p_notification_key text,
  p_stats            jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.email_triggers
     SET last_run_at = now(),
         last_run_stats = p_stats
   WHERE notification_key = p_notification_key;
$$;

GRANT EXECUTE ON FUNCTION public.email_trigger_record_run(text, jsonb) TO service_role, authenticated;


-- ── pg_cron schedule (run this AFTER the Edge Function is deployed) ────────
-- Uncomment + edit the URL/token below, then run separately.
-- Requires pg_cron extension (enabled by default on Supabase projects).
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- CREATE EXTENSION IF NOT EXISTS pg_net;
--
-- SELECT cron.schedule(
--   'email-dispatcher-hourly',
--   '7 * * * *',                                 -- every hour at :07
--   $$
--   SELECT net.http_post(
--     url     := 'https://<your-project>.supabase.co/functions/v1/dispatch-reminder-emails',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- To see scheduled jobs:          SELECT * FROM cron.job;
-- To see last runs:               SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- To unschedule:                  SELECT cron.unschedule('email-dispatcher-hourly');


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT notification_key, enabled, days_before, cooldown_days FROM public.email_triggers;
-- SELECT * FROM public.email_dispatch_candidates('reminder_insurance');
-- SELECT count(*) FROM public.email_send_log;
