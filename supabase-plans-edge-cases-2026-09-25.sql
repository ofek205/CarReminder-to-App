-- ============================================================================
-- Plans edge cases: a cancelled subscription stops saying it renews, and a
-- downgrade no longer freezes the shares an account already has.
-- 2026-09-25
-- ============================================================================
--
-- Two independent changes, each safe to run again:
--
--   1. account_subscriptions.auto_renew + set_iap_auto_renew()
--      A Play subscription the user cancelled keeps its plan until the paid
--      period ends, which is right, but we stored it as plain 'active', so
--      /MyPlan told that person "מתחדש ב..." about a subscription that will
--      not renew. Google says whether it renews; this is where we keep it.
--
--   2. enforce_account_share_cap(): an UPDATE to a share that already holds a
--      slot is never refused.
--      After a downgrade to free (2 shares) an account holding 5 could not
--      change any existing share, and the person it had invited could not
--      even ACCEPT the invitation, because every update re-ran the "+1" count.
--      That contradicts the rule this whole project applies to downgrades:
--      keep what you have, pay to add more.
--
-- Nothing here enforces anything new, and nothing changes any data.
-- ============================================================================


-- ── 0. PREFLIGHT ──────────────────────────────────────────────────────────
--
-- ⚠️ THE SHARE-CAP BODY BELOW IS REPRODUCED FROM
-- supabase-monetization-phase5a-share-cap-2026-09-08.sql, the only file in
-- the repo that defines it, with ONE added block. The preflight refuses to
-- replace a live body that is not recognisably that one, because a
-- create-or-replace from a stale file is how hardening silently gets reverted.

do $$
declare
  missing text := '';
  v_src   text;
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='account_subscriptions')
    then missing := missing || 'account_subscriptions (phase 1); '; end if;

  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_account_share_cap';

  if v_src is null then
    missing := missing || 'enforce_account_share_cap (phase 5a); ';
  elsif position('acct_share_cap:' in v_src) = 0
     or position('account_share_cap_exceeded' in v_src) = 0
     or position('share_cap_enforced' in v_src) = 0 then
    missing := missing || 'enforce_account_share_cap live body is not the phase 5a body; read it with pg_get_functiondef before replacing; ';
  end if;

  if missing <> '' then
    raise exception 'plans-edge-cases preflight failed, nothing was changed. %', missing;
  end if;
end $$;


-- ── 1. WILL IT RENEW ──────────────────────────────────────────────────────
--
-- NULL means unknown, and every screen must treat it as "say nothing about
-- renewal" rather than as either answer. It is NULL for every row today and
-- for anything not bought through a store.

alter table public.account_subscriptions
  add column if not exists auto_renew boolean;

comment on column public.account_subscriptions.auto_renew is
  'Store subscriptions only: will it renew at current_period_end. NULL = unknown. Written by set_iap_auto_renew() from play-rtdn / verify-play-purchase.';

-- ⚠️ A SEPARATE FUNCTION, NOT A NEW PARAMETER ON grant_iap_entitlement.
-- Adding a parameter creates a second overload next to the old one, and a
-- call with the five existing named arguments then matches both: "function is
-- not unique", on every renewal, for every subscriber. The Apple endpoint
-- calls grant_iap_entitlement too, so its signature stays exactly as it is.
create or replace function public.set_iap_auto_renew(
  p_account_id uuid,
  p_auto_renew boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_account_id is null then
    raise exception 'set_iap_auto_renew: account_id is required';
  end if;

  -- Scoped to store sources, like revoke_iap_entitlement, so it can never
  -- annotate a web checkout or an admin grant.
  update public.account_subscriptions
     set auto_renew = p_auto_renew,
         updated_at = now()
   where account_id = p_account_id
     and source in ('iap_google', 'iap_apple');
end;
$function$;

comment on function public.set_iap_auto_renew(uuid, boolean) is
  'Record whether a store subscription renews. Service role only; called after grant_iap_entitlement.';

revoke all on function public.set_iap_auto_renew(uuid, boolean) from public;
revoke all on function public.set_iap_auto_renew(uuid, boolean) from anon;
revoke all on function public.set_iap_auto_renew(uuid, boolean) from authenticated;
grant execute on function public.set_iap_auto_renew(uuid, boolean) to service_role;


-- ── 2. SHARES: AN EXISTING SLOT IS NEVER TAKEN AWAY ───────────────────────

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

  -- ⚠️ ADDED 2026-09-25: AN UPDATE TO A ROW THAT ALREADY HOLDS A SLOT TAKES
  -- NO NEW ONE, SO IT IS NEVER REFUSED. pending -> accepted is the recipient
  -- saying yes to an invitation the cap already counted; any other update to
  -- a live share changes nothing about how many exist. Without this, an
  -- account above its cap after a downgrade could not touch a single
  -- existing share, and its invitations could not be accepted. Only an
  -- INSERT, or an update that brings a revoked/expired row back to life,
  -- asks for a slot.
  if tg_op = 'UPDATE' and old.status in ('pending', 'accepted') then
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
  'Per-ACCOUNT share cap from plan_limits.max_shares. Distinct from the two per-VEHICLE caps. An update to a row already holding a slot is never refused (2026-09-25). See docs/plan-monetization-implementation.md §3.3.';

revoke all on function public.enforce_account_share_cap() from public;


-- ── 3. VERIFICATION ───────────────────────────────────────────────────────
--
-- One row. Expect: true, true, false, true, true, false.

select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'account_subscriptions'
      and column_name = 'auto_renew')                                      as auto_renew_column,
  (select has_function_privilege('service_role', p.oid, 'execute')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_iap_auto_renew')       as service_role_may_set,
  (select has_function_privilege('authenticated', p.oid, 'execute')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_iap_auto_renew')       as authenticated_may_set,
  (select position('old.status in (''pending'', ''accepted'')' in p.prosrc) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_account_share_cap') as share_update_rule_landed,
  (select position('acct_share_cap:' in p.prosrc) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_account_share_cap') as share_lock_kept,
  (select count(*) > 0 from public.account_subscriptions where auto_renew is not null)
                                                                           as any_auto_renew_set_yet;
