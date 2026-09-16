-- ============================================================================
-- Monetization: a cap on how many documents an account may HOLD
-- 2026-09-16
-- ============================================================================
--
-- free 5 · ₪9 16 · ₪19 40 · ₪49 unlimited
--
-- ⚠️ HELD, NOT UPLOADED. This counts rows that exist right now, exactly like
-- the vehicle cap, so deleting a document frees its slot and the next upload
-- succeeds. It is not a lifetime counter and not a monthly quota.
--
-- ⚠️ READ SECTION 1 BEFORE SECTION 2, AND MEAN IT THIS TIME.
-- A cap of 5 is tight for this product in a way the vehicle cap never was.
-- One vehicle already justifies a licence, an insurance policy and a test
-- certificate; two receipts after that and the account is at the cap. The
-- vehicle cap touched 21 accounts out of 737. This one plausibly touches a
-- large fraction of everybody, and section 1 is the only way to know before
-- writing rather than after.
--
-- Nothing here enforces anything on the day it is applied: the trigger is
-- gated on document_cap_enforced, seeded false.
--
-- ⚠️ THE GUARD DEFAULTS TO ON, deliberately and consistently with phases 4
-- and 5a: a missing flag row or a NULL value means ENFORCED. That is the
-- right direction for a paid feature long-term and the dangerous one today,
-- so the flag row must exist and say false. Section 5 verifies it.
-- ============================================================================


-- ── 0. PREFLIGHT ──────────────────────────────────────────────────────────

do $$
declare missing text := '';
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='plan_limits')
    then missing := missing || 'plan_limits (phase 1); '; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='account_subscriptions'
                    and column_name='ovr_max_vehicles')
    then missing := missing || 'account_subscriptions overrides (phase 2b); '; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='documents'
                    and column_name='account_id')
    then missing := missing || 'documents.account_id; '; end if;
  if not exists (select 1 from pg_proc where proname='plan_ovr')
    then missing := missing || 'plan_ovr() (phase 2b); '; end if;
  if missing <> '' then
    raise exception 'doc-cap preflight failed, nothing was changed. Missing: %', missing;
  end if;
end $$;


-- ── 1. THE BLAST RADIUS. READ-ONLY, AND IT DECIDES THE NUMBERS ────────────

select count(*)                          as accounts,
       count(*) filter (where n > 5)     as over_5,
       count(*) filter (where n > 16)    as over_16,
       count(*) filter (where n > 40)    as over_40,
       round(100.0 * count(*) filter (where n > 5) / nullif(count(*), 0), 1) as pct_over_5,
       max(n)                            as largest,
       round(avg(n), 1)                  as avg_docs
  from (
    select a.id,
           (select count(*) from public.documents d where d.account_id = a.id)::int as n
      from public.accounts a
  ) x;

-- The shape of the distribution, which is what says whether 5 is a
-- conversion point or a wall.
select case when n = 0 then '0'
            when n between 1 and 5   then '1-5'
            when n between 6 and 16  then '6-16'
            when n between 17 and 40 then '17-40'
            else '40+' end            as bucket,
       count(*)                       as accounts
  from (
    select (select count(*) from public.documents d where d.account_id = a.id)::int as n
      from public.accounts a
  ) y
 group by 1 order by 1;


-- ── 2. THE COLUMNS ────────────────────────────────────────────────────────

alter table public.plan_limits
  add column if not exists max_documents int;

comment on column public.plan_limits.max_documents is
  'Documents an account may HOLD at once. NULL = unlimited. Deleting frees a slot.';

alter table public.account_subscriptions
  add column if not exists ovr_max_documents int;

comment on column public.account_subscriptions.ovr_max_documents is
  'Per-account override for max_documents. NULL = inherit, -1 = unlimited. See plan_ovr().';


-- ── 3. THE VALUES ─────────────────────────────────────────────────────────
--
-- Written as an explicit UPDATE per plan rather than a seed, because
-- plan_limits already holds live rows and this file adds a column to them.

update public.plan_limits set max_documents = 5    where plan = 'free';
update public.plan_limits set max_documents = 16   where plan = 'p9';
update public.plan_limits set max_documents = 40   where plan = 'p19';
update public.plan_limits set max_documents = null where plan = 'p49';


-- ── 4. account_plan() MUST APPLY THE NEW OVERRIDE ─────────────────────────
--
-- ⚠️ THE FUNCTION RETURNS `public.plan_limits`, SO THE NEW COLUMN REACHES
-- EVERY CALLER FOR FREE. What does NOT come for free is the override: the
-- phase 2b body names each ovr_ column one line at a time, so a new column
-- without a new line here is an override that silently never applies.
--
-- The body below is phase 2b's, unchanged except for the max_documents line.

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
  v_live boolean;
begin
  select * into s
    from public.account_subscriptions
   where account_id = p_account_id;

  if not found then
    select * into v_plan from public.plan_limits where plan = 'free';
    return v_plan;
  end if;

  v_live := s.ovr_expires_at is null or s.ovr_expires_at > now();

  if not v_live and s.source = 'admin_grant' then
    v_code := coalesce(s.reverts_to_plan, 'free');
  elsif s.status = 'active'
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
-- a reader of this file would otherwise have to go back to phase 1 to learn
-- that account_plan is reachable by NOBODY directly. It is internal, called
-- by other security-definer functions, and my_account_plan(uuid) is the one
-- granted to authenticated. Leaving the privilege state implicit across a
-- redefinition is how a function quietly becomes callable.
revoke all on function public.account_plan(uuid) from public;
revoke all on function public.account_plan(uuid) from authenticated;
revoke all on function public.account_plan(uuid) from anon;


-- ── 5. THE FLAG, OFF ──────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('document_cap_enforced', 'false'::jsonb)
on conflict (key) do nothing;

-- Proof it is there and false. A missing row means ENFORCED.
select value #>> '{}' as document_cap_enforced
  from public.app_config where key = 'document_cap_enforced';


-- ── 6. THE TRIGGER ────────────────────────────────────────────────────────
--
-- Statement-level with a transition table, mirroring trg_vehicle_plan_cap_stmt
-- for the same reason: a per-row trigger lets a bulk insert land half in and
-- half out, and the client then reads a partial success as success.

create or replace function public.enforce_document_plan_cap_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_max   int;
  v_count int;
  v_grace timestamptz;
  v_on    boolean;
begin
  select coalesce((value #>> '{}')::boolean, true) into v_on
    from public.app_config where key = 'document_cap_enforced';
  if not found then v_on := true; end if;
  if v_on is distinct from true then
    return null;
  end if;

  for r in select distinct account_id from new_rows where account_id is not null loop

    -- Serialise per account, or two concurrent uploads each read a count
    -- below the cap and both commit.
    perform pg_advisory_xact_lock(hashtext('doc_cap:' || r.account_id::text));

    select max_documents into v_max from public.account_plan(r.account_id);
    if v_max is null then continue; end if;

    select grace_until into v_grace
      from public.account_subscriptions where account_id = r.account_id;
    -- Grace suspends enforcement entirely, matching the vehicle cap. Change
    -- this branch if the intent was the stricter "keep, do not add".
    if v_grace is not null and v_grace > now() then continue; end if;

    select count(*) into v_count
      from public.documents where account_id = r.account_id;

    -- `>` and not `>=`: this runs AFTER the insert, so v_count already
    -- includes the new rows.
    if v_count > v_max then
      raise exception 'document_plan_cap_exceeded'
        using detail = format('max=%s attempted_total=%s', v_max, v_count),
              hint   = 'upgrade_required';
    end if;
  end loop;

  return null;
end $$;

revoke all on function public.enforce_document_plan_cap_stmt() from public;

drop trigger if exists trg_document_plan_cap_stmt on public.documents;
create trigger trg_document_plan_cap_stmt
  after insert on public.documents
  referencing new table as new_rows
  for each statement
  execute function public.enforce_document_plan_cap_stmt();


-- ── 7. HOLD THE PLACE OF EVERYONE ALREADY ABOVE THE CAP ───────────────────
--
-- Run this unless section 1 convinced you to pick different numbers.
-- Same contract as the vehicle freeze: keep what you have, pay to add more.
--
-- ⚠️ AND LIKE THAT ONE, IT GOES STALE. It catches only accounts that are over
-- the cap at the instant it runs, so it must run AGAIN immediately before
-- document_cap_enforced is turned on.

with owned as (
  select a.id, (select count(*) from public.documents d where d.account_id = a.id)::int as n
    from public.accounts a
),
cap as (select max_documents as c from public.plan_limits where plan = 'free')
update public.account_subscriptions s
   set ovr_max_documents = o.n,
       ovr_note = coalesce(nullif(btrim(s.ovr_note), '') || ' | ', '') ||
                  'מסמכים 2026-09-16: הוקפא על ' || o.n ||
                  ' מסמכים בעת הכנסת תקרת המסמכים. שמירה על הקיים; ' ||
                  'הוספה מעבר לכך דורשת מסלול בתשלום.',
       updated_at = now()
  from owned o cross join cap
 where s.account_id = o.id
   and cap.c is not null
   and o.n > cap.c
   and s.ovr_max_documents is null;


-- ── 8. VERIFICATION ───────────────────────────────────────────────────────

select plan, max_vehicles, max_documents
  from public.plan_limits order by sort_order;
-- expect: free 5/5, p9 15/16, p19 30/40, p49 null/null

select count(*) as unprotected_over_doc_cap
  from public.accounts a
  left join public.account_subscriptions s on s.account_id = a.id
 where (select count(*) from public.documents d where d.account_id = a.id)
       > (select max_documents from public.plan_limits where plan = 'free')
   and s.ovr_max_documents is null;
-- MUST be 0 before document_cap_enforced is ever turned on.

-- And that the override actually reaches the resolver. Replace the id with
-- one from section 7's cohort; a frozen account must NOT report 5.
--   select max_documents from public.account_plan('<account-id>'::uuid);


-- ── 9. ROLLBACK ───────────────────────────────────────────────────────────
--
-- Drop the trigger BEFORE the flag: while the trigger exists, a missing flag
-- row reads as ENFORCED.
--
--   drop trigger if exists trg_document_plan_cap_stmt on public.documents;
--   drop function if exists public.enforce_document_plan_cap_stmt();
--   delete from public.app_config where key = 'document_cap_enforced';
--   update public.account_subscriptions
--      set ovr_max_documents = null,
--          ovr_note = nullif(btrim(regexp_replace(ovr_note,
--            '(\s*\|\s*)?מסמכים 2026-09-16:[^|]*', '', 'g')), '')
--    where ovr_note like '%מסמכים 2026-09-16%';
--   update public.plan_limits set max_documents = null;
--
-- The column itself is left in place: dropping it would change
-- account_plan()'s return type out from under every caller.
