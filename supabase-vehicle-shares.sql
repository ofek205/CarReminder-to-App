-- ==========================================================================
-- Per-vehicle sharing — full backend
--
-- Rules (per product spec):
--   - Per-vehicle ACL (NOT account-level). Existing account_members flow
--     stays untouched for legacy users.
--   - Cap: max 3 ACCEPTED users per vehicle. Pending invites are unlimited.
--   - TTL: pending invites auto-expire after 7 days. Both sides get a
--     'share_expired' notification when that happens.
--   - Roles: 'viewer' (read-only) or 'editor' (everything except delete +
--     share). Editor changes propagate to owner via 'vehicle_change'
--     notifications.
--   - Revoke: sharee loses access; data stays with owner. While shared,
--     content added by either side is visible to all parties with a
--     "shared" indicator (handled client-side).
--   - Cascading delete: owner deletes vehicle → all sharees notified +
--     access removed via FK CASCADE on vehicle_shares.vehicle_id.
--
-- Idempotent.
-- ==========================================================================

-- ── 1. vehicle_shares table ───────────────────────────────────────────
create table if not exists public.vehicle_shares (
  id                  uuid primary key default gen_random_uuid(),
  vehicle_id          uuid not null references public.vehicles(id) on delete cascade,
  owner_user_id       uuid not null references auth.users(id) on delete cascade,
  shared_with_email   text not null,                                            -- lowercased on insert
  shared_with_user_id uuid references auth.users(id) on delete cascade,         -- null until accept
  role                text not null check (role in ('viewer', 'editor')),
  status              text not null check (status in ('pending', 'accepted', 'revoked', 'expired'))
                                       default 'pending',
  invite_token        text unique not null,                                     -- reused for /JoinInvite
  created_at          timestamptz not null default now(),
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  expires_at          timestamptz not null default now() + interval '7 days',
  -- One active share per (vehicle, recipient email).
  -- Past revoked/expired rows are kept for audit; only one row per pair
  -- can be in pending or accepted state at a time.
  constraint vehicle_shares_one_active
    unique (vehicle_id, shared_with_email, status)                              -- weak; tight unique below
);

-- A tighter "one active per (vehicle, email)" using a partial index.
-- Replaces the constraint above for active states only.
create unique index if not exists vehicle_shares_active_uq
  on public.vehicle_shares(vehicle_id, lower(shared_with_email))
  where status in ('pending', 'accepted');

create index if not exists vehicle_shares_vehicle_idx
  on public.vehicle_shares(vehicle_id) where status in ('pending', 'accepted');

create index if not exists vehicle_shares_recipient_idx
  on public.vehicle_shares(shared_with_user_id) where status = 'accepted';

create index if not exists vehicle_shares_owner_idx
  on public.vehicle_shares(owner_user_id);

create index if not exists vehicle_shares_expiry_idx
  on public.vehicle_shares(expires_at) where status = 'pending';

alter table public.vehicle_shares enable row level security;

-- Selects: owner sees all of their vehicle's shares; recipient sees their
-- own row(s). Writes go ONLY through SECURITY DEFINER RPCs below — we
-- intentionally do not expose insert/update/delete policies to
-- authenticated clients.
drop policy if exists vshare_select on public.vehicle_shares;
create policy vshare_select on public.vehicle_shares
  for select using (
    auth.uid() = owner_user_id
    or auth.uid() = shared_with_user_id
  );


-- ── 2. Cap-of-3 trigger (counts ACCEPTED only) ────────────────────────
-- Pending invites do NOT count toward the cap (owner can spam-invite to
-- maximize the chance someone accepts). Only accepted.
create or replace function public.enforce_vehicle_share_cap()
returns trigger
language plpgsql
as $$
begin
  -- Fire only when transitioning into 'accepted'. Inserts at status='pending'
  -- and revokes/expires don't trigger the cap check.
  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status <> 'accepted') then
    if (
      select count(*) from public.vehicle_shares
       where vehicle_id = new.vehicle_id
         and status = 'accepted'
         and id <> new.id
    ) >= 3 then
      raise exception 'vehicle_share_cap_exceeded';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vshare_cap on public.vehicle_shares;
create trigger trg_vshare_cap
  before insert or update on public.vehicle_shares
  for each row execute function public.enforce_vehicle_share_cap();


-- ── 3. Vehicles RLS — additive policy for shared access ──────────────
-- Existing account_id-based policies stay untouched. We add a parallel
-- policy that grants SELECT to recipients with an accepted share, and
-- UPDATE only when role = 'editor'. DELETE stays owner-only (existing
-- policy handles that — non-owners simply don't match).
drop policy if exists vehicles_select_via_share on public.vehicles;
create policy vehicles_select_via_share on public.vehicles
  for select using (
    id in (
      select vehicle_id from public.vehicle_shares
       where shared_with_user_id = auth.uid() and status = 'accepted'
    )
  );

drop policy if exists vehicles_update_via_share on public.vehicles;
create policy vehicles_update_via_share on public.vehicles
  for update using (
    id in (
      select vehicle_id from public.vehicle_shares
       where shared_with_user_id = auth.uid()
         and status = 'accepted'
         and role = 'editor'
    )
  );

-- repair_logs / repair_attachments / accident_details / documents follow
-- the same pattern. Editors can insert/update/delete logs on shared
-- vehicles; viewers can only select.
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='repair_logs') then
    execute 'drop policy if exists repair_logs_select_via_share on public.repair_logs';
    execute $POL$
      create policy repair_logs_select_via_share on public.repair_logs for select using (
        vehicle_id in (
          select vehicle_id from public.vehicle_shares
           where shared_with_user_id = auth.uid() and status = 'accepted'
        )
      )
    $POL$;
    execute 'drop policy if exists repair_logs_write_via_share on public.repair_logs';
    execute $POL$
      create policy repair_logs_write_via_share on public.repair_logs for all using (
        vehicle_id in (
          select vehicle_id from public.vehicle_shares
           where shared_with_user_id = auth.uid()
             and status = 'accepted' and role = 'editor'
        )
      ) with check (
        vehicle_id in (
          select vehicle_id from public.vehicle_shares
           where shared_with_user_id = auth.uid()
             and status = 'accepted' and role = 'editor'
        )
      )
    $POL$;
  end if;
end $$;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='documents') then
    execute 'drop policy if exists documents_select_via_share on public.documents';
    execute $POL$
      create policy documents_select_via_share on public.documents for select using (
        vehicle_id in (
          select vehicle_id from public.vehicle_shares
           where shared_with_user_id = auth.uid() and status = 'accepted'
        )
      )
    $POL$;
    execute 'drop policy if exists documents_write_via_share on public.documents';
    execute $POL$
      create policy documents_write_via_share on public.documents for all using (
        vehicle_id in (
          select vehicle_id from public.vehicle_shares
           where shared_with_user_id = auth.uid()
             and status = 'accepted' and role = 'editor'
        )
      ) with check (
        vehicle_id in (
          select vehicle_id from public.vehicle_shares
           where shared_with_user_id = auth.uid()
             and status = 'accepted' and role = 'editor'
        )
      )
    $POL$;
  end if;
end $$;


-- ── 4. View: my_vehicles_v — owned ∪ accepted-shared ─────────────────
create or replace view public.my_vehicles_v as
  -- Vehicles I own (via my account)
  select v.*,
         false as is_shared_with_me,
         null::uuid as share_id,
         null::text as share_role,
         null::uuid as share_owner_user_id
    from public.vehicles v
   where v.account_id in (
     select account_id from public.account_members
      where user_id = auth.uid() and status = 'פעיל'
   )
  union all
  -- Vehicles shared with me
  select v.*,
         true as is_shared_with_me,
         s.id as share_id,
         s.role as share_role,
         s.owner_user_id as share_owner_user_id
    from public.vehicles v
    join public.vehicle_shares s on s.vehicle_id = v.id
   where s.shared_with_user_id = auth.uid()
     and s.status = 'accepted';

grant select on public.my_vehicles_v to authenticated;


-- ── 5. RPCs ──────────────────────────────────────────────────────────

-- 5a. share_vehicle_with_email
-- Caller must be the vehicle's owner. Creates a pending share row.
-- Returns invite_token + recipient_existing_user flag (for UI hints).
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
  uid uuid := auth.uid();
  v_owner_id uuid;
  v_account_id uuid;
  v_share_id uuid;
  v_token text;
  v_recipient_uid uuid;
  v_existing_active uuid;
  v_inviter_name text;
  v_vehicle_label text;
  v_email_norm text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('viewer', 'editor') then raise exception 'invalid_role'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'invalid_email'; end if;

  v_email_norm := lower(trim(p_email));

  -- Verify caller owns the vehicle (via account_members of owner role).
  select v.account_id into v_account_id
    from public.vehicles v
   where v.id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found'; end if;

  if not exists (
    select 1 from public.account_members
     where account_id = v_account_id and user_id = uid and status = 'פעיל'
       and role = 'בעלים'
  ) then
    raise exception 'not_vehicle_owner';
  end if;

  -- Block double-invite: check for any active (pending/accepted) row.
  select id into v_existing_active
    from public.vehicle_shares
   where vehicle_id = p_vehicle_id
     and lower(shared_with_email) = v_email_norm
     and status in ('pending', 'accepted')
   limit 1;
  if v_existing_active is not null then
    raise exception 'share_already_exists';
  end if;

  -- Resolve recipient user_id if they're already registered.
  select id into v_recipient_uid
    from auth.users where lower(email) = v_email_norm limit 1;

  -- Build invite token (32 bytes hex).
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.vehicle_shares (
    vehicle_id, owner_user_id, shared_with_email, shared_with_user_id,
    role, invite_token
  ) values (
    p_vehicle_id, uid, v_email_norm, v_recipient_uid, p_role, v_token
  ) returning id into v_share_id;

  -- Notify recipient if they're an existing user. Email + push handled
  -- separately by the client (Resend + FCM fan-out).
  if v_recipient_uid is not null and v_recipient_uid <> uid then
    select coalesce(full_name, email, 'משתמש') into v_inviter_name
      from public.user_profiles where user_id = uid limit 1;
    if v_inviter_name is null then
      select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_inviter_name
        from auth.users where id = uid;
    end if;

    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
      from public.vehicles where id = p_vehicle_id;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_recipient_uid,
      'share_offered',
      coalesce(v_inviter_name, 'משתמש') || ' מעוניין לשתף איתך רכב',
      coalesce(v_inviter_name, 'משתמש') || ' מעוניין לשתף איתך את ' || v_vehicle_label
        || '. אשר/י את השיתוף כדי לראות את הרכב ברשימה שלך.',
      jsonb_build_object(
        'share_id',     v_share_id,
        'vehicle_id',   p_vehicle_id,
        'vehicle_label', v_vehicle_label,
        'role',         p_role,
        'invite_token', v_token,
        'inviter_id',   uid,
        'inviter_name', coalesce(v_inviter_name, 'משתמש')
      )
    );
  end if;

  return jsonb_build_object(
    'share_id',                v_share_id,
    'invite_token',            v_token,
    'recipient_existing_user', v_recipient_uid is not null,
    'expires_at',              now() + interval '7 days'
  );
end;
$$;

revoke all on function public.share_vehicle_with_email(uuid, text, text) from public;
grant execute on function public.share_vehicle_with_email(uuid, text, text) to authenticated;


-- 5b. accept_vehicle_share — by share id (when recipient clicks bell)
-- or by token (when they open the email/JoinInvite link).
create or replace function public.accept_vehicle_share(
  p_share_id uuid default null,
  p_token    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_acceptor_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  if p_share_id is not null then
    select * into s from public.vehicle_shares where id = p_share_id for update;
  elsif p_token is not null then
    select * into s from public.vehicle_shares where invite_token = p_token for update;
  else
    raise exception 'missing_share_id_or_token';
  end if;

  if not found then raise exception 'share_not_found'; end if;
  if s.status <> 'pending' then raise exception 'share_not_pending'; end if;

  -- Email-match check: the auth.uid()'s email must match the invite
  -- email (case-insensitive). Block hijacking by another logged-in user.
  if not exists (
    select 1 from auth.users
     where id = uid and lower(email) = lower(s.shared_with_email)
  ) then
    raise exception 'share_email_mismatch';
  end if;

  -- Auto-expire if past TTL.
  if s.expires_at < now() then
    update public.vehicle_shares set status = 'expired' where id = s.id;
    raise exception 'share_expired';
  end if;

  update public.vehicle_shares set
    status              = 'accepted',
    accepted_at         = now(),
    shared_with_user_id = uid
   where id = s.id;

  -- Notify owner.
  begin
    select coalesce(full_name, email, 'משתמש') into v_acceptor_name
      from public.user_profiles where user_id = uid limit 1;
    if v_acceptor_name is null then
      select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_acceptor_name
        from auth.users where id = uid;
    end if;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
      from public.vehicles where id = s.vehicle_id;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      s.owner_user_id,
      'share_accepted',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר את שיתוף הרכב',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר את שיתוף ' || v_vehicle_label || '.',
      jsonb_build_object(
        'share_id',     s.id,
        'vehicle_id',   s.vehicle_id,
        'vehicle_label', v_vehicle_label,
        'acceptor_id',   uid,
        'acceptor_name', coalesce(v_acceptor_name, 'משתמש'),
        'role',          s.role
      )
    );
  exception when others then null; end;

  return jsonb_build_object(
    'share_id',   s.id,
    'vehicle_id', s.vehicle_id,
    'role',       s.role,
    'status',     'accepted'
  );
end;
$$;

revoke all on function public.accept_vehicle_share(uuid, text) from public;
grant execute on function public.accept_vehicle_share(uuid, text) to authenticated;


-- 5c. decline_vehicle_share
create or replace function public.decline_vehicle_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_decliner_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select * into s from public.vehicle_shares where id = p_share_id for update;
  if not found then raise exception 'share_not_found'; end if;
  if s.status <> 'pending' then raise exception 'share_not_pending'; end if;

  if not exists (
    select 1 from auth.users
     where id = uid and lower(email) = lower(s.shared_with_email)
  ) then
    raise exception 'share_email_mismatch';
  end if;

  update public.vehicle_shares
     set status = 'revoked', revoked_at = now()
   where id = s.id;

  begin
    select coalesce(full_name, email, 'משתמש') into v_decliner_name
      from public.user_profiles where user_id = uid limit 1;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
      from public.vehicles where id = s.vehicle_id;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      s.owner_user_id,
      'share_declined',
      coalesce(v_decliner_name, 'משתמש') || ' דחה את הזמנת השיתוף',
      coalesce(v_decliner_name, 'משתמש') || ' דחה את הזמנת השיתוף עבור ' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id)
    );
  exception when others then null; end;

  return true;
end;
$$;

revoke all on function public.decline_vehicle_share(uuid) from public;
grant execute on function public.decline_vehicle_share(uuid) to authenticated;


-- 5d. revoke_vehicle_share — owner removes a sharee.
create or replace function public.revoke_vehicle_share(p_share_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_owner_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select * into s from public.vehicle_shares where id = p_share_id for update;
  if not found then raise exception 'share_not_found'; end if;
  if s.owner_user_id <> uid then raise exception 'not_share_owner'; end if;
  if s.status not in ('pending', 'accepted') then raise exception 'share_not_active'; end if;

  update public.vehicle_shares
     set status = 'revoked', revoked_at = now()
   where id = s.id;

  -- Notify the (former) sharee if they had accepted.
  if s.shared_with_user_id is not null then
    begin
      select coalesce(full_name, email, 'משתמש') into v_owner_name
        from public.user_profiles where user_id = uid limit 1;
      select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
        from public.vehicles where id = s.vehicle_id;

      insert into public.app_notifications (user_id, type, title, body, data)
      values (
        s.shared_with_user_id,
        'share_revoked',
        coalesce(v_owner_name, 'משתמש') || ' ביטל את שיתוף הרכב',
        coalesce(v_owner_name, 'משתמש') || ' ביטל את שיתוף ' || v_vehicle_label
          || '. הרכב הוסר מהרשימה שלך.',
        jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id)
      );
    exception when others then null; end;
  end if;

  return true;
end;
$$;

revoke all on function public.revoke_vehicle_share(uuid) from public;
grant execute on function public.revoke_vehicle_share(uuid) to authenticated;


-- 5e. leave_vehicle_share — sharee removes themselves.
create or replace function public.leave_vehicle_share(p_vehicle_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  s public.vehicle_shares%rowtype;
  v_user_name text;
  v_vehicle_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select * into s from public.vehicle_shares
   where vehicle_id = p_vehicle_id
     and shared_with_user_id = uid
     and status = 'accepted'
   for update;
  if not found then raise exception 'share_not_found'; end if;

  update public.vehicle_shares
     set status = 'revoked', revoked_at = now()
   where id = s.id;

  begin
    select coalesce(full_name, email, 'משתמש') into v_user_name
      from public.user_profiles where user_id = uid limit 1;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
      from public.vehicles where id = s.vehicle_id;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      s.owner_user_id,
      'share_left',
      coalesce(v_user_name, 'משתמש') || ' עזב את השיתוף',
      coalesce(v_user_name, 'משתמש') || ' עזב את שיתוף ' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id)
    );
  exception when others then null; end;

  return true;
end;
$$;

revoke all on function public.leave_vehicle_share(uuid) from public;
grant execute on function public.leave_vehicle_share(uuid) to authenticated;


-- 5f. list_vehicle_shares — for the "who has access" modal.
create or replace function public.list_vehicle_shares(p_vehicle_id uuid)
returns table (
  id                  uuid,
  shared_with_email   text,
  shared_with_user_id uuid,
  shared_with_name    text,
  role                text,
  status              text,
  created_at          timestamptz,
  accepted_at         timestamptz,
  expires_at          timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id,
    s.shared_with_email,
    s.shared_with_user_id,
    coalesce(p.full_name, u.email, s.shared_with_email) as shared_with_name,
    s.role,
    s.status,
    s.created_at,
    s.accepted_at,
    s.expires_at
  from public.vehicle_shares s
  left join auth.users u on u.id = s.shared_with_user_id
  left join public.user_profiles p on p.user_id = s.shared_with_user_id
  where s.vehicle_id = p_vehicle_id
    and s.status in ('pending', 'accepted')
    and exists (
      select 1 from public.account_members
       where user_id = auth.uid() and status = 'פעיל' and role = 'בעלים'
         and account_id = (select account_id from public.vehicles where id = p_vehicle_id)
    );
$$;

revoke all on function public.list_vehicle_shares(uuid) from public;
grant execute on function public.list_vehicle_shares(uuid) to authenticated;


-- 5g. expire_stale_share_invites — call from a daily cron.
create or replace function public.expire_stale_share_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.vehicle_shares%rowtype;
  v_owner_name text;
  v_vehicle_label text;
  count_expired int := 0;
begin
  for s in
    select * from public.vehicle_shares
     where status = 'pending' and expires_at < now()
     for update
  loop
    update public.vehicle_shares set status = 'expired' where id = s.id;
    count_expired := count_expired + 1;

    -- Notify both sides.
    begin
      select coalesce(full_name, email, 'משתמש') into v_owner_name
        from public.user_profiles where user_id = s.owner_user_id limit 1;
      select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
        from public.vehicles where id = s.vehicle_id;

      -- To owner
      insert into public.app_notifications (user_id, type, title, body, data)
      values (
        s.owner_user_id,
        'share_expired',
        'הזמנת שיתוף פגה תוקף',
        'ההזמנה לשיתוף ' || v_vehicle_label || ' עם ' || s.shared_with_email
          || ' לא אושרה תוך 7 ימים ופגה. ניתן לשלוח הזמנה חדשה.',
        jsonb_build_object(
          'share_id',   s.id,
          'vehicle_id', s.vehicle_id,
          'side',       'owner'
        )
      );

      -- To recipient (if known)
      if s.shared_with_user_id is not null then
        insert into public.app_notifications (user_id, type, title, body, data)
        values (
          s.shared_with_user_id,
          'share_expired',
          'הזמנת שיתוף פגה תוקף',
          'הזמנת השיתוף של ' || coalesce(v_owner_name, 'משתמש')
            || ' לרכב ' || v_vehicle_label || ' פגה תוקף.',
          jsonb_build_object(
            'share_id',   s.id,
            'vehicle_id', s.vehicle_id,
            'side',       'recipient'
          )
        );
      end if;
    exception when others then null; end;
  end loop;

  return count_expired;
end;
$$;

revoke all on function public.expire_stale_share_invites() from public;
grant execute on function public.expire_stale_share_invites() to authenticated;


-- 5h. delete_vehicle_with_share_choice — replaces direct vehicle delete.
-- 'both' = owner action, deletes vehicle for everyone (FK CASCADE on
--          vehicle_shares + notifies all sharees).
-- 'self_leave' = sharee action, equivalent to leave_vehicle_share.
create or replace function public.delete_vehicle_with_share_choice(
  p_vehicle_id uuid,
  p_mode       text                                                   -- 'both' | 'self_leave'
)
returns boolean
language plpgsql
security definer
set search_path = public
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

  if p_mode = 'self_leave' then
    -- Sharee removes themselves.
    return public.leave_vehicle_share(p_vehicle_id);
  end if;

  -- 'both' mode — must be vehicle owner.
  select v.account_id into v_account_id
    from public.vehicles v
   where v.id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found'; end if;

  if not exists (
    select 1 from public.account_members
     where account_id = v_account_id and user_id = uid and status = 'פעיל'
       and role = 'בעלים'
  ) then
    raise exception 'not_vehicle_owner';
  end if;

  -- Notify all current sharees BEFORE delete (cascade will drop the rows).
  begin
    select coalesce(full_name, email, 'משתמש') into v_owner_name
      from public.user_profiles where user_id = uid limit 1;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
      from public.vehicles where id = p_vehicle_id;

    for s in
      select shared_with_user_id, id from public.vehicle_shares
       where vehicle_id = p_vehicle_id
         and status = 'accepted'
         and shared_with_user_id is not null
    loop
      insert into public.app_notifications (user_id, type, title, body, data)
      values (
        s.shared_with_user_id,
        'share_deleted',
        coalesce(v_owner_name, 'משתמש') || ' מחק את הרכב המשותף',
        coalesce(v_owner_name, 'משתמש') || ' מחק את ' || v_vehicle_label
          || '. הרכב הוסר מהרשימה שלך.',
        jsonb_build_object('share_id', s.id, 'vehicle_id', p_vehicle_id)
      );
    end loop;
  exception when others then null; end;

  -- Cascade drops vehicle_shares + dependent rows (via existing FKs).
  delete from public.vehicles where id = p_vehicle_id;

  return true;
end;
$$;

revoke all on function public.delete_vehicle_with_share_choice(uuid, text) from public;
grant execute on function public.delete_vehicle_with_share_choice(uuid, text) to authenticated;


-- 5i. notify_vehicle_change — fired by editor actions to alert the owner
-- and other sharees that something changed. Used for repair logs,
-- documents, vehicle field edits, etc. Keeps one place where the
-- "shared content updated" notification is generated.
create or replace function public.notify_vehicle_change(
  p_vehicle_id uuid,
  p_change_type text,                                                  -- 'repair_added' | 'document_added' | 'vehicle_edited' | ...
  p_summary    text                                                    -- short Hebrew description
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_actor_name text;
  v_vehicle_label text;
  v_owner_id uuid;
  recipient record;
begin
  if uid is null then return; end if;
  -- Allow this from anyone with read access; the inserts are governed
  -- by their own loop.

  select v.account_id, am.user_id into v_owner_id
    from public.vehicles v
    join public.account_members am
      on am.account_id = v.account_id and am.role = 'בעלים' and am.status = 'פעיל'
   where v.id = p_vehicle_id
   limit 1;

  select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
    from public.vehicles where id = p_vehicle_id;
  select coalesce(full_name, email, 'משתמש') into v_actor_name
    from public.user_profiles where user_id = uid limit 1;
  if v_actor_name is null then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_actor_name
      from auth.users where id = uid;
  end if;

  -- Notify owner if actor isn't the owner
  if v_owner_id is not null and v_owner_id <> uid then
    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_owner_id,
      'vehicle_change',
      coalesce(v_actor_name, 'משתמש') || ' עדכן את ' || v_vehicle_label,
      p_summary,
      jsonb_build_object(
        'vehicle_id',  p_vehicle_id,
        'change_type', p_change_type,
        'actor_id',    uid
      )
    );
  end if;

  -- Notify all other accepted sharees (not self)
  for recipient in
    select shared_with_user_id from public.vehicle_shares
     where vehicle_id = p_vehicle_id
       and status = 'accepted'
       and shared_with_user_id is not null
       and shared_with_user_id <> uid
  loop
    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      recipient.shared_with_user_id,
      'vehicle_change',
      coalesce(v_actor_name, 'משתמש') || ' עדכן את ' || v_vehicle_label,
      p_summary,
      jsonb_build_object(
        'vehicle_id',  p_vehicle_id,
        'change_type', p_change_type,
        'actor_id',    uid
      )
    );
  end loop;
end;
$$;

revoke all on function public.notify_vehicle_change(uuid, text, text) from public;
grant execute on function public.notify_vehicle_change(uuid, text, text) to authenticated;


-- ── 6. device_tokens table — for FCM push (Phase 3) ───────────────────
-- Created now so the schema is stable when FCM client wiring lands.
create table if not exists public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null check (platform in ('android', 'ios', 'web')),
  fcm_token   text not null,
  device_id   text,                                 -- optional: opaque per-install id
  last_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, fcm_token)
);

create index if not exists device_tokens_user_idx
  on public.device_tokens(user_id, last_seen_at desc);

alter table public.device_tokens enable row level security;

drop policy if exists device_tokens_self on public.device_tokens;
create policy device_tokens_self on public.device_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
