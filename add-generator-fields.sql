-- ============================================================================
-- add-generator-fields.sql
-- Phase 1 of the "גנרטור" (generator) category feature.
--
-- Adds nullable generator-specific columns to public.vehicles. The generator
-- category reuses the existing vehicles table (consistent with how vessel /
-- aviation / CME type-specific fields are stored) rather than a separate
-- generator_details table, so ReminderEngine, the detail page, documents,
-- and maintenance logs all keep operating on a single vehicle row with no JOIN.
--
-- SAFETY: every column is NULLABLE with no default → ZERO impact on existing
-- rows of every other category (רכב / אופנוע / כלי שייט / צמ"ה / טיס …).
-- No RLS change needed: these columns live on public.vehicles, already guarded
-- by the per-account row-level security policies.
--
-- Work-hours tracking is NOT a new column. Generators reuse the existing
-- current_engine_hours / engine_hours_baseline / engine_hours_update_date.
--
-- Run on staging first, then production (staging + prod currently share one DB).
-- Idempotent: uses IF NOT EXISTS so re-running is safe.
-- ============================================================================

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS generator_type                text,
  ADD COLUMN IF NOT EXISTS generator_type_other          text,
  ADD COLUMN IF NOT EXISTS power_value                   numeric,
  ADD COLUMN IF NOT EXISTS power_unit                    text,    -- 'kVA' | 'kW'
  ADD COLUMN IF NOT EXISTS location                      text,
  ADD COLUMN IF NOT EXISTS serial_number                 text,
  ADD COLUMN IF NOT EXISTS has_hour_meter                boolean,
  ADD COLUMN IF NOT EXISTS work_hours_at_last_service    numeric,
  ADD COLUMN IF NOT EXISTS has_ats                       boolean,
  ADD COLUMN IF NOT EXISTS is_emergency_generator        boolean,
  ADD COLUMN IF NOT EXISTS connected_to_critical_systems boolean,
  ADD COLUMN IF NOT EXISTS critical_systems              jsonb,   -- array of strings
  ADD COLUMN IF NOT EXISTS requires_fire_dept_approval   text,    -- 'כן' | 'לא' | 'לא יודע'
  ADD COLUMN IF NOT EXISTS last_service_date             date,
  ADD COLUMN IF NOT EXISTS last_load_bank_test_date      date,
  ADD COLUMN IF NOT EXISTS last_safety_approval_date     date,
  ADD COLUMN IF NOT EXISTS technician_name               text,
  ADD COLUMN IF NOT EXISTS technician_phone              text;

COMMENT ON COLUMN public.vehicles.generator_type IS 'Generator subtype (ביתי קטן / נייד / קבוע / חירום / תעשייתי / רפואי-קריטי / אחר). Generator category only.';
COMMENT ON COLUMN public.vehicles.critical_systems IS 'JSON array of critical systems the generator backs (תאורת חירום, חדר שרתים, …). Generator category only.';
