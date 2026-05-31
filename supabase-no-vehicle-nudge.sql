-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-no-vehicle-nudge.sql
--
-- Lifecycle nudge: email users who have ZERO vehicles, encouraging them to
-- add their first one. Two consumers of the SAME RPC:
--
--   1. One-time blast (manual):  POST { "min_age_days": 0 }  → every
--      confirmed user with zero vehicles, regardless of signup age.
--   2. Ongoing automation (cron): POST { "min_age_days": 4 }  → users who
--      signed up >= 4 days ago and STILL have zero vehicles. The daily
--      cron below calls this. Once-only per user (email_send_log dedup),
--      so a user caught by the blast won't be re-nudged at day 4.
--
-- "Zero vehicles" is user-centric: the user owns NO vehicle across ANY
-- account they own (role = 'בעלים'). Mirrors the owner→email join used by
-- email_dispatch_candidates, inverted with NOT EXISTS.
--
-- Lifecycle email (product decision 2026-05-31): sent to ALL eligible
-- users — NOT gated on per-user opt-in. The global kill-switch
-- (email_settings.emails_paused) is still honoured by the dispatcher, and
-- the email_send_log UNIQUE/dedup guarantees once-only.
--
-- Called by service_role from the dispatch-no-vehicle-nudge Edge Function.
-- Run ONCE in the SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_no_vehicle_nudge_list(int);

CREATE FUNCTION public.admin_no_vehicle_nudge_list(p_min_age_days int DEFAULT 4)
RETURNS TABLE (
  user_id          uuid,
  email            text,
  full_name        text,
  days_since_signup int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id                                                    AS user_id,
    u.email::text                                           AS email,
    COALESCE(
      NULLIF(u.raw_user_meta_data->>'full_name', ''),
      NULLIF(u.raw_user_meta_data->>'name', ''),
      split_part(u.email::text, '@', 1)
    )                                                       AS full_name,
    (now()::date - u.created_at::date)::int                 AS days_since_signup
  FROM auth.users u
  WHERE u.deleted_at IS NULL
    AND u.email_confirmed_at IS NOT NULL
    -- Exclude internal / test / Apple-review accounts (same set the
    -- welcome backfill skips).
    AND u.email::text NOT IN (
      'natanzone2024@gmail.com',
      'ofek205@gmail.com',
      'ofektest@gmail.com',
      'test@test.com',
      'apple-review@car-reminder.app'
    )
    AND u.email::text NOT LIKE '%@privaterelay.appleid.com'
    -- Old enough: blast passes 0 (everyone), cron passes 4.
    AND u.created_at <= now() - (GREATEST(p_min_age_days, 0) || ' days')::interval
    -- Owns no vehicle in ANY account they own.
    AND NOT EXISTS (
      SELECT 1
      FROM public.account_members am
      JOIN public.vehicles v ON v.account_id = am.account_id
      WHERE am.user_id = u.id
        AND am.role = 'בעלים'
    )
    -- Once-only: never sent this nudge before.
    AND NOT EXISTS (
      SELECT 1
      FROM public.email_send_log esl
      WHERE esl.recipient_email = u.email::text
        AND esl.notification_key = 'reminder_no_vehicles'
    )
  ORDER BY u.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_no_vehicle_nudge_list(int) FROM public;
REVOKE ALL ON FUNCTION public.admin_no_vehicle_nudge_list(int) FROM authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- pg_cron job: once daily at 06:00 UTC (09:00 Israel) — nudge users who
-- crossed the 4-day mark with still zero vehicles. Daily (not hourly) is
-- plenty for a 4-day onboarding nudge.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'no-vehicle-nudge';

SELECT cron.schedule(
  'no-vehicle-nudge',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/dispatch-no-vehicle-nudge',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Dispatch-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'dispatch_secret' LIMIT 1)
    ),
    body    := '{"min_age_days": 4}'::jsonb
  );
  $cron$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- In-app bell notification + native push for the SAME no-vehicle moment.
--
-- Inserting one row into app_notifications also fans out a native push to
-- the user's device tokens via the existing AFTER INSERT trigger
-- (trg_app_notifications_dispatch_push → dispatch-push). So this single
-- RPC delivers BOTH the bell badge and the mobile push.
--
-- Once-ever per user: a unique partial index is the race-proof guarantee;
-- the RPC also pre-checks and swallows the unique violation so a second
-- call is a silent no-op (matches the email's once-only semantics).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS app_notif_no_vehicle_once
  ON public.app_notifications (user_id)
  WHERE type = 'no_vehicle';

DROP FUNCTION IF EXISTS public.notify_no_vehicle(uuid, text);

CREATE FUNCTION public.notify_no_vehicle(p_user_id uuid, p_first_name text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(coalesce(p_first_name, '')), '');
BEGIN
  IF p_user_id IS NULL THEN RETURN false; END IF;

  -- Pre-check (fast path) — already notified once → no-op.
  IF EXISTS (
    SELECT 1 FROM public.app_notifications
     WHERE user_id = p_user_id AND type = 'no_vehicle'
  ) THEN
    RETURN false;
  END IF;

  -- Insert the bell row. The AFTER INSERT trigger handles the push.
  -- Wrapped so a concurrent insert (unique index) is swallowed silently.
  BEGIN
    INSERT INTO public.app_notifications (user_id, type, title, body, data)
    VALUES (
      p_user_id,
      'no_vehicle',
      CASE WHEN v_name IS NOT NULL
           THEN v_name || ', עוד לא הוספת רכב'
           ELSE 'עוד לא הוספת רכב' END,
      'הוסיפו את כלי התחבורה הראשון שלכם כדי לקבל תזכורות לטסט, ביטוח וטיפולים — לוקח פחות מדקה.',
      jsonb_build_object('reason', 'no_vehicles_owned')
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_no_vehicle(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.notify_no_vehicle(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_no_vehicle(uuid, text) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST (read-only — does NOT send anything):
--   SELECT count(*) FROM admin_no_vehicle_nudge_list(0);   -- blast audience
--   SELECT count(*) FROM admin_no_vehicle_nudge_list(4);   -- daily-cron audience
--   SELECT * FROM admin_no_vehicle_nudge_list(0) LIMIT 20; -- inspect rows
-- ═══════════════════════════════════════════════════════════════════════════
