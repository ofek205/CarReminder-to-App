-- ==========================================================================
-- vehicles — ownership history / "יד" support
--
-- Adds two columns sourced from data.gov.il's "היסטוריית כלי רכב פרטיים"
-- dataset (resource bb2355dc-...). The dataset returns one row per
-- ownership episode for a plate; the count of rows IS the vehicle's
-- current "hand" number (3 rows → יד שלישית).
--
--   • ownership_hand     — integer 1+ : the count of distinct ownership
--                          episodes the gov.il dataset reports.
--                          Rendered as "יד ראשונה / שנייה / שלישית /
--                          רביעית" in the UI; numbers ≥5 fall back to
--                          "יד 5".
--   • ownership_history  — jsonb array of {date, baalut} entries in
--                          chronological order. Powers the expandable
--                          "היסטוריית בעלויות" panel under the
--                          technical-spec section.
--
-- Both are nullable. A vehicle that hasn't been re-fetched from gov.il
-- since this column was added simply renders without the hand label —
-- editing the vehicle through AddVehicle's plate lookup populates them.
-- Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
-- ==========================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS ownership_hand     int,
  ADD COLUMN IF NOT EXISTS ownership_history  jsonb;

-- The CHECK keeps the value sensible — gov.il's dataset uses 1-based
-- counts, and a fleet vehicle with 50 owners is almost certainly a
-- data quality issue. Drop the bound by relaxing the check if real
-- data ever exceeds it.
ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_ownership_hand_range_chk;
ALTER TABLE public.vehicles
  ADD  CONSTRAINT vehicles_ownership_hand_range_chk
  CHECK (ownership_hand IS NULL OR (ownership_hand >= 1 AND ownership_hand <= 50));

notify pgrst, 'reload schema';
