-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-vehicle-transfer-2026-09-11.sql
--
-- Digital ownership transfer: a seller hands a vehicle's history to a buyer
-- instead of deleting it.
--
-- Spec: docs/spec-vehicle-ownership-transfer.md
--
-- ═══ THIS IS A MIRROR OF VEHICLE SHARING, NOT A NEW MECHANISM ═════════════
--
-- Ofek's direction, 2026-09-11: build it exactly the way vehicle sharing
-- already works — by EMAIL, with the other side approving, notifications on
-- both sides, and a link only for a recipient who has no account yet. An
-- earlier draft of this file was link-first with an automatic claim; that is
-- gone, and this replaces it in place (the earlier version was never applied,
-- never committed, and never recorded in the ledger).
--
-- Every structural decision here is copied deliberately from
-- supabase-vehicle-shares.sql so the two behave the same way:
--
--   share_vehicle_with_email   →  transfer_vehicle_to_email
--   PATH A registered          →  pending row + app_notifications row
--   PATH B unregistered        →  invite token; the link forces sign-up
--   accept_vehicle_share       →  accept_vehicle_transfer
--   decline_vehicle_share      →  decline_vehicle_transfer
--   revoke_vehicle_share       →  cancel_vehicle_transfer
--   list_vehicle_shares        →  list_vehicle_transfers
--   returns jsonb              →  same shape, so the client reads it the same
--   email sent client-side     →  same; the RPC does the DB half only
--
-- The anti-hijack check in accept_vehicle_share is mirrored too: the accepting
-- user's own auth email must match the invited address, or a different signed-in
-- user holding the link could take the vehicle.
--
-- ═══ WHAT MAKES IT A TRANSFER AND NOT A SHARE ═════════════════════════════
--
--   • A share grants ACCESS. A transfer COPIES history into the recipient's
--     account and moves the sender's vehicle to a read-only archive.
--   • A vehicle may be shared with many people; it may have only ONE open
--     transfer. Two would collide at accept time.
--   • The sender chooses what travels (the manifest); a share has no such idea.
--
-- ═══ WHAT IS COPIED, AND WHY THE LIST IS SHORT ════════════════════════════
--
-- public.vehicles has 120+ columns. An allow-list that long goes stale in a
-- month and a deny-list leaks every future column. It is also unnecessary:
-- this project already has gov-sync-vehicles, which fills a vehicle's
-- specification from the ministry by licence plate. The recipient needs
-- IDENTITY plus HISTORY; the sync fills the rest. Nine columns, reviewable.
--
-- Deliberately NOT copied, each for a reason:
--   nickname                     the recipient names their own car
--   insurance_*, leasing_company the sender's contracts, not the car's
--   notes                        personal notes
--   technician_*, marina         who the sender used and where they kept it
--   acting_admin_id              an impersonation AUDIT field. Copying it
--                                forges an admin's fingerprint onto a row they
--                                never touched.
--   receipt_storage_path,
--   photo_storage_paths,
--   vehicle_photo*               Postgres cannot copy a storage object inside
--                                a transaction. Copying the PATH without the
--                                object gives the recipient a broken link or a
--                                cross-account read of the sender's bucket.
--   other_driver_phone,
--   witnesses, injuries_details,
--   police_report_number/station third parties who never agreed to appear in
--                                a stranger's account.
--   next_reminder_*              the sender's schedule
--
-- SAFETY
--   Additive. One new table, two new columns on vehicles, one new column on
--   two child tables, one trigger, five functions. No existing policy, column
--   or row is altered. Idempotent and re-runnable. Nothing in the app calls
--   these yet, so applying it changes no behaviour.
--
-- APPLY
--   Supabase SQL Editor, once, then:
--     node scripts/sql-ledger.cjs record supabase-vehicle-transfer-2026-09-11.sql
--   (CLAUDE.md gate 5: staging shares this database with production.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. lifecycle on vehicles ──────────────────────────────────────────────
alter table public.vehicles
  add column if not exists lifecycle text not null default 'active',
  add column if not exists sold_at   timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_lifecycle_chk') then
    alter table public.vehicles add constraint vehicles_lifecycle_chk
      check (lifecycle in ('active', 'sold_archive'));
  end if;
end $$;

comment on column public.vehicles.lifecycle is
  'active | sold_archive. An archived vehicle is read-only and, per product decision 5, does NOT count against the plan vehicle cap.';

-- ── 2. the transfer record ────────────────────────────────────────────────
-- Column names follow vehicle_shares on purpose, so anyone who knows one
-- table can read the other.
create table if not exists public.vehicle_transfers (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.vehicles(id) on delete cascade,

  from_user_id      uuid not null references auth.users(id) on delete cascade,
  from_account_id   uuid not null references public.accounts(id) on delete cascade,

  to_email          text not null,
  to_user_id        uuid references auth.users(id) on delete set null,
  to_account_id     uuid references public.accounts(id) on delete set null,

  -- What the sender chose to include. Read at ACCEPT time from this row and
  -- never re-supplied by whoever accepts.
  manifest          jsonb not null default '{}'::jsonb,

  invite_token      text not null unique,
  status            text not null default 'pending',
  expires_at        timestamptz not null default (now() + interval '7 days'),
  created_at        timestamptz not null default now(),
  responded_at      timestamptz,

  constraint vehicle_transfers_status_chk
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  -- An accepted transfer must say who took it and when. Keeps the table out of
  -- states the functions below could not have produced.
  constraint vehicle_transfers_accept_coherent_chk
    check ((status = 'accepted') = (to_account_id is not null and responded_at is not null))
);

comment on table public.vehicle_transfers is
  'One row per ownership-transfer offer. Mirrors public.vehicle_shares in shape and lifecycle; differs in that accepting COPIES history and archives the sender''s vehicle. See docs/spec-vehicle-ownership-transfer.md.';

-- Only ONE open transfer per vehicle. A share may have many recipients; a
-- transfer may not, because two accepts would race over the same archive step.
create unique index if not exists vehicle_transfers_one_open_idx
  on public.vehicle_transfers (vehicle_id) where status = 'pending';
create index if not exists vehicle_transfers_recipient_idx
  on public.vehicle_transfers (to_user_id) where status = 'pending';
create index if not exists vehicle_transfers_expiry_idx
  on public.vehicle_transfers (expires_at) where status = 'pending';

-- ── 3. provenance on copied rows ──────────────────────────────────────────
-- Non-null means "inherited from a previous owner". The UI shows the ORIGINAL
-- created_at beside it, because twelve rows written last Tuesday look very
-- different from twelve spread over three years, and that difference is the
-- only honest signal of authenticity this feature can offer.
alter table public.maintenance_logs
  add column if not exists source_transfer_id uuid references public.vehicle_transfers(id) on delete set null;
alter table public.accidents
  add column if not exists source_transfer_id uuid references public.vehicle_transfers(id) on delete set null;

-- ── 4. RLS ────────────────────────────────────────────────────────────────
alter table public.vehicle_transfers enable row level security;

-- Both sides can see their own offers, which is what the two inboxes need.
-- Every write goes through the SECURITY DEFINER functions below.
--
-- Two uid columns and NOTHING ELSE, copied verbatim from vshare_select. An
-- earlier draft of this policy added
--   or lower(to_email) = (select email from auth.users where id = auth.uid())
-- to cover a PATH B recipient whose to_user_id is still null. That would have
-- broken every read of this table: a policy expression is evaluated with the
-- QUERYING role's privileges, and `authenticated` holds no grant on
-- auth.users, so the table would have answered "permission denied for table
-- users" for both parties.
--
-- It is also unnecessary. A PATH B recipient never selects this table — they
-- arrive holding a token and go through preview_vehicle_transfer and
-- accept_vehicle_transfer, both SECURITY DEFINER — and the sender's list goes
-- through list_vehicle_transfers.
drop policy if exists vehicle_transfers_select_own on public.vehicle_transfers;
create policy vehicle_transfers_select_own on public.vehicle_transfers
  for select using (
    from_user_id = auth.uid()
    or to_user_id = auth.uid()
  );

-- ── 5. the freeze ─────────────────────────────────────────────────────────
-- Once an offer is open, the history it promises stops changing. Enforced in
-- the database, not the UI: the DAL is reachable from the client, and a freeze
-- the client can skip is not a freeze.
create or replace function public.block_edit_while_transfer_pending()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_vehicle uuid := coalesce(new.vehicle_id, old.vehicle_id);
begin
  if current_user in ('authenticated', 'anon')
     and exists (
       select 1 from public.vehicle_transfers
        where vehicle_id = v_vehicle and status = 'pending' and expires_at > now()
     ) then
    raise exception 'vehicle_history_frozen'
      using hint = 'Cancel the open transfer before editing this vehicle''s history.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists maintenance_logs_freeze on public.maintenance_logs;
create trigger maintenance_logs_freeze
  before insert or update or delete on public.maintenance_logs
  for each row execute function public.block_edit_while_transfer_pending();

drop trigger if exists accidents_freeze on public.accidents;
create trigger accidents_freeze
  before insert or update or delete on public.accidents
  for each row execute function public.block_edit_while_transfer_pending();

-- ── 6. offer ──────────────────────────────────────────────────────────────
-- Mirrors share_vehicle_with_email, including the returned jsonb shape so the
-- client can branch on recipient_existing_user exactly as ShareVehicleDialog
-- already does, and send the Resend email itself.
create or replace function public.transfer_vehicle_to_email(
  p_vehicle_id uuid,
  p_email      text,
  p_manifest   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid             uuid := auth.uid();
  v_account_id    uuid;
  v_transfer_id   uuid;
  v_token         text;
  v_recipient_uid uuid;
  v_sender_name   text;
  v_vehicle_label text;
  v_email_norm    text;
  v_expires       timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_email is null or position('@' in p_email) = 0 then raise exception 'invalid_email'; end if;

  v_email_norm := lower(trim(p_email));

  select v.account_id into v_account_id
    from public.vehicles v
   where v.id = p_vehicle_id and v.lifecycle = 'active';
  if not found then raise exception 'vehicle_not_found'; end if;

  -- Owner only. Transferring is not something an editor-share holder may do.
  if not exists (
    select 1 from public.account_members
     where account_id = v_account_id and user_id = uid
       and status = 'פעיל' and role = 'בעלים'
  ) then
    raise exception 'not_vehicle_owner';
  end if;

  -- Retire this vehicle's lapsed offers FIRST. The partial unique index below
  -- is on (vehicle_id) WHERE status = 'pending' and knows nothing about
  -- expiry, so a row left pending past its date would collide with the insert
  -- and surface as a raw 23505 — even though the check just below deliberately
  -- treats it as gone. Without this, a seller whose offer expired could never
  -- send another one for that vehicle.
  update public.vehicle_transfers
     set status = 'expired', responded_at = now()
   where vehicle_id = p_vehicle_id and status = 'pending' and expires_at <= now();

  if exists (
    select 1 from public.vehicle_transfers
     where vehicle_id = p_vehicle_id and status = 'pending'
  ) then
    raise exception 'transfer_already_pending';
  end if;

  select id into v_recipient_uid from auth.users where lower(email) = v_email_norm limit 1;
  if v_recipient_uid = uid then raise exception 'cannot_transfer_to_yourself'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.vehicle_transfers (
    vehicle_id, from_user_id, from_account_id,
    to_email, to_user_id, manifest, invite_token
  ) values (
    p_vehicle_id, uid, v_account_id,
    v_email_norm, v_recipient_uid, coalesce(p_manifest, '{}'::jsonb), v_token
  ) returning id, expires_at into v_transfer_id, v_expires;

  -- PATH A: already a user → in-app notification. The email is the client's
  -- job either way, exactly as with sharing.
  if v_recipient_uid is not null then
    -- ⚠️ auth.users, NOT user_profiles. public.user_profiles has no full_name
    -- and no email column — it holds phone, birth_date and licence fields only.
    -- Reading them from there fails at PLAN time, which means the coalesce
    -- fallback never gets to run and the whole call throws. An earlier draft of
    -- this file copied the pattern straight out of supabase-vehicle-shares.sql,
    -- which is itself one of the files
    -- supabase-fix-fullname-reads-2026-07-02.sql had to repair for exactly this.
    select coalesce(au.raw_user_meta_data->>'full_name', au.email, 'משתמש') into v_sender_name
      from auth.users au where au.id = uid;

    select coalesce(manufacturer || ' ' || model, license_plate, 'הרכב') into v_vehicle_label
      from public.vehicles where id = p_vehicle_id;

    insert into public.app_notifications (user_id, type, title, body, data)
    values (
      v_recipient_uid,
      'transfer_offered',
      coalesce(v_sender_name, 'משתמש') || ' רוצה להעביר אליך רכב',
      coalesce(v_sender_name, 'משתמש') || ' מעביר אליך את ' || v_vehicle_label
        || ' יחד עם היסטוריית הטיפולים. אשר/י כדי לקבל אותו.',
      jsonb_build_object(
        'transfer_id',   v_transfer_id,
        'vehicle_id',    p_vehicle_id,
        'vehicle_label', v_vehicle_label,
        'manifest',      coalesce(p_manifest, '{}'::jsonb),
        'invite_token',  v_token,
        'sender_id',     uid,
        'sender_name',   coalesce(v_sender_name, 'משתמש')
      )
    );
  end if;

  return jsonb_build_object(
    'transfer_id',             v_transfer_id,
    'invite_token',            v_token,
    'recipient_existing_user', v_recipient_uid is not null,
    -- The row's real value, not a recomputed one. If the column default ever
    -- changes, the client's countdown and the database stay in agreement.
    'expires_at',              v_expires
  );
end;
$$;

-- ── 7. preview ────────────────────────────────────────────────────────────
-- For PATH B: someone opens the link before they have an account. Returns
-- counts and a date range and NOTHING else — no row content, and deliberately
-- no licence plate. A link travels through WhatsApp, browser history and
-- Referer headers, and a plate identifies a car and, through the ministry
-- registry, its owner. An unknown token returns zero rows rather than an
-- error, so guessing teaches nothing.
create or replace function public.preview_vehicle_transfer(p_token text)
returns table (
  manufacturer   text,
  model          text,
  year           integer,
  vehicle_type   text,
  sender_name    text,
  service_count  integer,
  accident_count integer,
  oldest_record  date,
  newest_record  date,
  manifest       jsonb,
  expires_at     timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.vehicle_transfers;
  v public.vehicles;
  n text;
begin
  -- ⚠️ EVERY COLUMN IN THIS FUNCTION IS QUALIFIED WITH AN ALIAS, and it has
  -- to be. A RETURNS TABLE column becomes a PL/pgSQL variable, so the output
  -- column `expires_at` collides with vehicle_transfers.expires_at and the
  -- WHERE below raised 42702 "column reference expires_at is ambiguous" at
  -- RUN time — the body is not parsed at CREATE time, so the file applied
  -- cleanly and only the first real call failed. `year`, `manifest`,
  -- `status` and `model` are the same hazard waiting to happen, which is why
  -- the fix is an alias on every table here rather than one repair to one
  -- line. Same trap as a RETURNS TABLE column named `found` shadowing
  -- PL/pgSQL's own FOUND.
  select * into t from public.vehicle_transfers vt
   where vt.invite_token = p_token
     and vt.status = 'pending'
     and vt.expires_at > now();
  if t.id is null then return; end if;

  select * into v from public.vehicles veh where veh.id = t.vehicle_id;
  -- full_name only, and NO email fallback, unlike everywhere else in this
  -- file. The other lookups answer a signed-in party who was named in the
  -- offer; this one answers whoever is holding the link, and the sender's
  -- address is not theirs to have.
  -- auth.users, for the reason given in transfer_vehicle_to_email above.
  -- NO email fallback here, unlike the other two: this answers whoever is
  -- holding the link rather than a named party, and the sender's address is
  -- not theirs to have.
  select coalesce(au.raw_user_meta_data->>'full_name', 'משתמש') into n
    from auth.users au where au.id = t.from_user_id;

  return query
  select v.manufacturer, v.model, v.year, v.vehicle_type,
         coalesce(n, 'משתמש'),
         (select count(*)::integer from public.maintenance_logs m where m.vehicle_id = v.id),
         (select count(*)::integer from public.accidents a      where a.vehicle_id = v.id),
         (select min(m.date)::date  from public.maintenance_logs m where m.vehicle_id = v.id),
         (select max(m.date)::date  from public.maintenance_logs m where m.vehicle_id = v.id),
         t.manifest, t.expires_at;
end;
$$;

-- ── 8. accept ─────────────────────────────────────────────────────────────
create or replace function public.accept_vehicle_transfer(
  p_transfer_id uuid default null,
  p_token       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid        uuid := auth.uid();
  t          public.vehicle_transfers;
  v_to       uuid;
  v_new      uuid;
  v_manifest jsonb;
  v_label    text;
  v_taker    text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  -- FOR UPDATE before any check, or two concurrent accepts both pass it.
  if p_transfer_id is not null then
    select * into t from public.vehicle_transfers where id = p_transfer_id for update;
  elsif p_token is not null then
    select * into t from public.vehicle_transfers where invite_token = p_token for update;
  else
    raise exception 'missing_transfer_id_or_token';
  end if;

  if not found then raise exception 'transfer_not_found'; end if;
  if t.status <> 'pending'  then raise exception 'transfer_not_pending'; end if;
  if t.expires_at <= now()  then raise exception 'transfer_expired'; end if;

  -- Anti-hijack, mirrored from accept_vehicle_share: the accepting user's own
  -- address must be the invited one. Without it, anyone signed in who obtains
  -- the link takes the vehicle.
  if not exists (
    select 1 from auth.users
     where id = uid and lower(email) = lower(t.to_email)
  ) then
    raise exception 'transfer_email_mismatch';
  end if;

  -- WHERE A RECEIVED VEHICLE LANDS: an account the recipient OWNS, and by
  -- preference their personal one.
  --
  -- ⚠️ NEVER an account they merely belong to. Someone buying a private car
  -- must not have it dropped into a company fleet they happen to drive for,
  -- and an account they do not own is an account whose OWNER would end up
  -- holding their vehicle. Every branch below resolves to an account the
  -- recipient owns; when none does, the transfer is refused rather than
  -- guessed at.
  --
  -- ⚠️ AND account_members HAS NO created_at. The column is joined_at. The
  -- first version of this query ordered by created_at, which meant every
  -- accept would have failed — invisibly, because a PL/pgSQL body is not
  -- checked when the function is created, only when it is first called.
  select a.id into v_to
    from public.accounts a
   where a.owner_user_id = uid and a.type = 'personal'
   order by a.created_at
   limit 1;

  if v_to is null then
    select a.id into v_to
      from public.accounts a
     where a.owner_user_id = uid
     order by a.created_at
     limit 1;
  end if;

  -- Last resort, and it exists for a real population: some accounts carry a
  -- NULL owner_user_id, and for those the membership row is the only record
  -- of ownership there is. Personal first even here.
  if v_to is null then
    select am.account_id into v_to
      from public.account_members am
      join public.accounts a on a.id = am.account_id
     where am.user_id = uid and am.status = 'פעיל' and am.role = 'בעלים'
     order by (a.type = 'personal') desc, am.joined_at nulls last
     limit 1;
  end if;

  if v_to is null then raise exception 'no_account_for_recipient'; end if;

  v_manifest := coalesce(t.manifest, '{}'::jsonb);

  -- Identity only. gov-sync-vehicles refills the specification from the plate.
  --
  -- ⚠️ THIS INSERT CAN BE REFUSED, AND THAT IS CORRECT. trg_vehicle_plan_cap_stmt
  -- fires on public.vehicles and raises `vehicle_plan_cap_exceeded` when the
  -- accepting account is already at its plan limit. The whole accept then rolls
  -- back: no half-copied history, no archived vehicle on the sender's side, and
  -- the offer stays pending so it can be accepted after an upgrade. The client
  -- MUST map that error name to the upgrade prompt rather than to a generic
  -- failure — it is the single most likely way a real accept fails.
  --
  -- ⚠️ AND THE CAP COUNTS THE SENDER'S ARCHIVE. enforce_vehicle_plan_cap_stmt
  -- counts `where account_id = …` with no lifecycle filter, so the vehicle this
  -- function just archived still occupies a slot on the SENDER's plan. Product
  -- decision 5 says it should not. That fix belongs to the cap function, not
  -- here; see the closing note.
  insert into public.vehicles (
    account_id, license_plate, manufacturer, model, year,
    vehicle_type, current_km, first_registration_date, vin, ownership_hand
  )
  select v_to, v.license_plate, v.manufacturer, v.model, v.year,
         v.vehicle_type, v.current_km, v.first_registration_date, v.vin, v.ownership_hand
    from public.vehicles v where v.id = t.vehicle_id
  returning id into v_new;

  -- created_at is carried over deliberately: it is the recipient's only honest
  -- signal that this history accumulated over years rather than the week of
  -- the sale.
  if coalesce((v_manifest->>'services')::boolean, true) then
    insert into public.maintenance_logs (
      vehicle_id, type, title, date, cost, notes,
      km_at_service, garage_name, performed_by, created_at, source_transfer_id
    )
    select v_new, m.type, m.title, m.date,
           case when coalesce((v_manifest->>'costs')::boolean, false) then m.cost else null end,
           m.notes, m.km_at_service, m.garage_name, m.performed_by, m.created_at, t.id
      from public.maintenance_logs m where m.vehicle_id = t.vehicle_id;
  end if;

  if coalesce((v_manifest->>'accidents')::boolean, true) then
    insert into public.accidents (
      account_id, vehicle_id, date, location, description, status,
      damage_description, other_driver_plate, other_driver_manufacturer,
      other_driver_model, other_driver_year, created_at, source_transfer_id
    )
    select v_to, v_new, a.date, a.location, a.description, a.status,
           a.damage_description, a.other_driver_plate, a.other_driver_manufacturer,
           a.other_driver_model, a.other_driver_year, a.created_at, t.id
      from public.accidents a where a.vehicle_id = t.vehicle_id;
  end if;

  update public.vehicles
     set lifecycle = 'sold_archive', sold_at = now()
   where id = t.vehicle_id;

  update public.vehicle_transfers
     set status = 'accepted', to_user_id = uid, to_account_id = v_to, responded_at = now()
   where id = t.id;

  -- Notify the SENDER. Both sides hear about every outcome.
  --
  -- nickname first here, and deliberately NOT in the notifications that go to
  -- the recipient: this one is read by the person who chose the nickname, so
  -- it is the label they recognise, while "האוטו של אבא" means nothing to a
  -- buyer and is the sender's private wording.
  select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_label
    from public.vehicles where id = t.vehicle_id;
  -- auth.users, same reason.
  select coalesce(au.raw_user_meta_data->>'full_name', au.email, 'המשתמש') into v_taker
    from auth.users au where au.id = uid;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (
    t.from_user_id, 'transfer_accepted',
    'ההעברה הושלמה',
    coalesce(v_taker, 'המשתמש') || ' קיבל/ה את ' || v_label
      || '. הרכב עבר אצלך לארכיון ונשאר לקריאה בלבד.',
    jsonb_build_object('transfer_id', t.id, 'vehicle_id', t.vehicle_id, 'vehicle_label', v_label)
  );

  return jsonb_build_object('vehicle_id', v_new, 'transfer_id', t.id);
end;
$$;

-- ── 9. decline / cancel ───────────────────────────────────────────────────
-- Takes EITHER identifier, exactly like accept. A recipient who arrived from
-- the link holds a token and never sees the row id, and "accept or decline"
-- has to be one screen with two buttons — offering only accept to a
-- link-arriving user would push every refusal into silence, and silence is
-- indistinguishable from "has not read it yet" on the sender's side.
create or replace function public.decline_vehicle_transfer(
  p_transfer_id uuid default null,
  p_token       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t   public.vehicle_transfers;
  v_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  if p_transfer_id is not null then
    select * into t from public.vehicle_transfers where id = p_transfer_id for update;
  elsif p_token is not null then
    select * into t from public.vehicle_transfers where invite_token = p_token for update;
  else
    raise exception 'missing_transfer_id_or_token';
  end if;

  if not found then raise exception 'transfer_not_found'; end if;
  if t.status <> 'pending' then raise exception 'transfer_not_pending'; end if;

  if not exists (select 1 from auth.users where id = uid and lower(email) = lower(t.to_email)) then
    raise exception 'transfer_email_mismatch';
  end if;

  update public.vehicle_transfers
     set status = 'declined', responded_at = now(), to_user_id = uid
   where id = t.id;

  -- Sender-facing, so the sender's own nickname is the right label.
  select coalesce(nickname, manufacturer || ' ' || model, license_plate, 'הרכב') into v_label
    from public.vehicles where id = t.vehicle_id;

  insert into public.app_notifications (user_id, type, title, body, data)
  values (t.from_user_id, 'transfer_declined', 'ההעברה נדחתה',
          'ההצעה להעביר את ' || v_label || ' נדחתה. הרכב נשאר אצלך ללא שינוי.',
          jsonb_build_object('transfer_id', t.id, 'vehicle_id', t.vehicle_id));
end;
$$;

create or replace function public.cancel_vehicle_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t   public.vehicle_transfers;
  v_label text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into t from public.vehicle_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer_not_found'; end if;
  if t.from_user_id <> uid then raise exception 'not_transfer_sender'; end if;
  if t.status <> 'pending' then raise exception 'transfer_not_pending'; end if;

  update public.vehicle_transfers
     set status = 'cancelled', responded_at = now()
   where id = t.id;

  if t.to_user_id is not null then
    select coalesce(manufacturer || ' ' || model, license_plate, 'הרכב') into v_label
      from public.vehicles where id = t.vehicle_id;
    insert into public.app_notifications (user_id, type, title, body, data)
    values (t.to_user_id, 'transfer_cancelled', 'ההעברה בוטלה',
            'ההצעה להעביר אליך את ' || v_label || ' בוטלה על ידי השולח.',
            jsonb_build_object('transfer_id', t.id, 'vehicle_id', t.vehicle_id));
  end if;
end;
$$;

-- ── 10. list ──────────────────────────────────────────────────────────────
create or replace function public.list_vehicle_transfers(p_vehicle_id uuid)
returns table (
  id uuid, to_email text, status text,
  manifest jsonb, created_at timestamptz, expires_at timestamptz, responded_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.to_email, t.status, t.manifest, t.created_at, t.expires_at, t.responded_at
    from public.vehicle_transfers t
    join public.account_members am
      on am.account_id = t.from_account_id
     and am.user_id = auth.uid()
     and am.status = 'פעיל'
   where t.vehicle_id = p_vehicle_id
   order by t.created_at desc;
$$;

-- ── 11. expiry ────────────────────────────────────────────────────────────
-- Sibling of expire_stale_share_invites. Kept separate rather than folded into
-- it: that function is defined in more than one file in this repo, and
-- redefining it from a file instead of from the live database is exactly the
-- trap check_admin_alerts set on 2026-09-10.
create or replace function public.expire_stale_vehicle_transfers()
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  update public.vehicle_transfers
     set status = 'expired', responded_at = now()
   where status = 'pending' and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 12. grants ────────────────────────────────────────────────────────────
revoke all on function public.transfer_vehicle_to_email(uuid, text, jsonb) from public;
revoke all on function public.accept_vehicle_transfer(uuid, text)          from public;
revoke all on function public.decline_vehicle_transfer(uuid, text)         from public;
revoke all on function public.cancel_vehicle_transfer(uuid)                from public;
revoke all on function public.list_vehicle_transfers(uuid)                 from public;
revoke all on function public.preview_vehicle_transfer(text)               from public;

grant execute on function public.transfer_vehicle_to_email(uuid, text, jsonb) to authenticated;
grant execute on function public.accept_vehicle_transfer(uuid, text)          to authenticated;
grant execute on function public.decline_vehicle_transfer(uuid, text)         to authenticated;
grant execute on function public.cancel_vehicle_transfer(uuid)                to authenticated;
grant execute on function public.list_vehicle_transfers(uuid)                 to authenticated;
-- anon too: PATH B opens the link before signing up, and refusing a preview
-- would mean asking a stranger to create an account before showing anything.
grant execute on function public.preview_vehicle_transfer(text)               to anon, authenticated;

-- ── 13. verify ────────────────────────────────────────────────────────────
-- One paste. Expect: t | 1 | 7 | 2
--
--   select
--     (select relrowsecurity from pg_class
--       where oid = 'public.vehicle_transfers'::regclass)                   as rls_on,
--     (select count(*) from pg_policies
--       where schemaname='public' and tablename='vehicle_transfers')        as policies,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname in
--       ('transfer_vehicle_to_email','preview_vehicle_transfer','accept_vehicle_transfer',
--        'decline_vehicle_transfer','cancel_vehicle_transfer','list_vehicle_transfers',
--        'expire_stale_vehicle_transfers'))                                 as rpcs,
--     (select count(*) from pg_trigger
--       where tgname in ('maintenance_logs_freeze','accidents_freeze'))     as freezes;
--
-- A stranger's token must reveal nothing. ZERO rows, not an error:
--   select * from public.preview_vehicle_transfer('not-a-real-token');
--
-- Nothing existing changed shape:
--   select count(*) from public.vehicles where lifecycle <> 'active';   -- 0
--
-- ROLLBACK:
--   drop function if exists public.expire_stale_vehicle_transfers();
--   drop function if exists public.list_vehicle_transfers(uuid);
--   drop function if exists public.cancel_vehicle_transfer(uuid);
--   drop function if exists public.decline_vehicle_transfer(uuid, text);
--   drop function if exists public.accept_vehicle_transfer(uuid, text);
--   drop function if exists public.preview_vehicle_transfer(text);
--   drop function if exists public.transfer_vehicle_to_email(uuid, text, jsonb);
--   drop trigger  if exists accidents_freeze on public.accidents;
--   drop trigger  if exists maintenance_logs_freeze on public.maintenance_logs;
--   drop function if exists public.block_edit_while_transfer_pending();
--   alter table public.accidents        drop column if exists source_transfer_id;
--   alter table public.maintenance_logs drop column if exists source_transfer_id;
--   drop table if exists public.vehicle_transfers;
--   alter table public.vehicles drop column if exists sold_at, drop column if exists lifecycle;
--
-- ── still owed, deliberately not here ─────────────────────────────────────
-- • The cap must stop counting archived vehicles (decision 5), and the 7-day
--   cap grace (decision 4). Both live in the existing cap RPCs, which are
--   defined across more than one file. Changing them safely needs the LIVE
--   definition read back first, so they get their own file.
-- • Attachments (Edge Function, later phase).
-- • Scheduling expire_stale_vehicle_transfers on pg_cron.
