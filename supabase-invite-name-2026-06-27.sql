-- ==========================================================================
-- Invite with a name — 2026-06-27
--
-- Spec: docs/spec-business-personal-membership-separation.md (§9, ת"ל "שם מוזמן")
--
-- Lets the inviter attach a human NAME to an invite, so a pending /
-- unregistered member is recognisable (not just an email). Adds:
--   1. account_members.invited_name  (nullable) — shown for pending rows
--   2. invites.invited_name          (nullable) — carried for unregistered
--   3. invite_account_member_by_email gains p_name (5th, defaulted → backward
--      compatible) and stores it on both paths.
--   4. workspace_team_directory coalesces invited_name into display_name when
--      the user has no profile/meta name yet (typical for a fresh pending user).
--
-- Idempotent. Additive + backward-compatible. Run in Supabase SQL Editor.
-- ==========================================================================

-- ── 1+2. Columns ──────────────────────────────────────────────────────────
alter table public.account_members add column if not exists invited_name text;
alter table public.invites          add column if not exists invited_name text;

-- ── 3. invite_account_member_by_email — +p_name ────────────────────────────
-- Drop the 4-arg version and recreate with a 5th defaulted param so existing
-- named-arg callers (p_email/p_role/p_vehicle_ids/p_account_id) still resolve.
drop function if exists public.invite_account_member_by_email(text, text, uuid[], uuid);

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

  -- Resolve the target account.
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
        (select coalesce(full_name, email, 'משתמש')
           from public.user_profiles where user_id = v_recipient_uid limit 1))
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

-- ── 4. workspace_team_directory — surface invited_name for nameless pendings ─
create or replace function public.workspace_team_directory(p_account_id uuid)
returns table (
  user_id      uuid,
  role         text,
  status       text,
  email        text,
  display_name text,
  phone        text,
  joined_at    timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (
    select 1 from public.account_members am
     where am.account_id = p_account_id
       and am.user_id    = auth.uid()
       and am.status     = 'פעיל'
  ) then
    raise exception 'forbidden_not_member';
  end if;

  return query
    select
      m.user_id,
      m.role,
      m.status,
      u.email::text,
      coalesce(
        nullif(u.raw_user_meta_data->>'full_name', ''),
        nullif(u.raw_user_meta_data->>'name', ''),
        nullif(m.invited_name, ''),                 -- typed at invite time
        split_part(u.email, '@', 1)
      )::text as display_name,
      p.phone::text,
      m.joined_at
      from public.account_members m
      join auth.users u           on u.id      = m.user_id
      left join public.user_profiles p on p.user_id = m.user_id
     where m.account_id = p_account_id
       and m.status not in ('הוסר', 'removed')
     order by
       case m.role
         when 'בעלים'  then 0
         when 'מנהל'   then 1
         when 'שותף'   then 2
         when 'driver' then 3
         else 9
       end,
       m.joined_at asc;
end;
$$;

revoke all  on function public.workspace_team_directory(uuid) from public;
grant execute on function public.workspace_team_directory(uuid) to authenticated;

notify pgrst, 'reload schema';
