-- ═══════════════════════════════════════════════════════════════════════════
-- Apple Private Relay: resume sending to @privaterelay.appleid.com
-- 2026-09-11
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️  DO NOT RUN THIS YET.  ⚠️⚠️
--
-- Apply ONLY after BOTH registration steps in
-- docs/runbook-apple-private-email-relay.md are done AND verified:
--
--   א. car-reminder.app + the Resend Return-Path subdomain + no-reply@…
--      registered under Certificates, Identifiers & Profiles →
--      Sign in with Apple for Email Communication
--   ב. Supabase → Authentication → SMTP Settings pointed at Resend, so
--      auth mail (signup confirmation, password reset, OTP) also leaves
--      from car-reminder.app instead of @mail.app.supabase.io
--
-- Running this BEFORE א simply resumes bouncing. Running it after א but
-- before ב fixes reminders while auth mail keeps bouncing.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THIS FILE EXISTS
--
-- Apple's "Hide My Email" gives a working forwarding address, but Apple
-- relays only from source domains registered in the developer portal.
-- Ours was not registered, so mail to those addresses bounced. Two senders
-- were taught to skip such users to stop the bounce:
--
--   supabase-welcome-backfill.sql   admin_welcome_backfill_list
--   supabase-no-vehicle-nudge.sql   admin_no_vehicle_nudge_list
--
-- That stopped the noise and guaranteed the silence. Once registration is
-- live those two filters are the only thing still preventing delivery, so
-- they have to come off in the same operation — otherwise the registration
-- is complete and nothing changes, which is the failure mode that is
-- hardest to notice.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ⚠️ NOT THE WHOLE STORY: the main reminder dispatcher never filtered
-- relay addresses at all. email_dispatch_candidates() selects u.email from
-- auth.users with no relay condition anywhere in any of its definitions, so
-- test / insurance / licence reminders have been sent to these users and
-- bouncing on every cycle. Nothing in this file changes that, and nothing
-- needs to: once registration is live those sends simply start landing.
-- It is recorded here because it is the reason this is urgent rather than
-- cosmetic — repeated bounces damage the sending domain's reputation for
-- every other user too.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY A NEW FILE AND NOT AN EDIT
--
-- Both source files were applied and recorded in public.sql_ledger, whose
-- carrying field is the sha256 of the exact bytes that ran. Editing them
-- now would detach them from what the database actually executed and mark
-- them CHANGED in `drift` forever. Per CLAUDE.md: an addition to an already
-- applied feature is a NEW file.
--
-- CREATE OR REPLACE rather than DROP + CREATE (which the originals used):
-- the signatures and return types are unchanged, privileges survive a
-- replace, and there is no window in which the function does not exist.
--
-- REPLAY_SAFE: idempotent, no data written, no schema changed.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. Welcome backfill — identical to supabase-welcome-backfill.sql except
--    the relay exclusion is gone. The internal / test / Apple-review
--    address list stays: it is unrelated to this change.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_welcome_backfill_list(p_since_hours int DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.admin_welcome_backfill_list(int) FROM public;
REVOKE ALL ON FUNCTION public.admin_welcome_backfill_list(int) FROM authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. No-vehicle nudge — identical to supabase-no-vehicle-nudge.sql except
--    the relay exclusion is gone.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_no_vehicle_nudge_list(p_min_age_days int DEFAULT 4)
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
-- VERIFY, in this order
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. Neither function still carries the filter (expect 0 rows):
--
--      SELECT p.proname
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.proname IN ('admin_welcome_backfill_list',
--                          'admin_no_vehicle_nudge_list')
--        AND pg_get_functiondef(p.oid) LIKE '%privaterelay%';
--
-- 2. Both are still SECURITY DEFINER with a pinned search_path (expect 2):
--
--      SELECT count(*)
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.proname IN ('admin_welcome_backfill_list',
--                          'admin_no_vehicle_nudge_list')
--        AND p.prosecdef
--        AND 'search_path=public' = ANY(p.proconfig);
--
-- 3. Relay users now appear as candidates (was 0 before this file):
--
--      SELECT count(*) FROM admin_welcome_backfill_list()
--       WHERE email LIKE '%@privaterelay.appleid.com';
--
-- 4. Send one real message and confirm it LANDS rather than bounces.
--    Until a delivered event appears, registration is unproven:
--
--      SELECT * FROM public.email_events
--       WHERE recipient_email LIKE '%@privaterelay.appleid.com'
--       ORDER BY created_at DESC LIMIT 10;
--
-- 5. Record this file:  node scripts/sql-ledger.cjs record <this file>
--    Put the result of step 4 in p_notes — what you actually saw, not
--    "applied".
-- ═══════════════════════════════════════════════════════════════════════════
