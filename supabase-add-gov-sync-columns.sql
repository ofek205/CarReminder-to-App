-- =========================================================================
-- 2026-05-17 — gov.il auto-sync infrastructure (Phase 1, schema only)
--
-- Adds five columns to `vehicles` that let the Edge Function reconcile
-- between the user's manual updates and the Israeli Ministry of Transport
-- (משרד התחבורה) snapshots. The Edge Function itself ships in a
-- follow-up PR; this migration is intentionally schema-only so it can
-- land independently without any code that consumes it.
--
-- Why each column:
--   last_gov_sync_at          — timestamp of the last successful API call
--                                (NULL = never synced). Used by the
--                                Edge to find candidates and to throttle.
--   last_gov_sync_km          — km value returned by gov.il in that sync.
--                                Decoupled from current_km so we can tell
--                                if the user has since overridden it.
--   last_gov_sync_test_date   — last-test date returned by gov.il in that
--                                sync. Drives the "was this a NEW test"
--                                check that triggers user notifications.
--   last_manual_km_update_at  — set by the frontend every time the user
--                                writes to current_km via the UI. The
--                                Edge skips auto-update of current_km
--                                when this timestamp is later than
--                                last_gov_sync_test_date.
--   auto_sync_enabled         — per-vehicle on/off toggle. Default TRUE
--                                so existing vehicles opt in automatically;
--                                the toggle in EditVehicle lets a user
--                                disable it on a per-vehicle basis.
--
-- All columns are nullable except auto_sync_enabled which defaults to
-- TRUE. No backfill is needed — the Edge writes the sync columns on its
-- first run per vehicle, and last_manual_km_update_at is populated
-- naturally once the user edits a vehicle after this release.
-- =========================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS last_gov_sync_at          timestamptz,
  ADD COLUMN IF NOT EXISTS last_gov_sync_km          integer,
  ADD COLUMN IF NOT EXISTS last_gov_sync_test_date   date,
  ADD COLUMN IF NOT EXISTS last_manual_km_update_at  timestamptz,
  ADD COLUMN IF NOT EXISTS auto_sync_enabled         boolean NOT NULL DEFAULT true;

-- Index used by the Edge Function to pick the next batch of sync
-- candidates. Filters down to vehicles that:
--   (a) have auto-sync enabled,
--   (b) have a license_plate to look up against gov.il, and
--   (c) are ordered by oldest-synced-first (NULLS FIRST so brand-new
--       vehicles get picked up on their first eligible run).
CREATE INDEX IF NOT EXISTS idx_vehicles_gov_sync_candidates
  ON public.vehicles (last_gov_sync_at NULLS FIRST)
  WHERE auto_sync_enabled = true
    AND license_plate IS NOT NULL;

-- RLS notes:
-- The existing UPDATE policy on `vehicles` is owner-scoped via
-- `account_id = current_user_account_id()` (or equivalent depending on
-- the project's policy text). The new columns inherit that policy
-- without any change because they're columns on the same row, and the
-- policy is row-level not column-level. The user can read all five new
-- columns the same way they read every other vehicle field.
--
-- For writes: the Edge Function runs with the service role, so it
-- bypasses RLS entirely. The user-side `EditVehicle` save path writes
-- `last_manual_km_update_at` and `auto_sync_enabled` through the same
-- normal-user RLS path that already permits updating their own row.
-- No additional policy needed.

COMMENT ON COLUMN public.vehicles.last_gov_sync_at IS
  'Timestamp of the most recent successful gov.il API sync for this vehicle. NULL = never synced. Updated by the gov-sync-vehicles Edge Function only.';
COMMENT ON COLUMN public.vehicles.last_gov_sync_km IS
  'km value returned by gov.il on the last sync. Used to detect changes between runs; not authoritative — current_km is.';
COMMENT ON COLUMN public.vehicles.last_gov_sync_test_date IS
  'last_test_date value returned by gov.il on the last sync. Drives the "user passed a new test" detection logic.';
COMMENT ON COLUMN public.vehicles.last_manual_km_update_at IS
  'Timestamp of the most recent manual update to current_km from any user-facing flow (EditVehicle, MaintenanceSection, AddRepairDialog). The Edge Function refuses to overwrite current_km when this is later than the gov-side test date.';
COMMENT ON COLUMN public.vehicles.auto_sync_enabled IS
  'Per-vehicle toggle. TRUE = the daily Edge picks this vehicle up. FALSE = the Edge skips it entirely. User-facing toggle lives in EditVehicle.';
