-- =========================================================================
-- MONETIZATION · a store subscription that has ENDED must stop granting
--
-- 2026-09-20
--
-- THE BUG THIS CLOSES
--   account_plan() decided the plan from `status = 'active'` alone. Nothing
--   anywhere looked at current_period_end. grant_iap_entitlement() writes
--   that column faithfully from Play's own expiryTime and then no reader
--   consulted it, so the column was decoration.
--
--   The consequence is not subtle: a subscription that ends grants its plan
--   for ever. Combined with there being no Real-time Developer Notifications
--   until today, nothing in the entire system was capable of learning that a
--   subscription had stopped. Cancel, refund, expire, charge back: the plan
--   stayed.
--
-- ⚠️ THIS FILE IS HALF OF A PAIR AND IS DANGEROUS ALONE.
--   Expiry only behaves if something keeps pushing current_period_end
--   forward as the subscription renews. That something is the play-rtdn edge
--   function, shipped alongside this. Apply this WITHOUT RTDN configured and
--   every paying customer silently drops to free roughly a month after they
--   subscribe, which is strictly worse than the bug being fixed.
--
--   Order: deploy play-rtdn, configure the Pub/Sub topic in Play Console,
--   see a test notification answered, and only then run this.
--
-- ⚠️ A NEW FILE, NOT AN EDIT.
--   supabase-monetization-iap-entitlement-2026-09-19.sql and its follow-up
--   are applied and recorded (ledger ids 29 and 30). The ledger keys on the
--   sha256 of the bytes on disk, so editing either would detach it from what
--   actually ran and mark it CHANGED for ever. Additions are new files.
--
-- WHAT CHANGES
--   account_plan() only. No table, no column, no data. The whole delta is
--   one extra condition on which plan code is chosen.
--
-- WHAT DOES NOT CHANGE
--   Admin grants and any future web checkout. The expiry test is scoped to
--   store sources, so an admin grant with a stale current_period_end is
--   unaffected, exactly as it is today.
-- =========================================================================


-- ── account_plan, with the expiry test ────────────────────────────────────
--
-- Reproduced in full from supabase-monetization-doc-cap-2026-09-16.sql
-- because `create or replace function` replaces the whole body. Everything
-- below is that version verbatim except the two marked blocks.

create or replace function public.account_plan(p_account_id uuid)
returns public.plan_limits
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s           public.account_subscriptions;
  v_plan      public.plan_limits;
  v_code      text;
  v_live      boolean;
  v_store     boolean;
  v_period_ok boolean;
begin
  select * into s
    from public.account_subscriptions
   where account_id = p_account_id;

  if not found then
    select * into v_plan from public.plan_limits where plan = 'free';
    return v_plan;
  end if;

  v_live := s.ovr_expires_at is null or s.ovr_expires_at > now();

  -- ── NEW ────────────────────────────────────────────────────────────────
  -- Scoped to store sources on purpose. An admin grant is a human decision
  -- with its own lifetime (reverts_to_plan + ovr_expires_at, handled below),
  -- and a web checkout does not exist yet. Applying a store's expiry rule to
  -- either would revoke plans nobody asked us to revoke.
  v_store := s.source in ('iap_google', 'iap_apple');

  -- ⚠️ NULL MEANS "WE DO NOT KNOW", AND THE ANSWER TO NOT KNOWING IS TO KEEP
  -- GRANTING. The expensive direction to be wrong in is taking a plan away
  -- from someone who is paying. A missing expiry is a gap in our data, not
  -- evidence against the customer, and the RTDN handler will fill it at the
  -- next renewal.
  --
  -- ⚠️ AND THE THREE-DAY MARGIN IS NOT ROUNDING. It is the window in which a
  -- delayed or dropped renewal notification can be noticed and replayed
  -- before anyone loses access. Play itself retries a push for days, and the
  -- app's own restore-at-launch re-verifies and rewrites this column, so
  -- three days is the cost of a quiet weekend rather than a real grace
  -- period. Play's own grace for a failed card is a different mechanism
  -- entirely and is already reflected in the state RTDN reports.
  v_period_ok := (not v_store)
              or s.current_period_end is null
              or s.current_period_end > (now() - interval '3 days');
  -- ── END NEW ────────────────────────────────────────────────────────────

  if not v_live and s.source = 'admin_grant' then
    v_code := coalesce(s.reverts_to_plan, 'free');
  -- ── CHANGED: `and v_period_ok` is the whole fix ────────────────────────
  elsif (s.status = 'active' and v_period_ok)
     or (s.grace_until is not null and s.grace_until > now()) then
    v_code := s.plan;
  else
    v_code := 'free';
  end if;

  select * into v_plan from public.plan_limits where plan = v_code;
  if not found then
    select * into v_plan from public.plan_limits where plan = 'free';
  end if;

  if v_live then
    v_plan.max_vehicles           := public.plan_ovr(s.ovr_max_vehicles,           v_plan.max_vehicles);
    v_plan.max_documents          := public.plan_ovr(s.ovr_max_documents,          v_plan.max_documents);
    v_plan.ai_daily_cap           := public.plan_ovr(s.ovr_ai_daily_cap,           v_plan.ai_daily_cap);
    v_plan.ai_lifetime_teaser     := public.plan_ovr(s.ovr_ai_lifetime_teaser,     v_plan.ai_lifetime_teaser);
    v_plan.plate_checks_per_month := public.plan_ovr(s.ovr_plate_checks_per_month, v_plan.plate_checks_per_month);
    v_plan.max_shares             := public.plan_ovr(s.ovr_max_shares,             v_plan.max_shares);
    if s.ovr_business_ui is not null then
      v_plan.business_ui := s.ovr_business_ui;
    end if;
  end if;

  return v_plan;
end $$;

-- ⚠️ RE-STATED, NOT ASSUMED. `create or replace` preserves the existing ACL,
-- so these are not strictly required, and that is exactly why they are here:
-- leaving the privilege state implicit across a redefinition is how a
-- function quietly becomes callable. account_plan is internal, called by
-- other security-definer functions; my_account_plan(uuid) is the one granted
-- to authenticated.
revoke all on function public.account_plan(uuid) from public;
revoke all on function public.account_plan(uuid) from authenticated;
revoke all on function public.account_plan(uuid) from anon;


-- =========================================================================
-- VERIFICATION. Run these and paste what you actually saw.
-- Nothing here writes. Every query is a read.
-- =========================================================================

-- 1. NOBODY LOSES ANYTHING TODAY.
--    Every store subscription that currently exists, with what the new rule
--    would say about it. Expect zero rows: there are no live IAP
--    subscriptions yet, so this change cannot move a single account.
select s.account_id,
       s.plan,
       s.status,
       s.source,
       s.current_period_end,
       (s.current_period_end is null
        or s.current_period_end > (now() - interval '3 days')) as would_still_grant
  from public.account_subscriptions s
 where s.source in ('iap_google', 'iap_apple')
 order by s.current_period_end nulls first;

-- 2. NO NON-STORE ACCOUNT IS TOUCHED.
--    Admin grants and anything else, counted by source. These rows take the
--    `not v_store` branch and are unaffected by definition; this is here so
--    the claim is measured rather than asserted.
select coalesce(source, '(null)') as source,
       count(*)                   as accounts,
       count(*) filter (where current_period_end is not null
                          and current_period_end <= now()) as expired_period_end
  from public.account_subscriptions
 group by 1
 order by 2 desc;

-- 3. THE FUNCTION STILL RETURNS A PLAN FOR A REAL ACCOUNT.
--    A smoke test that the rewrite parses and runs, using whichever account
--    is oldest. Expect one row with a plan code, not an error.
select (public.account_plan(a.id)).plan   as resolved_plan,
       (public.account_plan(a.id)).max_vehicles
  from public.accounts a
 order by a.created_at
 limit 1;

-- 4. THE PRIVILEGES ARE WHERE THEY SHOULD BE.
--    Expect NO row granting account_plan to anon or authenticated.
select p.proname,
       r.rolname          as granted_to
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) acl
  join pg_roles r on r.oid = acl.grantee
 where n.nspname = 'public'
   and p.proname in ('account_plan', 'my_account_plan')
 order by 1, 2;
