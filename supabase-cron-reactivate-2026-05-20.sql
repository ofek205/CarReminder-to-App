-- ═══════════════════════════════════════════════════════════════════════════
-- 2026-05-20 — Reactivate the reminder-email cron with REAL values
--
-- Background:
--   The original cron job `email-dispatcher-hourly` (from supabase-email-
--   dispatcher.sql:248-261) was installed with placeholder text — the
--   literal strings `<YOUR_PROJECT_REF>` and `<SERVICE_ROLE_KEY>` were
--   never replaced. pg_net failed every hourly invocation with "Quote
--   command returned error" on URL encoding. Ofek unscheduled the job
--   on 2026-05-19 to stop log spam.
--
--   This migration re-schedules the cron with:
--     1. The real project URL (zuqvolqapwcxomuzoodu).
--     2. The Vault-backed `dispatch_secret` (NOT the service role key —
--        the push trigger already uses this pattern; see supabase-push-
--        trigger-dedup.sql:53-56).
--     3. The same '7 * * * *' (hourly at :07) schedule as before.
--
-- Prerequisites:
--   • Vault entry `dispatch_secret` must exist. Verify:
--       SELECT name FROM vault.secrets WHERE name = 'dispatch_secret';
--     If missing, create it via Supabase Dashboard → Project Settings →
--     Vault. The same secret must be stored as DISPATCH_SECRET in the
--     Edge Function's Secrets (Dashboard → Edge Functions → Secrets).
--     Without the matching env var, `dispatch-reminder-emails` will
--     reject every call with auth_failed.
--   • Edge Function `dispatch-reminder-emails` must be deployed.
--   • Migrations supabase-email-center-full-control.sql and
--     supabase-reminder-default-on-2026-05-20.sql should be applied first
--     so the triggers/RPCs/default-on rows are in place.
--
-- Idempotent:
--   Drops any existing `email-dispatcher-hourly` job before re-scheduling.
--   Safe to re-run after any change.
-- ═══════════════════════════════════════════════════════════════════════════


-- Extension guard — should already be enabled, but re-stating is harmless.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ── Drop any previous version (handles re-runs + stale placeholder job) ────
DO $$
DECLARE
  v_existing_jobid bigint;
BEGIN
  SELECT jobid INTO v_existing_jobid
    FROM cron.job
   WHERE jobname = 'email-dispatcher-hourly';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
    RAISE NOTICE 'unscheduled previous email-dispatcher-hourly (jobid %)', v_existing_jobid;
  END IF;
END;
$$;


-- ── Re-schedule with real values ───────────────────────────────────────────
-- Note the use of dollar-quoting via $cron$...$cron$ instead of $$...$$
-- because the inner command itself contains '$' isn't an issue here, but
-- the named delimiter makes the boundary unambiguous if we ever embed
-- more SQL in the future.
SELECT cron.schedule(
  'email-dispatcher-hourly',
  '7 * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/dispatch-reminder-emails',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Dispatch-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dispatch_secret' LIMIT 1)
    ),
    body    := '{}'::jsonb
  );
  $cron$
);


-- ── Verify ─────────────────────────────────────────────────────────────────
-- Right after running:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--    WHERE jobname = 'email-dispatcher-hourly';
--   -- Expected: one row, active = true.
--
-- One hour later (around the next :07):
--   SELECT jobid, runid, status, start_time, return_message
--     FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'email-dispatcher-hourly')
--    ORDER BY start_time DESC
--    LIMIT 3;
--   -- Expected: status = 'succeeded'. If 'failed', read return_message
--   -- and fix Vault / Edge Function deployment before continuing.
-- ═══════════════════════════════════════════════════════════════════════════
