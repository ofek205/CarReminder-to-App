-- ═══════════════════════════════════════════════════════════════════════════
-- "רכב מורד מהכביש" — persist removed-from-road status on vehicles — 2026-06-01
-- ═══════════════════════════════════════════════════════════════════════════
-- CONTEXT: vehicleLookup now also queries the two historical "ירדו מהכביש /
-- ביטול סופי" archives (2010-2016 = 4e6b9724, 2000-2009 = ec8cbc34) on top of
-- the current cancelled registry (851ecab1). A plate found there comes back
-- flagged _isInactive + _cancellationDate. Phase 1 (lookup + the check report
-- "מורד מהכביש" status) needs NO schema change.
--
-- THIS migration is Phase 2: it lets us PERSIST the status on a vehicle the
-- user adds, so the app can (a) show a "מורד מהכביש" badge on the saved
-- vehicle and (b) skip nagging for test/insurance the vehicle can't legally
-- have. Run ONCE in the Supabase SQL Editor BEFORE deploying the Phase 2 code
-- (the client write would otherwise fail on a missing column).
--
-- SAFETY: two nullable columns with a default — metadata-only, no table
-- rewrite, instant, fully backward-compatible. Existing rows get
-- is_road_removed = false. Re-runnable (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_road_removed  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS road_removed_date date;

COMMENT ON COLUMN public.vehicles.is_road_removed IS
  'Vehicle is in final-cancellation / off-road status per the Ministry of Transport (gov.il "ירדו מהכביש ובסטטוס ביטול סופי"). Set at add-time from the lookup _isInactive + _cancellationDate flags.';
COMMENT ON COLUMN public.vehicles.road_removed_date IS
  'The bitul_dt (final cancellation date) from the MoT registry, when known.';

-- ────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT column_name, data_type, column_default
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='vehicles'
--     AND column_name IN ('is_road_removed','road_removed_date');
-- ────────────────────────────────────────────────────────────────────
