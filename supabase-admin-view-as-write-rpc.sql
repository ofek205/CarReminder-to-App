-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-write-rpc.sql — open RPC-gated writes for view-as
--
-- Several RPC-based write paths reject the admin (not a member). We add
-- `OR public.is_viewing(account_id)` to their authorization so they work during
-- an active, audited view session — and only then (is_viewing is false for
-- non-admins → zero impact on regular users).
--
--   A. is_workspace_manager()  → unlocks EXPENSES + ROUTES + DRIVER ASSIGNMENTS
--      (every RPC that authorizes via this helper) in one change.
--   B. save_repair_with_children() → unlocks REPAIRS (inline membership check).
--   C. delete_vehicle_with_share_choice() → unlocks vehicle DELETE (owner check;
--      also suppresses the admin-named sharee notification during view-as).
--   D. invite_account_member_by_email() → unlocks team INVITES (owner/manager
--      check; presents the ACCOUNT, not the admin, as inviter to stay silent.
--      Also fixes a latent bug: names now read from auth.users, not the
--      non-existent user_profiles.full_name/email columns — affects ALL users).
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


-- ── C. delete_vehicle_with_share_choice — owner OR active view session ────────
-- Live def with two changes: (1) owner-check also passes for an admin in an
-- active view session; (2) the "owner deleted the vehicle" sharee notification
-- is SKIPPED during view-as (it would otherwise name the ADMIN to the customer's
-- sharees). Deletes are still audited by the view_edit trigger on vehicles.
create or replace function public.delete_vehicle_with_share_choice(p_vehicle_id uuid, p_mode text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_owner_name text;
  v_vehicle_label text;
  s record;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('both', 'self_leave') then raise exception 'invalid_mode'; end if;
  if p_mode = 'self_leave' then return public.leave_vehicle_share(p_vehicle_id); end if;

  select v.account_id into v_account_id from public.vehicles v where v.id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found'; end if;
  -- CHANGED: allow an admin inside an active view session for this account.
  if not exists (
       select 1 from public.account_members
        where account_id = v_account_id and user_id = uid and status = 'פעיל' and role = 'בעלים'
     ) and not public.is_viewing(v_account_id) then
    raise exception 'not_vehicle_owner';
  end if;

  -- Notify sharees the owner deleted the vehicle — but NOT during view-as
  -- (would name the admin to the customer's sharees).
  if not public.is_viewing(v_account_id) then
    begin
      select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_owner_name from auth.users where id = uid;
      select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = p_vehicle_id;
      for s in select shared_with_user_id, id from public.vehicle_shares
         where vehicle_id = p_vehicle_id and status = 'accepted' and shared_with_user_id is not null loop
        insert into public.app_notifications (user_id, type, title, body, data) values (
          s.shared_with_user_id, 'share_deleted',
          coalesce(v_owner_name, 'משתמש') || ' מחק/ה את הרכב',
          coalesce(v_owner_name, 'משתמש') || ' מחק/ה את ' || v_vehicle_label || ', והרכב הוסר מהרשימה שלך.',
          jsonb_build_object('share_id', s.id, 'vehicle_id', p_vehicle_id)
        );
      end loop;
    exception when others then null; end;
  end if;

  delete from public.vehicles where id = p_vehicle_id;
  return true;
end $$;


-- ── D. invite_account_member_by_email — owner/manager OR active view session ──
-- Live def (supabase-invite-name-2026-06-27.sql) with TWO changes:
--   (1) an admin inside an active view session for the account may invite on its
--       behalf (requires an explicit p_account_id — the dialog always sends it).
--   (2) the invitee notification names the ACCOUNT, never the admin, so support
--       access stays silent (the recipient must not learn an admin invited them).
-- The pending account_members.invited_by still records the admin's uid (audit).
-- NOTE: names come from auth.users — user_profiles has NO full_name/email columns.
create or replace function public.invite_account_member_by_email(
  p_email       text,
  p_role        text,
  p_vehicle_ids uuid[] default null,
  p_account_id  uuid   default null,
  p_name        text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid              uuid := auth.uid();
  v_account_id     uuid;
  v_caller_role    text;
  v_email_norm     text;
  v_recipient_uid  uuid;
  v_member_id      uuid;
  v_inviter_name   text;
  v_token          text;
  v_invite_id      uuid;
  v_name           text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  if p_role not in ('מנהל', 'שותף', 'driver') then
    raise exception 'invalid_role';
  end if;

  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'invalid_email';
  end if;
  v_email_norm := lower(trim(p_email));

  if exists (select 1 from auth.users where id = uid and lower(email) = v_email_norm) then
    raise exception 'cannot_invite_self';
  end if;

  if p_account_id is not null then
    select am.account_id, am.role into v_account_id, v_caller_role
      from public.account_members am
     where am.user_id = uid and am.account_id = p_account_id
       and am.status = 'פעיל' and am.role in ('בעלים', 'מנהל');
  else
    select am.account_id, am.role into v_account_id, v_caller_role
      from public.account_members am
     where am.user_id = uid and am.status = 'פעיל' and am.role in ('בעלים', 'מנהל')
     order by am.joined_at nulls last
     limit 1;
  end if;

  -- CHANGED (admin view-as): an admin inside an active, audited view session for
  -- this account may invite on the account's behalf. is_viewing() is fail-closed
  -- (false for every non-admin) → zero impact on regular users.
  if v_account_id is null and p_account_id is not null and public.is_viewing(p_account_id) then
    v_account_id  := p_account_id;
    v_caller_role := 'בעלים';
  end if;

  if v_account_id is null then
    raise exception 'not_authorized';
  end if;

  -- Inviter display name. NOTE: user_profiles has NO full_name/email columns
  -- (only phone/license) — names live in auth.users, like workspace_team_directory.
  -- CHANGED (admin view-as): present the ACCOUNT as inviter, never the admin —
  -- keeps support access silent in the invitee's notification.
  if public.is_viewing(v_account_id) then
    select coalesce(nullif(btrim(a.name), ''), 'החשבון') into v_inviter_name
      from public.accounts a where a.id = v_account_id;
  else
    select coalesce(nullif(raw_user_meta_data->>'full_name', ''), email, 'משתמש')
      into v_inviter_name from auth.users where id = uid;
  end if;

  select id into v_recipient_uid
    from auth.users where lower(email) = v_email_norm limit 1;

  -- PATH A: registered → pending row + notification
  if v_recipient_uid is not null then
    if exists (
      select 1 from public.account_members
       where account_id = v_account_id and user_id = v_recipient_uid
         and status in ('פעיל', 'ממתין')
    ) then
      raise exception 'already_member';
    end if;

    insert into public.account_members (
      account_id, user_id, role, status, joined_at, vehicle_ids, invited_by, invited_name
    ) values (
      v_account_id, v_recipient_uid, p_role, 'ממתין', now(), p_vehicle_ids, uid, v_name
    )
    returning id into v_member_id;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_recipient_uid,
      'account_invite_offered',
      coalesce(v_inviter_name, 'משתמש') || ' מזמין אותך להצטרף לחשבון',
      coalesce(v_inviter_name, 'משתמש') || ' מזמין אותך להצטרף לחשבון כ'
        || p_role || '. לחץ/י כדי לאשר או לדחות.',
      jsonb_build_object(
        'member_id', v_member_id, 'account_id', v_account_id, 'role', p_role,
        'inviter_id', uid, 'inviter_name', coalesce(v_inviter_name, 'משתמש')
      )
    );

    return jsonb_build_object(
      'added_directly', false, 'pending', true, 'member_id', v_member_id,
      'recipient_existing_user', true,
      'recipient_name', coalesce(
        v_name,
        (select coalesce(nullif(raw_user_meta_data->>'full_name', ''), email, 'משתמש')
           from auth.users where id = v_recipient_uid))
    );
  end if;

  -- PATH B: unregistered → invites row + token
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invites (
    account_id, invited_by_user_id, role_to_assign,
    token, expires_at, max_uses, uses_count, status, vehicle_ids, invited_name
  ) values (
    v_account_id, uid, p_role,
    v_token, now() + interval '7 days', 1, 0, 'פעיל', p_vehicle_ids, v_name
  )
  returning id into v_invite_id;

  return jsonb_build_object(
    'added_directly', false, 'pending', false, 'invite_token', v_token,
    'invite_id', v_invite_id, 'recipient_existing_user', false,
    'expires_at', now() + interval '7 days'
  );
end $$;

revoke all on function public.invite_account_member_by_email(text, text, uuid[], uuid, text) from public;
grant execute on function public.invite_account_member_by_email(text, text, uuid[], uuid, text) to authenticated;

notify pgrst, 'reload schema';
