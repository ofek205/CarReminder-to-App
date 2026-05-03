-- ==========================================================================
-- External Drivers — drivers who don't have a user account in the app.
--
-- Until now every driver_assignments.driver_user_id had to point at a real
-- auth.users row, which forced every employee to sign up before a manager
-- could assign them to a fleet vehicle. This migration:
--
--   1. Adds public.external_drivers — roster entry per non-account
--      driver. Stores name, phone, email (optional), license details,
--      categories array, license photo. Soft-delete via status='archived'
--      to preserve assignment history.
--   2. Extends driver_assignments to allow EITHER driver_user_id OR
--      external_driver_id (XOR check). Re-creates the unique-active
--      index to cover both kinds.
--   3. Adds RPCs (security definer, manager-gated):
--        create_external_driver
--        update_external_driver
--        archive_external_driver        (also ends active assignments)
--        assign_external_driver         (mirrors assign_driver semantics)
--        end_driver_assignment          (universal: works for both kinds)
--   4. RLS on external_drivers: managers/owners read+write, drivers
--      themselves can't read (they have no account presence here).
--
-- Idempotent. Reversible (rollback at end of file).
-- ==========================================================================


-- 1. Table ------------------------------------------------------------------
create table if not exists public.external_drivers (
  id                          uuid primary key default gen_random_uuid(),
  account_id                  uuid not null references public.accounts(id) on delete cascade,
  full_name                   text not null,
  phone                       text not null,
  email                       text,
  birth_date                  date,
  license_number              text,
  -- License expiry is OPTIONAL per product decision (#3). If set, future
  -- phases will surface reminders for expiring licenses.
  license_expiry_date         date,
  -- Israeli license categories + custom labels (e.g. "מלגזה", "טרקטור").
  -- Stored as text[] so we can index/filter without a join table.
  license_categories          text[] not null default '{}',
  license_photo_url           text,
  license_photo_storage_path  text,
  notes                       text,
  status                      text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_by_user_id          uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists external_drivers_account_status_idx
  on public.external_drivers (account_id, status);
create index if not exists external_drivers_full_name_idx
  on public.external_drivers (account_id, full_name);

-- updated_at auto-bump trigger (uses existing helper if present, else
-- creates it). The helper is account-agnostic so other tables share it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists external_drivers_touch_updated_at on public.external_drivers;
create trigger external_drivers_touch_updated_at
  before update on public.external_drivers
  for each row execute function public.touch_updated_at();

alter table public.external_drivers enable row level security;


-- 2. Driver_assignments — extend for external drivers ----------------------
alter table public.driver_assignments
  add column if not exists external_driver_id uuid
    references public.external_drivers(id) on delete cascade;

alter table public.driver_assignments
  alter column driver_user_id drop not null;

-- XOR: exactly one of (user, external) per row.
alter table public.driver_assignments
  drop constraint if exists driver_assignments_one_driver_check;
alter table public.driver_assignments
  add constraint driver_assignments_one_driver_check check (
    (driver_user_id is not null and external_driver_id is null)
    or
    (driver_user_id is null and external_driver_id is not null)
  );

-- The legacy unique-active index covered (vehicle_id, driver_user_id).
-- We need an equivalent for external drivers, plus the original.
-- Re-create both as partial indexes scoped to status='active' so an
-- "ended" assignment doesn't block a re-assignment later.
drop index if exists public.driver_assignments_unique_active;

create unique index if not exists driver_assignments_user_unique_active
  on public.driver_assignments (vehicle_id, driver_user_id)
  where status = 'active' and driver_user_id is not null;

create unique index if not exists driver_assignments_external_unique_active
  on public.driver_assignments (vehicle_id, external_driver_id)
  where status = 'active' and external_driver_id is not null;

create index if not exists driver_assignments_external_driver_id_idx
  on public.driver_assignments (external_driver_id)
  where external_driver_id is not null;


-- 3. RLS policies on external_drivers --------------------------------------
drop policy if exists external_drivers_select on public.external_drivers;
create policy external_drivers_select
  on public.external_drivers
  for select
  to authenticated
  using (
    -- Any active member of the workspace can READ — drivers see their
    -- co-workers' names. Personal-data fields (phone, license_number,
    -- photo) shown only to managers via UI gating, but RLS grants the
    -- whole row; if you need stricter, switch to a view that hides
    -- columns. For MVP this matches behavior of account_members.
    exists (
      select 1 from public.account_members
       where account_id = external_drivers.account_id
         and user_id    = auth.uid()
         and status     = 'פעיל'
    )
  );

-- INSERT / UPDATE / DELETE go through RPCs (no policies on these = no
-- direct PostgREST writes).


-- 4. RPCs -------------------------------------------------------------------

-- 4a. create_external_driver — adds a roster entry.
create or replace function public.create_external_driver(
  p_account_id            uuid,
  p_full_name             text,
  p_phone                 text,
  p_email                 text default null,
  p_birth_date            date default null,
  p_license_number        text default null,
  p_license_expiry_date   date default null,
  p_license_categories    text[] default '{}',
  p_license_photo_url     text default null,
  p_license_photo_storage_path text default null,
  p_notes                 text default null
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
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full_name_required';
  end if;
  if coalesce(trim(p_phone), '') = '' then
    raise exception 'phone_required';
  end if;

  insert into public.external_drivers (
    account_id, full_name, phone, email, birth_date,
    license_number, license_expiry_date, license_categories,
    license_photo_url, license_photo_storage_path,
    notes, created_by_user_id
  ) values (
    p_account_id, trim(p_full_name), trim(p_phone), nullif(trim(p_email), ''), p_birth_date,
    nullif(trim(p_license_number), ''), p_license_expiry_date,
    coalesce(p_license_categories, '{}'),
    p_license_photo_url, p_license_photo_storage_path,
    nullif(trim(p_notes), ''), uid
  )
  returning id into new_id;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (p_account_id, uid, 'external_driver.create', 'external_driver', new_id,
     jsonb_build_object('full_name', p_full_name));

  return new_id;
end;
$$;

revoke all on function public.create_external_driver(
  uuid, text, text, text, date, text, date, text[], text, text, text
) from public;
grant execute on function public.create_external_driver(
  uuid, text, text, text, date, text, date, text[], text, text, text
) to authenticated;


-- 4b. update_external_driver — edit an existing entry.
-- Pattern: each "p_clear_*" boolean lets a caller explicitly null an
-- optional column without polluting the rest of the form.
create or replace function public.update_external_driver(
  p_id                       uuid,
  p_full_name                text default null,
  p_phone                    text default null,
  p_email                    text default null,
  p_clear_email              boolean default false,
  p_birth_date               date default null,
  p_clear_birth_date         boolean default false,
  p_license_number           text default null,
  p_clear_license_number     boolean default false,
  p_license_expiry_date      date default null,
  p_clear_license_expiry     boolean default false,
  p_license_categories       text[] default null,
  p_license_photo_url        text default null,
  p_license_photo_storage_path text default null,
  p_clear_license_photo      boolean default false,
  p_notes                    text default null,
  p_clear_notes              boolean default false,
  p_status                   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select account_id into v_account_id
    from public.external_drivers where id = p_id;
  if not found then raise exception 'driver_not_found'; end if;

  if not public.is_workspace_manager(v_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  if p_status is not null and p_status not in ('active', 'suspended', 'archived') then
    raise exception 'invalid_status';
  end if;

  update public.external_drivers
     set
       full_name = case when p_full_name is not null and trim(p_full_name) <> ''
                          then trim(p_full_name) else full_name end,
       phone     = case when p_phone is not null and trim(p_phone) <> ''
                          then trim(p_phone) else phone end,
       email     = case when p_clear_email then null
                        when p_email is not null then nullif(trim(p_email), '')
                        else email end,
       birth_date = case when p_clear_birth_date then null
                         when p_birth_date is not null then p_birth_date
                         else birth_date end,
       license_number = case when p_clear_license_number then null
                             when p_license_number is not null then nullif(trim(p_license_number), '')
                             else license_number end,
       license_expiry_date = case when p_clear_license_expiry then null
                                  when p_license_expiry_date is not null then p_license_expiry_date
                                  else license_expiry_date end,
       license_categories = case when p_license_categories is not null
                                 then p_license_categories
                                 else license_categories end,
       license_photo_url          = case when p_clear_license_photo then null
                                         when p_license_photo_url is not null then p_license_photo_url
                                         else license_photo_url end,
       license_photo_storage_path = case when p_clear_license_photo then null
                                         when p_license_photo_storage_path is not null then p_license_photo_storage_path
                                         else license_photo_storage_path end,
       notes      = case when p_clear_notes then null
                         when p_notes is not null then nullif(trim(p_notes), '')
                         else notes end,
       status     = coalesce(p_status, status)
   where id = p_id;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (v_account_id, uid, 'external_driver.update', 'external_driver', p_id, '{}'::jsonb);

  return true;
end;
$$;

revoke all on function public.update_external_driver(
  uuid, text, text, text, boolean, date, boolean, text, boolean, date, boolean,
  text[], text, text, boolean, text, boolean, text
) from public;
grant execute on function public.update_external_driver(
  uuid, text, text, text, boolean, date, boolean, text, boolean, date, boolean,
  text[], text, text, boolean, text, boolean, text
) to authenticated;


-- 4c. archive_external_driver — soft-delete (preserves history).
-- Also ends every active assignment of this driver — visually they
-- disappear from "currently assigned" lists immediately.
create or replace function public.archive_external_driver(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select account_id into v_account_id
    from public.external_drivers where id = p_id;
  if not found then raise exception 'driver_not_found'; end if;

  if not public.is_workspace_manager(v_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  update public.driver_assignments
     set status = 'ended', valid_to = coalesce(valid_to, now())
   where external_driver_id = p_id and status = 'active';

  update public.external_drivers
     set status = 'archived'
   where id = p_id;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (v_account_id, uid, 'external_driver.archive', 'external_driver', p_id, '{}'::jsonb);

  return true;
end;
$$;

revoke all on function public.archive_external_driver(uuid) from public;
grant execute on function public.archive_external_driver(uuid) to authenticated;


-- 4d. assign_external_driver — manager assigns an external driver to
-- a vehicle. Mirrors assign_driver but stores the external_driver_id
-- pointer instead.
create or replace function public.assign_external_driver(
  p_account_id        uuid,
  p_vehicle_id        uuid,
  p_external_driver_id uuid,
  p_valid_from        timestamptz default now(),
  p_valid_to          timestamptz default null
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

  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then
    raise exception 'vehicle_not_in_workspace';
  end if;

  if not exists (
    select 1 from public.external_drivers
     where id = p_external_driver_id
       and account_id = p_account_id
       and status = 'active'
  ) then
    raise exception 'external_driver_not_in_workspace_or_inactive';
  end if;

  insert into public.driver_assignments
    (account_id, vehicle_id, external_driver_id, valid_from, valid_to, status, created_by)
  values
    (p_account_id, p_vehicle_id, p_external_driver_id, p_valid_from, p_valid_to, 'active', uid)
  on conflict (vehicle_id, external_driver_id) where status = 'active' and external_driver_id is not null
  do update set
    valid_from = excluded.valid_from,
    valid_to   = excluded.valid_to,
    created_by = excluded.created_by
  returning id into new_id;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (p_account_id, uid, 'driver.assign_external', 'driver_assignment', new_id,
     jsonb_build_object('vehicle_id', p_vehicle_id, 'external_driver_id', p_external_driver_id));

  return new_id;
end;
$$;

revoke all on function public.assign_external_driver(uuid, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.assign_external_driver(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;


-- 4e. end_driver_assignment — universal "stop this assignment now".
-- Works for both driver_user_id and external_driver_id rows.
create or replace function public.end_driver_assignment(p_assignment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select account_id into v_account_id
    from public.driver_assignments where id = p_assignment_id;
  if not found then raise exception 'assignment_not_found'; end if;

  if not public.is_workspace_manager(v_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  update public.driver_assignments
     set status = 'ended', valid_to = coalesce(valid_to, now())
   where id = p_assignment_id;

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (v_account_id, uid, 'driver.unassign', 'driver_assignment', p_assignment_id, '{}'::jsonb);

  return true;
end;
$$;

revoke all on function public.end_driver_assignment(uuid) from public;
grant execute on function public.end_driver_assignment(uuid) to authenticated;


-- 5. Reload PostgREST cache -------------------------------------------------
notify pgrst, 'reload schema';


-- ==========================================================================
-- ROLLBACK (manual)
--   drop function if exists public.end_driver_assignment(uuid);
--   drop function if exists public.assign_external_driver(uuid, uuid, uuid, timestamptz, timestamptz);
--   drop function if exists public.archive_external_driver(uuid);
--   drop function if exists public.update_external_driver(
--     uuid, text, text, text, boolean, date, boolean, text, boolean, date, boolean,
--     text[], text, text, boolean, text, boolean, text);
--   drop function if exists public.create_external_driver(
--     uuid, text, text, text, date, text, date, text[], text, text, text);
--   drop policy   if exists external_drivers_select on public.external_drivers;
--   drop trigger  if exists external_drivers_touch_updated_at on public.external_drivers;
--   drop index    if exists public.driver_assignments_external_unique_active;
--   drop index    if exists public.driver_assignments_user_unique_active;
--   drop index    if exists public.driver_assignments_external_driver_id_idx;
--   alter table public.driver_assignments drop constraint if exists driver_assignments_one_driver_check;
--   -- careful: the following will fail if there are rows with NULL driver_user_id.
--   -- alter table public.driver_assignments alter column driver_user_id set not null;
--   alter table public.driver_assignments drop column if exists external_driver_id;
--   create unique index if not exists driver_assignments_unique_active
--     on public.driver_assignments (vehicle_id, driver_user_id) where status = 'active';
--   drop table if exists public.external_drivers;
-- ==========================================================================
