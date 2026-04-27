-- ==========================================================================
-- Vehicle share — role edit (editor ↔ viewer) without revoke + re-invite.
--
-- Adds:
--   • update_vehicle_share_role(p_share_id, p_role) RPC. Owner-only.
--     Updates the role on an active share and pushes an in-app
--     notification + bell ping to the recipient so they know their
--     access level changed.
--
-- Also patches:
--   • share_vehicle_with_email — return recipient_name in the JSON so
--     the dialog can confirm "ההזמנה נשלחה ל-<name>" instead of a
--     generic banner.
-- ==========================================================================

-- ── update_vehicle_share_role ─────────────────────────────────────────────
create or replace function public.update_vehicle_share_role(
  p_share_id uuid,
  p_role     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller         uuid := auth.uid();
  v_share          public.vehicle_shares%rowtype;
  v_vehicle_label  text;
  v_owner_name     text;
  v_old_role       text;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_role not in ('בעלים', 'מנהל', 'שותף') then
    raise exception 'invalid_role: must be בעלים / מנהל / שותף' using errcode = '22023';
  end if;

  -- Pull the share + verify ownership.
  select * into v_share
  from public.vehicle_shares
  where id = p_share_id;

  if not found then
    raise exception 'share_not_found' using errcode = 'P0002';
  end if;

  if v_share.owner_user_id <> v_caller then
    raise exception 'forbidden_not_owner' using errcode = '42501';
  end if;

  if v_share.status <> 'accepted' then
    raise exception 'share_not_active: role can only be changed on an accepted share' using errcode = '22023';
  end if;

  -- No-op if nothing changed.
  if v_share.role = p_role then
    return;
  end if;

  v_old_role := v_share.role;

  -- Apply.
  update public.vehicle_shares
     set role = p_role,
         updated_at = now()
   where id = p_share_id;

  -- Notify the recipient. Reuses the same app_notifications surface as
  -- share_offered / share_revoked so the bell + Notifications page light
  -- up immediately via the realtime hook.
  begin
    -- Build the notification body. Pulls vehicle label + owner display
    -- name with the same fallback ladder used elsewhere.
    select coalesce(v.nickname,
                    (v.manufacturer || ' ' || coalesce(v.model, ''))::text,
                    'הרכב')
      into v_vehicle_label
      from public.vehicles v
     where v.id = v_share.vehicle_id;

    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      into v_owner_name
      from auth.users
     where id = v_caller;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_share.shared_with_user_id,
      'share_role_changed',
      coalesce(v_owner_name, 'משתמש') || ' עדכן/ה את ההרשאה שלך',
      'ההרשאה שלך על ' || coalesce(v_vehicle_label, 'הרכב') || ' עודכנה ל' ||
        case p_role
          when 'מנהל' then 'שותף עורך (יכול לערוך)'
          when 'שותף' then 'שותף צופה (תצוגה בלבד)'
          else p_role
        end || '.',
      jsonb_build_object(
        'vehicle_id',  v_share.vehicle_id,
        'share_id',    p_share_id,
        'old_role',    v_old_role,
        'new_role',    p_role,
        'changed_by',  v_caller,
        'owner_name',  coalesce(v_owner_name, 'משתמש')
      )
    );
  exception when others then
    -- Notification is best-effort — the role update itself succeeded
    -- and shouldn't roll back on a notification failure (e.g. RLS
    -- policy hiccup).
    null;
  end;
end;
$$;

revoke all on function public.update_vehicle_share_role(uuid, text) from public;
grant execute on function public.update_vehicle_share_role(uuid, text) to authenticated;


-- ── share_vehicle_with_email — return recipient_name ──────────────────────
-- Same body as before, only the final return JSON gains a recipient_name
-- field so the dialog can show "ההזמנה נשלחה ל-<name>" on success when
-- the recipient is already a registered user.
create or replace function public.share_vehicle_with_email(
  p_vehicle_id uuid,
  p_email      text,
  p_role       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller          uuid := auth.uid();
  v_owner           uuid;
  v_account_id      uuid;
  v_recipient_uid   uuid;
  v_recipient_name  text;
  v_normalized      text := lower(trim(p_email));
  v_token           text;
  v_existing        public.vehicle_shares%rowtype;
  v_share_id        uuid;
  v_inviter_name    text;
  v_count_active    int;
begin
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_role not in ('מנהל', 'שותף') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_normalized is null or v_normalized = '' or position('@' in v_normalized) = 0 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  -- Lock vehicle scope: only the OWNER of the vehicle's account can share.
  select v.account_id, a.owner_user_id
    into v_account_id, v_owner
    from public.vehicles v
    join public.accounts a on a.id = v.account_id
   where v.id = p_vehicle_id;

  if v_owner is null then
    raise exception 'vehicle_not_found' using errcode = 'P0002';
  end if;
  if v_owner <> v_caller then
    raise exception 'forbidden_not_owner' using errcode = '42501';
  end if;

  -- Cap of 3 active shares per vehicle. pg_advisory lock makes this
  -- race-safe across concurrent invites.
  perform pg_advisory_xact_lock(hashtext(p_vehicle_id::text));

  select count(*) into v_count_active
    from public.vehicle_shares
   where vehicle_id = p_vehicle_id
     and status in ('pending','accepted');

  if v_count_active >= 3 then
    raise exception 'max_shares_per_vehicle' using errcode = '23505';
  end if;

  -- Self-share is meaningless and would cause access-cycle confusion.
  select id, coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
    into v_recipient_uid, v_recipient_name
    from auth.users
   where lower(email) = v_normalized;

  if v_recipient_uid is not null and v_recipient_uid = v_caller then
    raise exception 'cannot_share_with_self' using errcode = '22023';
  end if;

  -- Reuse an existing pending row for this (vehicle, email) tuple if
  -- one is still alive. Replaces the role + token so a re-invite works.
  select * into v_existing
    from public.vehicle_shares
   where vehicle_id = p_vehicle_id
     and lower(invitee_email) = v_normalized
     and status in ('pending','accepted');

  v_token := replace(gen_random_uuid()::text, '-', '') ||
             replace(gen_random_uuid()::text, '-', '');

  if v_existing.id is not null then
    update public.vehicle_shares
       set role = p_role,
           invite_token = v_token,
           expires_at = now() + interval '7 days',
           updated_at = now()
     where id = v_existing.id
     returning id into v_share_id;
  else
    insert into public.vehicle_shares (
      vehicle_id, owner_user_id, account_id, invitee_email,
      shared_with_user_id, role, status, invite_token, expires_at
    ) values (
      p_vehicle_id, v_caller, v_account_id, v_normalized,
      v_recipient_uid, p_role, 'pending', v_token, now() + interval '7 days'
    ) returning id into v_share_id;
  end if;

  -- Notify the recipient (if registered) — same as before.
  if v_recipient_uid is not null then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_inviter_name
      from auth.users where id = v_caller;

    insert into public.app_notifications (user_id, type, title, body, data) values (
      v_recipient_uid,
      'share_offered',
      coalesce(v_inviter_name, 'משתמש') || ' רוצה לשתף איתך רכב',
      coalesce(v_inviter_name, 'משתמש') || ' רוצה לשתף איתך רכב. אישור השיתוף יוסיף אותו לרשימה שלך.',
      jsonb_build_object(
        'vehicle_id',   p_vehicle_id,
        'share_id',     v_share_id,
        'role',         p_role,
        'invite_token', v_token,
        'inviter_id',   v_caller,
        'inviter_name', coalesce(v_inviter_name, 'משתמש')
      )
    );
  end if;

  return jsonb_build_object(
    'share_id',                v_share_id,
    'invite_token',            v_token,
    'recipient_existing_user', v_recipient_uid is not null,
    'recipient_name',          v_recipient_name,
    'expires_at',              now() + interval '7 days'
  );
end;
$$;

revoke all on function public.share_vehicle_with_email(uuid, text, text) from public;
grant execute on function public.share_vehicle_with_email(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
