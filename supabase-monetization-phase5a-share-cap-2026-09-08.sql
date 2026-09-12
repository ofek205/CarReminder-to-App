-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase5a-share-cap-2026-09-08.sql
--
-- Monetization, phase 5a: the per-ACCOUNT share cap (plan_limits.max_shares).
--
--   docs/plan-monetization-implementation.md §3.3
--
-- ⚠️ SHIPS DISABLED, like phase 4. The flag row is created FALSE.
--
-- ⚠️ DEPENDS ON PHASE 1 (plan_limits, account_subscriptions, account_plan).
--
-- ⚠️ THERE ARE ALREADY TWO PER-VEHICLE CAPS AND THIS IS A THIRD AXIS.
--   Do not confuse them, and do not try to merge them:
--
--     trg_vshare_cap                 3 recipients PER VEHICLE, counting
--     (supabase-vehicle-shares.sql)  'accepted' only, firing only on the
--                                    transition INTO accepted.
--
--     share_vehicle_with_email       3 PER VEHICLE, counting
--     (the deployed RPC body)        'pending' + 'accepted', raising
--                                    max_shares_per_vehicle.
--
--     THIS FILE                      max_shares PER ACCOUNT, from the plan.
--
--   All three coexist. A user can be under the plan cap and still blocked by
--   the per-vehicle cap, and the two refusals must read differently or the
--   message will be wrong half the time.
--
-- APPLY: Supabase SQL Editor, after phase 1. Then:
--   node scripts/sql-ledger.cjs record supabase-monetization-phase5a-share-cap-2026-09-08.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')           is null then missing := missing || 'table public.plan_limits (phase 1)'; end if;
  if to_regclass('public.account_subscriptions') is null then missing := missing || 'table public.account_subscriptions (phase 1)'; end if;
  if to_regclass('public.vehicle_shares')        is null then missing := missing || 'table public.vehicle_shares'; end if;
  if to_regclass('public.vehicles')              is null then missing := missing || 'table public.vehicles'; end if;
  if to_regprocedure('public.account_plan(uuid)') is null then missing := missing || 'function public.account_plan(uuid) (phase 1)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'phase 5a preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. kill switch, created OFF ───────────────────────────────────────────
-- Same two-defaults design as phase 4: the ROW is false so applying changes
-- nothing, while a MISSING row reads as true so a deleted row cannot quietly
-- switch the paywall off.
insert into public.app_config (key, value)
values ('share_cap_enforced', 'false'::jsonb)
on conflict (key) do nothing;


-- ── 2. index for the count ────────────────────────────────────────────────
-- §3.3: vehicle_shares has no index that serves "how many live shares does
-- this ACCOUNT have". The count joins through vehicles, so the useful index
-- is on the share side of that join, restricted to the statuses that occupy
-- a slot.
create index if not exists vehicle_shares_live_by_vehicle_idx
  on public.vehicle_shares (vehicle_id)
  where status in ('pending', 'accepted');


-- ── 3. the trigger function ───────────────────────────────────────────────
--
-- WHY A TRIGGER AND NOT THE RPC BODY: share_vehicle_with_email has been
-- CREATE OR REPLACE'd four times in this repo and the live body is only one
-- of them. A cap in the RPC would protect whichever body happens to be
-- deployed; a cap in the trigger cannot be routed around, and RLS has no
-- INSERT policy on this table precisely because every write goes through a
-- SECURITY DEFINER RPC.
--
-- ⚠️ THE ACCOUNT IS DERIVED THROUGH vehicles, NOT READ FROM
--   vehicle_shares.account_id. That column DOES now exist and the deployed
--   RPC populates it, but only rows written by that body have it: anything
--   older carries NULL, and a cap that silently skips NULL accounts is a
--   cap with a hole. vehicles.account_id is authoritative for every row.
--
--   It is also the right answer on principle (§6.1): the subject of a plan
--   is the ACCOUNT, and owner_user_id diverges from it as soon as a user
--   belongs to more than one account.
--
-- ⚠️ ITS OWN LOCK, ON THE ACCOUNT. The existing hardening takes
--   pg_advisory_xact_lock(vehicle_id), which serialises two invitations for
--   the SAME vehicle and does nothing for two invitations on DIFFERENT
--   vehicles of one account, which is exactly the race an account-wide cap
--   has to survive.
--
-- ⚠️ NO `exception when others`. Same reasoning as phase 4: a swallowed
--   error here is a way to exceed a paid limit for free.
create or replace function public.enforce_account_share_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_max     int;
  v_count   int;
  v_grace   timestamptz;
  v_on      boolean;
begin
  -- Only statuses that OCCUPY a slot matter. §3.3: counting 'accepted' only
  -- would let a free user hold unlimited PENDING invitations, and the cap
  -- would then bite at acceptance time, which is an action taken by someone
  -- ELSE. Counting pending means the cap bites while the inviter is present
  -- and can do something about it.
  if new.status not in ('pending', 'accepted') then
    return new;
  end if;

  select coalesce((value #>> '{}')::boolean, true) into v_on
    from public.app_config where key = 'share_cap_enforced';
  if not found then v_on := true; end if;
  if v_on is distinct from true then
    return new;
  end if;

  select v.account_id into v_account
    from public.vehicles v where v.id = new.vehicle_id;
  if v_account is null then
    -- No account to charge. Not a hole: a share whose vehicle does not
    -- exist cannot pass the table's own foreign key.
    return new;
  end if;

  -- Serialise per ACCOUNT. See the note above about the existing per-vehicle
  -- advisory lock being insufficient here.
  perform pg_advisory_xact_lock(hashtext('acct_share_cap:' || v_account::text));

  select max_shares into v_max from public.account_plan(v_account);
  if v_max is null then return new; end if;         -- unlimited plan

  -- Grace suspends enforcement, matching phase 4. An account grandfathered
  -- over a newly introduced limit must not be refused on day one.
  select grace_until into v_grace
    from public.account_subscriptions where account_id = v_account;
  if v_grace is not null and v_grace > now() then return new; end if;

  -- ⚠️ `revoked` and `expired` FREE UP A SLOT, deliberately. §3.3 notes
  --   that `revoked` conflates three different things: the owner cancelling
  --   (:507), the recipient leaving (:561), and a DECLINE (:459), because
  --   there is no separate `declined` value. So "did this share occupy a
  --   slot" is not answerable from status alone for revoked rows. Treating
  --   them as free is the generous reading and the simple one.
  select count(*) into v_count
    from public.vehicle_shares s
    join public.vehicles v on v.id = s.vehicle_id
   where v.account_id = v_account
     and s.status in ('pending', 'accepted')
     and s.id <> new.id;

  if v_count + 1 > v_max then
    -- ⚠️ A DISTINCT MESSAGE FROM THE PER-VEHICLE CAPS. "3 recipients for
    --   this vehicle" and "2 shared vehicles on the free plan" are
    --   different problems with different remedies, and reusing
    --   max_shares_per_vehicle here would send the user to remove a
    --   recipient when what they need is a bigger plan.
    raise exception 'account_share_cap_exceeded'
      using detail = format('max=%s current=%s', v_max, v_count),
            hint   = 'upgrade_required';
  end if;

  return new;
end $$;

comment on function public.enforce_account_share_cap() is
  'Per-ACCOUNT share cap from plan_limits.max_shares. Distinct from the two per-VEHICLE caps. See docs/plan-monetization-implementation.md §3.3.';

revoke all on function public.enforce_account_share_cap() from public;


-- ── 4. the trigger ────────────────────────────────────────────────────────
--
-- BEFORE INSERT OR UPDATE FOR EACH ROW, matching the existing trg_vshare_cap
-- so both caps see the same transitions.
--
-- ⚠️ ON FIRING ORDER, WHICH LOOKS LIKE IT MATTERS AND CURRENTLY DOES NOT.
--   Postgres fires same-phase row triggers alphabetically, and
--   trg_account_share_cap sorts BEFORE trg_vshare_cap, so this one runs
--   first and its message would win if both were violated.
--
--   With the seeded plans they cannot both be violated. free.max_shares is
--   2 and every paid plan is NULL:
--     - on free, the account cap of 2 binds before three recipients can
--       exist on any single vehicle, so the per-vehicle cap of 3 is
--       unreachable
--     - on a paid plan, max_shares is NULL and this function returns early,
--       so only the per-vehicle cap applies
--
--   THAT STOPS BEING TRUE the moment any plan sets max_shares to 3 or more.
--   Then both can fire, this one wins on name order, and the user is told to
--   upgrade when removing one recipient would also have worked. If that
--   happens, rename this trigger to sort after trg_vshare_cap so the more
--   specific and cheaper remedy is the one they see.
drop trigger if exists trg_account_share_cap on public.vehicle_shares;
create trigger trg_account_share_cap
  before insert or update on public.vehicle_shares
  for each row execute function public.enforce_account_share_cap();


-- ── 5. VERIFICATION ───────────────────────────────────────────────────────
--
-- 1) Applying changed nothing yet:
--      select value from public.app_config where key = 'share_cap_enforced';
--      -- expect: false
--
-- 2) Both caps present, and the ordering claim in §4 above:
--      select tgname from pg_trigger
--       where tgrelid = 'public.vehicle_shares'::regclass and not tgisinternal
--       order by tgname;
--      -- expect trg_account_share_cap BEFORE trg_vshare_cap
--
-- 3) Sharing still works with the flag off. If anything refuses, STOP.
--
-- 4) The account-wide live count, which is what the cap compares:
--      select v.account_id, count(*) as live_shares
--        from public.vehicle_shares s
--        join public.vehicles v on v.id = s.vehicle_id
--       where s.status in ('pending','accepted')
--       group by v.account_id order by 2 desc limit 20;
--
-- 5) How many accounts a free cap of 2 would already block. Read this
--    BEFORE flipping the flag, the same way the vehicle distribution is
--    read before phase 4:
--      select case when c.n > 2 then 'over 2' else '0-2' end as bucket,
--             count(*) as accounts
--        from (select v.account_id, count(*) as n
--                from public.vehicle_shares s
--                join public.vehicles v on v.id = s.vehicle_id
--               where s.status in ('pending','accepted')
--               group by v.account_id) c
--       group by 1;
--
-- 6) THE REAL TEST, on a disposable account, with the flag on:
--      -- expect: ERROR account_share_cap_exceeded on the third invite
--
-- TO DISABLE INSTANTLY:
--   insert into public.app_config (key, value) values ('share_cap_enforced','false'::jsonb)
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- ROLLBACK:
--   drop trigger if exists trg_account_share_cap on public.vehicle_shares;
--   drop function if exists public.enforce_account_share_cap();
--   drop index if exists public.vehicle_shares_live_by_vehicle_idx;
--   delete from public.app_config where key = 'share_cap_enforced';
