-- ==========================================================================
-- Phase 6 — Routes and Tasks
--
-- What this migration adds:
--   1. Role value 'driver' (data only — no CHECK constraint exists on
--      account_members.role to alter; the value is now meaningful).
--   2. driver_assignments      — narrows a 'driver' role member's
--                                  vehicle visibility to those assigned.
--   3. routes                  — header row per planned trip.
--   4. route_stops             — ordered stops/tasks within a route.
--   5. stop_documentation      — notes / photos / issue reports per stop.
--                                  This table is also the foundation
--                                  Phase 7 (Execution Logging) will
--                                  extend; do NOT remove it on rollback
--                                  if Phase 7 already shipped.
--   6. RLS — additive policies on all new tables + ONE additional
--      SELECT policy on vehicles that lets 'driver' role members read
--      their assigned vehicles. The pre-existing vehicles policies are
--      untouched.
--   7. RPCs (SECURITY DEFINER) — assign_driver, create_route_with_stops,
--      update_stop_status, add_stop_documentation.
--
-- This migration assumes Phase 1 (accounts.type) is applied. It does
-- not depend on Phase 4 (business_meta) being applied.
--
-- Idempotent. Reversible.
-- DO NOT APPLY TO PRODUCTION UNTIL STAGING/PROD DB SPLIT.
-- ==========================================================================

-- 1. driver_assignments ----------------------------------------------------
create table if not exists public.driver_assignments (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id)  on delete cascade,
  vehicle_id      uuid not null references public.vehicles(id)  on delete cascade,
  driver_user_id  uuid not null references auth.users(id)       on delete cascade,
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,
  status          text not null default 'active',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists driver_assignments_account_id_idx
  on public.driver_assignments (account_id);
create index if not exists driver_assignments_driver_user_id_idx
  on public.driver_assignments (driver_user_id);
create index if not exists driver_assignments_vehicle_id_idx
  on public.driver_assignments (vehicle_id);

-- One active assignment per (vehicle, driver) pair. A driver can be
-- assigned to multiple vehicles, and a vehicle can be assigned to
-- multiple drivers — but never the same pair active twice.
create unique index if not exists driver_assignments_unique_active
  on public.driver_assignments (vehicle_id, driver_user_id)
  where status = 'active';

alter table public.driver_assignments enable row level security;

-- 2. routes ----------------------------------------------------------------
create table if not exists public.routes (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references public.accounts(id)  on delete cascade,
  vehicle_id               uuid not null references public.vehicles(id)  on delete restrict,
  assigned_driver_user_id  uuid          references auth.users(id)       on delete set null,
  dispatcher_user_id       uuid          references auth.users(id)       on delete set null,
  title                    text not null,
  notes                    text,
  scheduled_for            date,
  status                   text not null default 'pending',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists routes_account_id_status_idx
  on public.routes (account_id, status);
create index if not exists routes_assigned_driver_user_id_idx
  on public.routes (assigned_driver_user_id);

alter table public.routes enable row level security;

-- 3. route_stops ----------------------------------------------------------
create table if not exists public.route_stops (
  id                      uuid primary key default gen_random_uuid(),
  route_id                uuid not null references public.routes(id)    on delete cascade,
  account_id              uuid not null references public.accounts(id)  on delete cascade,
  sequence                int  not null,
  title                   text not null,
  address_text            text,
  notes                   text,
  status                  text not null default 'pending',
  completed_at            timestamptz,
  completed_by_user_id    uuid references auth.users(id) on delete set null,
  completion_note         text,
  created_at              timestamptz not null default now()
);

create index if not exists route_stops_route_id_sequence_idx
  on public.route_stops (route_id, sequence);
create index if not exists route_stops_account_id_idx
  on public.route_stops (account_id);

alter table public.route_stops enable row level security;

-- 4. stop_documentation ---------------------------------------------------
create table if not exists public.stop_documentation (
  id                  uuid primary key default gen_random_uuid(),
  route_stop_id       uuid not null references public.route_stops(id)  on delete cascade,
  account_id          uuid not null references public.accounts(id)     on delete cascade,
  kind                text not null,
  payload             jsonb,
  captured_by_user_id uuid references auth.users(id) on delete set null,
  captured_at         timestamptz not null default now()
);

create index if not exists stop_documentation_route_stop_id_idx
  on public.stop_documentation (route_stop_id);
create index if not exists stop_documentation_account_id_idx
  on public.stop_documentation (account_id);

alter table public.stop_documentation enable row level security;

-- 5. RLS — visibility helper ----------------------------------------------
-- Returns true if the caller is a workspace member with manager-level
-- access (בעלים / מנהל). Used by INSERT/UPDATE/DELETE policies on the
-- new tables.
create or replace function public.is_workspace_manager(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_members
     where account_id = p_account_id
       and user_id    = auth.uid()
       and status     = 'פעיל'
       and role       in ('בעלים', 'מנהל')
  );
$$;

grant execute on function public.is_workspace_manager(uuid) to authenticated;

-- Returns true if the caller has an active driver_assignment on the
-- given vehicle (for use in vehicle SELECT policy extension).
create or replace function public.is_assigned_driver_for_vehicle(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.driver_assignments
     where vehicle_id     = p_vehicle_id
       and driver_user_id = auth.uid()
       and status         = 'active'
       and (valid_to is null or valid_to > now())
  );
$$;

grant execute on function public.is_assigned_driver_for_vehicle(uuid) to authenticated;

-- Returns true if caller is the assigned driver of the given route.
create or replace function public.is_assigned_driver_for_route(p_route_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.routes
     where id = p_route_id
       and assigned_driver_user_id = auth.uid()
  );
$$;

grant execute on function public.is_assigned_driver_for_route(uuid) to authenticated;

-- 5a. driver_assignments policies -----------------------------------------
drop policy if exists "driver_assignments_select" on public.driver_assignments;
create policy "driver_assignments_select"
  on public.driver_assignments
  for select
  to authenticated
  using (
    public.is_workspace_manager(account_id)
    or driver_user_id = auth.uid()
  );

-- INSERT/UPDATE/DELETE only via RPC — no policies = blocked for direct
-- postgrest writes. The RPCs below are SECURITY DEFINER and validate.

-- 5b. routes policies -----------------------------------------------------
drop policy if exists "routes_select" on public.routes;
create policy "routes_select"
  on public.routes
  for select
  to authenticated
  using (
    -- managers + 'שותף' viewers see all routes in their workspace
    exists (
      select 1 from public.account_members m
       where m.account_id = routes.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
         and m.role       in ('בעלים', 'מנהל', 'שותף')
    )
    -- drivers see only routes assigned to them
    or assigned_driver_user_id = auth.uid()
  );

-- INSERT/UPDATE only via RPC.

-- 5c. route_stops policies ------------------------------------------------
drop policy if exists "route_stops_select" on public.route_stops;
create policy "route_stops_select"
  on public.route_stops
  for select
  to authenticated
  using (
    exists (
      select 1 from public.account_members m
       where m.account_id = route_stops.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
         and m.role       in ('בעלים', 'מנהל', 'שותף')
    )
    or public.is_assigned_driver_for_route(route_id)
  );

-- 5d. stop_documentation policies ----------------------------------------
drop policy if exists "stop_documentation_select" on public.stop_documentation;
create policy "stop_documentation_select"
  on public.stop_documentation
  for select
  to authenticated
  using (
    exists (
      select 1 from public.account_members m
       where m.account_id = stop_documentation.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
         and m.role       in ('בעלים', 'מנהל', 'שותף')
    )
    or captured_by_user_id = auth.uid()
  );

-- 5e. vehicles — additional SELECT policy for driver role ----------------
-- Existing vehicles_select policy (granted via account_members) stays.
-- This adds a SECOND, permissive policy that lets 'driver' role members
-- see vehicles they're actively assigned to. Permissive policies are
-- OR-ed, so the driver does NOT lose access to anything; they GAIN
-- access to assigned vehicles when their workspace role would otherwise
-- not grant it (a 'driver' is NOT in the בעלים/מנהל/שותף list, so the
-- existing policy on its own would deny).

drop policy if exists "vehicles_select_assigned_driver" on public.vehicles;
create policy "vehicles_select_assigned_driver"
  on public.vehicles
  for select
  to authenticated
  using (public.is_assigned_driver_for_vehicle(id));

-- 6. RPCs ----------------------------------------------------------------

-- assign_driver: manager grants a driver access to a vehicle.
create or replace function public.assign_driver(
  p_account_id     uuid,
  p_vehicle_id     uuid,
  p_driver_user_id uuid,
  p_valid_from     timestamptz default now(),
  p_valid_to       timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_manager(p_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  -- Vehicle must belong to the workspace.
  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then
    raise exception 'vehicle_not_in_workspace';
  end if;

  -- Driver must be a workspace member (any role).
  if not exists (
    select 1 from public.account_members
     where account_id = p_account_id
       and user_id    = p_driver_user_id
       and status     = 'פעיל'
  ) then
    raise exception 'driver_not_workspace_member';
  end if;

  insert into public.driver_assignments
    (account_id, vehicle_id, driver_user_id, valid_from, valid_to, status, created_by)
  values
    (p_account_id, p_vehicle_id, p_driver_user_id, p_valid_from, p_valid_to, 'active', uid)
  on conflict (vehicle_id, driver_user_id) where status = 'active'
  do update set
    valid_from = excluded.valid_from,
    valid_to   = excluded.valid_to,
    created_by = excluded.created_by
  returning id into new_id;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (p_account_id, uid, 'driver.assign', 'driver_assignment', new_id,
     jsonb_build_object('vehicle_id', p_vehicle_id, 'driver_user_id', p_driver_user_id));

  return new_id;
end;
$$;

revoke all on function public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;

-- create_route_with_stops: atomic. Manager creates a route + its
-- ordered stops in one round trip. p_stops is a jsonb array of
-- {title, address_text, notes} objects; sequence is assigned 1..N.
create or replace function public.create_route_with_stops(
  p_account_id              uuid,
  p_vehicle_id              uuid,
  p_assigned_driver_user_id uuid,
  p_title                   text,
  p_notes                   text default null,
  p_scheduled_for           date default null,
  p_stops                   jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  stop record;
  seq int := 0;
  clean_title text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_manager(p_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  clean_title := nullif(trim(coalesce(p_title, '')), '');
  if clean_title is null then raise exception 'title_required'; end if;

  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then
    raise exception 'vehicle_not_in_workspace';
  end if;

  if p_assigned_driver_user_id is not null then
    if not exists (
      select 1 from public.account_members
       where account_id = p_account_id
         and user_id    = p_assigned_driver_user_id
         and status     = 'פעיל'
    ) then
      raise exception 'driver_not_workspace_member';
    end if;
  end if;

  insert into public.routes
    (account_id, vehicle_id, assigned_driver_user_id, dispatcher_user_id,
     title, notes, scheduled_for, status)
  values
    (p_account_id, p_vehicle_id, p_assigned_driver_user_id, uid,
     clean_title, p_notes, p_scheduled_for, 'pending')
  returning id into new_id;

  if p_stops is not null and jsonb_typeof(p_stops) = 'array' then
    for stop in
      select * from jsonb_array_elements(p_stops) as elem
    loop
      seq := seq + 1;
      insert into public.route_stops
        (route_id, account_id, sequence, title, address_text, notes, status)
      values
        (new_id,
         p_account_id,
         seq,
         coalesce(nullif(trim(stop.elem->>'title'), ''), 'תחנה ' || seq),
         stop.elem->>'address_text',
         stop.elem->>'notes',
         'pending');
    end loop;
  end if;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (p_account_id, uid, 'route.create', 'route', new_id,
     jsonb_build_object('vehicle_id', p_vehicle_id, 'driver_user_id', p_assigned_driver_user_id));

  return new_id;
end;
$$;

revoke all on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

-- update_stop_status: driver of the route, or manager, can change a
-- stop's status. Auto-advances the parent route's status:
--   - on first stop transition to a non-pending state → route 'in_progress'
--   - when all stops are in a terminal state (completed/skipped/issue)
--     → route 'completed' (or 'cancelled' is left to a separate RPC).
create or replace function public.update_stop_status(
  p_stop_id   uuid,
  p_status    text,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_route_id uuid;
  v_route_status text;
  v_remaining int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_status not in ('pending', 'completed', 'skipped', 'issue') then
    raise exception 'invalid_status';
  end if;

  select s.account_id, s.route_id
    into v_account_id, v_route_id
    from public.route_stops s
   where s.id = p_stop_id;
  if v_account_id is null then raise exception 'stop_not_found'; end if;

  if not (
    public.is_workspace_manager(v_account_id)
    or public.is_assigned_driver_for_route(v_route_id)
  ) then
    raise exception 'forbidden';
  end if;

  update public.route_stops
     set status               = p_status,
         completion_note      = coalesce(p_note, completion_note),
         completed_at         = case when p_status in ('completed','skipped','issue')
                                     then now() else null end,
         completed_by_user_id = case when p_status in ('completed','skipped','issue')
                                     then uid  else null end
   where id = p_stop_id;

  -- Auto-advance route status. Pending → in_progress on first non-pending.
  -- Any → completed when no pending stops remain.
  select status into v_route_status from public.routes where id = v_route_id;

  select count(*) into v_remaining
    from public.route_stops
   where route_id = v_route_id
     and status   = 'pending';

  if v_remaining = 0 and v_route_status in ('pending','in_progress') then
    update public.routes set status = 'completed', updated_at = now()
     where id = v_route_id;
  elsif v_route_status = 'pending' and p_status <> 'pending' then
    update public.routes set status = 'in_progress', updated_at = now()
     where id = v_route_id;
  end if;
end;
$$;

revoke all on function public.update_stop_status(uuid, text, text) from public;
grant execute on function public.update_stop_status(uuid, text, text) to authenticated;

-- add_stop_documentation: assigned driver or manager attaches a note,
-- photo reference, or issue report to a stop. Photos are stored
-- separately (Supabase Storage); this row holds the metadata.
create or replace function public.add_stop_documentation(
  p_stop_id  uuid,
  p_kind     text,
  p_payload  jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_route_id uuid;
  new_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('note', 'photo', 'issue') then
    raise exception 'invalid_kind';
  end if;

  select s.account_id, s.route_id
    into v_account_id, v_route_id
    from public.route_stops s
   where s.id = p_stop_id;
  if v_account_id is null then raise exception 'stop_not_found'; end if;

  if not (
    public.is_workspace_manager(v_account_id)
    or public.is_assigned_driver_for_route(v_route_id)
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.stop_documentation
    (route_stop_id, account_id, kind, payload, captured_by_user_id)
  values
    (p_stop_id, v_account_id, p_kind, p_payload, uid)
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.add_stop_documentation(uuid, text, jsonb) from public;
grant execute on function public.add_stop_documentation(uuid, text, jsonb) to authenticated;

grant select on public.driver_assignments    to authenticated;
grant select on public.routes                to authenticated;
grant select on public.route_stops           to authenticated;
grant select on public.stop_documentation    to authenticated;

notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (manual)
--
--   drop function if exists public.add_stop_documentation(uuid, text, jsonb);
--   drop function if exists public.update_stop_status(uuid, text, text);
--   drop function if exists public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb);
--   drop function if exists public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz);
--   drop policy   if exists "vehicles_select_assigned_driver" on public.vehicles;
--   drop policy   if exists "stop_documentation_select" on public.stop_documentation;
--   drop policy   if exists "route_stops_select" on public.route_stops;
--   drop policy   if exists "routes_select" on public.routes;
--   drop policy   if exists "driver_assignments_select" on public.driver_assignments;
--   drop function if exists public.is_assigned_driver_for_route(uuid);
--   drop function if exists public.is_assigned_driver_for_vehicle(uuid);
--   drop function if exists public.is_workspace_manager(uuid);
--   drop table    if exists public.stop_documentation;
--   drop table    if exists public.route_stops;
--   drop table    if exists public.routes;
--   drop table    if exists public.driver_assignments;
--   -- account_members.role values 'driver' (if any) become orphaned.
--   -- Cleanup if desired:
--   --   update public.account_members set role = 'שותף' where role = 'driver';
--
-- The vehicles policies were untouched, only one was added; rollback
-- restores their original behavior for any role we didn't introduce.
-- ==========================================================================
