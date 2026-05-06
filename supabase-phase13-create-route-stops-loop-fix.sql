-- ============================================================================
-- Phase 13 — Hotfix for `create_route_with_stops`.
--
-- Phase 11 inherited the phase 6/7 loop pattern:
--     for stop in select * from jsonb_array_elements(p_stops) as elem loop
--       ... stop.elem->>'...'
--
-- On this Postgres deployment that pattern raises at runtime:
--     ERROR 42703: record "stop" has no field "elem"
-- (the implicit single-column from `jsonb_array_elements` is named
--  `value`, not `elem` — the `AS elem` is only a table alias).
--
-- Phase 13 rewrites the body using an index-based loop with
-- `jsonb_array_length` + `->`. No record fields, no column-name guessing,
-- no ambiguity. Identical semantics to phase 11 — same fields populated,
-- same backwards compat, same `log_activity('route.create')` call.
-- ============================================================================

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
  v_stop jsonb;
  i int;
  total int;
  seq int := 0;
  clean_title text;
  v_stop_type text;
  v_lat double precision;
  v_lon double precision;
  v_planned_time timestamptz;
  v_driver_notes text;
  v_legacy_notes text;
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
    total := jsonb_array_length(p_stops);
    for i in 0 .. total - 1 loop
      v_stop := p_stops -> i;
      seq := seq + 1;

      v_stop_type := nullif(v_stop->>'stop_type', '');

      v_lat := case
        when v_stop ? 'latitude'
             and v_stop->>'latitude' is not null
             and v_stop->>'latitude' <> ''
          then (v_stop->>'latitude')::double precision
        else null
      end;

      v_lon := case
        when v_stop ? 'longitude'
             and v_stop->>'longitude' is not null
             and v_stop->>'longitude' <> ''
          then (v_stop->>'longitude')::double precision
        else null
      end;

      v_planned_time := case
        when v_stop ? 'planned_time'
             and v_stop->>'planned_time' is not null
             and v_stop->>'planned_time' <> ''
          then (v_stop->>'planned_time')::timestamptz
        else null
      end;

      v_driver_notes := nullif(v_stop->>'driver_notes', '');

      -- Legacy `notes` column kept populated for backwards-compat with
      -- read paths that haven't been migrated yet.
      v_legacy_notes := coalesce(v_driver_notes,
                                 nullif(v_stop->>'notes', ''));

      insert into public.route_stops (
        route_id, account_id, sequence,
        title, address_text, notes, status,
        stop_type, latitude, longitude, planned_time,
        contact_name, contact_phone,
        driver_notes, manager_notes
      )
      values (
        new_id,
        p_account_id,
        seq,
        coalesce(nullif(trim(v_stop->>'title'), ''), 'תחנה ' || seq),
        nullif(v_stop->>'address_text', ''),
        v_legacy_notes,
        'pending',
        v_stop_type,
        v_lat,
        v_lon,
        v_planned_time,
        nullif(v_stop->>'contact_name', ''),
        nullif(v_stop->>'contact_phone', ''),
        v_driver_notes,
        nullif(v_stop->>'manager_notes', '')
      );
    end loop;
  end if;

  perform public.log_activity(
    p_account_id, 'route.create',
    'route', new_id,
    p_vehicle_id, new_id, null, null,
    jsonb_build_object('title',          clean_title,
                       'driver_user_id', p_assigned_driver_user_id,
                       'scheduled_for',  p_scheduled_for,
                       'stop_count',     seq)
  );

  return new_id;
end;
$$;

revoke all on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
