-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-write-rpc.sql — open RPC-gated writes for view-as
--
-- Two RPC-based write paths reject the admin (not a member). We add
-- `OR public.is_viewing(account_id)` to their authorization so they work during
-- an active, audited view session — and only then (is_viewing is false for
-- non-admins → zero impact on regular users).
--
--   A. is_workspace_manager()  → unlocks EXPENSES + ROUTES + DRIVER ASSIGNMENTS
--      (every RPC that authorizes via this helper) in one change.
--   B. save_repair_with_children() → unlocks REPAIRS (inline membership check).
--
-- Bodies below are the LIVE definitions (via pg_get_functiondef) with ONLY the
-- authorization check changed — nothing else touched.
--
-- DEPENDS ON: public.is_viewing(uuid). Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── A. is_workspace_manager — manager OR active view session ─────────────────
create or replace function public.is_workspace_manager(p_account_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.account_members
     where account_id = p_account_id
       and user_id    = auth.uid()
       and status     = 'פעיל'
       and role       in ('בעלים', 'מנהל')
  ) or public.is_viewing(p_account_id);
$$;


-- ── B. save_repair_with_children — membership OR active view session ──────────
create or replace function public.save_repair_with_children(
  p_repair_log jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_accident jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  if uid is null then raise exception 'not_authenticated'; end if;
  if v_vehicle_id is null or v_account_id is null then
    raise exception 'missing_vehicle_or_account';
  end if;
  -- CHANGED: allow an admin inside an active view session for this account.
  if not exists (
    select 1 from public.account_members
    where account_id = v_account_id and user_id = uid and status = 'פעיל'
  ) and not public.is_viewing(v_account_id) then
    raise exception 'not_a_member_of_account';
  end if;

  if v_is_update then
    v_repair_id := (p_repair_log->>'id')::uuid;
    update public.repair_logs set
      repair_type_id = nullif(p_repair_log->>'repair_type_id','')::uuid,
      title          = p_repair_log->>'title',
      occurred_at    = (p_repair_log->>'occurred_at')::date,
      repaired_at    = nullif(p_repair_log->>'repaired_at','')::date,
      description    = p_repair_log->>'description',
      repaired_by    = coalesce(p_repair_log->>'repaired_by','אני'),
      garage_name    = p_repair_log->>'garage_name',
      cost           = nullif(p_repair_log->>'cost','')::numeric,
      is_accident    = coalesce((p_repair_log->>'is_accident')::boolean, false),
      accident_id    = nullif(p_repair_log->>'accident_id','')::uuid
    where id = v_repair_id and account_id = v_account_id;
    if not found then raise exception 'repair_log_not_found_or_wrong_account'; end if;
  else
    insert into public.repair_logs (
      vehicle_id, account_id, repair_type_id, title, occurred_at, repaired_at,
      description, repaired_by, garage_name, cost, is_accident, accident_id,
      created_by_user_id
    ) values (
      v_vehicle_id, v_account_id,
      nullif(p_repair_log->>'repair_type_id','')::uuid,
      p_repair_log->>'title',
      (p_repair_log->>'occurred_at')::date,
      nullif(p_repair_log->>'repaired_at','')::date,
      p_repair_log->>'description',
      coalesce(p_repair_log->>'repaired_by','אני'),
      p_repair_log->>'garage_name',
      nullif(p_repair_log->>'cost','')::numeric,
      coalesce((p_repair_log->>'is_accident')::boolean, false),
      nullif(p_repair_log->>'accident_id','')::uuid,
      uid
    ) returning id into v_repair_id;
  end if;

  if v_is_update then
    select array_agg(id) into v_existing_att_ids
    from public.repair_attachments where repair_log_id = v_repair_id;
    select coalesce(array_agg((a->>'id')::uuid), array[]::uuid[])
      into v_kept_att_ids
      from jsonb_array_elements(p_attachments) a where a->>'id' is not null;
    if v_existing_att_ids is not null then
      delete from public.repair_attachments
        where repair_log_id = v_repair_id and not (id = any(v_kept_att_ids));
    end if;
  end if;

  for v_att in select * from jsonb_array_elements(p_attachments) loop
    if v_att->>'id' is null then
      insert into public.repair_attachments (repair_log_id, file_url, file_type, storage_path)
      values (v_repair_id, v_att->>'file_url', v_att->>'file_type', v_att->>'storage_path');
    end if;
  end loop;

  if coalesce((p_repair_log->>'is_accident')::boolean, false) and p_accident is not null then
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
    delete from public.accident_details where repair_log_id = v_repair_id;
  end if;

  return jsonb_build_object('ok', true, 'repair_log_id', v_repair_id, 'was_update', v_is_update);
end $$;
