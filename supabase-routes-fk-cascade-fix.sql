-- supabase-routes-fk-cascade-fix.sql
--
-- Fix: vehicle delete failed with
--   "update or delete on table 'vehicles' violates foreign key constraint
--    'routes_vehicle_id_fkey' on table 'routes'"
--
-- Cause: routes.vehicle_id was created with ON DELETE RESTRICT
-- (supabase-phase6-routes-and-tasks.sql, line 63). Every other table that
-- FKs to public.vehicles uses ON DELETE CASCADE; routes is the outlier.
-- The intent of RESTRICT was probably "don't lose route history" but in
-- practice it blocks every owner-initiated delete that has any historical
-- route, including for users who don't even use the routes feature.
--
-- Fix: drop the RESTRICT constraint and re-add it as ON DELETE CASCADE.
-- route_stops already cascades from routes, so the full chain
-- vehicle → routes → route_stops drops cleanly.
--
-- Idempotent: drops by name then re-adds. Safe to run multiple times.

begin;

alter table public.routes
  drop constraint if exists routes_vehicle_id_fkey;

alter table public.routes
  add constraint routes_vehicle_id_fkey
  foreign key (vehicle_id)
  references public.vehicles(id)
  on delete cascade;

commit;

-- Verification — confdeltype 'c' = cascade, 'r' = restrict.
-- Expect: confdeltype = 'c' after running.
select conname, confdeltype
  from pg_constraint
 where conrelid = 'public.routes'::regclass
   and conname  = 'routes_vehicle_id_fkey';
