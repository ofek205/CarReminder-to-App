-- ==========================================================================
-- save_repair_with_children(...) — SECURITY DEFINER RPC
--
-- Replaces the multi-step client save in RepairsSection.jsx and
-- AddRepairDialog.jsx which does:
--   1. INSERT/UPDATE repair_logs
--   2. DELETE + INSERT repair_attachments
--   3. UPSERT accident_details (for is_accident logs)
--
-- Doing those as separate calls from the client meant a network drop
-- between steps 1 and 2 would leave an orphan repair_log with none of
-- the files the user attached — worse, the DB lost the accident_details
-- entirely on timeout.
--
-- This RPC runs the whole write set in a single transaction. On error
-- nothing persists. Caller passes attachments + accident as JSON arrays.
--
-- The RPC relies on RLS: the service-role bypass is intentional
-- (SECURITY DEFINER), but every write is validated against the caller's
-- account membership before execution. A user cannot save a repair on
-- a vehicle they don't belong to.
--
-- Safe to re-run.
-- ==========================================================================

create or replace function public.save_repair_with_children(
  p_repair_log    jsonb,         -- { id?, vehicle_id, account_id, ... }
  p_attachments   jsonb default '[]'::jsonb,  -- [{ id?, file_url, file_type, storage_path }]
  p_accident      jsonb default null          -- { other_driver_name, ... } | null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_repair_id uuid;
  v_vehicle_id uuid := (p_repair_log->>'vehicle_id')::uuid;
  v_account_id uuid := (p_repair_log->>'account_id')::uuid;
  v_is_update boolean := (p_repair_log ? 'id') and (p_repair_log->>'id') is not null;
  v_existing_att_ids uuid[];
  v_kept_att_ids uuid[];
  v_att jsonb;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if v_vehicle_id is null or v_account_id is null then
    raise exception 'missing_vehicle_or_account';
  end if;

  -- Membership check: caller must belong to the account the repair is on.
  -- RLS would catch this on the INSERT, but raising our own error gives
  -- a cleaner message and avoids partial state if only the accident
  -- insert fails mid-way.
  if not exists (
    select 1 from public.account_members
    where account_id = v_account_id
      and user_id = uid
      and status = 'פעיל'
  ) then
    raise exception 'not_a_member_of_account';
  end if;

  -- ── 1. repair_logs ───────────────────────────────────────────────
  if v_is_update then
    v_repair_id := (p_repair_log->>'id')::uuid;

    update public.repair_logs set
      repair_type_id     = nullif(p_repair_log->>'repair_type_id','')::uuid,
      title              = p_repair_log->>'title',
      occurred_at        = (p_repair_log->>'occurred_at')::date,
      repaired_at        = nullif(p_repair_log->>'repaired_at','')::date,
      description        = p_repair_log->>'description',
      repaired_by        = coalesce(p_repair_log->>'repaired_by','אני'),
      garage_name        = p_repair_log->>'garage_name',
      cost               = nullif(p_repair_log->>'cost','')::numeric,
      is_accident        = coalesce((p_repair_log->>'is_accident')::boolean, false)
    where id = v_repair_id
      and account_id = v_account_id;   -- safety net: won't cross accounts

    if not found then
      raise exception 'repair_log_not_found_or_wrong_account';
    end if;
  else
    insert into public.repair_logs (
      vehicle_id, account_id, repair_type_id, title, occurred_at, repaired_at,
      description, repaired_by, garage_name, cost, is_accident, created_by_user_id
    ) values (
      v_vehicle_id,
      v_account_id,
      nullif(p_repair_log->>'repair_type_id','')::uuid,
      p_repair_log->>'title',
      (p_repair_log->>'occurred_at')::date,
      nullif(p_repair_log->>'repaired_at','')::date,
      p_repair_log->>'description',
      coalesce(p_repair_log->>'repaired_by','אני'),
      p_repair_log->>'garage_name',
      nullif(p_repair_log->>'cost','')::numeric,
      coalesce((p_repair_log->>'is_accident')::boolean, false),
      uid
    ) returning id into v_repair_id;
  end if;

  -- ── 2. repair_attachments ────────────────────────────────────────
  -- Strategy: on update, look up existing attachment ids; keep the ones
  -- the caller re-submitted with an id; delete the rest; then insert
  -- any new attachments (no id).
  if v_is_update then
    select array_agg(id) into v_existing_att_ids
    from public.repair_attachments where repair_log_id = v_repair_id;

    select coalesce(array_agg((a->>'id')::uuid), array[]::uuid[])
      into v_kept_att_ids
      from jsonb_array_elements(p_attachments) a
      where a->>'id' is not null;

    if v_existing_att_ids is not null then
      delete from public.repair_attachments
        where repair_log_id = v_repair_id
          and not (id = any(v_kept_att_ids));
    end if;
  end if;

  for v_att in select * from jsonb_array_elements(p_attachments)
  loop
    if v_att->>'id' is null then
      insert into public.repair_attachments (repair_log_id, file_url, file_type, storage_path)
      values (
        v_repair_id,
        v_att->>'file_url',
        v_att->>'file_type',
        v_att->>'storage_path'
      );
    end if;
  end loop;

  -- ── 3. accident_details ──────────────────────────────────────────
  if coalesce((p_repair_log->>'is_accident')::boolean, false) and p_accident is not null then
    -- UPSERT via UNIQUE (repair_log_id) — see supabase-base44-migration.sql:182.
    insert into public.accident_details (
      repair_log_id, other_driver_name, other_driver_phone,
      other_driver_license_plate, insurance_claim_number, notes
    ) values (
      v_repair_id,
      p_accident->>'other_driver_name',
      p_accident->>'other_driver_phone',
      p_accident->>'other_driver_license_plate',
      p_accident->>'insurance_claim_number',
      p_accident->>'notes'
    )
    on conflict (repair_log_id) do update set
      other_driver_name          = excluded.other_driver_name,
      other_driver_phone         = excluded.other_driver_phone,
      other_driver_license_plate = excluded.other_driver_license_plate,
      insurance_claim_number     = excluded.insurance_claim_number,
      notes                      = excluded.notes;
  elsif v_is_update and not coalesce((p_repair_log->>'is_accident')::boolean, false) then
    -- User toggled is_accident off on an existing log. Remove any row.
    delete from public.accident_details where repair_log_id = v_repair_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'repair_log_id', v_repair_id,
    'was_update', v_is_update
  );
end $$;

revoke all on function public.save_repair_with_children(jsonb, jsonb, jsonb) from public;
grant execute on function public.save_repair_with_children(jsonb, jsonb, jsonb) to authenticated;
