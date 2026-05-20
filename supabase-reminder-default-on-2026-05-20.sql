-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-05-20 — Reminder emails default-on for new signups
--
-- Background:
--   `reminder_settings.email_enabled` defaulted to FALSE and rows were
--   created lazily when the user first opened /Settings → התראות. Most
--   users never opened that page → never had a row → dispatcher RPC
--   email_dispatch_candidates() never matched them. Result: 0/45
--   launch-day signups received reminder emails.
--
-- Change:
--   Extend `handle_new_user` (the auth.users INSERT trigger that already
--   creates account + membership) to ALSO insert a default reminder_settings
--   row with `email_enabled = true`. From now on, every new signup arrives
--   pre-configured to receive operational reminder emails. The user can
--   still turn them off in /Settings → התראות; the toggle there now mirrors
--   this default.
--
-- Why default TRUE:
--   Reminder emails are operational/transactional — the user signed up
--   FOR the reminders. Default OFF made the feature dead on arrival.
--   Marketing emails live behind a different gate (user_notification_
--   preferences per notification_key) so true here does NOT subscribe
--   anyone to marketing.
--
-- Existing users:
--   NOT touched. The 45 launch-day signups stay at "no row" / opt-out.
--   They will opt in (or not) on their own terms when they next visit
--   /Settings → התראות. Per Ofek's product call: "מבחינתי אפשר לוותר
--   על אלו שכבר נרשמו ולא קיבלו" (2026-05-20).
--
-- Idempotent:
--   Trigger function uses CREATE OR REPLACE. The reminder_settings INSERT
--   wraps a try/catch so a duplicate (re-run scenario) doesn't reject the
--   signup itself.
-- ═══════════════════════════════════════════════════════════════════════════


CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_account_id uuid;
BEGIN
  -- ── 1. Personal account + owner membership ──────────────────────────────
  -- Same body as supabase-new-user-bootstrap.sql. Re-stated so this single
  -- migration is the source of truth going forward.
  IF EXISTS (
    SELECT 1
      FROM public.account_members am
      JOIN public.accounts a ON a.id = am.account_id
     WHERE am.user_id = NEW.id
       AND a.type    = 'personal'
       AND am.status = 'פעיל'
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.accounts (owner_user_id)
      VALUES (NEW.id)
      RETURNING id INTO new_account_id;

    INSERT INTO public.account_members (account_id, user_id, role, status, joined_at)
      VALUES (new_account_id, NEW.id, 'בעלים', 'פעיל', now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user account bootstrap failed for user_id=%: %', NEW.id, sqlerrm;
  END;

  -- ── 2. Reminder settings — default-on for email ─────────────────────────
  -- A row pre-populated with email_enabled=true makes the reminder pipeline
  -- find the user as a candidate on day-1. Without this row, the user is
  -- invisible to email_dispatch_candidates() until they open /Settings.
  -- All non-default values match DEFAULT_REMINDER_SETTINGS in src/lib/
  -- notificationService.js and src/pages/ReminderSettingsPage.jsx.
  BEGIN
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
    ) VALUES (
      NEW.id,
      14,
      14,
      14,
      7,
      3,
      8,
      true,
      false
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user reminder_settings bootstrap failed for user_id=%: %', NEW.id, sqlerrm;
  END;

  RETURN NEW;
END;
$$;

-- Re-bind the trigger so the new function body is what fires. Safe to
-- re-run; DROP IF EXISTS handles the previous version.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';

-- ── Verify ─────────────────────────────────────────────────────────────────
-- After running, the next time a new user signs up (try with a throwaway
-- gmail), check:
--   SELECT user_id, email_enabled, created_at
--     FROM public.reminder_settings
--    WHERE user_id = '<new user id>';
-- Expected: one row, email_enabled = true.
