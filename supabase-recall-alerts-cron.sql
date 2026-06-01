-- ═══════════════════════════════════════════════════════════════════════════
-- Recall alerts — daily pg_cron job — 2026-06-01
-- ═══════════════════════════════════════════════════════════════════════════
-- Calls the dispatch-recall-alerts edge function once a day. The function
-- matches every saved vehicle's plate against the MoT open-recall dataset and
-- notifies the owner of any NEW open recall (deduped via vehicle_recall_alerts).
--
-- PREREQUISITES (run/deploy these FIRST):
--   1. supabase-recall-alerts-2026-06-01.sql  (the dedup table)
--   2. dispatch-recall-alerts edge function deployed, Verify JWT = OFF
--   3. dispatch_secret already in vault.decrypted_secrets (it is — used by
--      every other dispatch cron)
--
-- Re-runnable — cron.schedule upserts by job name.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.schedule(
  'recall-alerts-daily',
  '0 8 * * *',   -- 08:00 UTC daily (after gov.il's daily refresh)
  $cron$
  SELECT net.http_post(
    url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/dispatch-recall-alerts',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Dispatch-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'dispatch_secret' LIMIT 1)
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- Verify the job is scheduled:
--   SELECT jobid, jobname, schedule FROM cron.job WHERE jobname = 'recall-alerts-daily';
--
-- To remove:
--   SELECT cron.unschedule('recall-alerts-daily');
