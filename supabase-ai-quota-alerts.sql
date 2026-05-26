-- ==========================================================================
-- ai_quota_alerts + surface column + hourly cron
--
-- Added 2026-05-26 alongside the AdminAiUsage analytics enhancements.
-- Three things in one migration:
--
--   1. New `surface` column on public.ai_usage_logs. The existing
--      `feature` column groups all 7 scan UIs under
--      'scan_extraction' — useful but coarse. `surface` answers
--      "which exact screen / button generated this call?"  so the
--      admin can decide where to throttle when quota gets tight.
--      Nullable + CHECK so old rows survive and unknown values are
--      rejected at insert time.
--
--   2. New `public.ai_quota_alerts` table. One row per
--      (provider, threshold, sent_date) — prevents the hourly
--      check-ai-quota job from blasting the same alert 24 times
--      a day. Acts as the dedup ledger.
--
--   3. pg_cron job 'check-ai-quota' that fires the new Edge Function
--      every hour on the hour. Same pattern as the daily-digest job
--      (see supabase-daily-digest.sql) — net.http_post with the
--      X-Dispatch-Secret pulled from vault.decrypted_secrets.
-- ==========================================================================

-- ── 1. surface column on ai_usage_logs ───────────────────────────────────

ALTER TABLE public.ai_usage_logs
  ADD COLUMN IF NOT EXISTS surface text;

-- Drop the constraint if it exists from a previous run, then re-add it
-- with the current allow-list. Lets us evolve the enum without manual
-- DROP/ADD juggling.
ALTER TABLE public.ai_usage_logs
  DROP CONSTRAINT IF EXISTS ai_usage_logs_surface_check;

ALTER TABLE public.ai_usage_logs
  ADD CONSTRAINT ai_usage_logs_surface_check
  CHECK (
    surface IS NULL
    OR surface IN (
      'chat_assistant',          -- src/pages/AiAssistant.jsx (Yossi/Baruch chat)
      'community_reply',         -- src/components/community/CommentSection.jsx
      'vehicle_scan',            -- src/components/vehicle/VehicleScanWizard.jsx (cars)
      'vessel_scan',             -- src/components/vehicle/VesselScanWizard.jsx
      'vehicle_inline_scan',     -- src/components/vehicle/VehicleInfoSection.jsx (quick re-scan)
      'driver_license_scan',     -- src/components/profile/DriverLicenseScanDialog.jsx
      'expense_personal_scan',   -- src/pages/MyExpenses.jsx receipt scan
      'expense_business_scan',   -- src/components/expenses/ReceiptScanCard.jsx
      'document_scan'            -- src/pages/Documents.jsx via DocUploadDialog
    )
  );

-- Index for the breakdown queries the dashboard will run.
CREATE INDEX IF NOT EXISTS ai_usage_logs_surface_idx
  ON public.ai_usage_logs (surface, created_at DESC);

-- ── 2. ai_quota_alerts table (dedup ledger) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_quota_alerts (
  id          uuid         NOT NULL DEFAULT gen_random_uuid(),
  provider    text         NOT NULL,
  threshold   integer      NOT NULL,    -- 70 or 90
  sent_date   date         NOT NULL DEFAULT CURRENT_DATE,
  requests_at_send integer NOT NULL,    -- snapshot of RPD when the alert fired
  message     text,                     -- the actual Telegram text, for audit
  created_at  timestamptz  NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_quota_alerts_pkey PRIMARY KEY (id),

  CONSTRAINT ai_quota_alerts_provider_check
    CHECK (provider IN ('gemini', 'groq', 'claude', 'grok')),

  CONSTRAINT ai_quota_alerts_threshold_check
    CHECK (threshold IN (70, 90)),

  -- One alert per (provider, threshold) per day. The cron job uses
  -- ON CONFLICT DO NOTHING; without this constraint the dedup would
  -- need a SELECT-then-INSERT race window.
  CONSTRAINT ai_quota_alerts_dedup
    UNIQUE (provider, threshold, sent_date)
);

CREATE INDEX IF NOT EXISTS ai_quota_alerts_recent_idx
  ON public.ai_quota_alerts (sent_date DESC, provider);

-- RLS — admins read everything, no client writes (service role inserts).
ALTER TABLE public.ai_quota_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_quota_alerts_admin_read ON public.ai_quota_alerts;
CREATE POLICY ai_quota_alerts_admin_read
  ON public.ai_quota_alerts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ── 3. pg_cron job — hourly quota check ─────────────────────────────────

-- Idempotent: remove any previous scheduling under the same name first.
SELECT cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'check-ai-quota';

SELECT cron.schedule(
  'check-ai-quota',
  '0 * * * *',   -- every hour on the hour
  $cron$
  SELECT net.http_post(
    url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/check-ai-quota',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Dispatch-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                            WHERE name = 'dispatch_secret' LIMIT 1)
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

NOTIFY pgrst, 'reload schema';


-- ==========================================================================
-- USEFUL ADMIN QUERIES
--
-- How close are we to the daily quota right now?
--   SELECT provider, COUNT(*) AS requests_today
--     FROM public.ai_usage_logs
--    WHERE created_at >= CURRENT_DATE
--    GROUP BY provider;
--
-- Which surfaces consumed the most tokens this month?
--   SELECT surface, COUNT(*) AS calls, SUM(total_tokens) AS tokens
--     FROM public.ai_usage_logs
--    WHERE created_at >= NOW() - INTERVAL '30 days'
--    GROUP BY surface
--    ORDER BY tokens DESC NULLS LAST;
--
-- Which alerts fired today?
--   SELECT provider, threshold, requests_at_send, created_at
--     FROM public.ai_quota_alerts
--    WHERE sent_date = CURRENT_DATE
--    ORDER BY created_at DESC;
--
-- Force a manual quota check (useful for smoke-testing the function):
--   SELECT net.http_post(
--     url     := 'https://zuqvolqapwcxomuzoodu.supabase.co/functions/v1/check-ai-quota',
--     headers := jsonb_build_object(
--       'Content-Type',      'application/json',
--       'X-Dispatch-Secret', '<your-dispatch-secret>'
--     ),
--     body    := '{}'::jsonb
--   );
-- ==========================================================================
