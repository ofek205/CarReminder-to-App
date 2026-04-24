-- ==========================================================================
-- Fix C6 — repair_types schema gaps
--
-- Two problems:
--   1. MaintenanceTemplates.jsx was querying & inserting with `user_id`,
--      but the Base44-migration schema calls it `owner_user_id`. The
--      frontend fix is separate; this file only fixes the schema side.
--   2. MaintenanceTemplates has a `description` field in the UI (shown on
--      line 541, saved on line 855) that never made it into the schema,
--      so the insert fails with "Could not find the 'description' column".
--
-- Safe to re-run.
-- ==========================================================================

alter table public.repair_types
  add column if not exists description text;
