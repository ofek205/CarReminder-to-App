-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-phase2b-admin-2026-09-08.sql
--
-- Monetization, phase 2b: admin plan management. STILL NO ENFORCEMENT.
--
--   docs/plan-monetization-implementation.md §3.5
--
-- WHY THIS IS NOT A "NICE TO HAVE"
--   This is the sales channel for phases 1 through 5, before any payment
--   integration exists: an admin grants a plan by hand and the customer
--   pays by transfer. It also supplies the store reviewer account that
--   Google requires under App access, whose absence can block releases.
--
-- ⚠️ DEPENDS ON PHASE 1. Apply supabase-monetization-phase1-plans-2026-09-08.sql
--   first. The preflight below refuses to run otherwise.
--
-- WHAT THIS ADDS
--   1. Per-limit override columns on account_subscriptions, so a bespoke
--      deal never becomes a row in plan_limits.
--   2. plan_ovr(), the ONE place the -1 sentinel is translated.
--   3. A rewritten account_plan() that applies overrides and evaluates
--      expiry AT READ TIME.
--   4. Six admin RPCs, every one of them audited.
--
-- SAFETY: additive. New columns (all nullable), one new helper, a replaced
--   account_plan() whose signature and return type are unchanged, six new
--   functions. No existing table, policy or trigger is altered. Idempotent.
--   Rollback block at the bottom.
--
--   ⚠️ CLAUDE.md gate 5: staging shares this database with production.
--
-- APPLY
--   Supabase SQL Editor, once, AFTER phase 1. Then:
--     node scripts/sql-ledger.cjs record supabase-monetization-phase2b-admin-2026-09-08.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')           is null then missing := missing || 'table public.plan_limits (apply phase 1 first)'; end if;
  if to_regclass('public.account_subscriptions') is null then missing := missing || 'table public.account_subscriptions (apply phase 1 first)'; end if;
  if to_regclass('public.admin_audit_log')       is null then missing := missing || 'table public.admin_audit_log'; end if;
  if to_regprocedure('public.is_admin()')                              is null then missing := missing || 'function public.is_admin()'; end if;
  if to_regprocedure('public.admin_log(text,text,text,jsonb)')         is null then missing := missing || 'function public.admin_log(text,text,text,jsonb)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'phase 2b preflight failed, nothing was created. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. plan_limits.is_public ───────────────────────────────────────────────
-- The public pricing page is built from this table. is_public lets a plan be
-- retired or held back without deleting a row that live subscriptions still
-- reference by foreign key.
alter table public.plan_limits
  add column if not exists is_public boolean not null default true;


-- ── 2. override columns ────────────────────────────────────────────────────
--
-- ⚠️ WHY NOT A "custom" ROW IN plan_limits
--   The tempting move is to insert a plan called custom_<customer>. It is
--   wrong twice over: the public pricing page reads that table, so every
--   private deal would appear as a published plan, and the row count grows
--   without bound until nobody can answer "what plans do we sell?".
--
-- A bespoke deal is therefore a DEVIATION recorded against the account, not
-- a new product.
alter table public.account_subscriptions
  add column if not exists ovr_max_vehicles           int,
  add column if not exists ovr_ai_daily_cap           int,
  add column if not exists ovr_ai_lifetime_teaser     int,
  add column if not exists ovr_plate_checks_per_month int,
  add column if not exists ovr_max_shares             int,
  add column if not exists ovr_business_ui            boolean,
  -- Why this account is an exception. MANDATORY, enforced by every RPC: a
  -- grant with no written reason is a grant nobody can justify in a year.
  add column if not exists ovr_note                   text,
  -- NULL = never expires. Governs the overrides AND, for an admin_grant,
  -- the granted plan itself. See §3.5.4 and the naming note in
  -- account_plan() below.
  add column if not exists ovr_expires_at             timestamptz,
  add column if not exists reverts_to_plan            text,
  add column if not exists granted_by                 uuid,
  add column if not exists granted_at                 timestamptz;

-- Separate statements: ADD CONSTRAINT has no IF NOT EXISTS, so re-running
-- the file must not abort on an already-present constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'account_subscriptions_reverts_to_fk'
       and conrelid = 'public.account_subscriptions'::regclass
  ) then
    alter table public.account_subscriptions
      add constraint account_subscriptions_reverts_to_fk
      foreign key (reverts_to_plan) references public.plan_limits(plan);
  end if;
end $$;

-- ⚠️ THE SENTINEL, AND WHY IT HAS TO EXIST
--   In plan_limits, NULL means UNLIMITED.
--   In these override columns, NULL means INHERIT FROM THE PLAN.
--   The same value, two opposite meanings, which is why COALESCE alone
--   cannot express "override this to unlimited": coalescing a NULL override
--   just falls back to the plan. So -1 carries "unlimited" here, and
--   plan_ovr() below is the ONLY place it is translated.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'account_subscriptions_ovr_sane'
       and conrelid = 'public.account_subscriptions'::regclass
  ) then
    alter table public.account_subscriptions
      add constraint account_subscriptions_ovr_sane check (
        coalesce(ovr_max_vehicles, 0)           >= -1 and
        coalesce(ovr_ai_daily_cap, 0)           >= -1 and
        coalesce(ovr_ai_lifetime_teaser, 0)     >= -1 and
        coalesce(ovr_plate_checks_per_month, 0) >= -1 and
        coalesce(ovr_max_shares, 0)             >= -1
      );
  end if;
end $$;

-- The exceptions screen sorts by expiry with "never" last, and asks "which
-- accounts are not standard". Partial index over exactly that set.
create index if not exists account_subscriptions_exceptions_idx
  on public.account_subscriptions (ovr_expires_at nulls last)
  where source = 'admin_grant'
     or ovr_max_vehicles is not null
     or ovr_ai_daily_cap is not null
     or ovr_ai_lifetime_teaser is not null
     or ovr_plate_checks_per_month is not null
     or ovr_max_shares is not null
     or ovr_business_ui is not null;


-- ── 3. plan_ovr(): the one place the sentinel is translated ────────────────
create or replace function public.plan_ovr(p_ovr int, p_base int)
returns int
language sql
immutable
as $$
  select case
    when p_ovr is null then p_base   -- inherit: p_base may itself be NULL
    when p_ovr = -1    then null     -- override TO unlimited
    else p_ovr
  end;
$$;

comment on function public.plan_ovr(int, int) is
  'Resolve one override against its plan value. NULL override = inherit, -1 = unlimited. The ONLY place the -1 sentinel is translated.';


-- ── 4. account_plan(), rewritten to apply overrides ───────────────────────
--
-- Same signature and same return type as phase 1, so this is a genuine
-- CREATE OR REPLACE and my_account_plan() keeps working untouched.
--
-- ⚠️ EXPIRY IS EVALUATED HERE, AT READ TIME, NOT BY A CRON.
--   A three-month grant has to stop on time. A sweeper job would leave a
--   window where an expired grant is still live, and this project has
--   already been burned by a silent cron failure: reminder emails were dead
--   for roughly 98% of users because handle_new_user failed quietly. Read
--   time evaluation is fail-closed by construction, because an expired
--   override is simply not applied.
--
-- ⚠️ NAMING, INHERITED FROM THE SPEC: ovr_expires_at governs the overrides
--   AND, when source = 'admin_grant', the granted plan itself. The prefix
--   reads as though it only covers the override columns. It does not. One
--   exception, one expiry date.
create or replace function public.account_plan(p_account_id uuid)
returns public.plan_limits
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s      public.account_subscriptions;
  v_plan public.plan_limits;
  v_code text;
  v_live boolean;   -- is this exception still in force?
begin
  select * into s
    from public.account_subscriptions
   where account_id = p_account_id;

  -- No row at all: free. Fail-closed, and the state of every account that
  -- predates phase 1's backfill.
  if not found then
    select * into v_plan from public.plan_limits where plan = 'free';
    return v_plan;
  end if;

  v_live := s.ovr_expires_at is null or s.ovr_expires_at > now();

  -- Which plan's limits are the baseline.
  if not v_live and s.source = 'admin_grant' then
    -- The grant lapsed. Fall back to what it was agreed to revert to, or
    -- free. §3.5.9: the vehicles and reminders keep working, there is just
    -- no room to add more.
    v_code := coalesce(s.reverts_to_plan, 'free');
  elsif s.status = 'active'
     or (s.grace_until is not null and s.grace_until > now()) then
    v_code := s.plan;
  else
    -- past_due or canceled with no live grace.
    v_code := 'free';
  end if;

  select * into v_plan from public.plan_limits where plan = v_code;
  if not found then
    -- A plan code that no longer exists must not resolve to "no limits".
    select * into v_plan from public.plan_limits where plan = 'free';
  end if;

  -- Apply the deviations, but only while the exception is in force.
  if v_live then
    v_plan.max_vehicles           := public.plan_ovr(s.ovr_max_vehicles,           v_plan.max_vehicles);
    v_plan.ai_daily_cap           := public.plan_ovr(s.ovr_ai_daily_cap,           v_plan.ai_daily_cap);
    v_plan.ai_lifetime_teaser     := public.plan_ovr(s.ovr_ai_lifetime_teaser,     v_plan.ai_lifetime_teaser);
    v_plan.plate_checks_per_month := public.plan_ovr(s.ovr_plate_checks_per_month, v_plan.plate_checks_per_month);
    v_plan.max_shares             := public.plan_ovr(s.ovr_max_shares,             v_plan.max_shares);
    -- Boolean: no sentinel needed, since there is no "unlimited" boolean.
    -- NULL still means inherit.
    if s.ovr_business_ui is not null then
      v_plan.business_ui := s.ovr_business_ui;
    end if;
  end if;

  -- NOTE: v_plan.plan still reports the BASE plan code, not "custom". The
  -- plan is the product the account is on; the overrides are deviations
  -- from it. A screen that needs to say "overridden" asks
  -- admin_list_plan_exceptions, which is built for exactly that.
  return v_plan;
end $$;

revoke all on function public.account_plan(uuid) from public;
revoke all on function public.account_plan(uuid) from authenticated;
revoke all on function public.account_plan(uuid) from anon;


-- ── 5. shared guards for the admin RPCs ───────────────────────────────────
--
-- Every RPC below opens with the same three checks. They live in one
-- function so a new RPC cannot accidentally ship without them.
create or replace function public.admin_plan_guard(p_account_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- is_admin() ON THE SERVER. The admin bypass in lib/featureFlags.js is
  -- client-side and is not a substitute for anything.
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- A written reason is mandatory on every plan action. Blank, whitespace
  -- and NULL are all rejected: a grant nobody can justify later is worse
  -- than no grant.
  if p_note is null or btrim(p_note) = '' then
    raise exception 'note_required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'account_not_found' using errcode = '23503';
  end if;
end $$;

revoke all on function public.admin_plan_guard(uuid, text) from public;

-- Makes sure a subscription row exists, then locks it and returns it.
--
-- ⚠️ THE LOCK IS THE POINT. Two admins editing one account concurrently
-- would otherwise both read the old row and the second write would silently
-- discard the first. Same reasoning as the FOR UPDATE in the phase-4 cap
-- trigger.
create or replace function public.admin_lock_subscription(p_account_id uuid)
returns public.account_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.account_subscriptions;
begin
  insert into public.account_subscriptions (account_id)
       values (p_account_id)
  on conflict (account_id) do nothing;

  select * into s
    from public.account_subscriptions
   where account_id = p_account_id
     for update;

  return s;
end $$;

revoke all on function public.admin_lock_subscription(uuid) from public;


-- ── 6. the RPCs ───────────────────────────────────────────────────────────

-- 6a. Grant or change a plan.
create or replace function public.admin_set_account_plan(
  p_account_id  uuid,
  p_plan        text,
  p_note        text,
  p_source      text        default 'admin_grant',
  p_expires_at  timestamptz default null,
  p_reverts_to  text        default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_old public.account_subscriptions;
begin
  perform public.admin_plan_guard(p_account_id, p_note);

  if not exists (select 1 from public.plan_limits where plan = p_plan) then
    raise exception 'unknown_plan: %', p_plan using errcode = '23503';
  end if;
  if p_reverts_to is not null
     and not exists (select 1 from public.plan_limits where plan = p_reverts_to) then
    raise exception 'unknown_reverts_to_plan: %', p_reverts_to using errcode = '23503';
  end if;
  -- An expiry already in the past would be a grant that is dead on arrival.
  -- Almost certainly a typo, so refuse rather than silently do nothing.
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expiry_in_the_past' using errcode = '22023';
  end if;

  s_old := public.admin_lock_subscription(p_account_id);

  update public.account_subscriptions
     set plan            = p_plan,
         source          = p_source,
         status          = 'active',
         ovr_note        = p_note,
         ovr_expires_at  = p_expires_at,
         reverts_to_plan = p_reverts_to,
         granted_by      = auth.uid(),
         granted_at      = now()
   where account_id = p_account_id;

  perform public.admin_log(
    'set_account_plan', 'account', p_account_id::text,
    jsonb_build_object(
      'old_plan',   s_old.plan,
      'new_plan',   p_plan,
      'old_source', s_old.source,
      'new_source', p_source,
      'expires_at', p_expires_at,
      'reverts_to', p_reverts_to,
      'note',       p_note
    )
  );
end $$;

revoke all on function public.admin_set_account_plan(uuid, text, text, text, timestamptz, text) from public;
grant execute on function public.admin_set_account_plan(uuid, text, text, text, timestamptz, text) to authenticated;


-- 6b. Bespoke limits.
--
-- Overrides arrive as jsonb so one RPC covers every combination.
--
-- ⚠️ UNKNOWN KEYS ARE REJECTED, NOT IGNORED. Reading p_overrides->>'max_vehicles'
-- while the caller sent 'maxVehicles' would return NULL, the RPC would
-- report success, and nothing would change. A silent no-op on a commercial
-- deal is the worst outcome available here, so a typo is an error.
create or replace function public.admin_set_account_overrides(
  p_account_id uuid,
  p_overrides  jsonb,
  p_note       text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_old   public.account_subscriptions;
  v_key   text;
  v_known text[] := array[
    'max_vehicles', 'ai_daily_cap', 'ai_lifetime_teaser',
    'plate_checks_per_month', 'max_shares', 'business_ui'
  ];
begin
  perform public.admin_plan_guard(p_account_id, p_note);

  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'overrides_must_be_object' using errcode = '22023';
  end if;
  if p_overrides = '{}'::jsonb then
    raise exception 'overrides_empty: use admin_clear_account_overrides' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expiry_in_the_past' using errcode = '22023';
  end if;

  for v_key in select jsonb_object_keys(p_overrides) loop
    if not (v_key = any (v_known)) then
      raise exception 'unknown_override_key: %. known: %', v_key, array_to_string(v_known, ', ')
        using errcode = '22023';
    end if;
  end loop;

  s_old := public.admin_lock_subscription(p_account_id);

  -- A key that is present but null means "clear this one override". A key
  -- that is absent leaves the column alone, which is what makes this RPC
  -- safe to call for a single limit without wiping the others.
  update public.account_subscriptions s
     set ovr_max_vehicles = case when p_overrides ? 'max_vehicles'
              then (p_overrides->>'max_vehicles')::int else s.ovr_max_vehicles end,
         ovr_ai_daily_cap = case when p_overrides ? 'ai_daily_cap'
              then (p_overrides->>'ai_daily_cap')::int else s.ovr_ai_daily_cap end,
         ovr_ai_lifetime_teaser = case when p_overrides ? 'ai_lifetime_teaser'
              then (p_overrides->>'ai_lifetime_teaser')::int else s.ovr_ai_lifetime_teaser end,
         ovr_plate_checks_per_month = case when p_overrides ? 'plate_checks_per_month'
              then (p_overrides->>'plate_checks_per_month')::int else s.ovr_plate_checks_per_month end,
         ovr_max_shares = case when p_overrides ? 'max_shares'
              then (p_overrides->>'max_shares')::int else s.ovr_max_shares end,
         ovr_business_ui = case when p_overrides ? 'business_ui'
              then (p_overrides->>'business_ui')::boolean else s.ovr_business_ui end,
         ovr_note       = p_note,
         ovr_expires_at = p_expires_at,
         granted_by     = auth.uid(),
         granted_at     = now()
   where s.account_id = p_account_id;

  perform public.admin_log(
    'set_account_overrides', 'account', p_account_id::text,
    jsonb_build_object(
      'plan', s_old.plan,
      'old', jsonb_build_object(
        'max_vehicles',           s_old.ovr_max_vehicles,
        'ai_daily_cap',           s_old.ovr_ai_daily_cap,
        'ai_lifetime_teaser',     s_old.ovr_ai_lifetime_teaser,
        'plate_checks_per_month', s_old.ovr_plate_checks_per_month,
        'max_shares',             s_old.ovr_max_shares,
        'business_ui',            s_old.ovr_business_ui
      ),
      'new',        p_overrides,
      'expires_at', p_expires_at,
      'note',       p_note
    )
  );
end $$;

revoke all on function public.admin_set_account_overrides(uuid, jsonb, text, timestamptz) from public;
grant execute on function public.admin_set_account_overrides(uuid, jsonb, text, timestamptz) to authenticated;


-- 6c. Back to the plan's own limits.
create or replace function public.admin_clear_account_overrides(
  p_account_id uuid,
  p_note       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_old public.account_subscriptions;
begin
  perform public.admin_plan_guard(p_account_id, p_note);
  s_old := public.admin_lock_subscription(p_account_id);

  update public.account_subscriptions
     set ovr_max_vehicles           = null,
         ovr_ai_daily_cap           = null,
         ovr_ai_lifetime_teaser     = null,
         ovr_plate_checks_per_month = null,
         ovr_max_shares             = null,
         ovr_business_ui            = null,
         ovr_expires_at             = null,
         ovr_note                   = p_note,
         granted_by                 = auth.uid(),
         granted_at                 = now()
   where account_id = p_account_id;

  perform public.admin_log(
    'clear_account_overrides', 'account', p_account_id::text,
    jsonb_build_object(
      'cleared', jsonb_build_object(
        'max_vehicles',           s_old.ovr_max_vehicles,
        'ai_daily_cap',           s_old.ovr_ai_daily_cap,
        'ai_lifetime_teaser',     s_old.ovr_ai_lifetime_teaser,
        'plate_checks_per_month', s_old.ovr_plate_checks_per_month,
        'max_shares',             s_old.ovr_max_shares,
        'business_ui',            s_old.ovr_business_ui
      ),
      'note', p_note
    )
  );
end $$;

revoke all on function public.admin_clear_account_overrides(uuid, text) from public;
grant execute on function public.admin_clear_account_overrides(uuid, text) to authenticated;


-- 6d. Extend a cap-adjustment window.
create or replace function public.admin_extend_grace(
  p_account_id uuid,
  p_until      timestamptz,
  p_note       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_old public.account_subscriptions;
begin
  perform public.admin_plan_guard(p_account_id, p_note);

  if p_until is null or p_until <= now() then
    raise exception 'grace_must_be_in_the_future' using errcode = '22023';
  end if;

  s_old := public.admin_lock_subscription(p_account_id);

  update public.account_subscriptions
  -- ⚠️ DOES NOT TOUCH ovr_note. That column answers "why is this account
  -- an exception", and the exceptions screen renders it as THE reason. An
  -- account whose note reads "pilot, 15 vehicles agreed with the customer"
  -- must not have that replaced by "gave them more time" the first time
  -- someone extends its grace: the commercial rationale would be gone from
  -- the row. Grace and overrides are separate axes. This action's own
  -- reason belongs in the audit log, and goes there below.
  update public.account_subscriptions
     set grace_until = p_until
   where account_id = p_account_id;

  perform public.admin_log(
    'extend_grace', 'account', p_account_id::text,
    jsonb_build_object('old_grace', s_old.grace_until, 'new_grace', p_until, 'note', p_note)
  );
end $$;

revoke all on function public.admin_extend_grace(uuid, timestamptz, text) from public;
grant execute on function public.admin_extend_grace(uuid, timestamptz, text) to authenticated;


-- 6e. Revoke back to free, clearing every deviation.
create or replace function public.admin_revoke_plan(
  p_account_id uuid,
  p_note       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s_old public.account_subscriptions;
begin
  perform public.admin_plan_guard(p_account_id, p_note);
  s_old := public.admin_lock_subscription(p_account_id);

  -- ⚠️ THIS DOES NOT TOUCH ANY PAYMENT. §3.5.9: if the account is paying by
  -- card, revoking the plan here leaves the charge running at the PSP.
  -- Cancelling that is a separate, deliberate act, and the UI must warn
  -- before calling this on a row whose source is a real checkout.
  update public.account_subscriptions
     set plan                       = 'free',
         -- ⚠️ 'default', NOT 'admin_grant'. A revoked account is on free
         -- with no overrides, which is to say it is STANDARD. Leaving
         -- source = 'admin_grant' would keep it in admin_list_plan_exceptions
         -- forever, because that listing's first predicate is exactly this
         -- column. The screen exists because the real risk is FORGETTING an
         -- exception (§3.5.7), and a list that accumulates ordinary
         -- accounts with every revocation is a list nobody reads. "An admin
         -- did this" is already recorded permanently in admin_audit_log,
         -- which is append-only and is the right home for it.
         source                     = 'default',
         status                     = 'active',
         ovr_max_vehicles           = null,
         ovr_ai_daily_cap           = null,
         ovr_ai_lifetime_teaser     = null,
         ovr_plate_checks_per_month = null,
         ovr_max_shares             = null,
         ovr_business_ui            = null,
         ovr_expires_at             = null,
         reverts_to_plan            = null,
         ovr_note                   = p_note,
         granted_by                 = auth.uid(),
         granted_at                 = now()
   where account_id = p_account_id;

  perform public.admin_log(
    'revoke_plan', 'account', p_account_id::text,
    jsonb_build_object(
      'old_plan',   s_old.plan,
      'old_source', s_old.source,
      'had_external_subscription',
        s_old.external_subscription_id is not null,
      'note', p_note
    )
  );
end $$;

revoke all on function public.admin_revoke_plan(uuid, text) from public;
grant execute on function public.admin_revoke_plan(uuid, text) to authenticated;


-- 6f. The exceptions screen.
--
-- ⚠️ THE REAL OPERATIONAL RISK IS FORGETTING, NOT GRANTING. A free grant
-- nobody revisits is revenue leaking silently, with no alert anywhere. This
-- listing is the only thing that makes that visible, which is why it sorts
-- by expiry with soonest first and marks "never expires" separately.
create or replace function public.admin_list_plan_exceptions(
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  account_id       uuid,
  account_name     text,
  account_type     text,
  base_plan        text,
  effective_plan   text,
  source           text,
  status           text,
  vehicle_count    bigint,
  eff_max_vehicles int,
  ovr_max_vehicles int,
  ovr_ai_daily_cap int,
  ovr_ai_lifetime_teaser int,
  ovr_plate_checks_per_month int,
  ovr_max_shares   int,
  ovr_business_ui  boolean,
  ovr_note         text,
  ovr_expires_at   timestamptz,
  never_expires    boolean,
  is_expired       boolean,
  reverts_to_plan  text,
  granted_by_email text,
  granted_at       timestamptz,
  grace_until      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  return query
  select
    s.account_id,
    -- ⚠️ THE COLUMN IS accounts.name. `account_name` exists only as an
    -- ALIAS in the workspace views (phase1-workspace-foundation.sql:75
    -- selects `a.name as account_name`), and the client reads it under that
    -- alias, which makes it easy to assume the base table has it. It does
    -- not, and selecting a.account_name here fails at runtime with "column
    -- does not exist". Same trap as vehicles having no updated_at.
    a.name::text as account_name,
    a.type,
    s.plan            as base_plan,
    -- From the LATERAL below, evaluated ONCE per row. Writing
    -- (public.account_plan(...)).plan and (public.account_plan(...)).max_vehicles
    -- calls the function twice per row, and each call reads the
    -- subscription and the plan again: 1000 calls at the 500-row cap.
    ep.plan           as effective_plan,
    s.source,
    s.status,
    (select count(*) from public.vehicles v where v.account_id = s.account_id) as vehicle_count,
    ep.max_vehicles   as eff_max_vehicles,
    s.ovr_max_vehicles,
    s.ovr_ai_daily_cap,
    s.ovr_ai_lifetime_teaser,
    s.ovr_plate_checks_per_month,
    s.ovr_max_shares,
    s.ovr_business_ui,
    s.ovr_note,
    s.ovr_expires_at,
    (s.ovr_expires_at is null)                       as never_expires,
    (s.ovr_expires_at is not null
       and s.ovr_expires_at <= now())                as is_expired,
    s.reverts_to_plan,
    u.email::text                                    as granted_by_email,
    s.granted_at,
    s.grace_until
  from public.account_subscriptions s
  join public.accounts a on a.id = s.account_id
  left join auth.users u  on u.id = s.granted_by
  cross join lateral public.account_plan(s.account_id) ep
  where s.source = 'admin_grant'
     or s.ovr_max_vehicles is not null
     or s.ovr_ai_daily_cap is not null
     or s.ovr_ai_lifetime_teaser is not null
     or s.ovr_plate_checks_per_month is not null
     or s.ovr_max_shares is not null
     or s.ovr_business_ui is not null
  -- Soonest expiry first, "never" last: the ones about to lapse are the
  -- ones an admin has to act on, and the ones that never lapse are the ones
  -- that leak.
  order by (s.ovr_expires_at is null), s.ovr_expires_at asc, a.name
  limit  greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
end $$;

revoke all on function public.admin_list_plan_exceptions(int, int) from public;
grant execute on function public.admin_list_plan_exceptions(int, int) to authenticated;


-- ── 7. VERIFICATION ───────────────────────────────────────────────────────
--
-- 1) The sentinel translates in both directions:
--      select public.plan_ovr(null, 10) as inherit_10,     -- 10
--             public.plan_ovr(-1,   10) as to_unlimited,   -- NULL
--             public.plan_ovr(15,   10) as to_15,          -- 15
--             public.plan_ovr(null, null) as inherit_unlimited; -- NULL
--
-- 2) A bespoke deal resolves (use a real test account id):
--      select public.admin_set_account_overrides(
--        '<account>', '{"max_vehicles": 15}'::jsonb, 'בדיקה');
--      select plan, max_vehicles from public.account_plan('<account>');
--      -- expect: the base plan code, max_vehicles = 15
--
-- 3) "Override to unlimited" works, which COALESCE alone could not do:
--      select public.admin_set_account_overrides(
--        '<account>', '{"max_vehicles": -1}'::jsonb, 'בדיקה');
--      select max_vehicles from public.account_plan('<account>');  -- NULL
--
-- 4) A typo is refused rather than silently ignored:
--      select public.admin_set_account_overrides(
--        '<account>', '{"maxVehicles": 15}'::jsonb, 'בדיקה');
--      -- expect: ERROR unknown_override_key: maxVehicles
--
-- 5) A blank reason is refused:
--      select public.admin_set_account_plan('<account>', 'p49', '   ');
--      -- expect: ERROR note_required
--
-- 6) Expiry is honoured at read time, with no cron:
--      update public.account_subscriptions
--         set ovr_expires_at = now() - interval '1 day'
--       where account_id = '<account>';
--      select plan, max_vehicles from public.account_plan('<account>');
--      -- expect: reverts_to_plan (or free), overrides ignored
--
-- 7) Every action landed in the audit log:
--      select action, target_id, detail, created_at
--        from public.admin_audit_log
--       where target_type = 'account'
--       order by created_at desc limit 10;
--
-- 8) A non-admin is refused (run as a normal user):
--      select * from public.admin_list_plan_exceptions();
--      -- expect: ERROR unauthorized
--
-- ROLLBACK:
--   drop function if exists public.admin_list_plan_exceptions(int, int);
--   drop function if exists public.admin_revoke_plan(uuid, text);
--   drop function if exists public.admin_extend_grace(uuid, timestamptz, text);
--   drop function if exists public.admin_clear_account_overrides(uuid, text);
--   drop function if exists public.admin_set_account_overrides(uuid, jsonb, text, timestamptz);
--   drop function if exists public.admin_set_account_plan(uuid, text, text, text, timestamptz, text);
--   drop function if exists public.admin_lock_subscription(uuid);
--   drop function if exists public.admin_plan_guard(uuid, text);
--   -- account_plan() would need restoring from phase 1, not dropping.
--   drop function if exists public.plan_ovr(int, int);
--   alter table public.account_subscriptions
--     drop column if exists ovr_max_vehicles,
--     drop column if exists ovr_ai_daily_cap,
--     drop column if exists ovr_ai_lifetime_teaser,
--     drop column if exists ovr_plate_checks_per_month,
--     drop column if exists ovr_max_shares,
--     drop column if exists ovr_business_ui,
--     drop column if exists ovr_note,
--     drop column if exists ovr_expires_at,
--     drop column if exists reverts_to_plan,
--     drop column if exists granted_by,
--     drop column if exists granted_at;
--   alter table public.plan_limits drop column if exists is_public;
