-- ==========================================================================
-- vehicles — auto-stamp km_update_date / engine_hours_update_date on INSERT
--
-- 🐞 UX bug fix (2026-05-15):
-- When a user saves a vehicle from /VehicleCheck (or AddVehicle), the
-- gov.il lookup populates current_km but does not populate the
-- companion km_update_date column. The notification bell's "mileage"
-- rule (src/components/shared/ReminderEngine.js:328-351) then
-- interprets the NULL date as "no update has ever been recorded" and
-- fires the "עדכן קילומטראז'" reminder immediately — even though the
-- km was literally just fetched from a trusted source seconds before.
--
-- The JS fix would be to stamp the date inside buildVehicleInsertPayload
-- (vehicleQuickCheck.js) and the equivalent insert path in AddVehicle.
-- Doing it in Postgres instead means the bug stays fixed across every
-- client (web, Android, iOS) including users on older app versions —
-- no release required.
--
-- Behavior:
--   • BEFORE INSERT on vehicles
--   • If current_km IS NOT NULL and km_update_date IS NULL
--       → km_update_date := CURRENT_DATE
--   • Same logic mirrored for current_engine_hours /
--     engine_hours_update_date (vessels)
--   • Manual mileage updates (MileageUpdateWidget / driver_update_mileage
--     RPC) still set the date explicitly client-side, so this trigger
--     does NOT override their value.
--
-- The trigger does NOT fire on UPDATE — manual edits keep their existing
-- semantics. Only the gap between "vehicle just inserted with a km" and
-- "first km update event" is closed.
--
-- Backfill: existing rows that were inserted before this trigger existed
-- and have current_km but no km_update_date get CURRENT_DATE so the bell
-- quiets down for them too. After this runs, the 180-day re-prompt cycle
-- restarts cleanly for everyone — users who genuinely need to update
-- will see the reminder six months from now.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.vehicles_stamp_mileage_update_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_km IS NOT NULL AND NEW.km_update_date IS NULL THEN
    NEW.km_update_date := CURRENT_DATE;
  END IF;
  IF NEW.current_engine_hours IS NOT NULL AND NEW.engine_hours_update_date IS NULL THEN
    NEW.engine_hours_update_date := CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_stamp_mileage_update_date ON public.vehicles;

CREATE TRIGGER vehicles_stamp_mileage_update_date
  BEFORE INSERT ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.vehicles_stamp_mileage_update_date();

-- One-time backfill for existing rows that were inserted before this
-- trigger existed. Idempotent (only touches rows where the date is
-- still NULL).
UPDATE public.vehicles
   SET km_update_date = CURRENT_DATE
 WHERE current_km IS NOT NULL
   AND km_update_date IS NULL;

UPDATE public.vehicles
   SET engine_hours_update_date = CURRENT_DATE
 WHERE current_engine_hours IS NOT NULL
   AND engine_hours_update_date IS NULL;

NOTIFY pgrst, 'reload schema';
