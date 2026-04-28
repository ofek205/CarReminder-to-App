-- ==========================================================================
-- Phase 9, Step 11 — Bulk vehicle import
--
-- Manager-only RPC. Takes an array of vehicle objects (already enriched
-- on the client by vehicleLookup against MoT) and inserts them in a
-- single round trip.
--
-- Type coercion strategy: jsonb_populate_record(NULL::public.vehicles, …)
-- delegates per-column casting to PostgreSQL using the live row type
-- of the vehicles table. This avoids the schema-drift trap where the
-- RPC hardcodes a column as int but the schema has it as jsonb,
-- text[], boolean, etc. No manual ::int / ::date / ::boolean casts —
-- whatever the column type is, PostgreSQL handles it.
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
  v_clean  jsonb;
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

    -- Duplicate check inside this workspace.
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

    -- Clean: drop empty-string values + system columns the caller
    -- shouldn't override. Then force account_id and license_plate
    -- from validated parameters.
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into v_clean
      from jsonb_each(v_record)
      where value is not null
        and value <> '""'::jsonb
        and key not in ('id', 'created_at', 'updated_at', 'account_id', 'license_plate');

    v_clean := v_clean
      || jsonb_build_object('account_id',    p_account_id::text)
      || jsonb_build_object('license_plate', v_plate);

    begin
      -- Let PostgreSQL coerce types using the vehicles row type as
      -- the schema source of truth.
      insert into public.vehicles
      select (jsonb_populate_record(null::public.vehicles, v_clean)).*
      returning id into new_id;

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
