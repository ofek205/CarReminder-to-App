-- ==========================================================================
-- App notifications — generic per-user notification table
--
-- Motivation: vehicle-share events (invite offered / invite accepted) need
-- to land as a visible notification on both sides of the flow. The existing
-- `community_notifications` table is scoped to community posts, and the
-- `redeem_invite_token` RPC only inserts the membership row — the inviter
-- never learns that their invite was accepted.
--
-- This table is generic on purpose (type + title + body + jsonb data) so
-- future flows (vehicle transferred, document expiring because a co-owner
-- updated it, etc.) can reuse it without a schema change per feature.
--
-- Idempotent: safe to re-run.
-- ==========================================================================

create table if not exists public.app_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,                     -- 'share_offered' | 'share_accepted' | future types
  title       text not null,
  body        text,
  data        jsonb not null default '{}'::jsonb, -- { invite_id, account_id, from_user_id, from_user_name, ... }
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_app_notifs_user_unread
  on public.app_notifications(user_id, is_read, created_at desc);

alter table public.app_notifications enable row level security;

-- Self-read / self-update / self-delete. INSERT is intentionally *not*
-- exposed to client roles: rows are created by SECURITY DEFINER RPCs
-- below so arbitrary users can't spam each other.
drop policy if exists app_notifs_select_own on public.app_notifications;
create policy app_notifs_select_own
  on public.app_notifications for select
  using (auth.uid() = user_id);

drop policy if exists app_notifs_update_own on public.app_notifications;
create policy app_notifs_update_own
  on public.app_notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists app_notifs_delete_own on public.app_notifications;
create policy app_notifs_delete_own
  on public.app_notifications for delete
  using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- redeem_invite_token — now also notifies the inviter on acceptance.
-- Same signature & semantics as supabase-invite-role-strict.sql, plus a
-- final INSERT into app_notifications for the inviter.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.redeem_invite_token(tok text)
returns table (
  id uuid, account_id uuid, role_to_assign text, status text,
  vehicle_ids uuid[],
  remaining_uses int, was_consumed boolean, already_member boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invites%rowtype;
  uid uuid := auth.uid();
  is_member boolean;
  new_status text;
  acceptor_name text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into inv
  from public.invites
  where token = tok
  for update;

  if not found then
    raise exception 'invite_not_found';
  end if;

  if inv.status <> 'פעיל' then
    raise exception 'invite_not_active';
  end if;

  if inv.expires_at is not null and inv.expires_at < now() then
    update public.invites set status = 'פג תוקף' where id = inv.id;
    raise exception 'invite_expired';
  end if;

  if inv.uses_count >= inv.max_uses then
    raise exception 'invite_exhausted';
  end if;

  select exists(
    select 1 from public.account_members
     where account_id = inv.account_id
       and user_id = uid
       and status = 'פעיל'
  ) into is_member;

  if is_member then
    return query
    select inv.id, inv.account_id, inv.role_to_assign, inv.status,
           inv.vehicle_ids,
           (inv.max_uses - inv.uses_count)::int,
           false, true;
    return;
  end if;

  if inv.role_to_assign not in ('מנהל', 'שותף') then
    raise exception 'invalid_invite_role: %', inv.role_to_assign;
  end if;

  insert into public.account_members (account_id, user_id, role, status, joined_at, vehicle_ids)
  values (inv.account_id, uid, inv.role_to_assign, 'פעיל', now(), inv.vehicle_ids);

  new_status := case when inv.uses_count + 1 >= inv.max_uses then 'מומש' else inv.status end;
  update public.invites
     set uses_count = uses_count + 1,
         status = new_status
   where id = inv.id;

  -- Notify the inviter. Best-effort: a failure here must not roll back the
  -- membership insert, so we wrap in a BEGIN/EXCEPTION block.
  begin
    select coalesce(full_name, email, 'משתמש')
      into acceptor_name
      from public.user_profiles up
      join auth.users au on au.id = up.user_id
     where up.user_id = uid
     limit 1;

    if acceptor_name is null then
      select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
        into acceptor_name
        from auth.users where id = uid;
    end if;

    if inv.invited_by_user_id is not null then
      insert into public.app_notifications (user_id, type, title, body, data)
      values (
        inv.invited_by_user_id,
        'share_accepted',
        coalesce(acceptor_name, 'משתמש') || ' קיבל/ה את הזמנת השיתוף',
        'ההזמנה לשיתוף הרכבים אושרה — ' || coalesce(acceptor_name, 'המשתמש') || ' כעת ' || inv.role_to_assign,
        jsonb_build_object(
          'invite_id',      inv.id,
          'account_id',     inv.account_id,
          'acceptor_id',    uid,
          'acceptor_name',  coalesce(acceptor_name, 'משתמש'),
          'role',           inv.role_to_assign
        )
      );
    end if;
  exception when others then
    -- Swallow: notification is nice-to-have, membership is the contract.
    null;
  end;

  return query
  select inv.id, inv.account_id, inv.role_to_assign, new_status,
         inv.vehicle_ids,
         (inv.max_uses - inv.uses_count - 1)::int,
         (inv.uses_count + 1 >= inv.max_uses),
         false;
end $$;

grant execute on function public.redeem_invite_token(text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- notify_invitee_by_email — called by the client right after invite creation
-- when the sender provided an email. If that email belongs to an existing
-- authenticated user, drop a 'share_offered' notification into their bell.
-- If no such user exists, the function is a no-op (email-only invite will
-- still be emailed by the Resend flow).
--
-- SECURITY DEFINER because the invoking user cannot read auth.users.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.notify_invitee_by_email(
  p_email      text,
  p_invite_id  uuid,
  p_role       text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_uid uuid;
  inviter_name text;
  inviter_uid uuid := auth.uid();
begin
  if inviter_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_email is null or p_email = '' or p_invite_id is null then
    return false;
  end if;

  select id into target_uid
    from auth.users
   where lower(email) = lower(p_email)
   limit 1;

  if target_uid is null then
    return false;                    -- not a registered user → skip
  end if;
  if target_uid = inviter_uid then
    return false;                    -- don't notify self
  end if;

  select coalesce(full_name, email, 'משתמש')
    into inviter_name
    from public.user_profiles up
   where up.user_id = inviter_uid
   limit 1;

  if inviter_name is null then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש')
      into inviter_name
      from auth.users where id = inviter_uid;
  end if;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    target_uid,
    'share_offered',
    coalesce(inviter_name, 'משתמש') || ' מזמין/ה אותך לשתף רכב',
    'אתה מוזמן להצטרף לחשבון כ־' || p_role || '. פתח את ההזמנה מקישור המייל.',
    jsonb_build_object(
      'invite_id',   p_invite_id,
      'inviter_id',  inviter_uid,
      'inviter_name',coalesce(inviter_name, 'משתמש'),
      'role',        p_role
    )
  );
  return true;
end $$;

grant execute on function public.notify_invitee_by_email(text, uuid, text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache so RPC + table are immediately callable.
-- ──────────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';
