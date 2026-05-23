-- ═══════════════════════════════════════════════════════════════════════════
-- welcome-backfill-check.sql — Find users who never got a welcome email
--
-- Run in SQL Editor. Read-only query — safe to run anytime.
-- ═══════════════════════════════════════════════════════════════════════════

-- QUERY 1: Stats — how many signed up since v4.8.0, how many got welcome
SELECT
  'total_signups_since_v480' AS metric,
  COUNT(*)::int AS value
FROM auth.users
WHERE created_at >= '2026-05-20'::date
  AND deleted_at IS NULL

UNION ALL

SELECT
  'got_welcome_email',
  COUNT(DISTINCT esl.recipient_email)::int
FROM public.email_send_log esl
WHERE esl.notification_key = 'welcome'

UNION ALL

SELECT
  'total_users',
  COUNT(*)::int
FROM auth.users
WHERE deleted_at IS NULL;


-- QUERY 2: Users who NEVER got a welcome email (candidates for backfill)
SELECT
  u.id                                                    AS user_id,
  u.email                                                 AS email,
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(u.raw_user_meta_data->>'name', ''),
    split_part(u.email, '@', 1)
  )                                                       AS full_name,
  u.raw_app_meta_data->>'provider'                        AS provider,
  u.created_at                                            AS signed_up_at,
  u.email_confirmed_at IS NOT NULL                        AS email_verified
FROM auth.users u
WHERE u.deleted_at IS NULL
  AND u.email_confirmed_at IS NOT NULL
  AND u.email NOT IN (
    'natanzone2024@gmail.com',
    'ofek205@gmail.com'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.email_send_log esl
    WHERE esl.recipient_email = u.email
      AND esl.notification_key = 'welcome'
  )
ORDER BY u.created_at DESC;
