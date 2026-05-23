-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-welcome-backfill.sql — RPC for the backfill-welcome Edge Function
--
-- Two modes:
--   admin_welcome_backfill_list()            → ALL users without welcome
--   admin_welcome_backfill_list(p_since_hours := 1) → only last N hours
--
-- The second mode is used by the pg_cron job (every 10 min) to catch
-- new signups whose client-side welcome dispatch failed silently.
--
-- Called by service_role from Edge Function — no GRANT to authenticated.
-- Run ONCE in SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_welcome_backfill_list();
DROP FUNCTION IF EXISTS public.admin_welcome_backfill_list(int);

CREATE FUNCTION public.admin_welcome_backfill_list(p_since_hours int DEFAULT NULL)
RETURNS TABLE (
  user_id      uuid,
  email        text,
  full_name    text,
  provider     text,
  signed_up_at timestamptz
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
    (u.raw_app_meta_data->>'provider')::text                AS provider,
    u.created_at                                            AS signed_up_at
  FROM auth.users u
  WHERE u.deleted_at IS NULL
    AND u.email_confirmed_at IS NOT NULL
    AND u.email::text NOT IN (
      'natanzone2024@gmail.com',
      'ofek205@gmail.com',
      'ofektest@gmail.com',
      'test@test.com',
      'apple-review@car-reminder.app'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.email_send_log esl
      WHERE esl.recipient_email = u.email::text
        AND esl.notification_key = 'welcome'
    )
    -- When p_since_hours is set, only pick up recent signups
    AND (
      p_since_hours IS NULL
      OR u.created_at >= now() - (p_since_hours || ' hours')::interval
    )
  ORDER BY u.created_at DESC;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- pg_cron job: every 10 minutes, send welcome to recent signups who missed it
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'welcome-catch-up';

SELECT cron.schedule(
  'welcome-catch-up',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/backfill-welcome',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Dispatch-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'dispatch_secret' LIMIT 1)
    ),
    body    := '{"since_hours": 1}'::jsonb
  );
  $cron$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST:
--   SELECT * FROM admin_welcome_backfill_list();           -- all missing
--   SELECT * FROM admin_welcome_backfill_list(1);          -- last 1 hour
-- ═══════════════════════════════════════════════════════════════════════════
