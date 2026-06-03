-- ═══════════════════════════════════════════════════════════════════════════
-- Harden handle_new_user — log silent provisioning failures — 2026-06-03
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: orphans still appear (~1/day) AFTER the accounts.name DEFAULT fix.
-- Verified the current orphan (ofeke@gmail.com) provisioned fine when retried
-- manually, so the signup-time failure is TRANSIENT (lock/timeout/contention).
-- But handle_new_user swallows it as a bare RAISE WARNING with no row anywhere,
-- so we're blind to the real cause.
--
-- This change is PURELY ADDITIVE and SAFE for the signup path:
--   • The provisioning logic is byte-identical (same inserts, same defaults).
--   • The ONLY new code lives INSIDE the existing EXCEPTION handlers, and is
--     itself wrapped in a nested BEGIN/EXCEPTION that swallows any error — so
--     the logging can never break a signup. RAISE WARNING is kept too.
--   • Now a failure leaves a public.provisioning_errors row (sqlstate +
--     message) so the NEXT orphan finally tells us WHY.
--
-- Run ONCE in the Supabase SQL Editor (or via the management API).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_account_id uuid;
BEGIN
  -- Already provisioned? (idempotent re-fire guard)
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

  -- 1. Personal account + owner membership (name/type come from column DEFAULTs)
  BEGIN
    INSERT INTO public.accounts (owner_user_id)
      VALUES (NEW.id)
      RETURNING id INTO new_account_id;

    INSERT INTO public.account_members (account_id, user_id, role, status, joined_at)
      VALUES (new_account_id, NEW.id, 'בעלים', 'פעיל', now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user account bootstrap failed for user_id=%: %', NEW.id, sqlerrm;
    -- Persist the real cause so a silent orphan is no longer invisible.
    -- Nested + swallowed: logging can NEVER break the signup transaction.
    BEGIN
      INSERT INTO public.provisioning_errors (user_id, email, context, sqlstate, message)
        VALUES (NEW.id, NEW.email, 'handle_new_user.account', SQLSTATE, sqlerrm);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;

  -- 2. Reminder settings — default-on for email
  BEGIN
    INSERT INTO public.reminder_settings (
      user_id, remind_test_days_before, remind_insurance_days_before,
      remind_document_days_before, remind_maintenance_days_before,
      overdue_repeat_every_days, daily_job_hour, email_enabled, whatsapp_enabled
    ) VALUES (NEW.id, 14, 14, 14, 7, 3, 8, true, false)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user reminder_settings bootstrap failed for user_id=%: %', NEW.id, sqlerrm;
    BEGIN
      INSERT INTO public.provisioning_errors (user_id, email, context, sqlstate, message)
        VALUES (NEW.id, NEW.email, 'handle_new_user.reminder_settings', SQLSTATE, sqlerrm);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;

  RETURN NEW;
END;
$function$;

-- ── Heal cron: daily → hourly, so the orphan window shrinks from 24h to 1h.
-- NOTE: a direct `UPDATE cron.job SET schedule` is permission-denied for the
-- API/editor role, so use cron.alter_job (runs as the cron owner).
SELECT cron.alter_job(
  job_id   := (SELECT jobid FROM cron.job WHERE jobname = 'provision-orphan-users-daily'),
  schedule := '7 * * * *'
);

-- Verify:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname='provision-orphan-users-daily';
--   SELECT * FROM public.provisioning_errors ORDER BY occurred_at DESC LIMIT 10;
