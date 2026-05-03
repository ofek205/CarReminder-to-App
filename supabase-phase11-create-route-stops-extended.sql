-- ============================================================================
-- Phase 11 — Extend create_route_with_stops to populate the new route_stops
--            columns introduced in phase 10 (coordinates, stop_type, planned
--            time, contacts, role-specific notes).
--
-- Backwards-compatible by design:
--   • Function signature is unchanged — same 7 args, same return type.
--   • All new fields are read from p_stops jsonb with `nullif` / safe casts.
--     A caller that still passes only {title, address_text, notes} keeps
--     working exactly as before.
--   • The legacy `notes` column on route_stops is populated from
--     `driver_notes` first (new shape), falling back to `notes` (old shape).
--     This keeps RouteDetail.jsx — which still reads `route_stops.notes`
--     to render to the driver — fully backwards compatible.
--   • Existing stops in production are untouched.
--   • The `log_activity('route.create', ...)` call introduced in phase 7
--     is preserved 1:1 (same payload shape) so the Activity Log page and
--     reports continue working without any UI change.
--
-- Stop-level keys understood (all optional):
--   title           — string. Default: "תחנה <seq>".
--   address_text    — string.
--   notes           — string (legacy; mapped into legacy `notes` column).
--   driver_notes    — string (preferred; mapped into both `driver_notes`
--                              AND legacy `notes` for compat).
--   manager_notes   — string.
--   stop_type       — one of: pickup, delivery, meeting, inspection,
--                     vehicle_service, other  (CHECK enforced in phase 10).
--   latitude        — number, -90..90.
--   longitude       — number, -180..180.
--   planned_time    — ISO timestamptz string.
--   contact_name    — string.
--   contact_phone   — string.
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
  stop record;
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
    for stop in
      select * from jsonb_array_elements(p_stops) as elem
    loop
      seq := seq + 1;

      -- Coerce optional fields safely. Empty strings → null so the
      -- CHECK constraints from phase 10 don't reject the row.
      v_stop_type := nullif(stop.elem->>'stop_type', '');

      v_lat := case
        when stop.elem ? 'latitude'
             and stop.elem->>'latitude' is not null
             and stop.elem->>'latitude' <> ''
          then (stop.elem->>'latitude')::double precision
        else null
      end;

      v_lon := case
        when stop.elem ? 'longitude'
             and stop.elem->>'longitude' is not null
             and stop.elem->>'longitude' <> ''
          then (stop.elem->>'longitude')::double precision
        else null
      end;

      v_planned_time := case
        when stop.elem ? 'planned_time'
             and stop.elem->>'planned_time' is not null
             and stop.elem->>'planned_time' <> ''
          then (stop.elem->>'planned_time')::timestamptz
        else null
      end;

      v_driver_notes := nullif(stop.elem->>'driver_notes', '');

      -- Legacy `notes` column kept populated for backwards-compat with
      -- read paths that haven't been migrated yet. Prefer the new
      -- driver_notes value; fall back to the legacy `notes` key when
      -- callers still send the old shape.
      v_legacy_notes := coalesce(v_driver_notes,
                                 nullif(stop.elem->>'notes', ''));

      insert into public.route_stops (
        route_id, account_id, sequence,
        title, address_text, notes, status,
        -- new optional fields from phase 10:
        stop_type, latitude, longitude, planned_time,
        contact_name, contact_phone,
        driver_notes, manager_notes
      )
      values (
        new_id,
        p_account_id,
        seq,
        coalesce(nullif(trim(stop.elem->>'title'), ''), 'תחנה ' || seq),
        nullif(stop.elem->>'address_text', ''),
        v_legacy_notes,
        'pending',
        v_stop_type,
        v_lat,
        v_lon,
        v_planned_time,
        nullif(stop.elem->>'contact_name', ''),
        nullif(stop.elem->>'contact_phone', ''),
        v_driver_notes,
        nullif(stop.elem->>'manager_notes', '')
      );
    end loop;
  end if;

  -- Activity log call preserved 1:1 from phase 7 — same action code,
  -- same target shape, same payload keys (title / driver_user_id /
  -- scheduled_for / stop_count). Adding new stop fields would change
  -- the contract for downstream readers, so they stay out of the log.
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

-- Function signature is unchanged, so the existing grant from phase 7 still
-- applies. Re-stating here is idempotent and protects against any prior
-- privilege drift.
revoke all on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) from public;
grant execute on function public.create_route_with_stops(uuid, uuid, uuid, text, text, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
