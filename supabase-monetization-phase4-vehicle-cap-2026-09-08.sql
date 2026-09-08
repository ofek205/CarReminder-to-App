-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase4-vehicle-cap-2026-09-08.sql
--
-- Monetization, phase 4: THE FIRST PHASE THAT CAN REFUSE A USER ACTION.
--
--   docs/plan-monetization-implementation.md §2
--
-- ⚠️ READ THIS BEFORE APPLYING. Everything in phases 1 to 3 was inert: a
--   flag that was off, a table that did not exist, a counter nobody read.
--   This file adds a trigger that can make "add a vehicle" fail, and adding
--   a vehicle is the central action of this app. A mistake here is visible
--   to customers.
--
-- ⚠️ AND IT SHIPS DISABLED. The flag row is created as FALSE, so applying
--   this changes nothing until it is deliberately turned on. Do not turn it
--   on before reading verification query 3 in the phase-1 file: this is
--   what makes plan_limits.max_vehicles binding, and if 5 is the wrong
--   number the refusal lands on a cohort whose size has not been measured.
--
-- ⚠️ DEPENDS ON PHASES 1 AND 2b (account_plan with overrides).
--
-- SAFETY: one new function, one new trigger, one new read-only RPC, one
--   app_config row. No existing object is altered. Idempotent. Rollback at
--   the bottom, and the flag is a faster off switch than a rollback.
--
--   CLAUDE.md gate 5: staging shares this database with production.
--
-- APPLY: Supabase SQL Editor, after phases 1 and 2b. Then:
--   node scripts/sql-ledger.cjs record supabase-monetization-phase4-vehicle-cap-2026-09-08.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')           is null then missing := missing || 'table public.plan_limits (phase 1)'; end if;
  if to_regclass('public.account_subscriptions') is null then missing := missing || 'table public.account_subscriptions (phase 1)'; end if;
  if to_regclass('public.vehicles')              is null then missing := missing || 'table public.vehicles'; end if;
  if to_regclass('public.app_config')            is null then missing := missing || 'table public.app_config'; end if;
  if to_regprocedure('public.account_plan(uuid)') is null then missing := missing || 'function public.account_plan(uuid) (phase 1)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'phase 4 preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. the kill switch ────────────────────────────────────────────────────
--
-- ⚠️ TWO DIFFERENT DEFAULTS, AND CONFLATING THEM IS THE BUG TO AVOID.
--
--   The ROW is created FALSE, so applying this file enforces nothing. That
--   is about rollout: a migration must never start refusing customer
--   actions the moment it is pasted.
--
--   The FUNCTION treats a MISSING row as TRUE. That is about failure: once
--   enforcement is live, a deleted row or an unreadable app_config must not
--   silently switch the cap off, because that is a hole in the paywall.
--   §6 of the plan calls for fail-closed here, the opposite of the scan
--   gate's deliberate fail-open.
--
-- So: off by choice, on by accident. Both directions are intentional.
insert into public.app_config (key, value)
values ('vehicle_cap_enforced', 'false'::jsonb)
on conflict (key) do nothing;


-- ── 2. the trigger function ───────────────────────────────────────────────
--
-- WHY STATEMENT-LEVEL WITH A TRANSITION TABLE, not FOR EACH ROW:
--   `new_rows` holds EVERY row of the statement, so count(*) after the
--   insert sees the true final state. One vehicle and an import of 100 are
--   handled by the same code, and the raise rolls back the WHOLE statement,
--   so an import that would cross the cap is refused as a unit rather than
--   landing half in. Two of the paths in §2.1 insert 41 and 20 rows in a
--   single statement, which a row-level trigger would mis-count.
--
-- ⚠️ NO `exception when others`, AND THAT IS A DELIBERATE DEVIATION FROM
--   THE HOUSE PATTERN. community_posts_rate_limit swallows its error and
--   ends up fail-OPEN: `allowed` becomes null, `null = false` evaluates to
--   null, the raise never fires and the insert proceeds. That is right for
--   community posts, where a duplicate post beats blocking a user. It is
--   exactly wrong here, where every swallowed error is a way to skip
--   paying. Anything unexpected must roll the statement back.
create or replace function public.enforce_vehicle_plan_cap_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
    select count(*) into v_count
      from public.vehicles where account_id = r.account_id;

    -- `>` and not `>=`: this runs AFTER the insert, so v_count already
    -- includes the new rows. Landing exactly ON the cap is allowed.
    if v_count > v_max then
      raise exception 'vehicle_plan_cap_exceeded'
        using detail = format('max=%s attempted_total=%s', v_max, v_count),
              hint   = 'upgrade_required';
    end if;
  end loop;

  return null;
end $$;

comment on function public.enforce_vehicle_plan_cap_stmt() is
  'Statement-level vehicle cap. Fail-closed, grace-aware, serialised per account. See docs/plan-monetization-implementation.md §2.2.';

revoke all on function public.enforce_vehicle_plan_cap_stmt() from public;


-- ── 3. the trigger ────────────────────────────────────────────────────────
--
-- AFTER INSERT FOR EACH STATEMENT does not compete for ordering with the
-- two existing BEFORE INSERT triggers on this table
-- (vehicles_stamp_mileage_update_date, trg_vehicles_first_reminder_armed_at),
-- which Postgres fires alphabetically among themselves.
--
-- ⚠️ VERIFY THE LIVE TRIGGER LIST BEFORE TRUSTING THAT. The .sql files in
-- this repo are one-shot scripts, not a verified schema snapshot, and
-- nothing records whether those four triggers were ever applied to
-- production. Verification query 4 below reads pg_trigger directly.
drop trigger if exists trg_vehicle_plan_cap_stmt on public.vehicles;
create trigger trg_vehicle_plan_cap_stmt
  after insert on public.vehicles
  referencing new table as new_rows
  for each statement
  execute function public.enforce_vehicle_plan_cap_stmt();


-- ── 4. vehicle_cap_room(): the pre-flight the bulk import needs ───────────
--
-- ⚠️ WHY A SEPARATE PRE-CHECK EXISTS AT ALL. bulk_add_vehicles wraps EVERY
--   insert in its own `exception when others` handler
--   (supabase-phase9-bulk-vehicles.sql:110), so the trigger's raise is
--   caught there, counted into error_count, and the loop continues. The RPC
--   then returns HTTP 200 with a partial success. Worse, the client reads
--   only added_count and never errors, so a user importing 50 vehicles into
--   a cap-5 account sees "5 רכבים נוספו לצי" and no explanation at all.
--
--   The trigger is still the backstop for the other six insert paths. This
--   function lets the client ask FIRST and refuse the whole import with a
--   real message.
--
--   The complete fix in §2.2 also wants a pre-check inside the RPC itself,
--   outside every handler. That is deliberately NOT done here: the RPC is
--   SECURITY DEFINER and its live definition has not been verified against
--   this repo, and rewriting a definer function on that basis is how you
--   break bulk import for everyone. Verify it, then add the check.
--
-- Read-only, membership-gated, and honest about grace and unlimited plans.
create or replace function public.vehicle_cap_room(p_account_id uuid, p_adding int default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
  select count(*) into v_count from public.vehicles where account_id = p_account_id;
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
end $$;

revoke all on function public.vehicle_cap_room(uuid, int) from public;
grant execute on function public.vehicle_cap_room(uuid, int) to authenticated;


-- ── 5. VERIFICATION ───────────────────────────────────────────────────────
--
-- ⚠️ RUN 1 AND 2 WHILE THE FLAG IS STILL FALSE.
--
-- 1) Applying changed nothing yet:
--      select value from public.app_config where key = 'vehicle_cap_enforced';
--      -- expect: false
--
-- 2) Adding a vehicle still works for an account over the cap. Use a test
--    account. If this refuses anything, STOP: the flag is not being read.
--
-- 3) Now turn it on for ONE test account only by leaving the flag false and
--    calling the function directly, rather than flipping it globally:
--      select * from public.vehicle_cap_room('<test account>', 1);
--      -- expect: {cap, used, adding, in_grace, fits}
--
-- 4) The live trigger list on vehicles, because the repo is not a schema
--    snapshot and §2.4's ordering claim rests on this:
--      select tgname, tgtype, tgenabled
--        from pg_trigger
--       where tgrelid = 'public.vehicles'::regclass and not tgisinternal
--       order by tgname;
--      -- expect trg_vehicle_plan_cap_stmt present and enabled
--
-- 5) A grandfathered account is NOT refused while in grace:
--      select public.vehicle_cap_room('<account with grace_until in future>', 1);
--      -- expect: fits = true, in_grace = true
--
-- 6) THE REAL TEST, and only on a disposable account. Flip the flag on,
--    then try to insert one vehicle past the cap:
--      -- expect: ERROR vehicle_plan_cap_exceeded, and the row NOT created
--      select count(*) from public.vehicles where account_id = '<test>';
--
-- 7) And an import that crosses the cap is refused AS A WHOLE, not half:
--      insert into public.vehicles (account_id, license_plate)
--      select '<test>', 'T' || g from generate_series(1, 50) g;
--      -- expect: one error, zero rows added
--
-- TO DISABLE INSTANTLY (faster and safer than a rollback):
--   insert into public.app_config (key, value) values ('vehicle_cap_enforced','false'::jsonb)
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- ROLLBACK:
--   drop trigger if exists trg_vehicle_plan_cap_stmt on public.vehicles;
--   drop function if exists public.enforce_vehicle_plan_cap_stmt();
--   drop function if exists public.vehicle_cap_room(uuid, int);
--   delete from public.app_config where key = 'vehicle_cap_enforced';
