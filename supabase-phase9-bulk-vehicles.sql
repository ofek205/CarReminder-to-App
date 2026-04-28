-- ==========================================================================
-- Phase 9, Step 11 — Bulk vehicle import
--
-- Manager-only RPC. Takes an array of vehicle objects (already enriched
-- on the client by vehicleLookup against MoT) and inserts them in a
-- single round trip. Uses the same column set as the manual AddVehicle
-- flow so downstream behavior is identical.
--
-- Returns: { added, added_count, skipped, skipped_count, errors,
--            error_count }.
-- ==========================================================================

create or replace function public.bulk_add_vehicles(
  p_account_id uuid,
  p_vehicles   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_record jsonb;
  v_plate text;
  v_existing_id uuid;
  added_count int := 0;
  skipped_count int := 0;
  error_count int := 0;
  added jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  errors jsonb := '[]'::jsonb;
  new_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_manager(p_account_id) then
    raise exception 'forbidden_not_manager';
  end if;
  if jsonb_typeof(p_vehicles) <> 'array' then
    raise exception 'invalid_input';
  end if;

  for v_record in select * from jsonb_array_elements(p_vehicles)
  loop
    v_plate := nullif(trim(coalesce(v_record->>'license_plate', '')), '');
    if v_plate is null then
      error_count := error_count + 1;
      errors := errors || jsonb_build_object('reason', 'no_plate');
      continue;
    end if;

    select id into v_existing_id
      from public.vehicles
      where account_id = p_account_id
        and license_plate = v_plate
      limit 1;

    if v_existing_id is not null then
      skipped_count := skipped_count + 1;
      skipped := skipped || jsonb_build_object('plate', v_plate, 'reason', 'duplicate');
      continue;
    end if;

    begin
      insert into public.vehicles (
        account_id, license_plate, vehicle_type, manufacturer, model, year,
        nickname, test_due_date, insurance_due_date, insurance_company,
        current_km, current_engine_hours, vehicle_photo, fuel_type, is_vintage,
        last_tire_change_date, km_since_tire_change, tires_changed_count,
        flag_country, marina, marina_abroad, engine_manufacturer,
        pyrotechnics_expiry_date, fire_extinguisher_expiry_date, fire_extinguishers,
        life_raft_expiry_date, last_shipyard_date, hours_since_shipyard,
        front_tire, rear_tire, engine_model, color, last_test_date,
        first_registration_date, ownership, model_code, trim_level, vin,
        pollution_group, vehicle_class, safety_rating, horsepower, engine_cc,
        drivetrain, total_weight, doors, seats, airbags, transmission,
        body_type, country_of_origin, co2, green_index, tow_capacity,
        offroad_equipment, offroad_usage_type, last_offroad_service_date,
        inspection_report_expiry_date
      ) values (
        p_account_id,
        v_plate,
        v_record->>'vehicle_type',
        v_record->>'manufacturer',
        v_record->>'model',
        nullif(v_record->>'year', '')::int,
        v_record->>'nickname',
        nullif(v_record->>'test_due_date', '')::date,
        nullif(v_record->>'insurance_due_date', '')::date,
        v_record->>'insurance_company',
        nullif(v_record->>'current_km', '')::numeric,
        nullif(v_record->>'current_engine_hours', '')::numeric,
        v_record->>'vehicle_photo',
        v_record->>'fuel_type',
        nullif(v_record->>'is_vintage', '')::boolean,
        nullif(v_record->>'last_tire_change_date', '')::date,
        nullif(v_record->>'km_since_tire_change', '')::numeric,
        nullif(v_record->>'tires_changed_count', '')::int,
        v_record->>'flag_country',
        v_record->>'marina',
        nullif(v_record->>'marina_abroad', '')::boolean,
        v_record->>'engine_manufacturer',
        nullif(v_record->>'pyrotechnics_expiry_date', '')::date,
        nullif(v_record->>'fire_extinguisher_expiry_date', '')::date,
        v_record->'fire_extinguishers',
        nullif(v_record->>'life_raft_expiry_date', '')::date,
        nullif(v_record->>'last_shipyard_date', '')::date,
        nullif(v_record->>'hours_since_shipyard', '')::numeric,
        v_record->>'front_tire',
        v_record->>'rear_tire',
        v_record->>'engine_model',
        v_record->>'color',
        nullif(v_record->>'last_test_date', '')::date,
        nullif(v_record->>'first_registration_date', '')::date,
        v_record->>'ownership',
        v_record->>'model_code',
        v_record->>'trim_level',
        v_record->>'vin',
        v_record->>'pollution_group',
        v_record->>'vehicle_class',
        v_record->>'safety_rating',
        nullif(v_record->>'horsepower', '')::int,
        nullif(v_record->>'engine_cc', '')::int,
        v_record->>'drivetrain',
        nullif(v_record->>'total_weight', '')::numeric,
        nullif(v_record->>'doors', '')::int,
        nullif(v_record->>'seats', '')::int,
        nullif(v_record->>'airbags', '')::int,
        v_record->>'transmission',
        v_record->>'body_type',
        v_record->>'country_of_origin',
        nullif(v_record->>'co2', '')::numeric,
        v_record->>'green_index',
        nullif(v_record->>'tow_capacity', '')::numeric,
        v_record->>'offroad_equipment',
        v_record->>'offroad_usage_type',
        nullif(v_record->>'last_offroad_service_date', '')::date,
        nullif(v_record->>'inspection_report_expiry_date', '')::date
      ) returning id into new_id;

      added_count := added_count + 1;
      added := added || jsonb_build_object('id', new_id, 'plate', v_plate);
    exception when others then
      error_count := error_count + 1;
      errors := errors || jsonb_build_object('plate', v_plate, 'reason', sqlerrm);
    end;
  end loop;

  if added_count > 0 then
    perform public.log_activity(
      p_account_id, 'vehicle.bulk_import',
      'workspace', p_account_id,
      null, null, null, null,
      jsonb_build_object(
        'added_count',   added_count,
        'skipped_count', skipped_count,
        'error_count',   error_count
      )
    );
  end if;

  return jsonb_build_object(
    'added',         added,
    'added_count',   added_count,
    'skipped',       skipped,
    'skipped_count', skipped_count,
    'errors',        errors,
    'error_count',   error_count
  );
end;
$$;

revoke all  on function public.bulk_add_vehicles(uuid, jsonb) from public;
grant execute on function public.bulk_add_vehicles(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
