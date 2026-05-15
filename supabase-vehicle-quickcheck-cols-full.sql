-- ==========================================================================
-- vehicles — comprehensive backfill of all quick-check / spec columns
--
-- 🐞 Production bug fix (2026-05-15):
-- Users on /VehicleCheck who clicked "הוסף לרכבים שלי" saw a generic
-- "שמירת הרכב נכשלה. נסה שוב." toast. Root cause discovery iterated
-- through three PostgREST errors:
--
--   1. PGRST204 "Could not find the 'XXX' column of 'vehicles' in the
--      schema cache" — three new columns (is_personal_import,
--      personal_import_type, inspection_report_expiry_date) referenced
--      by code but never declared on the table.
--   2. Same error for 'abs', then 'ac' — cross-referencing
--      src/services/vehicleQuickCheck.js → DB_COLUMNS against every
--      existing *.sql migration revealed that
--      eu_class, fuel_type_spec, engine_number, empty_weight,
--      payload_capacity, has_tow_hitch, engine_model are also missing.
--      'abs' and 'ac' are declared in staging-init-consolidated.sql but
--      that bootstrap was never replayed against the Base44-migrated
--      production database.
--   3. 22P02 "invalid input syntax for type boolean: \"כן\"" — the
--      initial fix declared abs/ac/has_tow_hitch as boolean defaulting
--      to false, but gov.il returns the raw Hebrew strings "כן"/"לא".
--      Switched to TEXT to match the existing pattern for airbags,
--      pollution_group, and other gov.il-sourced spec columns.
--
-- This consolidated file is what would have shipped if all three rounds
-- had been done up-front. Idempotent and re-runnable.
--
-- Rather than play whack-a-mole one column at a time as Postgres
-- complains, this script declares EVERY column referenced by
-- vehicleQuickCheck.js → DB_COLUMNS using ADD COLUMN IF NOT EXISTS. Any
-- column that already exists is a no-op; the missing ones get created.
-- Idempotent — safe to re-run on any environment.
--
-- Data type choices:
--   • Spec columns (horsepower, engine_cc, weights, etc.) are TEXT to
--     match the existing pattern in supabase-add-spec-columns.sql —
--     gov.il sometimes returns formatted strings like "100 hp" that we
--     do not want to lose by coercing to integer.
--   • Date columns are DATE.
--   • Boolean columns default FALSE so old rows are unaffected.
--   • JSON arrays (ownership_history, fire_extinguishers) are JSONB.
-- ==========================================================================

ALTER TABLE public.vehicles
  -- Spec columns from data.gov.il "מפרט-טכני" / "תכונות-רכב" datasets.
  -- abs/ac/has_tow_hitch are TEXT, not boolean — gov.il returns the
  -- raw Hebrew strings "כן"/"לא" and we store them as-is rather than
  -- coercing client-side (matches the existing pattern for airbags,
  -- pollution_group, etc. in supabase-add-spec-columns.sql).
  ADD COLUMN IF NOT EXISTS abs                            text,
  ADD COLUMN IF NOT EXISTS ac                             text,
  ADD COLUMN IF NOT EXISTS eu_class                       text,
  ADD COLUMN IF NOT EXISTS fuel_type_spec                 text,
  ADD COLUMN IF NOT EXISTS engine_number                  text,
  ADD COLUMN IF NOT EXISTS engine_model                   text,
  ADD COLUMN IF NOT EXISTS empty_weight                   text,
  ADD COLUMN IF NOT EXISTS payload_capacity               text,
  ADD COLUMN IF NOT EXISTS has_tow_hitch                  text,

  -- the remaining DB_COLUMNS members — IF NOT EXISTS makes the
  -- already-present ones no-ops. Listed explicitly so the diff against
  -- the JS whitelist is reviewable.
  ADD COLUMN IF NOT EXISTS vehicle_type                   text,
  ADD COLUMN IF NOT EXISTS manufacturer                   text,
  ADD COLUMN IF NOT EXISTS model                          text,
  ADD COLUMN IF NOT EXISTS year                           integer,
  ADD COLUMN IF NOT EXISTS nickname                       text,
  ADD COLUMN IF NOT EXISTS license_plate                  text,
  ADD COLUMN IF NOT EXISTS test_due_date                  date,
  ADD COLUMN IF NOT EXISTS insurance_due_date             date,
  ADD COLUMN IF NOT EXISTS insurance_company              text,
  ADD COLUMN IF NOT EXISTS current_km                     numeric,
  ADD COLUMN IF NOT EXISTS current_engine_hours           numeric,
  ADD COLUMN IF NOT EXISTS vehicle_photo                  text,
  ADD COLUMN IF NOT EXISTS fuel_type                      text,
  ADD COLUMN IF NOT EXISTS is_vintage                     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_tire_change_date          date,
  ADD COLUMN IF NOT EXISTS km_since_tire_change           numeric,
  ADD COLUMN IF NOT EXISTS tires_changed_count            integer,
  ADD COLUMN IF NOT EXISTS flag_country                   text,
  ADD COLUMN IF NOT EXISTS marina                         text,
  ADD COLUMN IF NOT EXISTS marina_abroad                  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS engine_manufacturer            text,
  ADD COLUMN IF NOT EXISTS pyrotechnics_expiry_date       date,
  ADD COLUMN IF NOT EXISTS fire_extinguisher_expiry_date  date,
  ADD COLUMN IF NOT EXISTS fire_extinguishers             jsonb,
  ADD COLUMN IF NOT EXISTS life_raft_expiry_date          date,
  ADD COLUMN IF NOT EXISTS last_shipyard_date             date,
  ADD COLUMN IF NOT EXISTS hours_since_shipyard           numeric,
  ADD COLUMN IF NOT EXISTS front_tire                     text,
  ADD COLUMN IF NOT EXISTS rear_tire                      text,
  ADD COLUMN IF NOT EXISTS color                          text,
  ADD COLUMN IF NOT EXISTS last_test_date                 date,
  ADD COLUMN IF NOT EXISTS first_registration_date        date,
  ADD COLUMN IF NOT EXISTS ownership                      text,
  ADD COLUMN IF NOT EXISTS model_code                     text,
  ADD COLUMN IF NOT EXISTS trim_level                     text,
  ADD COLUMN IF NOT EXISTS vin                            text,
  ADD COLUMN IF NOT EXISTS pollution_group                text,
  ADD COLUMN IF NOT EXISTS vehicle_class                  text,
  ADD COLUMN IF NOT EXISTS safety_rating                  text,
  ADD COLUMN IF NOT EXISTS horsepower                     text,
  ADD COLUMN IF NOT EXISTS engine_cc                      text,
  ADD COLUMN IF NOT EXISTS drivetrain                     text,
  ADD COLUMN IF NOT EXISTS total_weight                   text,
  ADD COLUMN IF NOT EXISTS doors                          text,
  ADD COLUMN IF NOT EXISTS seats                          text,
  ADD COLUMN IF NOT EXISTS airbags                        text,
  ADD COLUMN IF NOT EXISTS transmission                   text,
  ADD COLUMN IF NOT EXISTS body_type                      text,
  ADD COLUMN IF NOT EXISTS country_of_origin              text,
  ADD COLUMN IF NOT EXISTS co2                            text,
  ADD COLUMN IF NOT EXISTS green_index                    text,
  ADD COLUMN IF NOT EXISTS tow_capacity                   text,
  ADD COLUMN IF NOT EXISTS offroad_equipment              text,
  ADD COLUMN IF NOT EXISTS offroad_usage_type             text,
  ADD COLUMN IF NOT EXISTS last_offroad_service_date      date;

NOTIFY pgrst, 'reload schema';
