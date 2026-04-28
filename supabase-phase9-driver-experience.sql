-- ==========================================================================
-- Phase 9, Step 9 — Driver experience RPCs
--   1. add_workspace_member_by_email — manager adds an existing user
--      to the workspace (driver, viewer, manager).
--   2. driver_update_mileage — driver updates current_km on assigned vehicle.
--   3. driver_log_vehicle_event — driver reports an issue or logs
--      maintenance done outside a route context.
--
-- All three are SECURITY DEFINER and validate authorization on every call.
-- ==========================================================================

create or replace function public.add_workspace_member_by_email(
  p_account_id uuid,
  p_email      text,
  p_role       text default 'driver'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_user_id uuid;
  member_id uuid;
  clean_email text;
  existing_status text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_manager(p_account_id) then
    raise exception 'forbidden_not_manager';
  end if;
  if p_role not in ('בעלים','מנהל','שותף','driver') then
    raise exception 'invalid_role';
  end if;

  clean_email := lower(trim(coalesce(p_email, '')));
  if clean_email = '' then raise exception 'email_required'; end if;

  select id into target_user_id
    from auth.users
    where lower(email) = clean_email;
  if target_user_id is null then
    raise exception 'user_not_registered';
  end if;

  select status into existing_status
    from public.account_members
    where account_id = p_account_id
      and user_id    = target_user_id
    limit 1;

  if existing_status = 'פעיל' then
    -- Active member with possibly a different role: allow the manager
    -- to "re-add" with a new role and treat it as a role change rather
    -- than a hard error. The previous "already_member" raise blocked
    -- the only path a manager had to fix a wrong role (we have no
    -- separate change-role RPC yet).
    update public.account_members
       set role = p_role
     where account_id = p_account_id
       and user_id    = target_user_id
    returning id into member_id;
  elsif existing_status is not null then
    update public.account_members
       set role      = p_role,
           status    = 'פעיל',
           joined_at = now()
     where account_id = p_account_id
       and user_id    = target_user_id
    returning id into member_id;
  else
    insert into public.account_members
      (account_id, user_id, role, status, joined_at)
    values
      (p_account_id, target_user_id, p_role, 'פעיל', now())
    returning id into member_id;
  end if;

  perform public.log_activity(
    p_account_id, 'member.add',
    'account_member', member_id,
    null, null, null, null,
    jsonb_build_object(
      'user_id', target_user_id,
      'email',   clean_email,
      'role',    p_role
    )
  );

  -- Notify the added/updated user. Without this the new member has no
  -- in-app signal that anything happened — the workspace switcher just
  -- silently grows a new entry the next time they open the app, and a
  -- driver in particular has no idea they're expected to be one.
  declare
    v_account_name text;
    v_role_label   text;
  begin
    select coalesce(name, 'חשבון עסקי') into v_account_name
      from public.accounts
     where id = p_account_id;

    v_role_label := case p_role
      when 'driver'  then 'נהג'
      when 'מנהל'    then 'מנהל'
      when 'שותף'    then 'צופה'
      when 'בעלים'   then 'בעלים'
      else p_role
    end;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      target_user_id,
      'workspace_member_added',
      'הוספת לחשבון עסקי',
      format('הצטרפת לחשבון "%s" בתפקיד %s', v_account_name, v_role_label),
      jsonb_build_object(
        'account_id',   p_account_id,
        'account_name', v_account_name,
        'role',         p_role
      )
    );
  end;

  return member_id;
end;
$$;

revoke all  on function public.add_workspace_member_by_email(uuid, text, text) from public;
grant execute on function public.add_workspace_member_by_email(uuid, text, text) to authenticated;


create or replace function public.driver_update_mileage(
  p_vehicle_id uuid,
  p_new_km     numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_current_km numeric;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_new_km is null or p_new_km < 0 then raise exception 'invalid_km'; end if;

  select account_id, current_km
    into v_account_id, v_current_km
    from public.vehicles
   where id = p_vehicle_id;
  if v_account_id is null then raise exception 'vehicle_not_found'; end if;

  if not (
    public.is_workspace_manager(v_account_id)
    or public.is_assigned_driver_for_vehicle(p_vehicle_id)
  ) then raise exception 'forbidden'; end if;

  if v_current_km is not null and p_new_km < v_current_km then
    raise exception 'km_cannot_decrease';
  end if;

  update public.vehicles
     set current_km = p_new_km,
         updated_at = now()
   where id = p_vehicle_id;

  perform public.log_activity(
    v_account_id, 'vehicle.mileage_update',
    'vehicle', p_vehicle_id,
    p_vehicle_id, null, null, null,
    jsonb_build_object('old_km', v_current_km, 'new_km', p_new_km)
  );
end;
$$;

revoke all  on function public.driver_update_mileage(uuid, numeric) from public;
grant execute on function public.driver_update_mileage(uuid, numeric) to authenticated;


create or replace function public.driver_log_vehicle_event(
  p_vehicle_id  uuid,
  p_kind        text,
  p_title       text,
  p_description text    default null,
  p_cost        numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  clean_title text;
  new_id uuid;
  v_repaired_at date;
  v_repaired_by text;
  v_action text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_kind not in ('report_issue', 'maintenance_done') then
    raise exception 'invalid_kind';
  end if;

  clean_title := nullif(trim(coalesce(p_title, '')), '');
  if clean_title is null then raise exception 'title_required'; end if;

  select account_id into v_account_id
    from public.vehicles
   where id = p_vehicle_id;
  if v_account_id is null then raise exception 'vehicle_not_found'; end if;

  if not (
    public.is_workspace_manager(v_account_id)
    or public.is_assigned_driver_for_vehicle(p_vehicle_id)
  ) then raise exception 'forbidden'; end if;

  if p_kind = 'maintenance_done' then
    v_repaired_at := current_date;
    v_repaired_by := 'אני';
    v_action      := 'vehicle.maintenance_logged';
  else
    v_repaired_at := null;
    v_repaired_by := 'דורש טיפול';
    v_action      := 'vehicle.issue_reported';
  end if;

  insert into public.repair_logs
    (vehicle_id, account_id, title, description,
     occurred_at, repaired_at, repaired_by, cost, created_by_user_id)
  values
    (p_vehicle_id, v_account_id, clean_title, p_description,
     current_date, v_repaired_at, v_repaired_by, p_cost, uid)
  returning id into new_id;

  perform public.log_activity(
    v_account_id, v_action,
    'repair_log', new_id,
    p_vehicle_id, null, p_description, null,
    jsonb_build_object('title', clean_title, 'cost', p_cost)
  );

  return new_id;
end;
$$;

revoke all  on function public.driver_log_vehicle_event(uuid, text, text, text, numeric) from public;
grant execute on function public.driver_log_vehicle_event(uuid, text, text, text, numeric) to authenticated;

notify pgrst, 'reload schema';
