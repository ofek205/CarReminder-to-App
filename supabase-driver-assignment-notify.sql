-- ==========================================================================
-- assign_driver: notify the driver when a manager assigns them a vehicle.
--
-- The original RPC (Phase 6) wrote a workspace_audit_log entry but did
-- not surface anything to the driver. The driver only discovered the
-- assignment by manually opening MyVehicles or refreshing — not great
-- when the manager expects them to head to the new vehicle within
-- minutes.
--
-- This patch re-defines assign_driver to:
--   * keep all existing logic (manager check, workspace check, upsert,
--     audit log)
--   * additionally INSERT an app_notifications row for the driver with
--     type='driver_assigned', body naming the vehicle and assignment
--     window. The driver's bell renders it via appNotificationConfig.
--
-- Idempotent. Safe to re-run.
-- ==========================================================================

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
  v_account_name  text;
  v_vehicle_label text;
  v_actor_label   text;
  v_kind          text;
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

  -- Driver-facing notification. Pulls human-readable labels so the
  -- bell row reads naturally instead of dumping ids.
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

  v_kind := case when p_valid_to is null then 'קבוע' else 'זמני' end;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    p_driver_user_id,
    'driver_assigned',
    'שויך לך רכב חדש',
    coalesce(v_actor_label, 'מנהל') || ' שייך אותך לרכב "' || v_vehicle_label || '" בחשבון "' ||
      v_account_name || '" (' || v_kind || ')',
    jsonb_build_object(
      'account_id',    p_account_id,
      'account_name',  v_account_name,
      'vehicle_id',    p_vehicle_id,
      'vehicle_label', v_vehicle_label,
      'assignment_id', new_id,
      'kind',          v_kind,
      'valid_from',    p_valid_from,
      'valid_to',      p_valid_to
    )
  );

  return new_id;
end;
$$;

revoke all on function public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function public.assign_driver(uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
