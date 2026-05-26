-- ==========================================================================
-- app_config — new feature flags for AI attachments + usage tracking
--
-- Added 2026-05-26. Lets us roll out the "upload an image / document to
-- the AI consultation chat" feature gradually:
--   • admins see the upload UI immediately (for QA)
--   • regular users see it only when the flag below is flipped to true
--
-- The client-side gating is in src/lib/featureFlags.js. It reads these
-- rows the same way aiScanGate.js reads scan_extraction_enabled.
--
-- ADMIN BYPASS: admins (users for whom public.is_admin() returns true)
-- ALWAYS pass the gate, regardless of the flag value. The flags below
-- only affect regular users. This is intentional — it lets the team
-- test a feature in production without exposing it to anyone else.
-- If you need to hide a feature from admins too, do it in code (e.g.,
-- a separate "feature_killed" flag that takes precedence) rather than
-- by removing admin permissions.
--
-- Behaviour of the seeded values:
--   • chat_attachments_enabled = false
--       → no regular user sees the upload button in AiAssistant.jsx
--       → admins still see it (the helper bypasses the flag for them)
--   • ai_usage_tracking_enabled = true
--       → every successful ai-proxy call writes one row to
--         public.ai_usage_logs so we can see who's using the feature
--         and how many tokens it costs
--       → set to false to pause logging (useful if the table fills up
--         faster than expected or if we need to take it offline for
--         maintenance — the proxy keeps working, just stops recording)
--
-- Both rows are upsert-safe: re-running this script does not overwrite
-- a manual flip an admin has already made.
-- ==========================================================================

-- 1. New flag: gates the "upload attachment in chat" UI for non-admins.
--    Seeded as FALSE so the feature is invisible to users on deploy day.
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('chat_attachments_enabled', 'false'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- 2. New flag: master switch for the ai_usage_logs writer. Seeded as
--    TRUE so we start collecting data the moment the deploy goes live.
--    Flip to false only if logging itself is causing problems.
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('ai_usage_tracking_enabled', 'true'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- 3. PostgREST schema cache reload so the client picks up the new rows
--    on its next /rest/v1/app_config query without a 10-minute wait.
NOTIFY pgrst, 'reload schema';


-- ==========================================================================
-- ADMIN TOGGLES
--
-- ENABLE chat attachments for all users (do this AFTER QA is happy):
--
--   UPDATE public.app_config
--      SET value = 'true'::jsonb, updated_at = NOW()
--    WHERE key = 'chat_attachments_enabled';
--
-- DISABLE chat attachments (rollback):
--
--   UPDATE public.app_config
--      SET value = 'false'::jsonb, updated_at = NOW()
--    WHERE key = 'chat_attachments_enabled';
--
-- PAUSE usage logging (rare — only if the logs table is causing issues):
--
--   UPDATE public.app_config
--      SET value = 'false'::jsonb, updated_at = NOW()
--    WHERE key = 'ai_usage_tracking_enabled';
--
-- VERIFY current state:
--
--   SELECT key, value, updated_at
--     FROM public.app_config
--    WHERE key IN (
--      'chat_attachments_enabled',
--      'ai_usage_tracking_enabled',
--      'scan_extraction_enabled'
--    )
--    ORDER BY key;
-- ==========================================================================
