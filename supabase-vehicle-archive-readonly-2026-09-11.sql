-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-vehicle-archive-readonly-2026-09-11.sql
--
-- Makes `lifecycle = 'sold_archive'` mean what the app already tells users it
-- means. Sequel to supabase-vehicle-transfer-2026-09-11.sql, which is applied
-- and recorded and therefore must not be edited — hence a second file.
--
-- ═══ WHY THIS EXISTS ══════════════════════════════════════════════════════
--
-- The transfer UI promises the seller, in two places and in these words:
-- "הרכב יעבור אצלך לארכיון לקריאה בלבד". After the first file, none of that
-- was true. `lifecycle` was a column nothing consulted:
--
--   • the archived vehicle stayed fully editable
--   • it kept occupying a slot against the seller's plan cap
--
-- The freeze trigger installed by the first file only covers the window while
-- an offer is PENDING. The moment the offer is accepted it stops applying,
-- which is precisely when the archive is supposed to begin.
--
-- ═══ THE CAP CHANGE MOVES TWO FUNCTIONS, NOT ONE ══════════════════════════
--
-- enforce_vehicle_plan_cap_stmt (the trigger) and vehicle_cap_room (the
-- pre-flight the client asks before it offers to add) count the same thing,
-- and vehicle_cap_room's own comment says why they must agree: if they ever
-- disagree, the client shows a refusal the database would have allowed, or
-- promises room the database then refuses. So both get the same predicate in
-- the same file.
--
-- Both bodies below were read back from the LIVE database with
-- pg_get_functiondef on 2026-09-11 and are reproduced VERBATIM apart from the
-- one added line, comments included. That matters here more than usual: this
-- RPC is defined in more than one file in this repo, so recreating it from a
-- file instead of from the database is how hardening silently gets reverted.
--
-- Product decision 5: an archived vehicle does not count against the cap. The
-- seller no longer owns the car; charging them a slot for the memory of it is
-- the opposite of what the feature is for.
--
-- ═══ WHAT STAYS ALLOWED ON AN ARCHIVED VEHICLE ════════════════════════════
--
--   DELETE. The seller may throw their own archive away. It costs the
--   recipient nothing: accept_vehicle_transfer COPIES the history rather than
--   re-pointing it, so the two records are independent from the moment of
--   acceptance.
--
--   Anything done by a SECURITY DEFINER function or from the SQL editor. The
--   guard is `current_user in ('authenticated','anon')`, and inside a SECURITY
--   DEFINER function current_user is the function's owner. So the archiving
--   UPDATE inside accept_vehicle_transfer is not blocked by the trigger this
--   file installs, and neither is a deliberate un-archive run by hand:
--     update public.vehicles set lifecycle='active', sold_at=null where id='…';
--
-- SAFETY
--   Idempotent and re-runnable. Adds one predicate to two existing functions,
--   replaces one trigger function with a wider one, and adds one trigger.
--   Changes no data. The cap change can only ever RELAX a refusal, never
--   introduce one, because it removes rows from a count.
--
-- APPLY
--   Supabase SQL Editor, once, then:
--     node scripts/sql-ledger.cjs record supabase-vehicle-archive-readonly-2026-09-11.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. pre-flight ─────────────────────────────────────────────────────────
-- Refuse to run at all if the first file was never applied. Without
-- vehicles.lifecycle every statement below is meaningless, and a half-applied
-- pair is worse than neither.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vehicles' and column_name = 'lifecycle'
  ) then
    raise exception 'vehicles.lifecycle is missing. Apply supabase-vehicle-transfer-2026-09-11.sql first.';
  end if;
end $$;


-- ── 1. the cap stops counting archived vehicles ───────────────────────────
create or replace function public.enforce_vehicle_plan_cap_stmt()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r        record;
  v_max    int;
  v_count  int;
  v_grace  timestamptz;
  v_on     boolean;
begin
  -- Missing row or unreadable value = ENFORCING. See §1 above.
  select coalesce((value #>> '{}')::boolean, true) into v_on
    from public.app_config where key = 'vehicle_cap_enforced';
  if not found then v_on := true; end if;
  if v_on is distinct from true then
    return null;
  end if;

  -- distinct: one statement can touch several accounts.
  for r in select distinct account_id from new_rows where account_id is not null loop

    -- ⚠️ SERIALISE PER ACCOUNT. Without this, two concurrent inserts each
    -- read a count below the cap and both commit, landing the account over
    -- the limit. Locking the subscription row makes the account a logical
    -- bottleneck for an instant. Adding a vehicle is a rare action, so the
    -- cost is nothing.
    perform 1 from public.account_subscriptions
      where account_id = r.account_id for update;

    select max_vehicles into v_max from public.account_plan(r.account_id);
    -- NULL cap = unlimited plan. Nothing to enforce.
    if v_max is null then continue; end if;

    -- ⚠️ GRACE SUSPENDS ENFORCEMENT, AND THE PLAN DOCUMENT DOES NOT SAY SO.
    --   account_plan() folds grace into WHICH plan applies, but a
    --   grandfathered free account still resolves to free/5 while holding
    --   twelve vehicles, so the trigger as written in §2.2 would refuse it
    --   on day one. That is precisely what the 60-day window exists to
    --   prevent: phase 1 grants grace to accounts already over the cap and
    --   to every business account, so without this branch the backfill's
    --   whole purpose is defeated and the most established customers are
    --   the first to be blocked.
    --
    --   ⚠️ QUESTION FOR OFEK, in docs/open-questions-monetization.md: this
    --   means an account inside its grace window can keep ADDING vehicles.
    --   The alternative reading, "keep what you have, add nothing", would
    --   refuse on day one and make grace meaningless for the only action
    --   the cap governs. Suspending is the generous reading and matches
    --   §5.6's ordering, where "read-only above the cap" is the state AFTER
    --   grace ends. Change this branch if the intent was the stricter one.
    select grace_until into v_grace
      from public.account_subscriptions where account_id = r.account_id;
    if v_grace is not null and v_grace > now() then continue; end if;

    -- Owned vehicles only, never my_vehicles_v. A shared vehicle counts
    -- against the OWNER's plan, and counting it twice would refuse the
    -- recipient for someone else's fleet (§2.3, spec §6.4).
    --
    -- ⚠️ ADDED 2026-09-11, and it is the only change to this function:
    -- a vehicle the user has already transferred away is not a vehicle they
    -- own. Without this line a seller who hands over three cars still pays
    -- for three slots forever, and the transfer feature quietly punishes the
    -- people who use it (product decision 5). vehicle_cap_room below carries
    -- the identical predicate; the two must never diverge.
    select count(*) into v_count
      from public.vehicles
     where account_id = r.account_id
       and lifecycle <> 'sold_archive';

    -- `>` and not `>=`: this runs AFTER the insert, so v_count already
    -- includes the new rows. Landing exactly ON the cap is allowed.
    if v_count > v_max then
      raise exception 'vehicle_plan_cap_exceeded'
        using detail = format('max=%s attempted_total=%s', v_max, v_count),
              hint   = 'upgrade_required';
    end if;
  end loop;

  return null;
end $function$;

comment on function public.enforce_vehicle_plan_cap_stmt() is
  'Statement-level vehicle cap. Fail-closed, grace-aware, serialised per account, and blind to sold_archive vehicles. See docs/plan-monetization-implementation.md §2.2.';

revoke all on function public.enforce_vehicle_plan_cap_stmt() from public;


-- ── 2. the pre-flight counts the same way ─────────────────────────────────
create or replace function public.vehicle_cap_room(p_account_id uuid, p_adding integer default 1)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  uid     uuid := auth.uid();
  v_max   int;
  v_count int;
  v_grace timestamptz;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (
        select 1 from public.account_members
         where account_id = p_account_id and user_id = uid and status = 'פעיל'
      )
     and not public.is_admin()
     and not public.is_viewing(p_account_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select max_vehicles into v_max from public.account_plan(p_account_id);
  -- Identical predicate to enforce_vehicle_plan_cap_stmt. See the note there.
  select count(*) into v_count
    from public.vehicles
   where account_id = p_account_id
     and lifecycle <> 'sold_archive';
  select grace_until into v_grace
    from public.account_subscriptions where account_id = p_account_id;

  return jsonb_build_object(
    'cap',        v_max,
    'used',       v_count,
    'adding',     greatest(0, coalesce(p_adding, 1)),
    'in_grace',   (v_grace is not null and v_grace > now()),
    -- Mirrors the trigger exactly, including that grace and a NULL cap both
    -- mean "yes". If these two ever disagree, the client shows a refusal
    -- the database would have allowed, or the reverse.
    'fits',       (
      v_max is null
      or (v_grace is not null and v_grace > now())
      or v_count + greatest(0, coalesce(p_adding, 1)) <= v_max
    )
  );
end $function$;

-- Restated, not changed. CREATE OR REPLACE preserves a function's existing
-- privileges, so these two lines reproduce exactly what
-- supabase-monetization-phase4-vehicle-cap-2026-09-08.sql already granted.
-- They are here because a SECURITY DEFINER function without an explicit revoke
-- is a hazard the pre-push gate refuses, and it is right to: the next person to
-- copy this block would otherwise carry the omission somewhere it matters.
revoke all on function public.vehicle_cap_room(uuid, int) from public;
grant execute on function public.vehicle_cap_room(uuid, int) to authenticated;


-- ── 3. one freeze covering both reasons ───────────────────────────────────
-- Replaces block_edit_while_transfer_pending, whose name described only half
-- of what the app promises. A vehicle's history is frozen while an offer is
-- open (so what was promised is what arrives) AND after it has been handed
-- over (because it is then somebody else's car).
create or replace function public.block_edit_on_frozen_vehicle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_vehicle   uuid := coalesce(new.vehicle_id, old.vehicle_id);
  v_lifecycle text;
begin
  -- Only client-plane writes. Inside a SECURITY DEFINER function current_user
  -- is the function's owner, which is how accept_vehicle_transfer copies rows
  -- and archives the source without tripping its own guard.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  select lifecycle into v_lifecycle from public.vehicles where id = v_vehicle;

  if v_lifecycle = 'sold_archive' then
    raise exception 'vehicle_archived'
      using hint = 'This vehicle was transferred to another owner and is read-only.';
  end if;

  if exists (
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
  for each row execute function public.block_edit_on_frozen_vehicle();

drop trigger if exists accidents_freeze on public.accidents;
create trigger accidents_freeze
  before insert or update or delete on public.accidents
  for each row execute function public.block_edit_on_frozen_vehicle();

-- The old function is now unreferenced. Dropped so a future reader cannot
-- attach a trigger to the version that checks only half the condition.
drop function if exists public.block_edit_while_transfer_pending();


-- ── 4. the vehicle row itself ─────────────────────────────────────────────
-- §3 protects the HISTORY. This protects the car: without it a seller could
-- still rename an archived vehicle, change its mileage, or edit its details,
-- all of which contradict "read-only" just as plainly.
--
-- UPDATE only. DELETE stays allowed — see the header.
create or replace function public.block_update_on_archived_vehicle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.lifecycle = 'sold_archive' then
    raise exception 'vehicle_archived'
      using hint = 'This vehicle was transferred to another owner and is read-only.';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_block_update_when_archived on public.vehicles;
create trigger vehicles_block_update_when_archived
  before update on public.vehicles
  for each row execute function public.block_update_on_archived_vehicle();


-- ── 5. verify ─────────────────────────────────────────────────────────────
-- Expect: 0 | 0 | t | t | 3
--
--   select
--     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='block_edit_while_transfer_pending')
--                                                                as old_fn_gone,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='enforce_vehicle_plan_cap_stmt'
--         and pg_get_functiondef(p.oid) !~ 'sold_archive')        as cap_unfixed,
--     (select pg_get_functiondef(p.oid) ~ 'sold_archive'
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='vehicle_cap_room') as room_fixed,
--     (select pg_get_functiondef(p.oid) ~ 'vehicle_archived'
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname='block_edit_on_frozen_vehicle')
--                                                                as freeze_fixed,
--     (select count(*) from pg_trigger where tgname in
--       ('maintenance_logs_freeze','accidents_freeze',
--        'vehicles_block_update_when_archived'))                  as triggers;
--
-- And the cap must now read the same from both sides for a real account:
--   select public.vehicle_cap_room('<account_id>');
--
-- ROLLBACK (restores the pre-2026-09-11 counting and removes the archive
-- guards; the two cap functions must be restored from the LIVE definitions
-- captured in this file's header, not from any other file in this repo):
--   drop trigger  if exists vehicles_block_update_when_archived on public.vehicles;
--   drop function if exists public.block_update_on_archived_vehicle();
--   -- then re-create enforce_vehicle_plan_cap_stmt and vehicle_cap_room
--   -- WITHOUT the `and lifecycle <> 'sold_archive'` line.
