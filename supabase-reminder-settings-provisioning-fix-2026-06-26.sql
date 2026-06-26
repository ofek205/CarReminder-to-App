-- ═══════════════════════════════════════════════════════════════════════════
-- Fix reminder_settings provisioning — 2026-06-26
-- ═══════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE (diagnosed from live DB this session):
--   handle_new_user() inserts a reminder_settings row on signup with
--       INSERT ... ON CONFLICT (user_id) DO NOTHING
--   but reminder_settings has NO unique/exclusion constraint on user_id
--   (PK is on the surrogate `id`). Postgres therefore raises 42P10
--   ("there is no unique or exclusion constraint matching the ON CONFLICT
--   specification") for EVERY signup. The error is swallowed by the
--   provisioning EXCEPTION handler and logged to provisioning_errors
--   (111 rows, context='handle_new_user.reminder_settings', since logging
--   was added 2026-06-03; silent before that).
--
-- IMPACT:
--   reminder_settings provisioning has NEVER worked via the trigger since
--   the block was added (~2026-05-20, v4.8.0). Result: only 14 of 564 users
--   have a row; only 8 have email_enabled=true. The email reminder pipeline
--   (cron + dispatch-reminder-emails) runs perfectly but is starved — its
--   candidate query INNER JOINs reminder_settings ON email_enabled=true, so
--   ~98% of users are invisible. In the last 30 days exactly 1 reminder_test
--   email went out, while 36 vehicles had a test due within 14 days.
--
-- THE FIX (two parts, no code change required):
--   1. Add UNIQUE(user_id) on reminder_settings. This immediately makes
--      handle_new_user's ON CONFLICT work → all FUTURE signups get a row.
--   2. Backfill a default-on row for every existing user who lacks one
--      (~550 users). Product decision (Ofek, 2026-06-26): full backfill,
--      email_enabled=true — reminders are operational, and the Settings UI
--      already shows the toggle ON by default, so users expect to be opted in.
--
-- SAFETY / SCOPE:
--   • Pre-flight duplicate check (below) returned 0 rows this session — safe
--     to add the unique constraint. If it ever returns rows, dedupe first.
--   • Defaults below are byte-identical to handle_new_user (14/14/14/7/3/8,
--     email on, whatsapp off) and to the frontend DEFAULT_FORM.
--   • Idempotent: constraint guarded by pg_constraint check; backfill uses
--     NOT EXISTS + ON CONFLICT DO NOTHING. Safe to re-run.
--   • ⚠ staging and prod currently SHARE the database. Running this affects
--     PRODUCTION immediately: ~550 users become eligible for reminder emails.
--     Resend free tier is 100/day. The first cron run after backfill will
--     send ~36–39 reminder_test emails in one burst (one per upcoming test
--     due date; the email_send_log unique key guarantees one-per-due-date).
--     Do NOT enable additional reminder types (insurance) in the same window.
--
-- Run ONCE in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. PRE-FLIGHT (run alone first; must return 0 rows) ─────────────────────
-- SELECT user_id, count(*) FROM public.reminder_settings
--  GROUP BY user_id HAVING count(*) > 1;


-- ── 1. Add the missing UNIQUE(user_id) so ON CONFLICT (user_id) works ───────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.reminder_settings'::regclass
       AND conname  = 'reminder_settings_user_id_key'
  ) THEN
    ALTER TABLE public.reminder_settings
      ADD CONSTRAINT reminder_settings_user_id_key UNIQUE (user_id);
  END IF;
END $$;


-- ── 2. Backfill existing users who have no reminder_settings row ────────────
-- Mirrors handle_new_user's defaults exactly. NOT EXISTS keeps it cheap and
-- the (now-valid) ON CONFLICT is a belt-and-suspenders guard against races.
INSERT INTO public.reminder_settings (
  user_id,
  remind_test_days_before,
  remind_insurance_days_before,
  remind_document_days_before,
  remind_maintenance_days_before,
  overdue_repeat_every_days,
  daily_job_hour,
  email_enabled,
  whatsapp_enabled
)
SELECT
  u.id, 14, 14, 14, 7, 3, 8, true, false
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.reminder_settings rs WHERE rs.user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;


-- ── 3. Verify ───────────────────────────────────────────────────────────────
-- Expect: settings_rows ≈ total_users, email_on ≈ total_users.
-- SELECT
--   (SELECT count(*) FROM public.reminder_settings)                     AS settings_rows,
--   (SELECT count(*) FROM public.reminder_settings WHERE email_enabled) AS email_on,
--   (SELECT count(*) FROM auth.users)                                   AS total_users;
--
-- Confirm the constraint now exists:
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conrelid = 'public.reminder_settings'::regclass AND contype = 'u';
--
-- After the next hourly cron tick (:07), confirm sends:
-- SELECT notification_key, status, count(*) FROM public.email_send_log
--  WHERE sent_at > now() - interval '1 day' GROUP BY 1,2 ORDER BY 1,2;
