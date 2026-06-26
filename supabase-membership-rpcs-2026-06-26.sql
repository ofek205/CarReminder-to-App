-- ==========================================================================
-- Wave 2 — Membership RPC layer for personal/business separation
--
-- Spec:  docs/spec-business-personal-membership-separation.md
-- Plan:  docs/plan-business-personal-membership-separation.md   (T2.1–T2.6)
--
-- ADDITIVE + BACKWARD-COMPATIBLE. Adds SECURITY DEFINER RPCs that become the
-- ONLY sanctioned write path for account_members, and fixes the invite RPC to
-- take an explicit account_id. RLS is NOT tightened here — that is Wave 3, and
-- only after this layer + the new client are live in prod (shared DB).
--
-- New RPCs:
--   1. transfer_ownership(account_id, new_owner_user_id)
--   2. remove_member(account_id, member_user_id)        — cancels driver_assignments
--   3. change_member_role(account_id, member_user_id, new_role)
--   4. leave_account(account_id)
--   5. cancel_pending_invite(member_id)
-- Modified:
--   6. invite_account_member_by_email — +p_account_id, allow 'driver', no LIMIT 1
--
-- Idempotent. Run in Supabase Dashboard → SQL Editor.
-- Status vocabulary: 'פעיל' active · 'ממתין' pending · 'הוסר' removed.
-- ==========================================================================


-- ── 1. transfer_ownership ─────────────────────────────────────────────────
-- Owner-only. Atomic, FOR UPDATE. New owner must be an ACTIVE member. Enforces
-- exactly one owner: heir → 'בעלים', everyone else (incl. previous owner) who
-- was 'בעלים' → 'מנהל'. accounts.owner_user_id is the source of truth.
create or replace function public.transfer_ownership(
  p_account_id        uuid,
  p_new_owner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_current_owner uuid;
  v_account_name  text;
  v_heir_status   text;
  v_actor_name    text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Lock the account; owner_user_id is the source of truth.
  select owner_user_id, name into v_current_owner, v_account_name
    from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_current_owner <> uid then
    raise exception 'not_authorized';
  end if;
  if p_new_owner_user_id = uid then
    raise exception 'cannot_transfer_to_self';
  end if;

  -- Heir must be an active member (lock the row to avoid a race with
  -- decline/remove happening concurrently).
  select status into v_heir_status
    from public.account_members
   where account_id = p_account_id and user_id = p_new_owner_user_id
   for update;
  if not found or v_heir_status <> 'פעיל' then
    raise exception 'heir_not_active_member';
  end if;

  -- Flip ownership. owner_user_id first (source of truth), then sync roles:
  -- demote any current 'בעלים' rows (handles drift), promote heir.
  update public.accounts set owner_user_id = p_new_owner_user_id
   where id = p_account_id;

  update public.account_members
     set role = 'מנהל'
   where account_id = p_account_id
     and role = 'בעלים'
     and user_id <> p_new_owner_user_id;

  update public.account_members
     set role = 'בעלים'
   where account_id = p_account_id
     and user_id = p_new_owner_user_id;

  -- Notify both parties.
  select coalesce(full_name, email, 'משתמש') into v_actor_name
    from public.user_profiles where user_id = uid limit 1;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    p_new_owner_user_id,
    'account_ownership_received',
    'הפכת לבעלים של החשבון',
    coalesce(v_actor_name, 'הבעלים הקודם') || ' העביר/ה אליך את הבעלות על "'
      || coalesce(v_account_name, 'החשבון') || '". כעת יש לך שליטה מלאה.',
    jsonb_build_object('account_id', p_account_id, 'previous_owner_id', uid)
  );

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    uid,
    'account_ownership_transferred',
    'העברת את הבעלות על החשבון',
    'הבעלות על "' || coalesce(v_account_name, 'החשבון')
      || '" הועברה. התפקיד שלך עודכן ל"מנהל".',
    jsonb_build_object('account_id', p_account_id, 'new_owner_id', p_new_owner_user_id)
  );

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'new_owner_id', p_new_owner_user_id
  );
end $$;

revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;


-- ── 2. remove_member ──────────────────────────────────────────────────────
-- Owner/manager removes an active member. Cancels their active
-- driver_assignments in the SAME transaction (ג9 — otherwise a removed driver
-- keeps getting reminder emails and can still act). Owner is protected; a
-- manager cannot remove another manager; cannot remove self (use leave_account).
create or replace function public.remove_member(
  p_account_id     uuid,
  p_member_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_caller_role text;
  v_owner_uid   uuid;
  v_target_role text;
  v_target_stat text;
  v_revoked int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_member_user_id = uid then
    raise exception 'use_leave_account';
  end if;

  select owner_user_id into v_owner_uid
    from public.accounts where id = p_account_id;
  if v_owner_uid is null then
    raise exception 'account_not_found';
  end if;

  -- Caller must be owner/manager of this account.
  select role into v_caller_role
    from public.account_members
   where account_id = p_account_id and user_id = uid and status = 'פעיל'
     and role in ('בעלים', 'מנהל');
  if v_caller_role is null then
    raise exception 'not_authorized';
  end if;

  -- Target row (lock).
  select role, status into v_target_role, v_target_stat
    from public.account_members
   where account_id = p_account_id and user_id = p_member_user_id
   for update;
  if not found then
    raise exception 'member_not_found';
  end if;

  -- Protections.
  if p_member_user_id = v_owner_uid or v_target_role = 'בעלים' then
    raise exception 'cannot_remove_owner';
  end if;
  if v_caller_role = 'מנהל' and v_target_role = 'מנהל' then
    raise exception 'not_authorized';  -- only the owner manages managers
  end if;

  -- Mark removed (keeps the row for audit; frees the active/pending uq index).
  update public.account_members
     set status = 'הוסר'
   where account_id = p_account_id and user_id = p_member_user_id;

  -- Cancel active driver assignments for this user in this account.
  with rev as (
    update public.driver_assignments
       set status = 'revoked', valid_to = now()
     where account_id = p_account_id
       and driver_user_id = p_member_user_id
       and status = 'active'
     returning 1
  )
  select count(*) into v_revoked from rev;

  -- Notify the removed user.
  insert into public.app_notifications (user_id, type, title, body, data)
  select p_member_user_id, 'account_member_removed', 'הוסרת מחשבון',
         'הוסרת מהחשבון "' || coalesce(a.name, 'חשבון') || '".',
         jsonb_build_object('account_id', p_account_id, 'removed_by', uid)
    from public.accounts a where a.id = p_account_id;

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'member_user_id', p_member_user_id,
    'assignments_revoked', v_revoked
  );
end $$;

revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;


-- ── 3. change_member_role ─────────────────────────────────────────────────
-- Owner/manager changes a member's role. Never sets/affects 'בעלים' (that is
-- transfer_ownership). A manager cannot touch managers (owner-only). Does NOT
-- touch driver_assignments — the driver layer is independent of the role layer.
create or replace function public.change_member_role(
  p_account_id     uuid,
  p_member_user_id uuid,
  p_new_role       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_caller_role text;
  v_owner_uid   uuid;
  v_target_role text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_new_role not in ('מנהל', 'שותף', 'driver') then
    raise exception 'invalid_role';  -- 'בעלים' only via transfer_ownership
  end if;

  select owner_user_id into v_owner_uid
    from public.accounts where id = p_account_id;
  if v_owner_uid is null then
    raise exception 'account_not_found';
  end if;

  select role into v_caller_role
    from public.account_members
   where account_id = p_account_id and user_id = uid and status = 'פעיל'
     and role in ('בעלים', 'מנהל');
  if v_caller_role is null then
    raise exception 'not_authorized';
  end if;

  select role into v_target_role
    from public.account_members
   where account_id = p_account_id and user_id = p_member_user_id and status = 'פעיל'
   for update;
  if not found then
    raise exception 'member_not_found';
  end if;

  if p_member_user_id = v_owner_uid or v_target_role = 'בעלים' then
    raise exception 'cannot_change_owner_role';
  end if;
  -- Only the owner may promote to / demote from manager.
  if v_caller_role = 'מנהל' and (v_target_role = 'מנהל' or p_new_role = 'מנהל') then
    raise exception 'not_authorized';
  end if;

  update public.account_members
     set role = p_new_role
   where account_id = p_account_id and user_id = p_member_user_id;

  insert into public.app_notifications (user_id, type, title, body, data)
  select p_member_user_id, 'account_role_changed', 'התפקיד שלך עודכן',
         'התפקיד שלך בחשבון "' || coalesce(a.name, 'חשבון') || '" עודכן.',
         jsonb_build_object('account_id', p_account_id, 'new_role', p_new_role, 'changed_by', uid)
    from public.accounts a where a.id = p_account_id;

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'member_user_id', p_member_user_id,
    'new_role', p_new_role
  );
end $$;

revoke all on function public.change_member_role(uuid, uuid, text) from public;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;


-- ── 4. leave_account ──────────────────────────────────────────────────────
-- A member leaves on their own. Owner cannot leave: with other members →
-- 'must_transfer_first'; sole member → 'owner_cannot_leave_use_delete'.
-- Cleans the leaver's active driver_assignments; notifies owners/managers.
create or replace function public.leave_account(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_owner_uid uuid;
  v_my_status text;
  v_others int;
  v_actor_name text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select owner_user_id into v_owner_uid
    from public.accounts where id = p_account_id;
  if v_owner_uid is null then
    raise exception 'account_not_found';
  end if;

  select status into v_my_status
    from public.account_members
   where account_id = p_account_id and user_id = uid
   for update;
  if not found or v_my_status <> 'פעיל' then
    raise exception 'not_a_member';
  end if;

  if uid = v_owner_uid then
    select count(*) into v_others
      from public.account_members
     where account_id = p_account_id and user_id <> uid and status = 'פעיל';
    if v_others > 0 then
      raise exception 'must_transfer_first';
    else
      raise exception 'owner_cannot_leave_use_delete';
    end if;
  end if;

  update public.account_members
     set status = 'הוסר'
   where account_id = p_account_id and user_id = uid;

  update public.driver_assignments
     set status = 'revoked', valid_to = now()
   where account_id = p_account_id and driver_user_id = uid and status = 'active';

  -- Notify owners/managers that someone left.
  select coalesce(full_name, email, 'משתמש') into v_actor_name
    from public.user_profiles where user_id = uid limit 1;

  insert into public.app_notifications (user_id, type, title, body, data)
  select m.user_id, 'workspace_member_left', 'חבר עזב את החשבון',
         coalesce(v_actor_name, 'משתמש') || ' עזב את החשבון "' || coalesce(a.name, 'חשבון') || '".',
         jsonb_build_object('account_id', p_account_id, 'left_user_id', uid)
    from public.account_members m
    join public.accounts a on a.id = m.account_id
   where m.account_id = p_account_id and m.user_id <> uid
     and m.status = 'פעיל' and m.role in ('בעלים', 'מנהל');

  return jsonb_build_object('ok', true, 'account_id', p_account_id);
end $$;

revoke all on function public.leave_account(uuid) from public;
grant execute on function public.leave_account(uuid) to authenticated;


-- ── 5. cancel_pending_invite ──────────────────────────────────────────────
-- Owner/manager cancels a still-pending (registered) invite. Deletes the
-- 'ממתין' row so the unique index frees up and the person can be re-invited.
create or replace function public.cancel_pending_invite(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_status text;
  v_caller_role text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select account_id, status into v_account_id, v_status
    from public.account_members where id = p_member_id for update;
  if not found then
    raise exception 'invite_not_found';
  end if;
  if v_status <> 'ממתין' then
    raise exception 'invite_not_pending';
  end if;

  select role into v_caller_role
    from public.account_members
   where account_id = v_account_id and user_id = uid and status = 'פעיל'
     and role in ('בעלים', 'מנהל');
  if v_caller_role is null then
    raise exception 'not_authorized';
  end if;

  delete from public.account_members where id = p_member_id;
  return true;
end $$;

revoke all on function public.cancel_pending_invite(uuid) from public;
grant execute on function public.cancel_pending_invite(uuid) to authenticated;


-- ── 6. invite_account_member_by_email — +p_account_id, allow 'driver' ───────
-- Drop the 3-arg version and recreate with a 4th defaulted param so the
-- CURRENTLY DEPLOYED client (3 named args) still resolves to this one function
-- (p_account_id defaults to NULL → deprecated LIMIT-1 fallback). The new client
-- passes p_account_id explicitly (ג11). Whitelist now includes 'driver' so the
-- Drivers surface can invite drivers through the same pending+accept flow.
drop function if exists public.invite_account_member_by_email(text, text, uuid[]);

create or replace function public.invite_account_member_by_email(
  p_email       text,
  p_role        text,
  p_vehicle_ids uuid[] default null,
  p_account_id  uuid   default null
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
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Role whitelist — never a בעלים via invite. 'driver' added for the Drivers surface.
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

  -- Resolve the target account.
  if p_account_id is not null then
    -- New client: explicit account (the active workspace). Authorise on it.
    select am.account_id, am.role into v_account_id, v_caller_role
      from public.account_members am
     where am.user_id = uid and am.account_id = p_account_id
       and am.status = 'פעיל' and am.role in ('בעלים', 'מנהל');
  else
    -- Deprecated fallback for the old client (no account_id). Deterministic
    -- order so it is at least stable; remove once the new client is everywhere.
    select am.account_id, am.role into v_account_id, v_caller_role
      from public.account_members am
     where am.user_id = uid and am.status = 'פעיל' and am.role in ('בעלים', 'מנהל')
     order by am.joined_at nulls last
     limit 1;
  end if;

  if v_account_id is null then
    raise exception 'not_authorized';
  end if;

  select coalesce(full_name, email, 'משתמש') into v_inviter_name
    from public.user_profiles where user_id = uid limit 1;
  if v_inviter_name is null then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
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
      account_id, user_id, role, status, joined_at, vehicle_ids, invited_by
    ) values (
      v_account_id, v_recipient_uid, p_role, 'ממתין', now(), p_vehicle_ids, uid
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
      'recipient_name', (select coalesce(full_name, email, 'משתמש')
                           from public.user_profiles where user_id = v_recipient_uid limit 1)
    );
  end if;

  -- PATH B: unregistered → invites row + token
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.invites (
    account_id, invited_by_user_id, role_to_assign,
    token, expires_at, max_uses, uses_count, status, vehicle_ids
  ) values (
    v_account_id, uid, p_role,
    v_token, now() + interval '7 days', 1, 0, 'פעיל', p_vehicle_ids
  )
  returning id into v_invite_id;

  return jsonb_build_object(
    'added_directly', false, 'pending', false, 'invite_token', v_token,
    'invite_id', v_invite_id, 'recipient_existing_user', false,
    'expires_at', now() + interval '7 days'
  );
end $$;

revoke all on function public.invite_account_member_by_email(text, text, uuid[], uuid) from public;
grant execute on function public.invite_account_member_by_email(text, text, uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
