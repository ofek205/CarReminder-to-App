-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase5c-plate-quota-2026-09-09.sql
--
-- Monetization, phase 5c: the plate-check quota decision.
--
--   docs/plan-monetization-implementation.md §3.2
--
-- ⚠️ SHIPS DISABLED. The flag row is created FALSE.
-- ⚠️ DEPENDS ON PHASES 1 AND 3.
--
-- ⚠️⚠️ AND THE THING TO READ BEFORE TRUSTING ANY OF THIS:
--
--   THIS QUOTA CANNOT BE ENFORCED ON THE SERVER, AND NOTHING HERE PRETENDS
--   OTHERWISE. The plate lookup is a fetch from the BROWSER straight to
--   data.gov.il (src/services/vehicleLookup.js:121). There is no request of
--   ours in the path to refuse, unlike the vehicle cap (a trigger on
--   vehicles), the share cap (a trigger on vehicle_shares) or the AI quota
--   (a check inside ai-proxy). The dataset is public and free; anyone can
--   query it directly with curl.
--
--   So this function is an ADVISORY READ. It answers "should the app show
--   this result?" and the refusal happens in the client. That is a PRODUCT
--   gate, not a security boundary, and the difference is not cosmetic:
--     • what the free plan actually buys is the app's presentation of the
--       data (normalisation, insights, test policy, history), not access to
--       the data, which was never ours to sell;
--     • a determined user bypasses it by editing one call, and that is
--       ACCEPTED rather than overlooked;
--     • therefore do NOT later "harden" this by moving money decisions
--       behind it, and do NOT add a server-side refusal that the client can
--       simply not ask for.
--
--   The count it reads IS authoritative and shared across devices, which is
--   the part worth having on the server: a per-device counter would reset by
--   clearing the browser and would disagree between a phone and a laptop.
--
-- WHAT THIS ADDS
--   1. my_plate_quota(), the client-callable verdict, derived from auth.uid().
--   2. The kill switch.
--
-- ⚠️ NO p_user_id PARAMETER, DELIBERATELY, and this is the difference from
--   ai_quota_check(uuid). That one is called by ai-proxy under the service
--   role, so it takes the id it is acting for and is revoked from
--   authenticated entirely. This one is called by the BROWSER, so accepting
--   a user id would let any signed-in user read any other user's remaining
--   allowance. It derives the caller from auth.uid() and cannot be pointed
--   at anyone else.
--
-- APPLY: Supabase SQL Editor, after phases 1 and 3. Then:
--   node scripts/sql-ledger.cjs record supabase-monetization-phase5c-plate-quota-2026-09-09.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')            is null then missing := missing || 'table public.plan_limits (phase 1)'; end if;
  if to_regclass('public.feature_usage_counters') is null then missing := missing || 'table public.feature_usage_counters (phase 3)'; end if;
  if to_regprocedure('public.account_plan(uuid)') is null then missing := missing || 'function public.account_plan(uuid) (phase 1)'; end if;
  if to_regprocedure('public.usage_period_key(text)') is null then missing := missing || 'function public.usage_period_key(text) (phase 3)'; end if;
  if to_regprocedure('public.resolve_usage_account(uuid)') is null then missing := missing || 'function public.resolve_usage_account(uuid) (phase 3)'; end if;
  -- Phase 5b's reader, reused rather than re-declared. If 5b has not been
  -- applied, this file stops instead of creating a second copy that would
  -- then drift from it.
  if to_regprocedure('public.feature_usage_count(uuid, text[], text)') is null then
    missing := missing || 'function public.feature_usage_count(uuid, text[], text) (phase 5b)';
  end if;

  if array_length(missing, 1) > 0 then
    raise exception 'phase 5c preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. kill switch, created OFF ───────────────────────────────────────────
-- Same two-defaults design as phases 4, 5a and 5b: the ROW is false so
-- applying changes nothing; a MISSING row reads as true so deleting the row
-- cannot quietly switch the gate off.
insert into public.app_config (key, value)
values ('plate_quota_enforced', 'false'::jsonb)
on conflict (key) do nothing;


-- ── 2. my_plate_quota(): the caller's own verdict ─────────────────────────
--
-- Returns:
--   { allowed, reason, "limit", used, remaining, account_id }
--
-- reason is null when allowed, otherwise:
--   'plate_quota_reached'  the month's allowance is spent. The remedy is a
--                          paid plan, so the client shows the plan wall.
--
-- ⚠️ RETURNS `remaining` AS WELL AS used/limit, unlike ai_quota_check. The
--   AI copy never counts down ("your one question"), but the plate wall
--   wants "2 of 3 left this month" and the screen must not compute that
--   itself: limit - used goes NEGATIVE once an over-cap account is
--   grandfathered by a plan change, and "-1 left" is a bug on screen.
--   greatest(...,0) belongs here, once, beside the numbers it clamps.
--
-- ⚠️ FAIL OPEN is the CLIENT's decision, not this function's. This raises
--   'not_authenticated' for an anonymous caller rather than answering,
--   because a guest has no account and the guest path has its own separate
--   one-check gate (hasUsedQuickCheck in VehicleCheck.jsx). See
--   src/lib/plateQuotaGate.js for what the client does with a failure.
create or replace function public.my_plate_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  v_account uuid;
  v_plan    public.plan_limits;
  v_used    int;
  v_cap     int;
  v_on      boolean;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select coalesce((value #>> '{}')::boolean, true) into v_on
    from public.app_config where key = 'plate_quota_enforced';
  if not found then v_on := true; end if;
  if v_on is distinct from true then
    return jsonb_build_object('allowed', true, 'reason', null, 'enforced', false);
  end if;

  v_account := public.resolve_usage_account(uid);
  if v_account is null then
    -- Authenticated but no live membership. Nothing to bill and nothing to
    -- count against; allowed, and the null account is visible in the payload
    -- so a support question about "why was I not limited" has an answer.
    return jsonb_build_object('allowed', true, 'reason', null, 'account_id', null);
  end if;

  select * into v_plan from public.account_plan(v_account);
  v_cap := v_plan.plate_checks_per_month;

  -- NULL cap is unlimited, on every paid plan today.
  if v_cap is null then
    return jsonb_build_object('allowed', true, 'reason', null,
      'limit', null, 'account_id', v_account);
  end if;

  -- Grace suspends enforcement, matching phases 4, 5a and 5b.
  if exists (
        select 1 from public.account_subscriptions
         where account_id = v_account
           and grace_until is not null
           and grace_until > now()
      ) then
    return jsonb_build_object('allowed', true, 'reason', null,
      'limit', v_cap, 'account_id', v_account);
  end if;

  v_used := public.feature_usage_count(v_account, array['plate_check'], 'month');

  return jsonb_build_object(
    'allowed',   v_used < v_cap,
    'reason',    case when v_used < v_cap then null else 'plate_quota_reached' end,
    'limit',     v_cap,
    'used',      v_used,
    -- Clamped: see the note above. An account moved from p9 (unlimited) to
    -- free mid-month can already have spent more than the free cap.
    'remaining', greatest(v_cap - v_used, 0),
    'account_id', v_account);
end $$;

comment on function public.my_plate_quota() is
  'Plate-check quota verdict for the CALLING user. ADVISORY: the lookup is a browser-to-data.gov.il fetch, so refusal happens client-side. See docs/plan-monetization-implementation.md §3.2.';

-- Callable by the browser, which is the whole point of this one. Still
-- revoked from anon: an anonymous caller would only get the
-- 'not_authenticated' raise, and there is no reason to spend a round trip
-- discovering that.
revoke all on function public.my_plate_quota() from public;
revoke all on function public.my_plate_quota() from anon;
grant execute on function public.my_plate_quota() to authenticated;


-- ── 3. VERIFICATION ───────────────────────────────────────────────────────
--
-- Run these AS A SIGNED-IN USER (SQL editor runs as postgres, where
-- auth.uid() is NULL and every call raises). Use the app, or set a JWT
-- claim, or call it from the client console.
--
-- 1) Applying changed nothing yet:
--      select value from public.app_config where key = 'plate_quota_enforced';
--      -- expect: false
--      select public.my_plate_quota();
--      -- expect: {"allowed": true, "reason": null, "enforced": false}
--
-- 2) It refuses to answer for anyone but the caller. There is no parameter
--    to pass, so verify the SHAPE: a signed-in user gets their own account
--    and cannot name another. If a future edit adds a p_user_id, that is a
--    cross-account read, not a convenience.
--      select public.my_plate_quota();
--      -- expect account_id = the caller's own account, always
--
-- 3) A paid plan is unlimited, and reports it as a NULL limit rather than a
--    large number:
--      -- grant p9 via admin_set_account_plan, then as that user:
--      select public.my_plate_quota();
--      -- expect: allowed true, limit null
--
-- 4) Turn the flag on, then walk a FREE account to its cap (3):
--      select public.bump_feature_usage('<account>','<user>','plate_check','month', 3);
--      select public.my_plate_quota();
--      -- expect: allowed FALSE, reason plate_quota_reached, used 3, limit 3,
--      --         remaining 0
--
-- 5) `remaining` NEVER goes negative. This is the over-cap case, which is
--    real: an account can drop from unlimited to free mid-month.
--      select public.bump_feature_usage('<account>','<user>','plate_check','month', 5);
--      select public.my_plate_quota();
--      -- expect: used 8, limit 3, remaining 0  (NOT -5)
--
-- 6) Grace suspends it:
--      select public.my_plate_quota();  -- as a user on a granted grace
--      -- expect: allowed true
--
-- 7) The month key is Israel time, not UTC. usage_period_key('month') is
--    what decides, and phase 3 already verifies it; the only thing to check
--    here is that this function reads 'month' and not 'day':
--      select public.my_plate_quota();
--      -- around the 1st of the month at 01:00 Israel time, `used` must
--      -- still reflect the NEW month, not the old one.
--
-- TO DISABLE INSTANTLY:
--   insert into public.app_config (key, value) values ('plate_quota_enforced','false'::jsonb)
--   on conflict (key) do update set value = excluded.value, updated_at = now();
--
-- ROLLBACK:
--   drop function if exists public.my_plate_quota();
--   delete from public.app_config where key = 'plate_quota_enforced';
