-- ============================================================================
-- Phase 10 — Extend route_stops for multi-stop tasks with coordinates & meta.
--
-- Context: the project's "business task" entity is `routes`, and individual
-- stops within a task live in `route_stops` (introduced in phase 6). The
-- product asked for a `business_task_stops` table, but the existing
-- `route_stops` is a one-for-one match (route_id ↔ task_id, account_id ↔
-- workspace_id, sequence ↔ stop_order). Per the migration plan we EXTEND
-- the existing table rather than create a parallel one — this preserves
-- every existing task, RPC, RLS policy, and UI query.
--
-- This migration is ADDITIVE only:
--   • All new columns are nullable (or have safe defaults).
--   • Existing rows are preserved untouched.
--   • Existing `create_route_with_stops`, `update_stop_status`, and
--     `add_stop_documentation` RPCs continue to work unchanged.
--   • UI components selecting from route_stops are unaffected: added columns
--     are picked up automatically by `select *`; explicit-column queries are
--     unchanged.
--
-- Status enum:
--   Existing values in production : pending, completed, skipped, issue
--   New supported values          : pending, in_progress, completed, failed,
--                                   overdue
--   The CHECK constraint added below allows BOTH old and new values, so
--   existing rows stay valid AND new code can use the richer flow.
--
-- Stop type enum (new):
--   pickup, delivery, meeting, inspection, vehicle_service, other
--   Optional (nullable) — legacy stops have no stop_type and stay valid.
--
-- RLS:
--   No changes. The existing `route_stops_select` policy already enforces:
--     • Workspace owners/managers/viewers (בעלים/מנהל/שותף) see all stops
--       in their workspace.
--     • Assigned drivers see stops only for routes assigned to them.
--     • Personal users with no workspace membership see nothing.
--   INSERT/UPDATE/DELETE remain RPC-only (SECURITY DEFINER).
-- ============================================================================

begin;

-- 1. New columns ------------------------------------------------------------
alter table public.route_stops
  add column if not exists stop_type      text,
  add column if not exists latitude       double precision,
  add column if not exists longitude      double precision,
  add column if not exists planned_time   timestamptz,
  add column if not exists contact_name   text,
  add column if not exists contact_phone  text,
  add column if not exists driver_notes   text,
  add column if not exists manager_notes  text,
  add column if not exists arrived_at     timestamptz,
  add column if not exists failure_reason text,
  add column if not exists updated_at     timestamptz not null default now();

-- 2. CHECK — stop_type whitelist -------------------------------------------
alter table public.route_stops
  drop constraint if exists route_stops_stop_type_chk;
alter table public.route_stops
  add  constraint route_stops_stop_type_chk
  check (
    stop_type is null
    or stop_type in (
      'pickup','delivery','meeting','inspection','vehicle_service','other'
    )
  );

-- 3. CHECK — status whitelist (extended, backwards-compatible) -------------
-- Existing schema had no CHECK on status. Adding one now with the union of
-- legacy values (already in production) and new values (introduced here).
alter table public.route_stops
  drop constraint if exists route_stops_status_chk;
alter table public.route_stops
  add  constraint route_stops_status_chk
  check (status in (
    'pending', 'in_progress', 'completed', 'failed', 'overdue',
    -- legacy values, retained for existing rows:
    'skipped', 'issue'
  ));

-- 4. CHECK — coordinate bounds ---------------------------------------------
alter table public.route_stops
  drop constraint if exists route_stops_lat_range_chk;
alter table public.route_stops
  add  constraint route_stops_lat_range_chk
  check (latitude is null or (latitude between -90 and 90));

alter table public.route_stops
  drop constraint if exists route_stops_lon_range_chk;
alter table public.route_stops
  add  constraint route_stops_lon_range_chk
  check (longitude is null or (longitude between -180 and 180));

-- 5. updated_at maintenance trigger -----------------------------------------
create or replace function public.touch_updated_at_route_stops()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_route_stops_touch_updated_at on public.route_stops;
create trigger trg_route_stops_touch_updated_at
  before update on public.route_stops
  for each row execute function public.touch_updated_at_route_stops();

-- 6. Indexes (additive — existing two from phase 6 are kept) ---------------
-- Existing (retained):
--   route_stops_route_id_sequence_idx  (route_id, sequence)
--   route_stops_account_id_idx         (account_id)
--
-- New, supporting upcoming map / fleet-overview queries:
create index if not exists route_stops_status_idx
  on public.route_stops (status);

create index if not exists route_stops_planned_time_idx
  on public.route_stops (planned_time)
  where planned_time is not null;

create index if not exists route_stops_geo_idx
  on public.route_stops (latitude, longitude)
  where latitude is not null and longitude is not null;

-- 7. RLS — unchanged --------------------------------------------------------
-- The existing route_stops_select policy is row-level (not column-level), so
-- it covers all new fields automatically. The phase-6 grant
-- `grant select on public.route_stops to authenticated` carries over to
-- current and future columns. No re-grants needed.

notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Down-migration (for reference only; DO NOT run unless rolling back):
--
-- begin;
-- alter table public.route_stops drop column if exists failure_reason;
-- alter table public.route_stops drop column if exists arrived_at;
-- alter table public.route_stops drop column if exists manager_notes;
-- alter table public.route_stops drop column if exists driver_notes;
-- alter table public.route_stops drop column if exists contact_phone;
-- alter table public.route_stops drop column if exists contact_name;
-- alter table public.route_stops drop column if exists planned_time;
-- alter table public.route_stops drop column if exists longitude;
-- alter table public.route_stops drop column if exists latitude;
-- alter table public.route_stops drop column if exists stop_type;
-- alter table public.route_stops drop column if exists updated_at;
-- alter table public.route_stops drop constraint if exists route_stops_stop_type_chk;
-- alter table public.route_stops drop constraint if exists route_stops_status_chk;
-- alter table public.route_stops drop constraint if exists route_stops_lat_range_chk;
-- alter table public.route_stops drop constraint if exists route_stops_lon_range_chk;
-- drop trigger  if exists trg_route_stops_touch_updated_at on public.route_stops;
-- drop function if exists public.touch_updated_at_route_stops();
-- drop index    if exists route_stops_status_idx;
-- drop index    if exists route_stops_planned_time_idx;
-- drop index    if exists route_stops_geo_idx;
-- commit;
-- ============================================================================
