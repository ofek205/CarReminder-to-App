-- ==========================================================================
-- app_config — `scan_extraction_enabled` flag for the AI scan gate
--
-- Added 2026-05-15 alongside v4.5.0. Lets us turn the AI document-scan
-- feature OFF for everyone with a single SQL update, without shipping
-- a new app release. The client (src/lib/aiScanGate.js) reads the flag
-- from public.app_config and refuses scan_extraction calls when it's
-- false — surfaces fall back to manual entry, which every scan flow
-- already supports.
--
-- Behavior of the seeded value:
--   • 'true'  → AI scans run normally (current production behaviour
--                preserved for users on v4.5.0+ until this row exists)
--   • 'false' → all 6 scan surfaces (license book, driver license,
--                receipt × 2, document, vessel license) show the
--                "סריקת AI אינה זמינה כרגע" dialog and the user
--                completes the form manually.
--
-- This script seeds the row as 'true' so existing behaviour is
-- unchanged on first deploy. Flip it to 'false' via the UPDATE
-- statement below (run as a separate query when AI capacity needs
-- to be cut).
--
-- The client caches the flag for 60 seconds, so a flip takes effect
-- within a minute for already-loaded sessions; fresh page loads see
-- the new value immediately.
-- ==========================================================================

-- 1. Seed the flag as ENABLED so the v4.5.0 deploy doesn't accidentally
--    kill scans for users who happen to be in the middle of one. The
--    actual disable is a separate, conscious admin action below.
INSERT INTO public.app_config (key, value, updated_at)
VALUES ('scan_extraction_enabled', 'true'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- 2. PostgREST schema cache reload so the client picks up the new row
--    on its next /rest/v1/app_config query without a 10-minute wait.
NOTIFY pgrst, 'reload schema';


-- ==========================================================================
-- ADMIN TOGGLES
--
-- DISABLE the AI scan feature (run this query when the provider is
-- unhealthy or quota is exhausted). Takes effect within 60 seconds
-- for active sessions; immediate for fresh page loads.
--
--   UPDATE public.app_config
--      SET value = 'false'::jsonb, updated_at = NOW()
--    WHERE key = 'scan_extraction_enabled';
--
-- RE-ENABLE the AI scan feature (run this when AI is healthy again).
--
--   UPDATE public.app_config
--      SET value = 'true'::jsonb, updated_at = NOW()
--    WHERE key = 'scan_extraction_enabled';
--
-- VERIFY the current state:
--
--   SELECT key, value, updated_at
--     FROM public.app_config
--    WHERE key = 'scan_extraction_enabled';
-- ==========================================================================
