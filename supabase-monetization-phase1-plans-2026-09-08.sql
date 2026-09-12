-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase1-plans-2026-09-08.sql
--
-- Monetization, phase 1 of 7: plan infrastructure. NO ENFORCEMENT.
--
--   docs/plan-monetization-implementation.md  §1, §4 (phase 1), §6
--   docs/spec-monetization-plans-v2.md        §1 (the four plans)
--
-- WHAT THIS DOES
--   Creates plan_limits (lookup, one row per plan), account_subscriptions
--   (one row per account), the account_plan() resolver, and backfills every
--   existing account onto 'free' with a grace window where one is needed.
--
-- WHAT THIS DOES NOT DO
--   Nothing reads these tables yet. No trigger, no quota, no blocking, no
--   client code. Phase 2 shows the plan to the user, phase 3 counts usage,
--   phase 4 is the first phase that can refuse an action. The ordering is
--   "measure, show, count, block, charge" precisely so the blocking phases
--   arrive after real data exists.
--
-- SAFETY: additive only. Two new tables, one new function, one trigger on a
--   NEW table. Zero change to any existing table, function, policy or
--   trigger. Idempotent and re-runnable. Rollback block at the bottom.
--
--   ⚠️ CLAUDE.md gate 5: staging shares this database with production, so
--   this runs against live data. It is additive, so nothing existing moves.
--
-- APPLY
--   Supabase SQL Editor, once. Then record it:
--     node scripts/sql-ledger.cjs record supabase-monetization-phase1-plans-2026-09-08.sql
--   Verification queries in §6 below. Run them and paste what you saw into
--   p_notes, rather than "applied ok".
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight: fail loudly and early on a missing dependency ───────────
--
-- This file creates four objects and DEPENDS on six it does not create:
-- accounts, account_members, vehicles, is_admin(), is_viewing(uuid) and
-- touch_updated_at(). CLAUDE.md is explicit that the repo is NOT the source
-- of truth for the schema: there are ~199 flat SQL files, no migration
-- runner, and no record of what was applied. touch_updated_at() in
-- particular lives in supabase-base44-migration.sql, the one file classified
-- NEEDS_REVIEW.
--
-- Without this block a missing dependency surfaces as a mid-script error
-- with the tables already created and the backfill half-done. With it, the
-- run stops before writing anything and names what is absent.
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.accounts')        is null then missing := missing || 'table public.accounts'; end if;
  if to_regclass('public.account_members') is null then missing := missing || 'table public.account_members'; end if;
  if to_regclass('public.vehicles')        is null then missing := missing || 'table public.vehicles'; end if;
  if to_regprocedure('public.is_admin()')             is null then missing := missing || 'function public.is_admin()'; end if;
  if to_regprocedure('public.is_viewing(uuid)')       is null then missing := missing || 'function public.is_viewing(uuid)'; end if;
  if to_regprocedure('public.touch_updated_at()')     is null then missing := missing || 'function public.touch_updated_at()'; end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'phase 1 preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. plan_limits: the single source of truth for every limit ────────────
--
-- A table rather than constants in code, so changing a limit is one UPDATE
-- with no deploy, and so the pricing page and the enforcement read the same
-- row. Marketing and enforcement cannot contradict each other if there is
-- only one number.
--
-- NULL means unlimited, everywhere in this table. That is why the columns
-- are nullable ints and not "-1 = unlimited" sentinels: NULL propagates
-- correctly through comparisons (`count >= NULL` is NULL, never true), so a
-- missing limit cannot accidentally block someone. §3.5.3 of the plan uses a
-- -1 sentinel for the ADMIN OVERRIDE columns for the opposite reason, where
-- NULL has to mean "no override".
create table if not exists public.plan_limits (
  plan                   text primary key,
  label_he               text        not null,
  price_ils_month        numeric(6,2) not null,
  max_vehicles           int,
  ai_daily_cap           int,
  ai_lifetime_teaser     int,
  plate_checks_per_month int,
  max_shares             int,
  business_ui            boolean     not null default false,
  sort_order             int         not null
);

comment on table public.plan_limits is
  'Monetization plan limits. NULL = unlimited. Change a limit with UPDATE, never a deploy. See docs/spec-monetization-plans-v2.md.';

-- Seed. ON CONFLICT DO NOTHING, deliberately: this file is a seeder, not an
-- overwriter. Once a price or a cap is tuned with an UPDATE in production,
-- re-running this file must not silently revert it.
--
-- ⚠️ PLAN CODE IS 'p49', NOT THE 'p50' IN THE PLAN DOC. The top tier was
-- ₪50 when that doc was written and is now ₪49. A code reading p50 beside a
-- price reading 49 is a trap for whoever reads it next.
insert into public.plan_limits
  (plan,   label_he, price_ils_month, max_vehicles, ai_daily_cap, ai_lifetime_teaser, plate_checks_per_month, max_shares, business_ui, sort_order)
values
  ('free', 'חינם',              0.00,    5,    null,    1,       3,    2, false, 1),
  ('p9',   '₪9 לחודש',          9.00,   10,      50, null,    null, null, true,  2),
  ('p19',  '₪19 לחודש',        19.00,   30,     200, null,    null, null, true,  3),
  ('p49',  '₪49 לחודש',        49.00, null,     500, null,    null, null, true,  4)
on conflict (plan) do nothing;

-- ⚠️ THREE OF THESE NUMBERS ARE NOT YET DECIDED.
--
--   max_vehicles on 'free' = 5
--     Provisional. spec §ח-1 says the free cap cannot be fixed before
--     admin_vehicle_count_distribution() is read. Note what 5 implies: the
--     CURRENT personal cap is app_config.personal_vehicle_cap defaulting to
--     10 (supabase-vehicle-cap-2026-07-25.sql), so free at 5 TIGHTENS
--     today's limit. Everyone holding 6 to 10 vehicles is fine right now and
--     would be over the free cap. That is exactly what the grace backfill in
--     §4 exists for, and it is the single biggest reason phase 4 must not
--     ship until that distribution has been read.
--
--   ai_daily_cap = 50 / 200 / 500
--     Provisional, from spec §ח-3. The plans advertise "unlimited AI", which
--     at ₪9 gross (₪7.13 to ₪7.32 net) is an uncapped cost against a fixed
--     price: the existing rate limit already permits 10 calls a minute. A
--     fair-use ceiling protects the margin without touching 99% of users.
--     "Unlimited" stays as marketing copy; this is the real server ceiling.
--
--   'free' keeps ai_daily_cap NULL on purpose
--     Free is bounded by ai_lifetime_teaser = 1, one question ever. A daily
--     number next to it would read as a second, contradictory allowance.
--
-- Nothing enforces any of them yet, which is why seeding provisional values
-- is safe. Tune with UPDATE before phase 3, and never edit this file to do
-- it.

alter table public.plan_limits enable row level security;

-- Public information: the pricing page must render for signed-out visitors
-- and guests. No policy for insert/update/delete at all, so only the
-- service role can write, since it bypasses RLS.
drop policy if exists plan_limits_read_all on public.plan_limits;
create policy plan_limits_read_all on public.plan_limits
  for select using (true);


-- ── 2. account_subscriptions: which plan each account is on ──────────────
--
-- account_id is the PRIMARY KEY, so "which row is current" is not a
-- question that can be asked. That is a direct response to the ג11 finding
-- in the membership audit, where invite_account_member_by_email used
-- LIMIT 1 with no ORDER BY and resolved a non-deterministic account. A
-- subscription table with multiple rows per account would reintroduce the
-- same class of bug where it decides what someone paid for.
--
-- Subscription HISTORY (upgrades, charges, refunds) belongs in an
-- append-only subscription_events table in a later phase, never as extra
-- rows here.
create table if not exists public.account_subscriptions (
  account_id               uuid primary key
                             references public.accounts(id) on delete cascade,
  plan                     text        not null default 'free'
                             references public.plan_limits(plan),
  status                   text        not null default 'active',
  current_period_end       timestamptz,
  -- Grace is about the CAP, not about payment: it is what keeps an existing
  -- account that is already over a newly introduced limit from being
  -- refused on the day enforcement lands. Payment trouble is `status`.
  grace_until              timestamptz,
  source                   text        not null default 'default',
  external_customer_id     text,
  external_subscription_id text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint account_subscriptions_status_chk
    check (status in ('active', 'grace', 'past_due', 'canceled')),
  constraint account_subscriptions_source_chk
    check (source in ('checkout', 'iap_apple', 'iap_google', 'admin_grant', 'grandfather', 'default'))
);

comment on table public.account_subscriptions is
  'One row per account: which monetization plan it is on. Client-readable, service-role-writable only. See docs/plan-monetization-implementation.md §1.2.';

-- source allows the two IAP values now even though phase 7 is far away.
-- Adding a value to a CHECK later means an ALTER on a table the enforcement
-- path reads, and the cost of listing them today is nothing.

-- Resolving "is this account still within grace" is a filtered scan the
-- grace banner and the admin exceptions screen both want.
create index if not exists account_subscriptions_grace_idx
  on public.account_subscriptions (grace_until)
  where grace_until is not null;

create index if not exists account_subscriptions_plan_idx
  on public.account_subscriptions (plan);

drop trigger if exists account_subscriptions_touch_tg on public.account_subscriptions;
create trigger account_subscriptions_touch_tg
  before update on public.account_subscriptions
  for each row execute function public.touch_updated_at();

alter table public.account_subscriptions enable row level security;

-- Read: members of the account, plus admins, plus an admin in view-as.
-- Copied from the membership test in my_vehicle_capacity() rather than
-- invented, including status = 'פעיל', which is the literal the 104 other
-- occurrences in this project use.
drop policy if exists account_subscriptions_select_member on public.account_subscriptions;
create policy account_subscriptions_select_member on public.account_subscriptions
  for select using (
    exists (
      select 1 from public.account_members m
       where m.account_id = account_subscriptions.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
    )
    or public.is_admin()
    or public.is_viewing(account_subscriptions.account_id)
  );

-- ⚠️ NO insert / update / delete POLICY, AND THAT IS THE DESIGN.
-- A client must never be able to decide what it paid for. Every write comes
-- from a SECURITY DEFINER RPC or the service role. If a future phase needs
-- a client-side write here, that is a signal the RPC is missing, not that
-- this policy is.


-- ── 3. account_plan(): resolve an account to its effective limits ─────────
--
-- Fail-closed: an account with no subscription row resolves to 'free', never
-- to unlimited. A missing row is the state of every account that existed
-- before this file ran and of every account created before the phase-2 RPC
-- exists, so "no row" has to be the safe answer rather than an open door.
--
-- Grace is honoured here, not at the call sites: an account inside its grace
-- window resolves to its plan even when status has moved on. Putting that in
-- one function is what stops each of the seven insert paths from having its
-- own opinion about grace.
create or replace function public.account_plan(p_account_id uuid)
returns public.plan_limits
language sql
stable
security definer
set search_path = public
as $$
  select pl.*
    from public.plan_limits pl
   where pl.plan = coalesce(
     (select s.plan
        from public.account_subscriptions s
       where s.account_id = p_account_id
         and (s.status = 'active'
              or (s.grace_until is not null and s.grace_until > now()))),
     'free'
   );
$$;

comment on function public.account_plan(uuid) is
  'Effective plan limits for an account. Fail-closed to free. INTERNAL: not granted to authenticated, use my_account_plan(). See docs/plan-monetization-implementation.md §1.4.';

-- ⚠️ NOT granted to authenticated, on purpose. This function has no
-- authorization check because the phase-4 enforcement trigger has to call it
-- while acting on behalf of whoever is inserting, and a membership test
-- there would break admin grants running as the service role. Exposing an
-- unchecked SECURITY DEFINER function to clients would let anyone read any
-- account's plan by id. Callers inside other SECURITY DEFINER functions
-- still reach it, because the effective user there is the owner.
revoke all on function public.account_plan(uuid) from public;
revoke all on function public.account_plan(uuid) from authenticated;
revoke all on function public.account_plan(uuid) from anon;

-- The client-facing wrapper: same answer, with the project's standard
-- membership gate in front of it. This is what phase 2's useAccountPlan()
-- hook will call.
create or replace function public.my_account_plan(p_account_id uuid)
returns public.plan_limits
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_plan public.plan_limits;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Same test as my_vehicle_capacity(): a member, an admin, or an admin
  -- impersonating this account. Plan is not a secret, but scoping stops
  -- enumeration of who pays for what.
  if not exists (
        select 1 from public.account_members
         where account_id = p_account_id
           and user_id    = uid
           and status     = 'פעיל'
      )
     and not public.is_admin()
     and not public.is_viewing(p_account_id) then
    raise exception 'forbidden';
  end if;

  -- Direct assignment, not `select * into`: account_plan returns a single
  -- composite, so assigning it is unambiguous, while `select *` relies on
  -- the composite expanding into columns in exactly the declared order.
  v_plan := public.account_plan(p_account_id);
  return v_plan;
end $$;

comment on function public.my_account_plan(uuid) is
  'Membership-scoped wrapper over account_plan(). This is the client entry point.';

revoke all on function public.my_account_plan(uuid) from public;
grant execute on function public.my_account_plan(uuid) to authenticated;


-- ── 4. backfill: every existing account onto free, with grace where due ───
--
-- Two groups get a 60-day grace window (spec §5, "אורך החסד 60 יום"):
--
--   a) accounts already holding more vehicles than the free cap. They are
--      within today's limit of 10 and would be over a free cap of 5 the
--      moment phase 4 lands. Without this they would be refused on day one
--      for something they did before the rule existed.
--
--   b) BUSINESS accounts, all of them. Today a business account has no
--      vehicle cap at all (my_vehicle_capacity returns isCapped false for
--      type <> 'personal'), and every one of them was created through
--      admin-reviewed request_business_workspace rather than by paying.
--      Backfilling them to free WITHOUT grace would cap admin-approved
--      fleets at five vehicles. Grace buys 60 days to assign real plans
--      through the phase-2 admin UI.
--
-- Owned vehicles only. Shared vehicles must not count toward the owner's
-- cap, which is the documented reason my_vehicle_capacity() asks the server
-- instead of counting a merged list client-side.
--
-- ON CONFLICT DO NOTHING: re-running never disturbs an account whose plan
-- has since been set by a human or a checkout.
-- The "needs grace" test is written ONCE, in the CTE. Spelling it out twice,
-- in a source CASE and again in a grace_until CASE, would be two copies of
-- one rule: edit one and you get an account marked 'grandfather' with no
-- grace, or grace with no explanation of why it has it.
with free_cap as (
  select max_vehicles from public.plan_limits where plan = 'free'
),
scored as (
  select
    a.id,
    (a.type is distinct from 'personal') as is_business,
    -- Owned vehicles only. Shared vehicles must not count toward the
    -- owner's cap, the documented reason my_vehicle_capacity() asks the
    -- server rather than counting a merged list client-side.
    (select count(*) from public.vehicles v where v.account_id = a.id) as owned
  from public.accounts a
)
insert into public.account_subscriptions (account_id, plan, status, source, grace_until)
select
  s.id,
  'free',
  'active',
  case when s.is_business or s.owned > fc.max_vehicles then 'grandfather' else 'default' end,
  case when s.is_business or s.owned > fc.max_vehicles then now() + interval '60 days' else null end
from scored s cross join free_cap fc
on conflict (account_id) do nothing;

-- ⚠️ `a.type is distinct from 'personal'` deliberately catches NULL too. An
-- account whose type is unknown is treated as business, which means it gets
-- grace. That is the safe direction: the cost of an unnecessary 60-day grace
-- is nothing, and the cost of missing one is a real account refused on the
-- day phase 4 lands.
--
-- ⚠️ If free.max_vehicles is ever set to NULL (unlimited free), the
-- comparison yields NULL, nobody counts as over the cap, and only business
-- accounts get grace. That is correct, and it is why the cap is read from
-- the table here rather than hardcoded as 5.

-- ⚠️ NEW accounts created after this runs get NO row, and therefore resolve
-- to 'free' with NO grace, which is correct: a brand-new account has never
-- been over any limit. handle_new_user does not need to change for phase 1.
-- Phase 2 adds the row when it starts showing the plan.
--
-- ⚠️ AND THIS GRACE IS A CLOCK. It starts now, not when phase 4 ships. If
-- phase 4 is more than 60 days out, the grace has to be extended before it
-- lands, or the grandfathered accounts get blocked with no warning window
-- and no banner ever shown, because the banner is phase 2. Verification
-- query 5 below is how you check how much of it is left.


-- ── 5. permissions ────────────────────────────────────────────────────────
grant select on public.plan_limits to anon, authenticated;
grant select on public.account_subscriptions to authenticated;


-- ── 6. VERIFICATION: run these, and record what you actually saw ──────────
--
-- 1) Four plans, priced 0 / 9 / 19 / 49, caps 5 / 10 / 30 / NULL:
--      select plan, price_ils_month, max_vehicles, business_ui
--        from public.plan_limits order by sort_order;
--
-- 2) Every account has exactly one row, and none was missed:
--      select (select count(*) from public.accounts)            as accounts,
--             (select count(*) from public.account_subscriptions) as subs;
--
-- 3) How many accounts are already over a free cap of 5, and how far over.
--    THIS IS THE NUMBER THAT DECIDES WHETHER 5 IS THE RIGHT FREE CAP, and
--    it answers the part of §ח-1 the admin chart cannot, because that chart
--    buckets everything above 10 into a single "10+" column:
--      select case when c.n > 30 then '30+'
--                  when c.n > 10 then '11-30'
--                  when c.n > 5  then '6-10'
--                  else '0-5' end as bucket,
--             count(*) as accounts
--        from (select a.id,
--                     (select count(*) from public.vehicles v
--                       where v.account_id = a.id) as n
--                from public.accounts a
--               where a.type = 'personal') c
--       group by 1 order by 1;
--
-- 4) The grace cohort, split by reason:
--      select source, count(*), min(grace_until), max(grace_until)
--        from public.account_subscriptions
--       group by source order by 2 desc;
--
-- 5) Days of grace remaining. Re-run this before shipping phase 4:
--      select min(grace_until - now()) as least_remaining
--        from public.account_subscriptions where grace_until is not null;
--
-- 6) Fail-closed holds for an account with no row:
--      select plan, max_vehicles
--        from public.account_plan('00000000-0000-0000-0000-000000000000');
--      -- expect: free, 5
--
-- 7) The client wrapper refuses a foreign account (run as a normal user):
--      select * from public.my_account_plan('<someone else''s account id>');
--      -- expect: ERROR forbidden
--
-- ROLLBACK (nothing reads these yet, so this is clean):
--   drop function if exists public.my_account_plan(uuid);
--   drop function if exists public.account_plan(uuid);
--   drop table if exists public.account_subscriptions;
--   drop table if exists public.plan_limits;
