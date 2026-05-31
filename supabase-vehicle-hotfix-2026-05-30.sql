-- ═══════════════════════════════════════════════════════════════════════════
-- Vehicle hotfix — 2026-05-30
--
-- Two production bugs surfaced via the Telegram admin alert pipeline:
--
--   1. "שמירת הרכב נכשלה" (5 users in 15 min): PostgREST 404 on
--      VehicleCheck save because three columns are referenced by code
--      but were never declared on public.vehicles:
--        • is_personal_import         (boolean) — set by vehicleLookup
--          when gov.il flags a "יבוא אישי" plate
--        • personal_import_type       (text)
--        • inspection_report_expiry_date (date) — referenced by the
--          first_reminder_armed_at trigger function (silently no-op
--          today because the column doesn't exist; will start working
--          once added)
--
--      The supabase-vehicle-quickcheck-cols-full.sql migration mentioned
--      these three in its header comment but the actual ALTER TABLE
--      block forgot to include them. This migration closes that gap.
--
--   2. "queries איטיים: 72 vehicles.filter > 3s in 15 min": no index
--      exists on public.vehicles(account_id), so every list-page query
--      (Dashboard, Reports, BusinessDashboard, MyExpenses, Documents,
--      …) sequential-scans the whole table. With multiple users × many
--      vehicles per account, this regularly crosses the 3-second
--      slow-query threshold instrumented in src/lib/supabaseQuery.js.
--
--      Adding a B-tree index on account_id collapses the scan from O(N)
--      to O(log N + matches) — for a 5000-row table with 50 vehicles
--      per account, that's ~100× faster.
--
-- All changes are idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────────
-- FIX 1: missing columns referenced by vehicleQuickCheck.js DB_COLUMNS
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS is_personal_import        boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS personal_import_type      text,
  ADD COLUMN IF NOT EXISTS inspection_report_expiry_date date;

COMMENT ON COLUMN public.vehicles.is_personal_import IS
'TRUE when gov.il flags the vehicle as "יבוא אישי" (personal import).
Surfaced in VehicleCheck → vehicleLookup → buildVehicleInsertPayload.';

COMMENT ON COLUMN public.vehicles.personal_import_type IS
'Subtype of personal import when applicable — free text from gov.il.';

COMMENT ON COLUMN public.vehicles.inspection_report_expiry_date IS
'Periodic safety inspection ("תסקיר") expiry date. Optional everywhere;
fires reminders alongside test reminders when populated. Already referenced
by trg_vehicles_first_reminder_armed_at trigger.';


-- ────────────────────────────────────────────────────────────────────
-- FIX 2: index on account_id (root cause of vehicles.filter slow alerts)
-- ────────────────────────────────────────────────────────────────────
-- Plain B-tree on account_id — every list-page filter uses this. We
-- could go composite (account_id, license_plate_normalized) for the
-- duplicate-check path too, but the single-column index already covers
-- both the equality filter AND the secondary in-memory plate scan that
-- AddVehicle/EditVehicle do client-side after the fetch.
CREATE INDEX IF NOT EXISTS idx_vehicles_account_id
  ON public.vehicles (account_id);

-- Composite index for the dup-check pattern in EditVehicle/AddVehicle:
-- "find rows in this account where license_plate_normalized matches".
-- With the column-pair index, both filters are satisfied at once.
CREATE INDEX IF NOT EXISTS idx_vehicles_account_plate_norm
  ON public.vehicles (account_id, license_plate_normalized)
  WHERE license_plate_normalized IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────
-- Tell PostgREST to reload its schema cache so the new columns are
-- recognized immediately without waiting for a deploy.
-- ────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════
-- Verification (paste into SQL Editor after running the above):
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  cols_added int;
  idx_account_id_exists boolean;
  idx_composite_exists boolean;
BEGIN
  -- Verify the 3 columns now exist
  SELECT COUNT(*) INTO cols_added
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='vehicles'
    AND column_name IN ('is_personal_import', 'personal_import_type', 'inspection_report_expiry_date');

  -- Verify the indexes exist
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='vehicles' AND indexname='idx_vehicles_account_id'
  ) INTO idx_account_id_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='vehicles' AND indexname='idx_vehicles_account_plate_norm'
  ) INTO idx_composite_exists;

  RAISE NOTICE 'vehicles missing columns added: % / 3', cols_added;
  RAISE NOTICE 'idx_vehicles_account_id exists: %', idx_account_id_exists;
  RAISE NOTICE 'idx_vehicles_account_plate_norm exists: %', idx_composite_exists;
END $$;
