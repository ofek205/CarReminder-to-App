-- =========================================================================
-- Monetization: turning a verified store purchase into an entitlement.
--
-- WHAT THIS IS
--   The server half of Google Play Billing. The client opens the Play sheet,
--   but the client's answer is never trusted: an edge function verifies the
--   purchase token against the Play Developer API and then calls
--   grant_iap_entitlement() with what GOOGLE said, not what the device said.
--
-- WHAT THIS IS NOT
--   It does not verify anything. It has no network access and no knowledge of
--   Play. It is the write step, locked to service_role, and it is only ever
--   correct because the caller has already verified.
--
-- WHY A SEPARATE PRODUCT TABLE AND NOT A COLUMN ON plan_limits
--   ⚠️ account_plan() RETURNS THE plan_limits ROW TYPE. Adding a column to
--   that table changes the function's return shape, which breaks every
--   caller until the function is recreated, and the failure is at runtime.
--   A separate mapping table costs one join and touches nothing that is
--   already live.
--
-- Prerequisites, all applied and recorded 2026-09-10:
--   supabase-monetization-phase1-plans-2026-09-08.sql   (plan_limits,
--       account_subscriptions, and the source CHECK that already permits
--       'iap_google' and 'iap_apple')
--   supabase-monetization-phase2b-admin-2026-09-08.sql  (the ovr_ columns
--       and plan_ovr())
--
-- Nothing here is reachable by a user. Every function is service_role only,
-- and no client code calls them. Applying this file changes no behaviour.
-- =========================================================================


-- ── 1. Which store product grants which plan ──────────────────────────────
-- The product id is Play's, and it can never be changed or reused once the
-- product exists, so this table is the one place the mapping is written down.
create table if not exists public.iap_products (
  store       text        not null,
  product_id  text        not null,
  plan        text        not null references public.plan_limits(plan),
  active      boolean     not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (store, product_id),
  constraint iap_products_store_chk check (store in ('google', 'apple'))
);

comment on table public.iap_products is
  'Store product id to plan code. Kept out of plan_limits because account_plan() returns that table''s row type. See docs/spec-monetization-play-billing.md.';

insert into public.iap_products (store, product_id, plan, note)
values
  ('google', 'plan_p9',  'p9',  'base plan p9-monthly'),
  ('google', 'plan_p19', 'p19', 'base plan p19-monthly'),
  ('google', 'plan_p49', 'p49', 'base plan p49-monthly')
on conflict (store, product_id) do nothing;

alter table public.iap_products enable row level security;

-- Readable so a future screen can show what is purchasable without a second
-- source of truth. It holds no user data. Writes are service_role only,
-- which needs no policy because service_role bypasses RLS.
drop policy if exists iap_products_read on public.iap_products;
create policy iap_products_read
  on public.iap_products for select
  to authenticated
  using (true);

grant select on public.iap_products to authenticated;


-- ── 2. Grant ──────────────────────────────────────────────────────────────
-- Returns the plan code granted, so the caller can log what actually happened
-- rather than what it intended.
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

  -- FAIL CLOSED ON AN UNKNOWN PRODUCT. A product id we do not recognise is
  -- either a typo in Play or someone replaying a token from another app, and
  -- granting "something reasonable" in either case is how a free tier leaks.
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

  -- ⚠️ THE GRANDFATHER OVERRIDE BECOMES A RESTRICTION THE MOMENT THEY PAY.
  --
  -- plan_ovr() is `else p_ovr`, so an override wins even when it is LOWER
  -- than the plan. An account frozen at ovr_max_vehicles = 8 that buys p9
  -- (cap 15) would still be capped at 8 after paying, and the support ticket
  -- would read "I paid and nothing changed".
  --
  -- So clear it, but ONLY when the purchased plan is genuinely better. A NULL
  -- plan cap means unlimited and always wins. An override that is already
  -- higher than the plan is someone's deliberate arrangement and is left
  -- alone, because taking capacity away from a paying customer is worse than
  -- leaving them with extra.
  select max_vehicles into v_plan_cap from public.plan_limits where plan = v_plan;
  select ovr_max_vehicles into v_ovr_cap
    from public.account_subscriptions where account_id = p_account_id;

  if v_ovr_cap is not null
     and v_ovr_cap <> -1
     and (v_plan_cap is null or v_plan_cap > v_ovr_cap)
  then
    update public.account_subscriptions
       set ovr_max_vehicles = null,
           ovr_note = concat_ws(' | ', nullif(ovr_note, ''),
                        format('grandfather cap %s cleared on %s purchase %s',
                               v_ovr_cap, p_store, current_date)),
           updated_at = now()
     where account_id = p_account_id;
  end if;

  return v_plan;
end;
$$;

comment on function public.grant_iap_entitlement(uuid, text, text, timestamptz, text) is
  'Write an entitlement from a purchase ALREADY verified against the store API. Never call this with unverified client data.';

revoke all on function public.grant_iap_entitlement(uuid, text, text, timestamptz, text) from public;
grant execute on function public.grant_iap_entitlement(uuid, text, text, timestamptz, text) to service_role;


-- ── 3. Revoke ─────────────────────────────────────────────────────────────
-- Driven by Real-time Developer Notifications: EXPIRED, REVOKED (a refund),
-- and the end of a cancelled period.
--
-- ⚠️ CANCELLED IS NOT EXPIRED. A cancellation means "will not renew", and the
-- user keeps access until current_period_end. Only call this when the store
-- says the entitlement is actually over.
create or replace function public.revoke_iap_entitlement(
  p_account_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_account_id is null then
    raise exception 'revoke_iap_entitlement: account_id is required';
  end if;

  -- Drop to free rather than deleting the row: the product principle is that
  -- nothing is removed and no reminder stops. They keep every vehicle they
  -- hold and simply cannot add another past the free cap.
  update public.account_subscriptions
     set plan               = 'free',
         status             = 'canceled',
         current_period_end = null,
         ovr_note           = concat_ws(' | ', nullif(ovr_note, ''),
                                format('entitlement revoked %s: %s',
                                       current_date, coalesce(p_reason, 'unspecified'))),
         updated_at         = now()
   where account_id = p_account_id
     and source in ('iap_google', 'iap_apple');
end;
$$;

comment on function public.revoke_iap_entitlement(uuid, text) is
  'End a store entitlement. Scoped to IAP sources so it can never clear a web checkout or an admin grant.';

revoke all on function public.revoke_iap_entitlement(uuid, text) from public;
grant execute on function public.revoke_iap_entitlement(uuid, text) to service_role;


-- =========================================================================
-- VERIFICATION. Run these and paste what you actually saw.
--
-- 1. The mapping exists and points at real plans. Expect exactly 3 rows,
--    and a plan_exists of true on every one.
--
--      select p.store, p.product_id, p.plan, p.active,
--             (l.plan is not null) as plan_exists
--        from public.iap_products p
--        left join public.plan_limits l on l.plan = p.plan
--       order by p.product_id;
--
-- 2. Both functions exist and are locked to service_role. Expect 2 rows,
--    each with security_definer = true and public_execute = false.
--
--      select p.proname,
--             p.prosecdef as security_definer,
--             has_function_privilege('public', p.oid, 'execute') as public_execute
--        from pg_proc p
--        join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public'
--         and p.proname in ('grant_iap_entitlement', 'revoke_iap_entitlement');
--
-- 3. Nothing was granted to anyone by applying this file. Expect 0.
--
--      select count(*) from public.account_subscriptions
--       where source in ('iap_google', 'iap_apple');
--
-- ⚠️ Query 3 returns 0 both when the file worked and when it was never run,
--    so it proves nothing on its own. Query 1 is the one that distinguishes:
--    it errors with "relation does not exist" if the file did not apply.
-- =========================================================================
