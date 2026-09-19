-- =========================================================================
-- Follow-up to supabase-monetization-iap-entitlement-2026-09-19.sql.
--
-- ⚠️ A SEPARATE FILE BECAUSE THE FIRST ONE IS APPLIED AND RECORDED. The
-- ledger keys on sha256, so editing an applied file detaches it from the
-- bytes that actually ran and `drift` flags it as CHANGED forever. An
-- addition to an applied feature is a NEW file, never an edit.
--
-- Two findings from the pre-handover review.
-- =========================================================================


-- ── 1. The flag the client already reads, which had no row ────────────────
--
-- Plans.jsx calls useFeatureFlag('play_billing_enabled'), and nothing has
-- ever created it. readFlag() resolves a missing row to `defaultOnError`,
-- which is false here, so the absence was FAIL-SAFE and hid the purchase
-- surface correctly. It just could never be switched on.
--
-- Seeded false on purpose: the first click in the admin screen is what turns
-- this on, not the act of applying a migration.
insert into public.app_config (key, value)
values ('play_billing_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- ⚠️ DO NOT TURN THIS ON UNTIL ALL THREE ARE TRUE, because each one alone
-- produces a screen that lies:
--   1. The Play Billing plugin is installed and a signed build is on a track.
--      Without it getBillingBackend() returns null, so nothing renders.
--   2. The purchase-verification edge function is deployed. Until then
--      Plans.jsx verifyPurchase() returns false, and every purchase lands in
--      PENDING, which tells a paying user their activation is delayed forever.
--   3. The three products exist in Play Console on com.carreminder.app.


-- ── 2. grant_iap_entitlement: clear the expiry with the override ──────────
--
-- The first version cleared ovr_max_vehicles and left ovr_expires_at set,
-- leaving an expiry attached to an override that no longer exists. Measured
-- zero rows carry an expiry today, so nothing is broken in production; it is
-- the kind of inconsistency that is free to fix now and confusing later.
--
-- Everything else in this function is unchanged.
create or replace function public.grant_iap_entitlement(
  p_account_id      uuid,
  p_store           text,
  p_product_id      text,
  p_expires_at      timestamptz,
  p_external_sub_id text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan     text;
  v_source   text;
  v_plan_cap int;
  v_ovr_cap  int;
begin
  if p_account_id is null or p_external_sub_id is null then
    raise exception 'grant_iap_entitlement: account_id and external_sub_id are required';
  end if;

  -- Fail closed on an unknown product: a token replayed from another app is
  -- exactly the case where granting "something reasonable" means a free tier.
  select plan into v_plan
    from public.iap_products
   where store = p_store and product_id = p_product_id and active;

  if v_plan is null then
    raise exception 'grant_iap_entitlement: unknown or inactive product %/%',
      p_store, p_product_id;
  end if;

  v_source := case p_store
                when 'google' then 'iap_google'
                when 'apple'  then 'iap_apple'
              end;
  if v_source is null then
    raise exception 'grant_iap_entitlement: unknown store %', p_store;
  end if;

  insert into public.account_subscriptions
    (account_id, plan, status, current_period_end, source, external_subscription_id)
  values
    (p_account_id, v_plan, 'active', p_expires_at, v_source, p_external_sub_id)
  on conflict (account_id) do update
    set plan                     = excluded.plan,
        status                   = 'active',
        current_period_end       = excluded.current_period_end,
        source                   = excluded.source,
        external_subscription_id = excluded.external_subscription_id,
        updated_at               = now();

  -- The grandfather override becomes a RESTRICTION the moment they pay:
  -- plan_ovr() is `else p_ovr`, so a freeze at 8 would survive a p9 purchase
  -- (cap 15) and cap a paying customer at 8. Cleared, but only when the plan
  -- is genuinely better, so a deliberately higher arrangement is never cut.
  select max_vehicles into v_plan_cap from public.plan_limits where plan = v_plan;
  select ovr_max_vehicles into v_ovr_cap
    from public.account_subscriptions where account_id = p_account_id;

  if v_ovr_cap is not null
     and v_ovr_cap <> -1
     and (v_plan_cap is null or v_plan_cap > v_ovr_cap)
  then
    update public.account_subscriptions
       set ovr_max_vehicles = null,
           -- ⚠️ THE FIX: the expiry goes with the override it belonged to.
           -- Leaving it behind attaches a deadline to something that is no
           -- longer there.
           ovr_expires_at   = null,
           ovr_note = concat_ws(' | ', nullif(ovr_note, ''),
                        format('grandfather cap %s cleared on %s purchase %s',
                               v_ovr_cap, p_store, current_date)),
           updated_at = now()
     where account_id = p_account_id;
  end if;

  return v_plan;
end;
$$;

revoke all on function public.grant_iap_entitlement(uuid, text, text, timestamptz, text) from public;
grant execute on function public.grant_iap_entitlement(uuid, text, text, timestamptz, text) to service_role;


-- =========================================================================
-- VERIFICATION. Run this and paste what you actually saw.
--
--   select
--     (select value #>> '{}' from public.app_config
--       where key = 'play_billing_enabled')                  as flag_value,
--     (select count(*) from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname = 'grant_iap_entitlement'
--         and pg_get_functiondef(p.oid) ilike '%ovr_expires_at   = null%') as fix_present;
--
-- Expected: flag_value = 'false', fix_present = 1.
--
-- ⚠️ fix_present is the half that distinguishes applied from not-applied.
-- flag_value alone would read NULL before and 'false' after, which is a real
-- difference, but the function body is the part that actually changed and it
-- is checked directly rather than assumed.
-- =========================================================================
