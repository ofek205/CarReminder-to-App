-- maintenance_logs — next-service reminder columns
-- ============================================================
-- Feature: when a user logs a small/large service, they can opt-in
-- to a "next service" reminder. The system computes the next due
-- point from the standard interval (recommended by the app) OR a
-- manual interval the user enters, applied to either the last
-- service km/date or the vehicle's current km/date.
--
-- Three new columns:
--   next_reminder_kind   — 'time' | 'km' | NULL  (NULL = no reminder)
--   next_reminder_at     — timestamptz, when the reminder is due
--                          (for kind='time') or the projected service
--                          date (for kind='km'). Set even for km-based
--                          reminders so the bell + LocalNotification
--                          can fire on a date.
--   next_reminder_km     — integer, target absolute km
--                          (for kind='km'). NULL for time-based.
--
-- Safe migration:
--   • All columns nullable, default NULL — existing rows unchanged.
--   • Idempotent via IF NOT EXISTS.
--   • No RLS / constraint changes.
--
-- Run order: this SQL must land BEFORE the frontend code that
-- writes these columns. The frontend reads via React Query so a
-- missing column path is handled gracefully (just no reminder).
-- ============================================================

ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS next_reminder_kind  text,
  ADD COLUMN IF NOT EXISTS next_reminder_at    timestamptz,
  ADD COLUMN IF NOT EXISTS next_reminder_km    integer;

-- Sanity check.
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'maintenance_logs'
      AND column_name IN ('next_reminder_kind','next_reminder_at','next_reminder_km');
  RAISE NOTICE 'maintenance_logs next-reminder columns present: % of 3', cnt;
END $$;
