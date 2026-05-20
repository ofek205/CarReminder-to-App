-- ═══════════════════════════════════════════════════════════════════════════
-- One-off welcome-email backfill — launch-day cohort (2026-05-18 → 2026-05-19)
--
-- Context: v4.7.0 launched on Web + iOS + Android on 2026-05-18. ~45 users
-- signed up, but only 2 received a "welcome" email because the
-- dispatcher (AuthPage.dispatchWelcomeEmail) was wired ONLY for the
-- email+password signup path. Users who came in via Google / Apple
-- OAuth bypassed the dispatcher entirely. The going-forward fix lives
-- in src/components/shared/GuestContext.jsx (dispatchOAuthWelcomeEmail).
-- This file recovers the historical cohort.
--
-- HOW TO RUN (Ofek, tomorrow morning ~09:00 IL):
--   1. Open Supabase Dashboard → SQL Editor → New query.
--   2. Paste the PREVIEW block below (Step 1). Run.
--      Sanity-check the count (~45) and skim the email list.
--   3. If the list looks right, follow the runbook in the comment under
--      Step 2 to actually send. We deliberately split preview from send
--      so a typo in the date range or filters can't trigger a mass send.
--
-- Safety:
--   • Read-only SELECT. Cannot send emails, cannot modify any table.
--   • NOT EXISTS clause already filters out anyone who somehow received
--     a welcome — re-running the backfill is idempotent.
--   • Internal allowlist matches the accounts known on 2026-05-19.
--     If you have more test accounts, extend the NOT IN (...) list.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── STEP 1 — PREVIEW (run this first, alone) ────────────────────────────────

SELECT
  u.id                                                    AS user_id,
  u.email                                                 AS recipient_email,
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(u.raw_user_meta_data->>'name', ''),
    split_part(u.email, '@', 1)
  )                                                       AS full_name,
  u.raw_app_meta_data->>'provider'                        AS provider,
  u.created_at                                            AS signed_up_at,
  u.email_confirmed_at                                    AS confirmed_at
FROM auth.users u
WHERE u.created_at >= '2026-05-18 00:00:00+00'::timestamptz
  AND u.created_at <  '2026-05-20 00:00:00+00'::timestamptz
  AND u.email_confirmed_at IS NOT NULL
  AND u.deleted_at IS NULL
  AND u.email NOT IN (
    'natanzone2024@gmail.com',
    'ofek205@gmail.com'
    -- Add any other internal / test accounts to skip here.
  )
  AND NOT EXISTS (
    SELECT 1
      FROM public.email_send_log esl
     WHERE esl.user_id = u.id
       AND esl.notification_key = 'welcome'
  )
ORDER BY u.created_at;


-- ── STEP 2 — SEND (do NOT run this block until preview looks right) ─────────
--
-- The actual send cannot run from SQL because:
--   • send-email Edge Function rejects pg_net calls (requires a user
--     Bearer JWT, not service_role or x-dispatch-secret — see
--     supabase/functions/send-email/index.ts:47-50).
--   • Calling Resend directly from SQL would bypass email_send_log,
--     rate limits, and the kill switch — that's worse than no send.
--
-- Approach we'll use tomorrow morning, in order of preference:
--   (a) Run `node scripts/backfill-welcome-2026-05-19.cjs` (TBD).
--       That script reads Ofek's admin JWT from env, calls the
--       preview query above to get recipients, then POSTs to
--       send-email for each — rate-limited to fit Resend's 5/min/user.
--   (b) Fallback: use SendTestDialog in /EmailCenter manually for
--       each recipient. Tedious (45 sends) but reliable.
--
-- After the send, confirm with:
--   SELECT count(*) FROM public.email_send_log
--    WHERE notification_key='welcome'
--      AND sent_at >= '2026-05-20 00:00:00+00'::timestamptz;
-- ═══════════════════════════════════════════════════════════════════════════
