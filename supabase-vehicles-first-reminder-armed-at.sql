-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 0 of analytics overhaul — add first_reminder_armed_at to vehicles.
--
-- WHY: the activation funnel (signup → vehicle → doc → reminder → return)
-- has no reliable "first reminder set" timestamp today. Reminders are
-- implicit in vehicles.<X>_due_date columns; there is no event log.
-- Computing the funnel by joining MIN(<X>_due_date) per vehicle is
-- expensive and fragile (a user editing a date AFTER setting it would
-- shift the timestamp into the future).
--
-- This migration adds a dedicated `first_reminder_armed_at timestamptz`
-- column that captures the *first time* any of the four reminder date
-- columns transitioned from NULL to non-NULL. Once set, it never
-- changes — it's the activation signal.
--
-- Plan:
--   1. ADD COLUMN (nullable, no default).
--   2. CREATE TRIGGER that fires on INSERT/UPDATE and stamps the column
--      with NOW() the first time any reminder date becomes non-NULL.
--   3. BACKFILL existing rows: for vehicles that already have at least
--      one non-NULL reminder date, we cannot know the exact arming
--      moment retroactively — best proxy is `created_at`. For vehicles
--      with all four dates NULL, leave first_reminder_armed_at NULL
--      (= "user never set a reminder, just registered the vehicle").
--
-- Re-runnable via IF NOT EXISTS / OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Column
ALTER TABLE public.vehicles
ADD COLUMN IF NOT EXISTS first_reminder_armed_at timestamptz;

COMMENT ON COLUMN public.vehicles.first_reminder_armed_at IS
'When this vehicle first had ANY reminder date populated (test/insurance/license/inspection). Set automatically by trigger; never modified after first set. Used by the activation funnel in admin analytics.';


-- 2. Trigger function
CREATE OR REPLACE FUNCTION public.fn_stamp_first_reminder_armed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip if already stamped — this is a one-time event per vehicle.
  IF NEW.first_reminder_armed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Stamp when ANY of the three reminder-bearing date columns is non-NULL.
  -- Source of truth: supabase-email-dispatcher.sql dispatches off
  -- test_due_date + insurance_due_date. inspection_report_expiry_date
  -- is shown in the UI as a reminder-like field even though the cron
  -- doesn't pull it yet (planned). If new columns join the family,
  -- add them here AND in the trigger's UPDATE OF list below.
  IF NEW.test_due_date IS NOT NULL
     OR NEW.insurance_due_date IS NOT NULL
     OR NEW.inspection_report_expiry_date IS NOT NULL
  THEN
    NEW.first_reminder_armed_at := now();
  END IF;

  RETURN NEW;
END;
$$;


-- 3. Trigger wiring (BEFORE so the column lands in the row being written)
DROP TRIGGER IF EXISTS trg_vehicles_first_reminder_armed_at ON public.vehicles;
CREATE TRIGGER trg_vehicles_first_reminder_armed_at
BEFORE INSERT OR UPDATE OF
  test_due_date,
  insurance_due_date,
  inspection_report_expiry_date
ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.fn_stamp_first_reminder_armed_at();


-- 4. One-shot backfill — use created_at as the proxy for existing rows.
-- WHERE clause skips rows already stamped (re-runnable safely).
UPDATE public.vehicles
SET first_reminder_armed_at = created_at
WHERE first_reminder_armed_at IS NULL
  AND (
    test_due_date IS NOT NULL
    OR insurance_due_date IS NOT NULL
    OR inspection_report_expiry_date IS NOT NULL
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS — copy into SQL Editor after running the above:
--
-- 1. Verify backfill numbers are sensible (most vehicles should be stamped):
--      SELECT
--        COUNT(*)                                              AS total_vehicles,
--        COUNT(*) FILTER (WHERE first_reminder_armed_at IS NOT NULL) AS armed,
--        COUNT(*) FILTER (WHERE first_reminder_armed_at IS NULL)     AS not_armed
--      FROM public.vehicles;
--
-- 2. Verify trigger fires on update (manual test, expect a NEW timestamp):
--      -- pick a vehicle where first_reminder_armed_at IS NULL AND test_due_date IS NULL
--      UPDATE public.vehicles
--      SET test_due_date = current_date + interval '90 days'
--      WHERE id = '<some_id>'
--      RETURNING id, first_reminder_armed_at;
--
-- 3. Verify trigger does NOT overwrite on subsequent updates:
--      UPDATE public.vehicles
--      SET test_due_date = current_date + interval '180 days'  -- change date
--      WHERE id = '<same_id>'
--      RETURNING id, first_reminder_armed_at;  -- timestamp unchanged
-- ═══════════════════════════════════════════════════════════════════════════
