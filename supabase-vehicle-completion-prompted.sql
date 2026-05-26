-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-vehicle-completion-prompted.sql
--
-- Adds `completion_prompted_at` to public.vehicles. Set ONCE — the first
-- time we showed the user the post-save "completion sheet" for that
-- specific vehicle, regardless of whether they filled or skipped. This
-- way the prompt never re-appears for the same row.
--
-- Why a DB column and not localStorage:
--   • Survives device switch (user opens the app on a new phone)
--   • Survives cache clear / PWA reinstall
--   • Per-vehicle, so the user can complete-prompt for each new vehicle
--     they add — only suppresses re-prompt on the SAME vehicle
--
-- The column is NOT a "did the user complete?" flag — it only records
-- that the prompt was SHOWN. A user who skipped but later edits the
-- vehicle manually still completes the profile via /EditVehicle.
--
-- Re-runnable. Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS completion_prompted_at timestamptz;

COMMENT ON COLUMN public.vehicles.completion_prompted_at IS
'Timestamp the post-save completion bottom-sheet was shown for this vehicle. NULL = never shown. NOT NULL = shown at least once, never re-prompt for the same row. See src/components/vehicle/VehicleCompletionSheet.jsx.';

-- Optional index — only relevant if we ever query "vehicles that were
-- prompted but never had their photo filled". Skipping for now; can add
-- later if a "completion rate" admin dashboard is built.

-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'vehicles'
--      AND column_name = 'completion_prompted_at';
--   -- Expect one row: completion_prompted_at | timestamp with time zone
-- ═══════════════════════════════════════════════════════════════════════════
