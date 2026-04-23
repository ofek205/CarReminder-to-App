-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: add service_size (small/big) to maintenance templates, and
-- tires_changed_count to vehicles.
--
-- Why:
--   1. The Maintenance Templates page treats every template uniformly, but
--      real-world service schedules distinguish between "טיפול קטן" (small,
--      ~every 10k km) and "טיפול גדול" (big, ~every 30k km). The log table
--      already stores this distinction (maintenance_logs.type); the template
--      layer was missing it, so users couldn't pre-classify a template they
--      create.
--
--   2. Vehicles stored "tires changed on date X at mileage Y" but not HOW
--      MANY tires were changed. Many replacements are 2-of-4 (front or rear
--      axle only), so treating every entry as "all 4 new" misrepresents
--      wear on the untouched tires.
--
-- Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE maintenance_reminder_prefs
  ADD COLUMN IF NOT EXISTS service_size text
  CHECK (service_size IS NULL OR service_size IN ('small', 'big'));

COMMENT ON COLUMN maintenance_reminder_prefs.service_size IS
  'Optional classification: small | big. Null = unclassified / applies to both.';

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS tires_changed_count smallint
  CHECK (tires_changed_count IS NULL OR (tires_changed_count >= 1 AND tires_changed_count <= 4));

COMMENT ON COLUMN vehicles.tires_changed_count IS
  'How many tires were replaced in last_tire_change_date event. 1-4. Null = unknown / legacy rows.';
