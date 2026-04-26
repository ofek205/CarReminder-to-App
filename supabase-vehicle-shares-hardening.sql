-- ==========================================================================
-- Pre-ship hardening for vehicle_shares — addresses 4 blockers from the
-- final code review:
--
--   C2  vehicles_update_via_share missing WITH CHECK → editor could hijack
--       a vehicle into their own account by setting account_id. Add WITH
--       CHECK that mirrors USING and explicitly blocks account_id changes.
--
--   H1  Cap-of-3 race: two concurrent accept_vehicle_share callers can both
--       see count=2 and both succeed, ending up with 4 accepted shares.
--       Add pg_advisory_xact_lock(hashtext(vehicle_id::text)) at the top
--       of accept_vehicle_share so concurrent accepts on the same vehicle
--       serialize.
--
--   H2  notify_vehicle_change is grant-execute to authenticated with no
--       access check. Any user can spam any owner. Verify caller has
--       access (owner or accepted sharee) before fan-out.
--
--   L3  share_vehicle_with_email accepts the caller's own email,
--       creating a share to self. Cheap to block at the RPC level.
--
--   L4  expire_stale_share_invites granted to authenticated → user can
--       trigger global sweep + notification fan-out. Restrict to admins
--       (called from a daily admin/cron job).
--
-- Idempotent. Safe to re-run.
-- ==========================================================================

-- ── C2: vehicles_update_via_share — add WITH CHECK ────────────────────
-- The post-row state must satisfy the same predicate (still shared with me +
-- editor), AND the row's account_id must remain unchanged. The cheapest
-- way to enforce that in a policy alone is to require the editor's
-- updated row to still match the same vehicle_shares membership AND have
-- the original account_id; we enforce the latter via a trigger because
-- WITH CHECK can't reference OLD/NEW.
drop policy if exists vehicles_update_via_share on public.vehicles;
create policy vehicles_update_via_share on public.vehicles
  for update using (
    id in (
      select vehicle_id from public.vehicle_shares
       where shared_with_user_id = auth.uid()
         and status = 'accepted' and role = 'editor'
    )
  )
  with check (
    id in (
      select vehicle_id from public.vehicle_shares
       where shared_with_user_id = auth.uid()
         and status = 'accepted' and role = 'editor'
    )
  );

-- Trigger: editors can edit fields, but not move the vehicle into another
-- account or change ownership semantics.
create or replace function public.prevent_vehicle_account_hijack()
returns trigger language plpgsql as $$
begin
  -- Skip checks when the row is being updated by an account-member
  -- (owner). They legitimately can change account_id (e.g. re-parenting
  -- in admin tools); editors via vehicle_shares cannot. Service role
  -- (no auth.uid()) also bypasses for migrations.
  if auth.uid() is null then return new; end if;

  if (new.account_id is distinct from old.account_id)
     and exists (
       select 1 from public.vehicle_shares
        where vehicle_id = new.id and shared_with_user_id = auth.uid()
          and status = 'accepted' and role = 'editor'
     )
     and not exists (
       select 1 from public.account_members
        where account_id = old.account_id and user_id = auth.uid() and status = 'פעיל'
     )
  then
    raise exception 'editors_cannot_reparent_vehicles';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_vehicle_account_hijack on public.vehicles;
create trigger trg_prevent_vehicle_account_hijack
  before update on public.vehicles
  for each row execute function public.prevent_vehicle_account_hijack();


-- ── H1: cap-of-3 race — advisory lock in accept_vehicle_share ────────
create or replace function public.accept_vehicle_share(p_share_id uuid default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  else raise exception 'missing_share_id_or_token'; end if;

  if not found then raise exception 'share_not_found'; end if;
  if s.status <> 'pending' then raise exception 'share_not_pending'; end if;
  if not exists (select 1 from auth.users where id = uid and lower(email) = lower(s.shared_with_email)) then
    raise exception 'share_email_mismatch';
  end if;
  if s.expires_at < now() then
    update public.vehicle_shares set status = 'expired' where id = s.id;
    raise exception 'share_expired';
  end if;

  -- Serialize concurrent accepts on the same vehicle so the cap-of-3
  -- trigger sees a stable count. Without this, two callers can both
  -- read count=2 and both transition to 'accepted'. Lock is per-vehicle
  -- and held until commit.
  perform pg_advisory_xact_lock(hashtext(s.vehicle_id::text));

  update public.vehicle_shares set status = 'accepted', accepted_at = now(), shared_with_user_id = uid where id = s.id;

  begin
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_acceptor_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = s.vehicle_id;
    insert into public.app_notifications (user_id, type, title, body, data) values (
      s.owner_user_id, 'share_accepted',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את השיתוף',
      coalesce(v_acceptor_name, 'משתמש') || ' אישר/ה את שיתוף ' || v_vehicle_label || '.',
      jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id, 'vehicle_label', v_vehicle_label,
                         'acceptor_id', uid, 'acceptor_name', coalesce(v_acceptor_name, 'משתמש'), 'role', s.role)
    );
  exception when others then null; end;

  return jsonb_build_object('share_id', s.id, 'vehicle_id', s.vehicle_id, 'role', s.role, 'status', 'accepted');
end $$;


-- ── H2: notify_vehicle_change — caller-must-have-access check ────────
create or replace function public.notify_vehicle_change(p_vehicle_id uuid, p_change_type text, p_summary text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_actor_name text;
  v_vehicle_label text;
  v_owner_id uuid;
  v_account_id uuid;
  recipient record;
begin
  if uid is null then return; end if;

  -- Authorize: caller must either own the vehicle (via account_members)
  -- or have an accepted share. Otherwise this is a notification-spam
  -- attack vector — any authenticated user could fan out alerts to any
  -- account by guessing UUIDs.
  select v.account_id into v_account_id from public.vehicles v where v.id = p_vehicle_id;
  if v_account_id is null then return; end if;

  if not exists (
    select 1 from public.account_members
     where account_id = v_account_id and user_id = uid and status = 'פעיל'
  ) and not exists (
    select 1 from public.vehicle_shares
     where vehicle_id = p_vehicle_id and shared_with_user_id = uid and status = 'accepted'
  ) then
    return;                                      -- no access → silent no-op
  end if;

  select am.user_id into v_owner_id from public.account_members am
   where am.account_id = v_account_id and am.role = 'בעלים' and am.status = 'פעיל'
   limit 1;
  select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = p_vehicle_id;
  select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_actor_name from auth.users where id = uid;

  if v_owner_id is not null and v_owner_id <> uid then
    insert into public.app_notifications (user_id, type, title, body, data) values (
      v_owner_id, 'vehicle_change',
      coalesce(v_actor_name, 'משתמש') || ' עדכן/ה את ' || v_vehicle_label,
      p_summary,
      jsonb_build_object('vehicle_id', p_vehicle_id, 'change_type', p_change_type, 'actor_id', uid)
    );
  end if;

  for recipient in select shared_with_user_id from public.vehicle_shares
     where vehicle_id = p_vehicle_id and status = 'accepted' and shared_with_user_id is not null and shared_with_user_id <> uid loop
    insert into public.app_notifications (user_id, type, title, body, data) values (
      recipient.shared_with_user_id, 'vehicle_change',
      coalesce(v_actor_name, 'משתמש') || ' עדכן/ה את ' || v_vehicle_label,
      p_summary,
      jsonb_build_object('vehicle_id', p_vehicle_id, 'change_type', p_change_type, 'actor_id', uid)
    );
  end loop;
end $$;


-- ── L3: block self-share in share_vehicle_with_email ─────────────────
create or replace function public.share_vehicle_with_email(p_vehicle_id uuid, p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_share_id uuid;
  v_token text;
  v_recipient_uid uuid;
  v_existing_active uuid;
  v_inviter_name text;
  v_vehicle_label text;
  v_email_norm text;
  v_caller_email text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_role not in ('viewer', 'editor') then raise exception 'invalid_role'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'invalid_email'; end if;
  v_email_norm := lower(trim(p_email));

  -- Block self-share. Cheaper here than at insert (the unique index on
  -- active rows would catch most cases but produce a cryptic error).
  select lower(email) into v_caller_email from auth.users where id = uid;
  if v_caller_email = v_email_norm then raise exception 'cannot_share_with_self'; end if;

  select v.account_id into v_account_id from public.vehicles v where v.id = p_vehicle_id;
  if not found then raise exception 'vehicle_not_found'; end if;
  if not exists (select 1 from public.account_members where account_id = v_account_id and user_id = uid and status = 'פעיל' and role = 'בעלים') then
    raise exception 'not_vehicle_owner';
  end if;

  select id into v_existing_active from public.vehicle_shares
   where vehicle_id = p_vehicle_id and lower(shared_with_email) = v_email_norm and status in ('pending', 'accepted') limit 1;
  if v_existing_active is not null then raise exception 'share_already_exists'; end if;

  select id into v_recipient_uid from auth.users where lower(email) = v_email_norm limit 1;
  -- gen_random_uuid() is native in Postgres 13+, no pgcrypto required.
  -- Concatenated x2 minus dashes = 64 hex chars (256 bits of randomness),
  -- same security level as encode(gen_random_bytes(32), 'hex'). Avoids
  -- the gen_random_bytes-not-found error on Supabase deployments where
  -- pgcrypto sits in the `extensions` schema (not in the function's
  -- `set search_path = public`).
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.vehicle_shares (vehicle_id, owner_user_id, shared_with_email, shared_with_user_id, role, invite_token)
  values (p_vehicle_id, uid, v_email_norm, v_recipient_uid, p_role, v_token)
  returning id into v_share_id;

  if v_recipient_uid is not null and v_recipient_uid <> uid then
    select coalesce(raw_user_meta_data->>'full_name', email, 'משתמש') into v_inviter_name from auth.users where id = uid;
    select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label from public.vehicles where id = p_vehicle_id;
    insert into public.app_notifications (user_id, type, title, body, data) values (
      v_recipient_uid, 'share_offered',
      coalesce(v_inviter_name, 'משתמש') || ' רוצה לשתף איתך רכב',
      coalesce(v_inviter_name, 'משתמש') || ' רוצה לשתף איתך את ' || v_vehicle_label || '. אישור השיתוף יוסיף את הרכב לרשימה שלך.',
      jsonb_build_object('share_id', v_share_id, 'vehicle_id', p_vehicle_id, 'vehicle_label', v_vehicle_label,
                         'role', p_role, 'invite_token', v_token, 'inviter_id', uid,
                         'inviter_name', coalesce(v_inviter_name, 'משתמש'))
    );
  end if;

  return jsonb_build_object('share_id', v_share_id, 'invite_token', v_token,
                            'recipient_existing_user', v_recipient_uid is not null,
                            'expires_at', now() + interval '7 days');
end $$;


-- ── L4: restrict expire_stale_share_invites to admins only ───────────
revoke execute on function public.expire_stale_share_invites() from authenticated;
revoke execute on function public.expire_stale_share_invites() from public;
-- service_role is granted automatically; admins can call via the
-- supabase function-runner. If you wire a daily cron, use the admin
-- API key.

notify pgrst, 'reload schema';
