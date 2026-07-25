-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-invite-actions-view-as-2026-07-24.sql
-- Let an admin accept/decline an account invite on the target's behalf while
-- an audited view session is active.
--
-- WHY
--   Both RPCs refuse unless auth.uid() IS the invitee:
--       IF v_row.user_id <> uid THEN RAISE EXCEPTION 'not_your_invite';
--   During view-as auth.uid() stays the ADMIN, so the accept/decline buttons
--   in the notification bell could never work. The client blocked them with a
--   toast rather than surfacing the server error.
--
-- TWO CORRECTNESS FIXES, NOT ONE
--   1. The gate now also accepts public.is_viewing_user(v_row.user_id) — the
--      audited, time-boxed primitive keyed on the TARGET USER. False for
--      non-admins and false with no active session, so nothing changes for
--      regular users.
--
--      It must be the invitee, not the account. The first version of this
--      file gated on is_viewing(v_row.account_id) and rejected every real
--      case: an invite to a BUSINESS account carries that business's
--      account_id, while the admin's session targets the invitee's own
--      account. Two different ids, so the check failed with not_your_invite
--      on exactly the invites it was written to allow. The question is "am I
--      impersonating the person this invite belongs to", and only
--      is_viewing_user asks it.
--
--   2. The notification sent to the inviter was built from uid, which under
--      view-as is the admin. The inviter would have been told "אופק אדלשטיין
--      הצטרף/ה לחשבון" when the person who actually joined is the invitee.
--      Both functions now resolve the name and the id from v_row.user_id.
--      Outside view-as uid = v_row.user_id, so this is a no-op there.
--
-- ATTRIBUTION
--   An acceptance is a consent decision. When an admin makes it for someone
--   else, admin_log records who did it, for whom, and on which account. The
--   payload marks by_admin so the row is distinguishable from a genuine
--   self-acceptance forever.
--
-- DEPENDS ON: public.is_viewing(uuid), public.admin_log(...). Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.accept_account_invite(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_row public.account_members%rowtype;
  v_acceptor_name text;
  v_inviter_id uuid;
  v_via_admin boolean := false;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
    from public.account_members
   where id = p_member_id
   for update;

  if not found then
    raise exception 'invite_not_found';
  end if;

  if v_row.user_id <> uid then
    if public.is_viewing_user(v_row.user_id) then
      v_via_admin := true;
    else
      raise exception 'not_your_invite';
    end if;
  end if;

  if v_row.status <> 'ממתין' then
    raise exception 'invite_not_pending';
  end if;

  update public.account_members
     set status = 'פעיל', joined_at = now()
   where id = p_member_id;

  -- Name resolved from the INVITEE, never from auth.uid() — under view-as
  -- those are different people and the inviter must hear about the invitee.
  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
    into v_acceptor_name from auth.users where id = v_row.user_id;

  v_inviter_id := v_row.invited_by;
  if v_inviter_id is not null then
    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_inviter_id,
      'account_invite_accepted',
      coalesce(v_acceptor_name, 'משתמש') || ' הצטרף/ה לחשבון',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את ההזמנה והצטרף/ה לחשבון כ' || v_row.role || '.',
      jsonb_build_object(
        'member_id',     p_member_id,
        'account_id',    v_row.account_id,
        'acceptor_id',   v_row.user_id,
        'acceptor_name', coalesce(v_acceptor_name, 'משתמש'),
        'role',          v_row.role,
        'by_admin',      v_via_admin
      )
    );
  end if;

  if v_via_admin then
    perform public.admin_log(
      'invite_accepted_for_user', 'account_member', p_member_id::text,
      jsonb_build_object(
        'account_id',  v_row.account_id,
        'invitee_id',  v_row.user_id,
        'role',        v_row.role
      )
    );
  end if;

  return jsonb_build_object(
    'member_id',  p_member_id,
    'account_id', v_row.account_id,
    'role',       v_row.role,
    'status',     'פעיל',
    'by_admin',   v_via_admin
  );
end $$;

revoke all on function public.accept_account_invite(uuid) from public;
grant execute on function public.accept_account_invite(uuid) to authenticated;


create or replace function public.decline_account_invite(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_row public.account_members%rowtype;
  v_decliner_name text;
  v_via_admin boolean := false;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
    from public.account_members
   where id = p_member_id
   for update;

  if not found then
    raise exception 'invite_not_found';
  end if;

  if v_row.user_id <> uid then
    if public.is_viewing_user(v_row.user_id) then
      v_via_admin := true;
    else
      raise exception 'not_your_invite';
    end if;
  end if;

  if v_row.status <> 'ממתין' then
    raise exception 'invite_not_pending';
  end if;

  -- Read the name BEFORE the delete; v_row is a snapshot but the join isn't.
  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
    into v_decliner_name from auth.users where id = v_row.user_id;

  delete from public.account_members where id = p_member_id;

  if v_row.invited_by is not null then
    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_row.invited_by,
      'account_invite_declined',
      coalesce(v_decliner_name, 'משתמש') || ' דחה את ההזמנה לחשבון',
      coalesce(v_decliner_name, 'משתמש') || ' דחה את ההזמנה להצטרף לחשבון.',
      jsonb_build_object(
        'member_id',     p_member_id,
        'account_id',    v_row.account_id,
        'decliner_id',   v_row.user_id,
        'decliner_name', coalesce(v_decliner_name, 'משתמש'),
        'by_admin',      v_via_admin
      )
    );
  end if;

  if v_via_admin then
    perform public.admin_log(
      'invite_declined_for_user', 'account_member', p_member_id::text,
      jsonb_build_object('account_id', v_row.account_id, 'invitee_id', v_row.user_id)
    );
  end if;

  return true;
end $$;

revoke all on function public.decline_account_invite(uuid) from public;
grant execute on function public.decline_account_invite(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- Verification
-- ═══════════════════════════════════════════════════════════════════════════
--   -- Both functions reference is_viewing now:
--   select proname,
--          pg_get_functiondef(oid) like '%is_viewing%' as has_view_as_gate
--     from pg_proc
--    where proname in ('accept_account_invite','decline_account_invite');
--
--   -- After accepting one on a user's behalf, the audit row exists:
--   select action, target_id, detail, created_at
--     from public.admin_audit_log
--    where action in ('invite_accepted_for_user','invite_declined_for_user')
--    order by created_at desc limit 5;
-- ═══════════════════════════════════════════════════════════════════════════
