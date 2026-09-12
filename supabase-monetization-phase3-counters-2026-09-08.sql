-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase3-counters-2026-09-08.sql
--
-- Monetization, phase 3: usage counters. COUNTING ONLY, NO ENFORCEMENT.
--
--   docs/plan-monetization-implementation.md §1.3, §3, §4 (phase 3)
--
-- WHY THIS PHASE EXISTS, AND WHY IT COMES BEFORE THE BLOCKING ONES
--   §4 calls this the most important protection in the plan. It buys a week
--   or two of REAL data on how many plate checks and AI questions people
--   actually use, BEFORE anyone is refused. If three checks a month would
--   block 40% of active users, that is discovered from a report rather than
--   from complaints. It is also what settles the open fair-use numbers, so
--   it is not waiting on them.
--
-- ⚠️ DEPENDS ON PHASE 1. The preflight refuses to run without plan_limits
--   and account_subscriptions.
--
-- WHAT THIS ADDS
--   1. feature_usage_counters, one table covering three time horizons.
--   2. usage_period_key(), the Israel-time period key.
--   3. bump_feature_usage(), atomic, INTERNAL (service role / definer only).
--   4. bump_my_feature_usage(), the client entry point, which cannot name
--      another user.
--   5. my_feature_usage(), the read behind the /MyPlan meters.
--
-- SAFETY: additive. One new table, four new functions. No existing object is
--   altered. Idempotent. Rollback block at the bottom.
--
--   ⚠️ CLAUDE.md gate 5: staging shares this database with production.
--
-- APPLY: Supabase SQL Editor, after phase 1. Then:
--   node scripts/sql-ledger.cjs record supabase-monetization-phase3-counters-2026-09-08.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')            is null then missing := missing || 'table public.plan_limits (apply phase 1 first)'; end if;
  if to_regclass('public.account_subscriptions')  is null then missing := missing || 'table public.account_subscriptions (apply phase 1 first)'; end if;
  if to_regclass('public.accounts')               is null then missing := missing || 'table public.accounts'; end if;
  if to_regclass('public.account_members')        is null then missing := missing || 'table public.account_members'; end if;
  if to_regprocedure('public.is_admin()')         is null then missing := missing || 'function public.is_admin()'; end if;
  if to_regprocedure('public.is_viewing(uuid)')   is null then missing := missing || 'function public.is_viewing(uuid)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'phase 3 preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. the counter table ──────────────────────────────────────────────────
--
-- ⚠️ WHY A NEW TABLE AND NOT ai_usage_logs
--   The acceptance criteria require that turning off
--   app_config.ai_usage_tracking_enabled must NOT dissolve the quota. But
--   ai-proxy checks that flag BEFORE it writes to ai_usage_logs, so that
--   table cannot be the source of truth for a quota: switching analytics off
--   would make the allowance infinite, which is the exact opposite of what
--   the AC demands. Writes to THIS table are immune to that flag, and
--   nothing here reads it.
--
-- One table, three horizons, carried by period_key:
--   'lifetime'    the free plan's one-question AI teaser
--   'YYYY-MM'     monthly quotas (plate checks)
--   'YYYY-MM-DD'  daily fair-use ceilings
-- Three horizons in one table rather than three tables, because they differ
-- only in the key.
--
-- user_id is part of the key even where the quota is per-ACCOUNT, so a
-- report can answer "who consumed it". An account total is then
-- sum(count) over the account, and a per-user allowance is the row itself.
create table if not exists public.feature_usage_counters (
  account_id uuid        not null references public.accounts(id) on delete cascade,
  user_id    uuid        not null,
  feature    text        not null,
  period_key text        not null,
  count      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id, feature, period_key),
  constraint feature_usage_counters_count_chk check (count >= 0),
  constraint feature_usage_counters_feature_chk
    check (feature in ('ai_advisor', 'ai_forum', 'plate_check', 'vehicle_share'))
);

-- ⚠️ ADDING A FEATURE NAME REQUIRES EDITING THE CHECK ABOVE, and forgetting
-- to is SILENT. bump_feature_usage would raise 23514, ai-proxy's counter
-- swallows its errors on purpose (an advisor answer must not be lost because
-- a counter could not be written), and the feature would simply never be
-- counted while every screen kept reporting zero.
--
-- 'ai_forum' is the community forum's expert reply, kept separate from
-- 'ai_advisor' because only the advisor bucket is measured against the free
-- plan's lifetime teaser: a forum reply fires when a user POSTS rather than
-- when they ask, so charging it to the teaser would spend a free user's only
-- question on something they never requested. Paid plans' daily ceiling sums
-- both. The routing lives in supabase/functions/_shared/aiQuota.ts.
--
-- If the table already exists when you run this file, the idempotent
-- creation above will NOT amend the constraint. Add the value explicitly:
--   alter table public.feature_usage_counters
--     drop constraint feature_usage_counters_feature_chk,
--     add  constraint feature_usage_counters_feature_chk
--          check (feature in ('ai_advisor','ai_forum','plate_check','vehicle_share'));

comment on table public.feature_usage_counters is
  'Monetization usage counters. Writes are immune to ai_usage_tracking_enabled by design. See docs/plan-monetization-implementation.md §1.3.';

-- The account-wide read the meters and the reports both want.
create index if not exists feature_usage_counters_account_idx
  on public.feature_usage_counters (account_id, feature, period_key);

alter table public.feature_usage_counters enable row level security;

-- Read: members of the account, admins, and an admin in view-as. Copied
-- from my_vehicle_capacity()'s predicate rather than invented, including
-- status = 'פעיל', the literal this project uses.
drop policy if exists feature_usage_counters_select_own on public.feature_usage_counters;
create policy feature_usage_counters_select_own on public.feature_usage_counters
  for select using (
    exists (
      select 1 from public.account_members m
       where m.account_id = feature_usage_counters.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
    )
    or public.is_admin()
    or public.is_viewing(feature_usage_counters.account_id)
  );

-- ⚠️ NO insert / update / delete POLICY, DELIBERATELY. A client that can
-- write its own counter can reset it. Every write goes through the
-- SECURITY DEFINER functions below.


-- ── 2. usage_period_key(): the period key, in Israel time ─────────────────
--
-- ⚠️ Asia/Jerusalem, NOT UTC. A monthly quota keyed on UTC rolls over at
-- 02:00 or 03:00 local, so the last two hours of a month would already be
-- counted against the next one, and a daily ceiling would reset in the
-- middle of the night rather than at midnight. Israel observes DST, so the
-- offset is not constant and cannot be hardcoded.
create or replace function public.usage_period_key(p_horizon text)
returns text
language sql
stable
as $$
  select case p_horizon
    when 'lifetime' then 'lifetime'
    when 'month'    then to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM')
    when 'day'      then to_char(now() at time zone 'Asia/Jerusalem', 'YYYY-MM-DD')
    -- An unknown horizon must NOT silently become 'lifetime', which is the
    -- most permissive bucket for a teaser and the most restrictive for a
    -- ceiling. Fail loudly instead.
    else null
  end;
$$;

comment on function public.usage_period_key(text) is
  'Period key for a usage horizon: lifetime | month | day, in Asia/Jerusalem. NULL for an unknown horizon.';


-- ── 3. bump_feature_usage(): atomic increment, INTERNAL ───────────────────
--
-- ⚠️ ATOMICITY IS THE WHOLE POINT. Read-then-write would let two concurrent
-- requests both see count = 2 against a cap of 3 and both proceed. The
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING is a single statement, so
-- the row is locked and incremented once per call, and the returned value is
-- the caller's own post-increment number. That is what phase 5 will compare
-- against the cap.
--
-- Returns the NEW count.
--
-- NOT granted to authenticated: it takes an arbitrary user_id and
-- account_id, so exposing it would let anyone inflate someone else's usage.
-- The edge function calls it with the service role; clients use
-- bump_my_feature_usage() below.
create or replace function public.bump_feature_usage(
  p_account_id uuid,
  p_user_id    uuid,
  p_feature    text,
  p_horizon    text,
  p_delta      int default 1
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public.usage_period_key(p_horizon);
  v_new int;
begin
  if v_key is null then
    raise exception 'unknown_horizon: %', p_horizon using errcode = '22023';
  end if;
  if p_account_id is null or p_user_id is null then
    raise exception 'account_and_user_required' using errcode = '22023';
  end if;

  insert into public.feature_usage_counters
              (account_id, user_id, feature, period_key, count, updated_at)
       values (p_account_id, p_user_id, p_feature, v_key, greatest(1, coalesce(p_delta, 1)), now())
  on conflict (account_id, user_id, feature, period_key) do update
      set count      = public.feature_usage_counters.count + greatest(1, coalesce(p_delta, 1)),
          updated_at = now()
  returning count into v_new;

  return v_new;
end $$;

revoke all on function public.bump_feature_usage(uuid, uuid, text, text, int) from public;
revoke all on function public.bump_feature_usage(uuid, uuid, text, text, int) from authenticated;
revoke all on function public.bump_feature_usage(uuid, uuid, text, text, int) from anon;
-- ⚠️ AND GRANTED TO service_role, WITHOUT WHICH THIS SILENTLY DOES NOTHING.
--   ai-proxy calls this under the service role. Revoking from PUBLIC removes
--   the default grant that PUBLIC gets on every new function, and nothing
--   restores it for service_role, so the call would fail with "permission
--   denied for function" — get swallowed by the try/catch in
--   countAdvisorUsage, log a warning, and leave the counter at zero forever.
--   A quota built on a counter that never increments is a quota that never
--   fires.
--
--   This is the project's convention, not an invention: see
--   supabase-device-tokens.sql:80 and supabase-phase9-driver-reminders.sql:153.
grant execute on function public.bump_feature_usage(uuid, uuid, text, text, int) to service_role;


-- ── 4. bump_my_feature_usage(): the client entry point ────────────────────
--
-- Needed because the plate-check lookup is a DIRECT browser fetch to
-- data.gov.il with no edge function and no RPC in the path (§3.2), so the
-- only place to count it is a client call made before the lookup.
--
-- ⚠️ IT TAKES NO user_id AND NO account_id. Both are derived from
-- auth.uid(), so a client cannot name another user or another account. That
-- is the difference between this and the internal function above, and it is
-- why the internal one stays revoked.
--
-- ⚠️ AND IT IS STILL SPOOFABLE IN ONE DIRECTION: a caller can decline to
-- call it at all, or call data.gov.il straight from the console. §3.2
-- accepts that knowingly, because what is sold is the formatted report, not
-- the raw JSON, and the plate data is public either way. Real enforcement
-- needs the lookup behind an edge function, which is deliberately out of
-- scope for this version.
create or replace function public.bump_my_feature_usage(
  p_account_id uuid,
  p_feature    text,
  p_horizon    text,
  p_delta      int default 1
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- ⚠️ CLAMPED, BECAUSE THE CLIENT CHOOSES THIS NUMBER. p_delta exists so a
  -- bulk import of N vehicles is one call instead of N, but an unclamped
  -- delta on a quota counter is a gift: a negative value would let a caller
  -- REDUCE its own usage, and a huge one would let it burn someone's
  -- allowance. Only a sane positive batch is accepted.
  if p_delta is null or p_delta < 1 or p_delta > 500 then
    raise exception 'delta_out_of_range' using errcode = '22023';
  end if;

  -- The caller must be a live member of the account they are spending
  -- against. Same predicate as the read policy.
  if not exists (
        select 1 from public.account_members
         where account_id = p_account_id
           and user_id    = uid
           and status     = 'פעיל'
      ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- user_id is auth.uid(), never a parameter.
  return public.bump_feature_usage(p_account_id, uid, p_feature, p_horizon, p_delta);
end $$;

revoke all on function public.bump_my_feature_usage(uuid, text, text, int) from public;
grant execute on function public.bump_my_feature_usage(uuid, text, text, int) to authenticated;


-- ── 4b. resolve_usage_account(): which account an AI call is charged to ───
--
-- ai-proxy authenticates a USER, but the quotas in the spec belong to an
-- ACCOUNT, and the request body carries no account id. Something has to
-- choose, and a user can be a live member of several accounts.
--
-- ⚠️ FULLY ORDERED, WITH NO TIE LEFT UNBROKEN. `limit 1` with a partial
-- ORDER BY is the ג11 bug from the membership audit, where
-- invite_account_member_by_email resolved a non-deterministic account and
-- wrote to whichever one Postgres happened to return. A usage counter that
-- drifts between accounts run to run produces numbers nobody can act on,
-- so the ordering here ends in the primary key and cannot tie:
--
--   1. the PERSONAL account first, because that is where a solo user's
--      quota belongs and it matches how my_vehicle_capacity() treats caps
--   2. then the oldest, which for a multi-account user is the one they have
--      actually been using
--   3. then the id, so the answer is stable even for two accounts created
--      in the same transaction
--
-- ⚠️ THIS IS NOT PER-WORKSPACE ATTRIBUTION. A user switching between a
-- personal and a business workspace has both charged to the same resolved
-- account. That is acceptable while phase 3 only MEASURES, and aggregate
-- volume is unaffected. Phase 5 enforces, and by then the client has to
-- send the active workspace as a hint and the server has to validate the
-- membership before trusting it: a client-named account id is a client
-- naming someone else's allowance to spend.
create or replace function public.resolve_usage_account(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.account_id
    from public.account_members m
    join public.accounts a on a.id = m.account_id
   where m.user_id = p_user_id
     and m.status  = 'פעיל'
   order by (a.type = 'personal') desc,
            a.created_at asc nulls last,
            m.account_id asc
   limit 1;
$$;

comment on function public.resolve_usage_account(uuid) is
  'Which account a user''s AI usage is charged to. Fully ordered, so the answer never drifts. See docs/plan-monetization-implementation.md §3.1.';

-- Called by ai-proxy under the service role, never by a client.
revoke all on function public.resolve_usage_account(uuid) from public;
revoke all on function public.resolve_usage_account(uuid) from authenticated;
revoke all on function public.resolve_usage_account(uuid) from anon;
-- Same reasoning as bump_feature_usage above: ai-proxy resolves the account
-- under the service role, and without this grant it cannot.
grant execute on function public.resolve_usage_account(uuid) to service_role;


-- ── 5. my_feature_usage(): the read behind the meters ─────────────────────
--
-- Returns the account's consumption for the CURRENT periods, one row per
-- feature, so /MyPlan can render "2 of 3" without three round trips.
--
-- Account-wide sums, because the quotas in the spec are per-account. The
-- per-user breakdown is still in the table for reporting.
-- ⚠️ RETURNS A `horizon` LABEL, NOT JUST period_key, AND THAT MATTERS.
--   ai_advisor produces TWO rows in the same result: its lifetime teaser
--   count and today's fair-use count. A client holding only period_key
--   ('lifetime' / '2026-09' / '2026-09-08') cannot tell the monthly row
--   from the daily one without recomputing Israel-time dates itself, and
--   matching on "whichever is not lifetime" returns whichever happens to
--   come first. Asking for today's AI usage would then sometimes hand back
--   a monthly plate-check total.
--
--   Labelling here keeps every date decision, including DST, on the server
--   where usage_period_key() already lives.
create or replace function public.my_feature_usage(p_account_id uuid)
returns table (
  feature      text,
  horizon      text,
  period_key   text,
  used         bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (
        select 1 from public.account_members
         where account_id = p_account_id
           and user_id    = uid
           and status     = 'פעיל'
      )
     and not public.is_admin()
     and not public.is_viewing(p_account_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  -- One row per feature at the horizon that feature actually uses:
  --   ai_advisor    lifetime (the free teaser) AND today (fair use)
  --   ai_forum      today, and it is the caller's job to ADD it to
  --                 ai_advisor when drawing the daily meter: the daily
  --                 ceiling is enforced against the two together, so a meter
  --                 showing the advisor alone would sit below the cap it is
  --                 drawn against. The lifetime teaser deliberately excludes
  --                 it. /MyPlan does this via useFeatureUsage's usedSum().
  --   plate_check   this month
  --   vehicle_share is a live count of rows, not a counter, so it is not
  --                 here. The share cap is a trigger on vehicle_shares.
  --
  -- Deliberately NOT filtered by feature, only by period: a new bucket shows
  -- up here the moment it is written, with no edit to this function.
  select c.feature,
         case c.period_key
           when 'lifetime'                     then 'lifetime'
           when public.usage_period_key('month') then 'month'
           when public.usage_period_key('day')   then 'day'
         end                                   as horizon,
         c.period_key,
         sum(c.count)::bigint                  as used
    from public.feature_usage_counters c
   where c.account_id = p_account_id
     and c.period_key in (
       'lifetime',
       public.usage_period_key('month'),
       public.usage_period_key('day')
     )
   group by c.feature, c.period_key;
end $$;

revoke all on function public.my_feature_usage(uuid) from public;
grant execute on function public.my_feature_usage(uuid) to authenticated;


-- ── 6. VERIFICATION ───────────────────────────────────────────────────────
--
-- 1) The period keys are Israel time, not UTC. Run this near midnight UTC
--    to see them differ:
--      select public.usage_period_key('lifetime') as lifetime,
--             public.usage_period_key('month')    as month,
--             public.usage_period_key('day')      as day,
--             to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as utc_day;
--
-- 2) An unknown horizon is refused, not silently bucketed:
--      select public.bump_feature_usage(
--        '<account>', '<user>', 'ai_advisor', 'weekly');
--      -- expect: ERROR unknown_horizon: weekly
--
-- 3) The increment is atomic and returns the new value:
--      select public.bump_feature_usage('<account>', '<user>', 'ai_advisor', 'lifetime'); -- 1
--      select public.bump_feature_usage('<account>', '<user>', 'ai_advisor', 'lifetime'); -- 2
--
-- 4) A client CANNOT reach the internal function (run as a normal user):
--      select public.bump_feature_usage('<account>', '<user>', 'ai_advisor', 'day');
--      -- expect: ERROR permission denied for function bump_feature_usage
--
-- 5) A client CANNOT spend against an account it does not belong to:
--      select public.bump_my_feature_usage('<someone else''s account>', 'plate_check', 'month');
--      -- expect: ERROR forbidden
--
-- 6) A client CANNOT reset its own counter (no write policy):
--      update public.feature_usage_counters set count = 0
--       where account_id = '<my account>';
--      -- expect: 0 rows affected
--
-- 7) The meters read what was counted:
--      select * from public.my_feature_usage('<my account>');
--
-- ROLLBACK:
--   drop function if exists public.my_feature_usage(uuid);
--   drop function if exists public.bump_my_feature_usage(uuid, text, text, int);
--   drop function if exists public.bump_feature_usage(uuid, uuid, text, text, int);
--   drop function if exists public.usage_period_key(text);
--   drop table if exists public.feature_usage_counters;
