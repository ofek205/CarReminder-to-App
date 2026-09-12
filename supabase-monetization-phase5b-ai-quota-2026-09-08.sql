-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase5b-ai-quota-2026-09-08.sql
--
-- Monetization, phase 5b: the AI advisor quota decision.
--
--   docs/plan-monetization-implementation.md §3.1
--
-- ⚠️ SHIPS DISABLED. The flag row is created FALSE.
-- ⚠️ DEPENDS ON PHASES 1 AND 3.
--
-- WHAT THIS ADDS
--   1. feature_usage_count(), the internal READ that phase 3 lacked: it
--      only had an incrementer and a membership-gated client read.
--   2. ai_quota_check(), ONE call returning the whole verdict.
--   3. The kill switch.
--
-- WHY ONE FUNCTION AND NOT THREE ROUND TRIPS. ai-proxy would otherwise
-- resolve the account, read the plan, and read the counter separately, which
-- means three RPCs on the hot path of every advisor call AND exposing
-- account_plan() to the service role. Deciding in SQL keeps the whole rule
-- in one place that the client cannot skip, and returns one object.
--
-- APPLY: Supabase SQL Editor, after phases 1 and 3. Then:
--   node scripts/sql-ledger.cjs record supabase-monetization-phase5b-ai-quota-2026-09-08.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')             is null then missing := missing || 'table public.plan_limits (phase 1)'; end if;
  if to_regclass('public.feature_usage_counters')  is null then missing := missing || 'table public.feature_usage_counters (phase 3)'; end if;
  if to_regprocedure('public.account_plan(uuid)')  is null then missing := missing || 'function public.account_plan(uuid) (phase 1)'; end if;
  if to_regprocedure('public.usage_period_key(text)') is null then missing := missing || 'function public.usage_period_key(text) (phase 3)'; end if;
  if to_regprocedure('public.resolve_usage_account(uuid)') is null then missing := missing || 'function public.resolve_usage_account(uuid) (phase 3)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'phase 5b preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. kill switch, created OFF ───────────────────────────────────────────
-- Same two-defaults design as phases 4 and 5a: the ROW is false so applying
-- changes nothing; a MISSING row reads as true so a deleted row cannot
-- quietly switch the paywall off.
insert into public.app_config (key, value)
values ('ai_quota_enforced', 'false'::jsonb)
on conflict (key) do nothing;

-- The anti-forgery ceiling on the free plan's combined lifetime AI use.
-- NOT a product limit: see the long note in ai_quota_check for why an
-- exemption the client can claim needs a bound at all. Tunable with an
-- UPDATE, no deploy. A missing row falls back to the same 25 in code, so
-- deleting it cannot remove the bound.
insert into public.app_config (key, value)
values ('ai_free_lifetime_ceiling', '25'::jsonb)
on conflict (key) do nothing;


-- ── 2. feature_usage_count(): the internal read ───────────────────────────
--
-- Phase 3 shipped an incrementer and a membership-gated client read, and
-- NEITHER is usable from ai-proxy: the client read raises
-- 'not_authenticated' because auth.uid() is NULL under the service role.
--
-- ⚠️ AND IT MUST RAISE ON AN UNKNOWN HORIZON, NOT RETURN ZERO.
--   The obvious `language sql` version compares period_key against
--   usage_period_key(p_horizon), which is NULL for an unrecognised horizon.
--   `period_key = NULL` matches nothing, so the function would return 0,
--   the caller would read "no usage yet", and the quota would ALLOW the
--   call. A typo in a horizon name would silently disable the paywall.
--   Fail closed: raise.
-- ⚠️ IT TAKES AN ARRAY OF FEATURES, NOT ONE, and the reason is the teaser.
--   The two bounds read DIFFERENT sets of buckets:
--     the free lifetime teaser reads ai_advisor ALONE, because the community
--       forum's expert reply fires when a user posts rather than when they
--       ask, and on the free plan (one question, ever) the first forum post
--       would otherwise spend the entire allowance invisibly — both community
--       call sites swallow their errors to console;
--     a paid plan's daily ceiling reads ai_advisor AND ai_forum, because both
--       cost real provider tokens and that bound exists to cap cost.
--   One function taking a set expresses both without a second copy.
create or replace function public.feature_usage_count(
  p_account_id uuid,
  p_features   text[],
  p_horizon    text
)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := public.usage_period_key(p_horizon);
  v_n   int;
begin
  if v_key is null then
    raise exception 'unknown_horizon: %', p_horizon using errcode = '22023';
  end if;

  -- An empty or NULL feature set would make `= any(...)` match nothing and
  -- report zero usage, which reads as "allowed". Same fail-open shape as an
  -- unknown horizon, so it gets the same refusal.
  if p_features is null or array_length(p_features, 1) is null then
    raise exception 'empty_feature_set' using errcode = '22023';
  end if;

  -- Account-wide sum: the quotas in the spec are per-account, while the
  -- table keys per user so a report can still say who consumed it.
  select coalesce(sum(count), 0)::int into v_n
    from public.feature_usage_counters
   where account_id = p_account_id
     and feature    = any(p_features)
     and period_key = v_key;

  return v_n;
end $$;

revoke all on function public.feature_usage_count(uuid, text[], text) from public;
revoke all on function public.feature_usage_count(uuid, text[], text) from authenticated;
revoke all on function public.feature_usage_count(uuid, text[], text) from anon;
-- Callable by ai-proxy. Without this the revoke above leaves nobody able to
-- call it, which is the bug phase 3 shipped with for its own two functions.
grant execute on function public.feature_usage_count(uuid, text[], text) to service_role;


-- ── 3. ai_quota_check(): the whole verdict, in one call ───────────────────
--
-- Returns:
--   { allowed, reason, "limit", used, account_id }
--
-- reason is null when allowed, otherwise one of:
--   'ai_requires_paid_plan'  the free plan's lifetime teaser is spent. The
--                            answer is an upgrade, so the caller returns
--                            402 and the UI shows a paywall.
--   'ai_daily_cap_reached'   a paid plan's fair-use ceiling for today. The
--                            answer is to come back tomorrow, so the caller
--                            returns 429 and the UI must NOT show a paywall.
--
-- ⚠️ 402 AND 429 ARE DELIBERATELY DIFFERENT, and the reason is in the
--   existing copy. aiProxy.js maps every 429 to "חרגת ממגבלת קריאות ה-AI.
--   נסה שוב בעוד דקה", and AiAssistant says "יותר מדי בקשות. המתן דקה".
--   Both are right for the per-minute rate limiter and WRONG for a plan
--   block: telling a free user who spent their one question to wait sixty
--   seconds promises something that will never arrive. Separate codes are
--   what let the client tell the two apart.
--
-- ⚠️ THE FREE TEASER IS CHECKED FIRST, and the order matters. A free plan
--   has ai_lifetime_teaser = 1 and ai_daily_cap = NULL; the paid plans are
--   the reverse. Checking the daily cap first would find NULL on free, skip
--   to "allowed", and hand out unlimited free AI.
--
-- ⚠️ THIS IS A READ, SO IT IS NOT ATOMIC WITH THE INCREMENT, AND THAT IS
--   ACCEPTED RATHER THAN OVERLOOKED. The counter is bumped in ai-proxy only
--   after a provider answers, so two requests fired in the same instant both
--   read the old count and both proceed. A free user who double-fires can
--   therefore get one extra question.
--
--   Phases 4 and 5a take the opposite approach (FOR UPDATE, advisory locks)
--   because they guard INSERTs where the cap is the product promise and the
--   overshoot is permanent. Here the overshoot is one provider call on a free
--   tier, it self-corrects on the next request, and the send button is
--   disabled while a request is in flight. Serialising every advisor call on
--   an account lock would add contention to the hot path to prevent an
--   occasional extra free answer. If that trade ever stops being worth it,
--   the fix is pg_advisory_xact_lock(hashtextextended(v_account::text, 0))
--   here plus moving the bump into the same transaction, which is a bigger
--   change than it looks: the bump currently cannot run in the request's
--   transaction because the provider call sits between them.
create or replace function public.ai_quota_check(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account        uuid;
  v_plan           public.plan_limits;
  v_used           int;
  v_used_all       int;
  v_forum_ceiling  int;
  v_on             boolean;
begin
  select coalesce((value #>> '{}')::boolean, true) into v_on
    from public.app_config where key = 'ai_quota_enforced';
  if not found then v_on := true; end if;
  if v_on is distinct from true then
    return jsonb_build_object('allowed', true, 'reason', null);
  end if;

  v_account := public.resolve_usage_account(p_user_id);
  if v_account is null then
    -- No account resolves for this user. Not a hole worth blocking on:
    -- ai-proxy has already authenticated them, and a user with no live
    -- membership has no plan to bill. Allowed, and visible in the payload.
    return jsonb_build_object('allowed', true, 'reason', null, 'account_id', null);
  end if;

  select * into v_plan from public.account_plan(v_account);

  -- Grace suspends enforcement, matching phases 4 and 5a.
  if exists (
        select 1 from public.account_subscriptions
         where account_id = v_account
           and grace_until is not null
           and grace_until > now()
      ) then
    return jsonb_build_object('allowed', true, 'reason', null, 'account_id', v_account);
  end if;

  -- 1. The free plan's lifetime teaser. Checked FIRST, see the note above.
  --    ai_advisor ALONE: a forum reply the user did not ask for must not
  --    spend the one free question. See the note on feature_usage_count.
  if v_plan.ai_lifetime_teaser is not null then
    v_used := public.feature_usage_count(v_account, array['ai_advisor'], 'lifetime');
    if v_used >= v_plan.ai_lifetime_teaser then
      return jsonb_build_object(
        'allowed', false, 'reason', 'ai_requires_paid_plan',
        'limit', v_plan.ai_lifetime_teaser, 'used', v_used, 'account_id', v_account);
    end if;

    -- ⚠️ AND THE BOUND THAT MAKES THE EXEMPTION SAFE TO GRANT.
    --
    -- The check above reads ai_advisor alone, which is right for the user
    -- but WOULD BE A COMPLETE BYPASS on its own. 'community_reply' is a
    -- value the CLIENT sends, and ai-proxy accepts it (it is in
    -- ALLOWED_SURFACES). So anyone willing to edit one string in the
    -- payload could label every advisor question as a forum reply, land it
    -- in the exempt bucket, and take unlimited free AI. The server cannot
    -- tell the two apart: both are the same HTTP call with the same JWT,
    -- and "the user asked" versus "a post triggered it" is not a fact any
    -- signal in the request can prove.
    --
    -- Since the distinction is unprovable, the exemption gets a CEILING
    -- instead of blind trust. Honest free use of the forum sits far below
    -- it; forgery converts "unlimited" into "this many, then pay".
    --
    -- Deliberately generous, and deliberately in app_config rather than a
    -- literal: it is an ANTI-FORGERY BOUND, not a product limit, so it must
    -- be tunable with an UPDATE and no deploy. If real users start meeting
    -- it, that is the signal to raise it, not to remove it.
    -- Digits-only before the cast, NOT a bare ::int. A bare cast would
    -- raise on a hand-typed '25 ' or '"25"', ai_quota_check would abort,
    -- and ai-proxy's deliberate fail-open would then let every request
    -- through: one typo in a config row would silently switch the paywall
    -- off with nothing to show why. Anything unparseable falls back to the
    -- default instead.
    select case when (value #>> '{}') ~ '^[0-9]+$'
                then (value #>> '{}')::int
                else 25
           end
      into v_forum_ceiling
      from public.app_config where key = 'ai_free_lifetime_ceiling';
    if not found or v_forum_ceiling is null then v_forum_ceiling := 25; end if;

    v_used_all := public.feature_usage_count(
      v_account, array['ai_advisor', 'ai_forum'], 'lifetime');
    if v_used_all >= v_forum_ceiling then
      return jsonb_build_object(
        'allowed', false, 'reason', 'ai_requires_paid_plan',
        'limit', v_plan.ai_lifetime_teaser, 'used', v_used,
        'account_id', v_account);
    end if;

    -- `used` and `limit` report the TEASER, not the ceiling, because that
    -- is what the meter on /MyPlan is drawn against and what the user was
    -- told they have. Surfacing the anti-forgery bound would explain the
    -- workaround to the person most likely to use it.
    return jsonb_build_object('allowed', true, 'reason', null,
      'limit', v_plan.ai_lifetime_teaser, 'used', v_used, 'account_id', v_account);
  end if;

  -- 2. A paid plan's daily fair-use ceiling. BOTH buckets: this bound exists
  --    to cap provider cost, and a forum reply costs the same as a question.
  if v_plan.ai_daily_cap is not null then
    v_used := public.feature_usage_count(v_account, array['ai_advisor', 'ai_forum'], 'day');
    if v_used >= v_plan.ai_daily_cap then
      return jsonb_build_object(
        'allowed', false, 'reason', 'ai_daily_cap_reached',
        'limit', v_plan.ai_daily_cap, 'used', v_used, 'account_id', v_account);
    end if;
    return jsonb_build_object('allowed', true, 'reason', null,
      'limit', v_plan.ai_daily_cap, 'used', v_used, 'account_id', v_account);
  end if;

  -- Neither bound set: genuinely unlimited.
  return jsonb_build_object('allowed', true, 'reason', null, 'account_id', v_account);
end $$;

comment on function public.ai_quota_check(uuid) is
  'One-call AI advisor quota verdict. 402-worthy reason vs 429-worthy reason are distinct on purpose. See docs/plan-monetization-implementation.md §3.1.';

revoke all on function public.ai_quota_check(uuid) from public;
revoke all on function public.ai_quota_check(uuid) from authenticated;
revoke all on function public.ai_quota_check(uuid) from anon;
grant execute on function public.ai_quota_check(uuid) to service_role;


-- ── 4. VERIFICATION ───────────────────────────────────────────────────────
--
-- 1) Applying changed nothing yet:
--      select value from public.app_config where key = 'ai_quota_enforced';
--      -- expect: false
--
-- 2) With the flag off, everything is allowed regardless of usage:
--      select public.ai_quota_check('<any user id>');
--      -- expect: {"allowed": true, "reason": null}
--
-- 3) An unknown horizon RAISES rather than reporting zero usage:
--      select public.feature_usage_count('<account>', array['ai_advisor'], 'weekly');
--      -- expect: ERROR unknown_horizon: weekly
--      -- If this returns 0, the paywall can be disabled by a typo.
--    And so does an empty feature set, for the same reason:
--      select public.feature_usage_count('<account>', array[]::text[], 'day');
--      -- expect: ERROR empty_feature_set
--
-- 3b) THE FORUM REPLY DOES NOT SPEND THE FREE TEASER. This is the behaviour
--     the split exists for, so verify it directly on a FREE account:
--      select public.bump_feature_usage('<account>','<user>','ai_forum','lifetime');
--      select public.ai_quota_check('<free user>');
--      -- expect: allowed TRUE, used 0
--      -- used must stay 0: the teaser reads ai_advisor alone. If this shows
--      -- used 1, a user's first community post silently burned their only
--      -- free advisor question.
--
-- 3c) BUT THE EXEMPTION IS BOUNDED, or it is a total bypass. Verify the
--     ceiling actually bites, because without it anyone can label an
--     advisor question 'community_reply' and never pay:
--      -- drop the ceiling to something quick to reach:
--      update public.app_config set value = '3'::jsonb
--       where key = 'ai_free_lifetime_ceiling';
--      -- then spend 3 on the FORUM bucket only:
--      select public.bump_feature_usage('<account>','<user>','ai_forum','lifetime', 3);
--      select public.ai_quota_check('<free user>');
--      -- expect: allowed FALSE, reason ai_requires_paid_plan
--      -- and note `used` still reports the TEASER (0), not 3: the response
--      -- must not teach the reader where the real bound is.
--      -- restore:
--      update public.app_config set value = '25'::jsonb
--       where key = 'ai_free_lifetime_ceiling';
--
-- 4) Turn the flag on, then walk a FREE account through its teaser:
--      select public.ai_quota_check('<free user>');
--      -- expect allowed true, limit 1, used 0
--      select public.bump_feature_usage('<account>','<user>','ai_advisor','lifetime');
--      select public.ai_quota_check('<free user>');
--      -- expect allowed FALSE, reason ai_requires_paid_plan, used 1
--
-- 5) And a PAID account hits the daily ceiling, not the teaser:
--      -- grant p9 first via admin_set_account_plan, then:
--      select public.ai_quota_check('<paid user>');
--      -- expect limit 50 (ai_daily_cap), reason null
--      -- the reason when exhausted must be ai_daily_cap_reached, NOT
--      -- ai_requires_paid_plan: they already paid.
--
-- 6) Grace suspends it, matching phases 4 and 5a:
--      select public.ai_quota_check('<user on a granted grace>');
--      -- expect: allowed true
--
-- 7) service_role can actually call these. Run as the service role, or from
--    the edge function, NOT as postgres in the SQL editor, because postgres
--    can call them regardless and would hide a missing grant:
--      select has_function_privilege('service_role',
--        'public.ai_quota_check(uuid)', 'EXECUTE') as can_call;
--      -- expect: true
--
-- TO DISABLE INSTANTLY:
--   insert into public.app_config (key, value) values ('ai_quota_enforced','false'::jsonb)
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- ROLLBACK:
--   drop function if exists public.ai_quota_check(uuid);
--   drop function if exists public.feature_usage_count(uuid, text[], text);
--   delete from public.app_config
--    where key in ('ai_quota_enforced', 'ai_free_lifetime_ceiling');
