-- ==========================================================================
-- ai_usage_logs — per-call usage tracking for the AI proxy
--
-- Added 2026-05-26. Lets us answer:
--   • How many distinct users are using the AI features?
--   • Which feature consumes the most tokens?
--   • Which provider are we hitting most? Are we near the free quota?
--   • Are attachment (image / document) requests pulling their weight,
--     or are they too expensive to leave open?
--   • Who are the heaviest users? Do we need per-user caps?
--
-- One row per successful ai-proxy call. Failures are NOT logged here —
-- they go to public.app_errors via reportEdgeError. Logging is best-
-- effort: if the insert fails, the response still goes out fine.
--
-- The writer is the ai-proxy Edge Function, running under the service
-- role. The READERS are the admin dashboard (sees everything) and the
-- user's own profile if we ever want to show "your AI usage this month"
-- (sees only their own rows). RLS below enforces this split.
--
-- Master kill switch: public.app_config.ai_usage_tracking_enabled.
-- When false, the Edge Function skips the insert. The table stays —
-- existing data is preserved.
-- ==========================================================================

-- 1. Extension for gen_random_uuid (already enabled in this project but
--    safe to re-declare; ignored if already present).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Table definition.
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id                 uuid           NOT NULL DEFAULT gen_random_uuid(),
  user_id            uuid           NOT NULL,
  provider           text           NOT NULL,
  model              text           NOT NULL,
  feature            text,
  prompt_tokens      integer,
  completion_tokens  integer,
  total_tokens       integer,
  had_attachment     boolean        NOT NULL DEFAULT false,
  created_at         timestamptz    NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id),

  CONSTRAINT ai_usage_logs_provider_check
    CHECK (provider IN ('groq', 'gemini', 'claude', 'grok')),

  -- feature is nullable because community_expert / yossi_chat /
  -- scan_extraction is whitelisted on the client and might be missing
  -- on a malformed request. Constrain to the known set when present.
  CONSTRAINT ai_usage_logs_feature_check
    CHECK (
      feature IS NULL
      OR feature IN ('community_expert', 'yossi_chat', 'scan_extraction')
    ),

  -- Foreign key to auth.users. ON DELETE CASCADE so when a user is
  -- removed, their usage trail goes with them — keeps the table tidy
  -- and aligns with GDPR right-to-erasure expectations.
  CONSTRAINT ai_usage_logs_user_fk
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 3. Indexes for the queries the admin dashboard will run.
--    a) created_at DESC — newest-first, used by every "last N days" panel
--    b) user_id        — "how much did user X use this week?"
--    c) (provider, feature, created_at) — breakdown charts
CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx
  ON public.ai_usage_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_logs_user_id_idx
  ON public.ai_usage_logs (user_id);

CREATE INDEX IF NOT EXISTS ai_usage_logs_provider_feature_idx
  ON public.ai_usage_logs (provider, feature, created_at DESC);

-- 4. RLS — locked by default; explicit policies grant access.
ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- 5. SELECT policy: a user sees their own rows.
DROP POLICY IF EXISTS ai_usage_logs_select_own
  ON public.ai_usage_logs;
CREATE POLICY ai_usage_logs_select_own
  ON public.ai_usage_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 6. SELECT policy: an admin sees everything.
--    is_admin() is the project's SECURITY DEFINER admin check — same
--    function the AI provider settings page uses.
DROP POLICY IF EXISTS ai_usage_logs_select_admin
  ON public.ai_usage_logs;
CREATE POLICY ai_usage_logs_select_admin
  ON public.ai_usage_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- 7. NO INSERT / UPDATE / DELETE policies are defined.
--    With RLS enabled and no permissive INSERT policy, only the service
--    role bypasses RLS and can write. The Edge Function uses the
--    service role key, so it can insert; users cannot tamper with their
--    own usage rows from the client.

-- 8. PostgREST schema cache reload so the dashboard's first query
--    after deploy sees the new table without a 10-minute wait.
NOTIFY pgrst, 'reload schema';


-- ==========================================================================
-- USEFUL QUERIES FOR THE ADMIN DASHBOARD
--
-- a) Distinct users in the last 7 days, broken down by feature:
--   SELECT feature, COUNT(DISTINCT user_id) AS users_7d
--     FROM public.ai_usage_logs
--    WHERE created_at >= NOW() - INTERVAL '7 days'
--    GROUP BY feature
--    ORDER BY users_7d DESC;
--
-- b) Tokens spent per provider in the last 30 days:
--   SELECT provider,
--          SUM(prompt_tokens)     AS in_tokens,
--          SUM(completion_tokens) AS out_tokens,
--          SUM(total_tokens)      AS total
--     FROM public.ai_usage_logs
--    WHERE created_at >= NOW() - INTERVAL '30 days'
--    GROUP BY provider
--    ORDER BY total DESC NULLS LAST;
--
-- c) Top 10 heaviest users this week:
--   SELECT user_id, SUM(total_tokens) AS week_tokens
--     FROM public.ai_usage_logs
--    WHERE created_at >= NOW() - INTERVAL '7 days'
--    GROUP BY user_id
--    ORDER BY week_tokens DESC NULLS LAST
--    LIMIT 10;
--
-- d) Attachment share — what percent of requests include an image /
--    document in the last 7 days:
--   SELECT
--     ROUND(100.0 * COUNT(*) FILTER (WHERE had_attachment) / NULLIF(COUNT(*), 0), 1)
--       AS attachment_pct,
--     COUNT(*) AS total_requests
--     FROM public.ai_usage_logs
--    WHERE created_at >= NOW() - INTERVAL '7 days';
-- ==========================================================================


-- ==========================================================================
-- RETENTION (run periodically — NOT part of this migration)
--
-- If the table grows faster than expected, prune rows older than 90
-- days. The aggregate analytics only need recent data; long-term
-- trends can be moved to a rollup table later.
--
--   DELETE FROM public.ai_usage_logs
--    WHERE created_at < NOW() - INTERVAL '90 days';
-- ==========================================================================
