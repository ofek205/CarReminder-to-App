-- ==========================================================================
-- create_route_with_stops — notify the assigned driver via app_notifications
--
-- The original RPC wrote a workspace_audit_log entry but didn't surface the
-- new task to the driver. The driver only discovered it via manual refresh
-- or by happening to be on /Routes when react-query re-polled.
--
-- This patch keeps every existing behaviour (manager check, vehicle check,
-- member check, atomic stop insert, audit log) and adds an
-- app_notifications row with type='task_assigned' for the driver, naming
-- the task title, the assigning manager, the vehicle, and the scheduled
-- date so the bell row reads naturally.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ==========================================================================

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
  v_account_name  text;
  v_vehicle_label text;
  v_actor_label   text;
  v_scheduled_str text;
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

  -- Driver-facing bell notification. Only fires when an actual driver
  -- was assigned at creation time (the manager can also create the task
  -- "ללא שיוך" and assign later — when that follow-up RPC lands it
  -- should send its own notification then).
  if p_assigned_driver_user_id is not null then
    select coalesce(name, 'חשבון עסקי') into v_account_name
      from public.accounts where id = p_account_id;

    select coalesce(
             nullif(nickname, ''),
             nullif(trim(coalesce(manufacturer, '') || ' ' || coalesce(model, '')), ''),
             license_plate,
             'רכב'
           )
      into v_vehicle_label
      from public.vehicles where id = p_vehicle_id;

    select coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1))
      into v_actor_label
      from auth.users u where u.id = uid;

    v_scheduled_str := case
      when p_scheduled_for is null then ''
      else ' לתאריך ' || to_char(p_scheduled_for, 'DD/MM/YYYY')
    end;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      p_assigned_driver_user_id,
      'task_assigned',
      'משימה חדשה שויכה אליך',
      coalesce(v_actor_label, 'מנהל') || ' שייך לך משימה: "' || clean_title ||
        '" עם הרכב "' || v_vehicle_label || '"' || v_scheduled_str,
      jsonb_build_object(
        'account_id',    p_account_id,
        'account_name',  v_account_name,
        'route_id',      new_id,
        'route_title',   clean_title,
        'vehicle_id',    p_vehicle_id,
        'vehicle_label', v_vehicle_label,
        'scheduled_for', p_scheduled_for
      )
    );
  end if;

  return new_id;
end;
$$;

revoke all on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
