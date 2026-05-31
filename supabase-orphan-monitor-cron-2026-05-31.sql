-- ═══════════════════════════════════════════════════════════════════════════
-- Orphan-user monitor + auto-heal cron — 2026-05-31
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: the orphan-signup bug (accounts.name NOT NULL + trigger omitting name,
-- fixed in supabase-fix-orphan-signups-2026-05-31.sql) was INVISIBLE for a
-- long time because handle_new_user swallowed the failure as a bare
-- RAISE WARNING — no admin_alert, no provisioning_errors row. A user had to
-- manually report it.
--
-- This closes the observability blind spot WITHOUT touching the high-stakes
-- signup trigger (a mistake there = "Database error saving new user" for
-- EVERY new user — worse than an orphan). Instead, the EXISTING daily
-- orphan cron (job name 'provision-orphan-users-daily') is upgraded to:
--   1. HEAL — provision account + owner membership for every orphan
--      (reaches old + new apps immediately, server-side).
--   2. ALERT — if it healed any, insert an admin_alerts row (kind=
--      'orphan_users_healed') which rides the existing AFTER INSERT trigger
--      → dispatch-admin-alert → Telegram. So the next silent provisioning
--      failure surfaces within 24h instead of waiting for a user report.
--
-- SAFETY: runs at 04:00 UTC, fully isolated from the signup path. A failure
-- only fails the cron run (logged) — users are never affected. Per-user
-- errors are caught so one bad row can't abort the whole sweep. Alert is
-- deduped to once per 4h.
--
-- Re-runnable — cron.schedule upserts by job name.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.schedule(
  'provision-orphan-users-daily',
  '0 4 * * *',
  $cron$
  DO $inner$
  DECLARE
    u record;
    new_account_id uuid;
    v_count int := 0;
  BEGIN
    FOR u IN
      SELECT id, email FROM auth.users
       WHERE NOT EXISTS (
         SELECT 1 FROM public.account_members
          WHERE user_id = auth.users.id AND status = 'פעיל')
    LOOP
      BEGIN
        INSERT INTO public.accounts (owner_user_id, name)
          VALUES (u.id, COALESCE(NULLIF(split_part(u.email,'@',1),''),'חשבון'))
          RETURNING id INTO new_account_id;
        INSERT INTO public.account_members (account_id, user_id, role, status, joined_at)
          VALUES (new_account_id, u.id, 'בעלים', 'פעיל', now());
        v_count := v_count + 1;
      EXCEPTION WHEN OTHERS THEN
        NULL;  -- a single bad user must not abort the whole sweep
      END;
    END LOOP;

    -- Healed orphans => signup provisioning is still failing silently => alert.
    IF v_count > 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.admin_alerts
         WHERE kind = 'orphan_users_healed'
           AND created_at >= now() - interval '4 hours'
      ) THEN
        INSERT INTO public.admin_alerts
          (kind, severity, title, message, context, first_seen_at, last_seen_at, count)
        VALUES (
          'orphan_users_healed', 'high',
          'משתמשים ללא חשבון תוקנו אוטומטית',
          format('נמצאו ותוקנו %s משתמשים ללא חשבון — signup provisioning נכשל בשקט. כדאי לבדוק את handle_new_user.', v_count),
          jsonb_build_object('healed_count', v_count),
          now(), now(), v_count
        );
      END IF;
    END IF;
  END $inner$;
  $cron$
);

-- Verify the job is scheduled:
--   SELECT jobid, jobname, schedule FROM cron.job WHERE jobname = 'provision-orphan-users-daily';
