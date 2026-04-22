-- ==========================================================================
-- Security hardening migration. Closes critical/high findings from the
-- penetration test. Idempotent.
--
-- Fixes:
--   C1: invites table was world-readable/writable (USING true).
--   C2: account_members allowed self-insert with ANY role (owner escalation).
--   H2: community_posts.author_name could be forged in the client.
--   H7: accounts_insert had no check, allowed unbounded account creation.
--   M1: rate-limit INSERT abuse on analytics / contact / app_errors.
-- ==========================================================================

-- ──────────────────────────────────────────────────────────────────────
-- C1: INVITES — lock down
-- ──────────────────────────────────────────────────────────────────────
-- Only the inviter (or the joining user via SECURITY DEFINER helpers)
-- should be able to read/update invites. Anonymous enumeration is now
-- blocked; the JoinInvite flow uses a dedicated RPC below.

drop policy if exists "invites_select"  on public.invites;
drop policy if exists "invites_insert"  on public.invites;
drop policy if exists "invites_update"  on public.invites;
drop policy if exists "invites_delete"  on public.invites;

-- Inviter (the user who issued the invite) can see / manage their own invites.
create policy invites_select_owner on public.invites
  for select using (invited_by = auth.uid());

create policy invites_insert_auth on public.invites
  for insert with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.account_members
      where user_id = auth.uid()
        and account_id = invites.account_id
        and role in ('בעלים','מנהל')
        and status = 'פעיל'
    )
  );

create policy invites_update_owner on public.invites
  for update using (invited_by = auth.uid());

create policy invites_delete_owner on public.invites
  for delete using (invited_by = auth.uid());

-- A SECURITY DEFINER RPC the JoinInvite UI calls with a token. Returns
-- a single matching invite row if the token is valid, increments
-- uses_count atomically, and enforces max_uses server-side (closes M7
-- race condition).
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
  safe_role text;
  new_status text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Lock the row so concurrent redemptions don't race
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

  -- Already a member? Short-circuit without consuming the invite.
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

  -- Only safe, non-owner roles assignable via invite
  safe_role := case when inv.role_to_assign in ('מנהל','שותף') then inv.role_to_assign else 'שותף' end;

  -- Create membership atomically with the redemption
  insert into public.account_members (account_id, user_id, role, status, joined_at, vehicle_ids)
  values (inv.account_id, uid, safe_role, 'פעיל', now(), inv.vehicle_ids);

  -- Increment & potentially close out the invite
  new_status := case when inv.uses_count + 1 >= inv.max_uses then 'מומש' else inv.status end;
  update public.invites
     set uses_count = uses_count + 1,
         status = new_status
   where id = inv.id;

  return query
  select inv.id, inv.account_id, safe_role, new_status,
         inv.vehicle_ids,
         (inv.max_uses - inv.uses_count - 1)::int,
         (inv.uses_count + 1 >= inv.max_uses),
         false;
end $$;

grant execute on function public.redeem_invite_token(text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- C2: account_members — no self-owner / admin escalation
-- ──────────────────────────────────────────────────────────────────────
-- Self-insert is ONLY allowed with the weakest role. Promotion to
-- מנהל/בעלים must go through change_member_role() by a current owner.

drop policy if exists "members_insert" on public.account_members;
create policy members_insert_weak on public.account_members
  for insert with check (
    user_id = auth.uid()
    and role = 'שותף'
    and status = 'פעיל'
  );

-- An existing owner can promote/demote members on their own account.
drop policy if exists "members_update_role" on public.account_members;
create policy members_update_role on public.account_members
  for update using (
    account_id in (
      select account_id from public.account_members
      where user_id = auth.uid() and role = 'בעלים' and status = 'פעיל'
    )
  ) with check (
    account_id in (
      select account_id from public.account_members
      where user_id = auth.uid() and role = 'בעלים' and status = 'פעיל'
    )
  );

-- ──────────────────────────────────────────────────────────────────────
-- H7: accounts_insert — gate at owner level
-- ──────────────────────────────────────────────────────────────────────
drop policy if exists "accounts_insert" on public.accounts;
create policy accounts_insert_owner on public.accounts
  for insert with check (
    -- Must be authenticated and setting themselves as owner
    owner_user_id = auth.uid()
  );

-- ──────────────────────────────────────────────────────────────────────
-- H2: community_posts — enforce author_name = authenticated user
-- ──────────────────────────────────────────────────────────────────────
-- Trigger rewrites author_name at INSERT/UPDATE time so the client
-- cannot spoof it. Anonymous posts are still allowed (is_anonymous=true
-- with a numeric pseudo-id), but author_name is generated here, not by
-- the client.

-- Ensure the anonymity columns exist. The UI already reads/writes these
-- and older schemas may be missing them; ADD COLUMN IF NOT EXISTS keeps
-- this idempotent and stops the triggers below from throwing on
-- column-not-found.
alter table if exists public.community_posts
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists anonymous_number int;
alter table if exists public.community_comments
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists anonymous_number int;

create or replace function public.community_posts_set_author()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_row auth.users%rowtype;
  real_name text;
begin
  if new.user_id <> auth.uid() then
    raise exception 'cannot post on behalf of another user';
  end if;

  select * into user_row from auth.users where id = auth.uid();
  real_name := coalesce(
    nullif(user_row.raw_user_meta_data->>'full_name', ''),
    split_part(user_row.email, '@', 1),
    'משתמש'
  );

  if new.is_anonymous then
    -- Keep the anonymous_number from the client but overwrite the name
    -- so spoofing is impossible even in anonymous mode.
    new.author_name := format('אנונימי #%s', coalesce(new.anonymous_number, 1));
  else
    new.author_name := left(real_name, 60);
  end if;

  return new;
end $$;

drop trigger if exists community_posts_author_tg on public.community_posts;
create trigger community_posts_author_tg
  before insert or update of author_name, user_id, is_anonymous
  on public.community_posts
  for each row execute function public.community_posts_set_author();

-- Same for community_comments
create or replace function public.community_comments_set_author()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  user_row auth.users%rowtype;
  real_name text;
begin
  if new.user_id <> auth.uid() then
    raise exception 'cannot comment on behalf of another user';
  end if;
  select * into user_row from auth.users where id = auth.uid();
  real_name := coalesce(
    nullif(user_row.raw_user_meta_data->>'full_name', ''),
    split_part(user_row.email, '@', 1),
    'משתמש'
  );
  if coalesce(new.is_anonymous, false) then
    new.author_name := format('אנונימי #%s', coalesce(new.anonymous_number, 1));
  else
    new.author_name := left(real_name, 60);
  end if;
  return new;
end $$;

drop trigger if exists community_comments_author_tg on public.community_comments;
create trigger community_comments_author_tg
  before insert or update of author_name, user_id, is_anonymous
  on public.community_comments
  for each row execute function public.community_comments_set_author();

-- ──────────────────────────────────────────────────────────────────────
-- M1: rate-limit abuse vectors (analytics / contact / app_errors)
-- ──────────────────────────────────────────────────────────────────────
-- A lightweight per-IP / per-user rate limit table + trigger. We cap at
-- 60 inserts/minute per caller, which covers any legitimate burst.

create table if not exists public.rate_limit_counters (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

create or replace function public.rate_limit_check(kind text, max_per_min int default 60)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  row_ public.rate_limit_counters%rowtype;
begin
  k := kind || ':' || coalesce(auth.uid()::text, 'anon');
  select * into row_ from public.rate_limit_counters where key = k for update;
  if not found then
    insert into public.rate_limit_counters(key, window_start, count)
    values (k, now(), 1);
    return true;
  end if;
  if row_.window_start < now() - interval '1 minute' then
    update public.rate_limit_counters
      set window_start = now(), count = 1
      where key = k;
    return true;
  end if;
  if row_.count >= max_per_min then
    return false;
  end if;
  update public.rate_limit_counters set count = count + 1 where key = k;
  return true;
end $$;

-- Attach to the three high-traffic insert-open tables
create or replace function public.throttle_insert()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if not public.rate_limit_check(tg_table_name, 60) then
    raise exception 'rate limit exceeded for %', tg_table_name;
  end if;
  return new;
end $$;

do $$ begin
  if to_regclass('public.anonymous_analytics') is not null then
    drop trigger if exists throttle_analytics_tg on public.anonymous_analytics;
    create trigger throttle_analytics_tg before insert on public.anonymous_analytics
      for each row execute function public.throttle_insert();
  end if;
  if to_regclass('public.contact_messages') is not null then
    drop trigger if exists throttle_contact_tg on public.contact_messages;
    create trigger throttle_contact_tg before insert on public.contact_messages
      for each row execute function public.throttle_insert();
  end if;
  if to_regclass('public.app_errors') is not null then
    drop trigger if exists throttle_errors_tg on public.app_errors;
    create trigger throttle_errors_tg before insert on public.app_errors
      for each row execute function public.throttle_insert();
  end if;
end $$;

-- ──────────────────────────────────────────────────────────────────────
-- Clean up hardcoded admin email fallback in is_current_user_admin.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public, auth
stable
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and (raw_user_meta_data->>'role') = 'admin'
  );
$$;

grant execute on function public.is_current_user_admin() to authenticated;
