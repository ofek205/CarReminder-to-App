-- ==========================================================================
-- Phase 7 — Execution Documentation & Activity Log
--
-- Extends the workspace_audit_log table (introduced in Phase 4) into
-- the unified activity log the brief calls for. Strategy: extend in
-- place, do not introduce a parallel table. Existing rows continue to
-- be valid log entries — they just had fewer denormalized columns.
--
-- Immutability is enforced in three layers:
--   1. No INSERT/UPDATE/DELETE policies for any role  → postgrest blocked
--   2. All writes go through SECURITY DEFINER RPCs    → centralized
--   3. BEFORE UPDATE trigger raises unconditionally   → belt + suspenders
--
-- Hard deletes only happen via ON DELETE CASCADE when the parent
-- workspace itself is deleted — a deliberate, rare operation.
-- "Corrections" must create new log entries.
--
-- Idempotent. Reversible.
-- DO NOT APPLY TO PRODUCTION UNTIL STAGING/PROD DB SPLIT.
-- ==========================================================================

-- 1. Schema additions ------------------------------------------------------
alter table public.workspace_audit_log
  add column if not exists note            text,
  add column if not exists attachment_ref  text,
  add column if not exists vehicle_id      uuid references public.vehicles(id) on delete set null,
  add column if not exists route_id        uuid references public.routes(id)   on delete set null;

-- 2. Indexes for paginated filtering --------------------------------------
create index if not exists idx_audit_log_account_created
  on public.workspace_audit_log (account_id, created_at desc);
create index if not exists idx_audit_log_actor_created
  on public.workspace_audit_log (actor_user_id, created_at desc);
create index if not exists idx_audit_log_vehicle_created
  on public.workspace_audit_log (vehicle_id, created_at desc)
  where vehicle_id is not null;
create index if not exists idx_audit_log_route_created
  on public.workspace_audit_log (route_id, created_at desc)
  where route_id is not null;

-- 3. Immutability trigger -------------------------------------------------
create or replace function public.prevent_audit_log_update()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'activity_log_immutable: rows in workspace_audit_log cannot be updated. Create a new log entry instead.'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists prevent_audit_log_update on public.workspace_audit_log;
create trigger prevent_audit_log_update
  before update on public.workspace_audit_log
  for each row
  execute function public.prevent_audit_log_update();

-- 4. SELECT policy — replace the manager-only policy with a layered one ---
drop policy if exists "audit_select_managers_only" on public.workspace_audit_log;
drop policy if exists "activity_log_select"         on public.workspace_audit_log;

create policy "activity_log_select"
  on public.workspace_audit_log
  for select
  to authenticated
  using (
    -- (a) managers + 'שותף' viewers see all logs in their workspace
    exists (
      select 1 from public.account_members m
       where m.account_id = workspace_audit_log.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
         and m.role       in ('בעלים', 'מנהל', 'שותף')
    )
    -- (b) drivers see their own actions
    or actor_user_id = auth.uid()
    -- (c) drivers see logs about routes assigned to them
    or (target_kind = 'route' and exists (
      select 1 from public.routes r
       where r.id = workspace_audit_log.target_id
         and r.assigned_driver_user_id = auth.uid()
    ))
    -- (d) drivers see logs about stops in routes assigned to them
    or (target_kind = 'route_stop' and exists (
      select 1 from public.route_stops s
       join public.routes r on r.id = s.route_id
       where s.id = workspace_audit_log.target_id
         and r.assigned_driver_user_id = auth.uid()
    ))
    -- (e) drivers see their own driver_assignment events
    or (target_kind = 'driver_assignment' and exists (
      select 1 from public.driver_assignments da
       where da.id = workspace_audit_log.target_id
         and da.driver_user_id = auth.uid()
    ))
  );

-- 5. log_activity helper --------------------------------------------------
-- Internal helper. Intended for SECURITY DEFINER RPCs only — direct
-- callers don't have an INSERT policy on the table, so this function
-- being executable doesn't open a hole.
create or replace function public.log_activity(
  p_account_id     uuid,
  p_action         text,
  p_target_kind    text default null,
  p_target_id      uuid default null,
  p_vehicle_id     uuid default null,
  p_route_id       uuid default null,
  p_note           text default null,
  p_attachment_ref text default null,
  p_payload        jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
begin
  insert into public.workspace_audit_log
    (account_id, actor_user_id, action,
     target_kind, target_id,
     vehicle_id, route_id,
     note, attachment_ref, payload)
  values
    (p_account_id, auth.uid(), p_action,
     p_target_kind, p_target_id,
     p_vehicle_id, p_route_id,
     p_note, p_attachment_ref, p_payload)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.log_activity(uuid, text, text, uuid, uuid, uuid, text, text, jsonb) from public;
-- Not granted to authenticated — only invokable from other SECURITY
-- DEFINER functions in the same schema (same-owner call).

-- 6. Update existing RPCs to denormalize vehicle_id / route_id ------------
-- create_business_workspace: keep its current log shape (workspace.create)
-- assign_driver: enrich with vehicle_id
-- create_route_with_stops: enrich with vehicle_id + route_id

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
  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then raise exception 'vehicle_not_in_workspace'; end if;
  if not exists (
    select 1 from public.account_members
     where account_id = p_account_id
       and user_id    = p_driver_user_id
       and status     = 'פעיל'
  ) then raise exception 'driver_not_workspace_member'; end if;

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

  perform public.log_activity(
    p_account_id, 'driver.assign',
    'driver_assignment', new_id,
    p_vehicle_id, null, null, null,
    jsonb_build_object('driver_user_id', p_driver_user_id,
                       'valid_from', p_valid_from,
                       'valid_to',   p_valid_to)
  );
  return new_id;
end;
$$;

revoke all on function public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;


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
  ) then raise exception 'vehicle_not_in_workspace'; end if;
  if p_assigned_driver_user_id is not null and not exists (
    select 1 from public.account_members
     where account_id = p_account_id
       and user_id    = p_assigned_driver_user_id
       and status     = 'פעיל'
  ) then raise exception 'driver_not_workspace_member'; end if;

  insert into public.routes
    (account_id, vehicle_id, assigned_driver_user_id, dispatcher_user_id,
     title, notes, scheduled_for, status)
  values
    (p_account_id, p_vehicle_id, p_assigned_driver_user_id, uid,
     clean_title, p_notes, p_scheduled_for, 'pending')
  returning id into new_id;

  if p_stops is not null and jsonb_typeof(p_stops) = 'array' then
    for stop in select * from jsonb_array_elements(p_stops) as elem
    loop
      seq := seq + 1;
      insert into public.route_stops
        (route_id, account_id, sequence, title, address_text, notes, status)
      values
        (new_id, p_account_id, seq,
         coalesce(nullif(trim(stop.elem->>'title'), ''), 'תחנה ' || seq),
         stop.elem->>'address_text', stop.elem->>'notes', 'pending');
    end loop;
  end if;

  perform public.log_activity(
    p_account_id, 'route.create',
    'route', new_id,
    p_vehicle_id, new_id, null, null,
    jsonb_build_object('title', clean_title,
                       'driver_user_id', p_assigned_driver_user_id,
                       'scheduled_for', p_scheduled_for,
                       'stop_count', seq)
  );
  return new_id;
end;
$$;

revoke all on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;


-- update_stop_status: the heart of execution documentation. Logs every
-- transition + the auto-advance route status changes.
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
  v_vehicle_id uuid;
  v_stop_seq int;
  v_old_route_status text;
  v_new_route_status text;
  v_remaining int;
  v_action text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_status not in ('pending', 'completed', 'skipped', 'issue') then
    raise exception 'invalid_status';
  end if;

  select s.account_id, s.route_id, s.sequence
    into v_account_id, v_route_id, v_stop_seq
    from public.route_stops s
   where s.id = p_stop_id;
  if v_account_id is null then raise exception 'stop_not_found'; end if;

  if not (
    public.is_workspace_manager(v_account_id)
    or public.is_assigned_driver_for_route(v_route_id)
  ) then raise exception 'forbidden'; end if;

  select vehicle_id, status into v_vehicle_id, v_old_route_status
    from public.routes where id = v_route_id;

  update public.route_stops
     set status               = p_status,
         completion_note      = coalesce(p_note, completion_note),
         completed_at         = case when p_status in ('completed','skipped','issue')
                                     then now() else null end,
         completed_by_user_id = case when p_status in ('completed','skipped','issue')
                                     then uid  else null end
   where id = p_stop_id;

  -- Activity log entry for the stop transition.
  v_action := case p_status
                when 'completed' then 'stop.complete'
                when 'skipped'   then 'stop.skip'
                when 'issue'     then 'stop.issue'
                else                  'stop.reopen'
              end;
  perform public.log_activity(
    v_account_id, v_action,
    'route_stop', p_stop_id,
    v_vehicle_id, v_route_id, p_note, null,
    jsonb_build_object('sequence', v_stop_seq, 'new_status', p_status)
  );

  -- Auto-advance route status, with corresponding log entries.
  -- Three transitions handled:
  --   (A) all stops non-pending  + route was pending/in_progress → completed
  --   (B) reopen of any stop     + route was completed           → in_progress (KI-1 fix)
  --   (C) first non-pending stop + route was pending             → in_progress
  select count(*) into v_remaining
    from public.route_stops
   where route_id = v_route_id and status = 'pending';

  if v_remaining = 0 and v_old_route_status in ('pending','in_progress') then
    update public.routes set status = 'completed', updated_at = now()
     where id = v_route_id;
    perform public.log_activity(
      v_account_id, 'route.complete',
      'route', v_route_id, v_vehicle_id, v_route_id,
      null, null,
      jsonb_build_object('previous_status', v_old_route_status)
    );
  elsif v_remaining > 0 and v_old_route_status = 'completed' then
    -- KI-1: a stop was reopened on a completed route. Move route
    -- back to in_progress so reports + UI stay consistent.
    update public.routes set status = 'in_progress', updated_at = now()
     where id = v_route_id;
    perform public.log_activity(
      v_account_id, 'route.reopen',
      'route', v_route_id, v_vehicle_id, v_route_id,
      null, null,
      jsonb_build_object('reopened_stop_id', p_stop_id)
    );
  elsif v_old_route_status = 'pending' and p_status <> 'pending' then
    update public.routes set status = 'in_progress', updated_at = now()
     where id = v_route_id;
    perform public.log_activity(
      v_account_id, 'route.start',
      'route', v_route_id, v_vehicle_id, v_route_id,
      null, null, null
    );
  end if;
end;
$$;

revoke all on function public.update_stop_status(uuid, text, text) from public;
grant execute on function public.update_stop_status(uuid, text, text) to authenticated;


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
  v_vehicle_id uuid;
  v_attachment text;
  v_note_text text;
  new_id uuid;
  v_action text;
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
  ) then raise exception 'forbidden'; end if;

  select vehicle_id into v_vehicle_id from public.routes where id = v_route_id;

  insert into public.stop_documentation
    (route_stop_id, account_id, kind, payload, captured_by_user_id)
  values
    (p_stop_id, v_account_id, p_kind, p_payload, uid)
  returning id into new_id;

  -- Pull surface fields out of payload so the activity log can render
  -- without expanding the jsonb on every row.
  v_note_text  := nullif(p_payload->>'text', '');
  v_attachment := nullif(p_payload->>'storage_path', '');

  v_action := case p_kind
                when 'note'  then 'stop.note_added'
                when 'photo' then 'stop.photo_added'
                when 'issue' then 'stop.issue_documented'
              end;

  perform public.log_activity(
    v_account_id, v_action,
    'route_stop', p_stop_id,
    v_vehicle_id, v_route_id,
    v_note_text, v_attachment,
    jsonb_build_object('documentation_id', new_id, 'kind', p_kind)
  );

  return new_id;
end;
$$;

revoke all on function public.add_stop_documentation(uuid, text, jsonb) from public;
grant execute on function public.add_stop_documentation(uuid, text, jsonb) to authenticated;


-- 7. View — actor display label (id prefix only) -------------------------
-- Note: user_profiles in this codebase does NOT store full_name (only
-- phone/birth_date/license fields). actor_label falls back to the first
-- 8 chars of the user_id. A future migration can extend user_profiles
-- with display_name and re-introduce the JOIN.
create or replace view public.v_activity_log
  with (security_invoker = true)
as
select
  l.id,
  l.account_id,
  l.actor_user_id,
  substr(l.actor_user_id::text, 1, 8) as actor_label,
  l.action,
  l.target_kind,
  l.target_id,
  l.vehicle_id,
  l.route_id,
  l.note,
  l.attachment_ref,
  l.payload,
  l.created_at
from public.workspace_audit_log l;

grant select on public.v_activity_log to authenticated;

notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (manual)
--
--   drop view if exists public.v_activity_log;
--   drop trigger if exists prevent_audit_log_update on public.workspace_audit_log;
--   drop function if exists public.prevent_audit_log_update();
--   drop policy if exists "activity_log_select" on public.workspace_audit_log;
--   create policy "audit_select_managers_only" ...    -- restore Phase 4 policy
--   drop function if exists public.log_activity(uuid,text,text,uuid,uuid,uuid,text,text,jsonb);
--   alter table public.workspace_audit_log drop column if exists route_id;
--   alter table public.workspace_audit_log drop column if exists vehicle_id;
--   alter table public.workspace_audit_log drop column if exists attachment_ref;
--   alter table public.workspace_audit_log drop column if exists note;
--   -- Restore previous RPC bodies by re-running supabase-phase4 + phase6 .sql.
--
-- Existing log rows survive rollback — only the new columns + UI features
-- are lost. No data deleted.
-- ==========================================================================
