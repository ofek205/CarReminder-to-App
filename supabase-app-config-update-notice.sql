-- ==========================================================================
-- app_config — `android_latest_version` + `ios_latest_version` flags
--
-- Added 2026-05-15 alongside v4.5.0. Drives the soft "update available"
-- banner (`src/components/shared/UpdateAvailableBanner.jsx` +
-- `src/hooks/useUpdateAvailable.js`). Sister to the existing hard-block
-- gate (`android_min_version` / `ios_min_version` + `AppUpdateGate`):
--
--   *_min_version    → if installed < min     → full-screen block
--   *_latest_version → if installed < latest  → non-blocking bottom strip
--
-- Workflow once a release is shipped to the stores:
--
--   1. v4.5.0 binary uploaded + approved by Google Play / Apple Review.
--   2. Public production rollout enabled (so users can actually update).
--   3. Run the UPDATE statements below to set BOTH platform versions
--      to "4.5.0". The banner fires for everyone on 4.4.x and earlier.
--   4. After ~95% adoption, repeat for the next release.
--
-- Behaviour rules baked into the client:
--   • Web users never see the banner (auto-update via service worker).
--   • Older clients (v4.4.x and earlier) don't have the banner code
--     yet, so they ignore the flag. Their natural path is the hard-
--     block gate or organic store updates.
--   • If installed >= latest (steady state) — silent.
--   • If installed >  latest (admin set the value too low or the user
--     side-loaded a newer build) — silent. Never tells a user to
--     downgrade.
--   • Flag fetch failure with no cache — silent. The flag is a soft
--     signal; an outage on Supabase must not produce a false alarm.
--   • Snooze: tapping "אחר כך" or "עדכן עכשיו" sets
--     localStorage.update_banner_snoozed_until = NOW + 3 days. The
--     banner stays hidden until that timestamp.
-- ==========================================================================

-- 1. Seed BOTH rows as NULL (jsonb null, not missing). NULL → "no
--    latest declared yet, banner stays silent". This is the safe
--    default: ship the code today, set the actual version strings
--    only after the corresponding builds are live in their stores.
INSERT INTO public.app_config (key, value, updated_at)
VALUES
  ('android_latest_version', 'null'::jsonb, NOW()),
  ('ios_latest_version',     'null'::jsonb, NOW())
ON CONFLICT (key) DO NOTHING;

-- 2. PostgREST schema cache reload so the client picks up the new rows
--    on its next /rest/v1/app_config query without a 10-minute wait.
NOTIFY pgrst, 'reload schema';


-- ==========================================================================
-- ADMIN TOGGLES — run these when a new release is APPROVED + LIVE
--
-- Set BOTH platforms to "4.5.0" after the Play Store + App Store both
-- show v4.5.0 as the current production version. Banner will appear
-- on the next session for any user on 4.4.x or earlier:
--
--   UPDATE public.app_config
--      SET value = '"4.5.0"'::jsonb, updated_at = NOW()
--    WHERE key IN ('android_latest_version', 'ios_latest_version');
--
-- Per-platform update (e.g., Google Play approves before Apple — set
-- only Android, leave iOS at its current value):
--
--   UPDATE public.app_config
--      SET value = '"4.5.0"'::jsonb, updated_at = NOW()
--    WHERE key = 'android_latest_version';
--
-- Verify the current state:
--
--   SELECT key, value, updated_at
--     FROM public.app_config
--    WHERE key IN ('android_latest_version', 'ios_latest_version',
--                  'android_min_version',    'ios_min_version');
--
-- Pull the banner BACK (e.g., emergency rollback — current production
-- got pulled and you want users to stop being told to update):
--
--   UPDATE public.app_config
--      SET value = 'null'::jsonb, updated_at = NOW()
--    WHERE key IN ('android_latest_version', 'ios_latest_version');
-- ==========================================================================
