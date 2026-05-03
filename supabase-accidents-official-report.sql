-- ==========================================================================
-- Accidents — fields needed for an insurance / police-grade PDF report.
--
-- Adds the columns the AddAccident form started writing in the official-
-- report layout pass:
--   * time of accident (HH:MM, separate from date)
--   * damage description for the user's own vehicle
--   * injury reporting (toggle + free-text details)
--   * police report number + station (when reported)
--   * witnesses (jsonb array of {name, phone, statement}, max 3 in UI)
--   * GPS coordinates (captured silently by the "use current location"
--     button so the exported PDF carries an unambiguous incident
--     location alongside the human-readable address)
--
-- Idempotent: safe to re-run. Run in Supabase SQL Editor against staging
-- AND production — both share the same DB cluster as of the staging
-- DB-split planning notes in CLAUDE.md.
-- ==========================================================================

alter table public.accidents
  add column if not exists time                      text,
  add column if not exists damage_description        text,
  add column if not exists injured                   boolean not null default false,
  add column if not exists injuries_details          text,
  add column if not exists police_report_number      text,
  add column if not exists police_station            text,
  add column if not exists witnesses                 jsonb   not null default '[]'::jsonb,
  add column if not exists latitude                  double precision,
  add column if not exists longitude                 double precision;

-- Reload PostgREST schema cache so the new columns are immediately
-- visible to the supabase-js client without a server restart.
notify pgrst, 'reload schema';
