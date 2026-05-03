-- ==========================================================================
-- Vehicle Expenses — private-side feed + extended categories.
--
-- Phase 1 of the private-account expenses feature. The B2B Phase 8 schema
-- (supabase-phase8-reports-and-costs.sql) already created the
-- vehicle_expenses table + add/update/delete RPCs + cost-summary views.
-- This migration:
--
--   1. Extends the category CHECK constraint from 4 → 16 codes (covers
--      the full private-side category list: maintenance / repair /
--      inspection / license_fee / 3 insurance variants / fuel / parking /
--      wash / tires / toll / towing / accessories / other / general).
--   2. Adds two new columns:
--        vendor  — merchant / garage / station name (used by AI scan)
--        source  — 'manual' | 'ai_scan' (provenance, optional)
--   3. Creates v_vehicle_expense_feed — a UNION ALL view that merges
--        vehicle_expenses + maintenance_logs(.cost) + repair_logs(.cost)
--      with a `source_type` + `editable` field so the UI can route edits
--      back to the canonical table for each row.
--   4. Adds fn_list_vehicle_expenses(...) — single RPC that returns
--      paginated rows + filter-aware totals in one round trip.
--
-- Existing add_vehicle_expense / update_vehicle_expense / delete_vehicle_expense
-- RPCs are NOT touched here. They already gate on is_workspace_manager,
-- which returns true for the בעלים of any account (private or B2B).
--
-- Idempotent: safe to re-run.
-- ==========================================================================

-- 1. Extend category enum -------------------------------------------------
-- Drop the legacy 4-value check, install the 16-value one.
alter table public.vehicle_expenses
  drop constraint if exists vehicle_expenses_category_check;

alter table public.vehicle_expenses
  add constraint vehicle_expenses_category_check
  check (category in (
    'maintenance',         -- טיפול             (also stored in maintenance_logs; here only when manually logged outside that flow)
    'repair',              -- תיקון             (also stored in repair_logs; same caveat)
    'inspection',          -- טסט
    'license_fee',         -- אגרת רישוי
    'insurance_mtpl',      -- ביטוח חובה
    'insurance_comp',      -- ביטוח מקיף
    'insurance_3p',        -- ביטוח צד ג׳
    'fuel',                -- דלק
    'parking',             -- חניה
    'wash',                -- שטיפה
    'tires',               -- צמיגים
    'toll',                -- כבישי אגרה
    'towing',              -- גרירה
    'accessories',         -- אביזרים
    'other',               -- אחר
    'general'              -- כללי
  ));

-- 2. New columns ----------------------------------------------------------
-- title  — optional headline shown as the row's primary text
--          ("טסט שנתי 2026", "תדלוק לפני נסיעה לצפון" וכו').
-- vendor — merchant / station / garage / insurance company name (used by
--          AI scan + manual input).
-- source — provenance tag: 'manual' | 'ai_scan'. Optional for legacy rows.
alter table public.vehicle_expenses
  add column if not exists title  text,
  add column if not exists vendor text,
  add column if not exists source text;

-- Light constraint on `source` so future inserts use one of the known
-- provenance tags. Existing rows have NULL → unchanged.
alter table public.vehicle_expenses
  drop constraint if exists vehicle_expenses_source_check;
alter table public.vehicle_expenses
  add constraint vehicle_expenses_source_check
  check (source is null or source in ('manual', 'ai_scan'));

-- 3. Unified read view ----------------------------------------------------
-- Merges 3 sources for the Expenses screen.
--   • vehicle_expenses           → editable=TRUE
--   • maintenance_logs (cost>0)  → editable=FALSE (route to MaintenanceDialog)
--   • repair_logs (cost>0)       → editable=FALSE (route to AddRepairDialog)
--
-- security_invoker = true → RLS on each base table still applies, so a
-- user only sees rows in accounts they belong to.
drop view if exists public.v_vehicle_expense_feed;
create view public.v_vehicle_expense_feed
  with (security_invoker = true)
as
  -- A. Manual / AI-scanned expenses
  select
    ve.id              as id,
    ve.account_id      as account_id,
    ve.vehicle_id      as vehicle_id,
    ve.amount          as amount,
    ve.currency        as currency,
    ve.category        as category,
    ve.expense_date    as expense_date,
    ve.title           as title,
    ve.note            as note,
    ve.vendor          as vendor,
    ve.receipt_url     as receipt_url,
    ve.created_at      as created_at,
    'expense'::text    as source_type,
    ve.id              as source_id,
    true               as editable
  from public.vehicle_expenses ve

  union all

  -- B. Maintenance with a recorded cost
  select
    m.id               as id,
    v.account_id       as account_id,
    m.vehicle_id       as vehicle_id,
    m.cost             as amount,
    'ILS'::text        as currency,
    'maintenance'::text as category,
    coalesce(m.date::date, m.created_at::date) as expense_date,
    m.title            as title,
    m.notes            as note,
    m.garage_name      as vendor,
    null::text         as receipt_url,
    m.created_at       as created_at,
    'maintenance'::text as source_type,
    m.id               as source_id,
    false              as editable
  from public.maintenance_logs m
  join public.vehicles v on v.id = m.vehicle_id
  where coalesce(m.cost, 0) > 0

  union all

  -- C. Repair with a recorded cost
  select
    r.id               as id,
    r.account_id       as account_id,
    r.vehicle_id       as vehicle_id,
    r.cost             as amount,
    'ILS'::text        as currency,
    'repair'::text     as category,
    coalesce(r.occurred_at, r.created_at::date) as expense_date,
    r.title            as title,
    r.description      as note,
    r.garage_name      as vendor,
    null::text         as receipt_url,
    r.created_at       as created_at,
    'repair'::text     as source_type,
    r.id               as source_id,
    false              as editable
  from public.repair_logs r
  where coalesce(r.cost, 0) > 0;

grant select on public.v_vehicle_expense_feed to authenticated;

-- 4. List + totals RPC ----------------------------------------------------
-- One round trip: filtered rows + aggregations. Used by the Expenses page.
create or replace function public.fn_list_vehicle_expenses(
  p_vehicle_id  uuid,
  p_from        date,
  p_to          date,
  p_categories  text[]  default null,   -- null = all
  p_limit       int     default 30,
  p_offset      int     default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_rows         jsonb;
  v_total        numeric;
  v_count        int;
  v_by_category  jsonb;
  v_by_source    jsonb;
  v_has_more     boolean;
begin
  if p_vehicle_id is null then
    raise exception 'vehicle_id_required';
  end if;
  if p_from is null or p_to is null then
    raise exception 'date_range_required';
  end if;

  -- Single CTE evaluated once; planner reuses it for rows + 4 aggregations.
  -- The view's predicates (vehicle_id, expense_date, category) push down
  -- to each UNION arm and hit the existing per-table indexes.
  with filtered as (
    select *
    from v_vehicle_expense_feed
    where vehicle_id    = p_vehicle_id
      and expense_date between p_from and p_to
      and (p_categories is null or array_length(p_categories, 1) is null or category = any(p_categories))
  ),
  page as (
    select * from filtered
    order by expense_date desc, created_at desc
    limit p_limit offset p_offset
  )
  select
    coalesce((select jsonb_agg(p.*) from page p), '[]'::jsonb),
    coalesce((select sum(amount) from filtered), 0)::numeric,
    coalesce((select count(*)    from filtered), 0)::int,
    coalesce((
      select jsonb_object_agg(category, sum_amt)
      from (select category, sum(amount) as sum_amt from filtered group by category) c
    ), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(source_type, sum_amt)
      from (select source_type, sum(amount) as sum_amt from filtered group by source_type) s
    ), '{}'::jsonb),
    coalesce((select count(*) > p_offset + p_limit from filtered), false)
    into v_rows, v_total, v_count, v_by_category, v_by_source, v_has_more;

  return jsonb_build_object(
    'rows',     v_rows,
    'totals',   jsonb_build_object(
      'total',       v_total,
      'count',       v_count,
      'by_category', v_by_category,
      'by_source',   v_by_source
    ),
    'has_more', v_has_more
  );
end;
$$;

revoke all on function public.fn_list_vehicle_expenses(uuid, date, date, text[], int, int) from public;
grant execute on function public.fn_list_vehicle_expenses(uuid, date, date, text[], int, int) to authenticated;

-- 5. Date bounds (for UI year picker) ------------------------------------
create or replace function public.fn_vehicle_expense_date_bounds(
  p_vehicle_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_min date;
  v_max date;
begin
  if p_vehicle_id is null then return null; end if;
  select min(expense_date), max(expense_date)
    into v_min, v_max
    from v_vehicle_expense_feed
   where vehicle_id = p_vehicle_id;
  return jsonb_build_object('earliest', v_min, 'latest', v_max);
end;
$$;

revoke all on function public.fn_vehicle_expense_date_bounds(uuid) from public;
grant execute on function public.fn_vehicle_expense_date_bounds(uuid) to authenticated;

-- 6. Reload PostgREST cache ----------------------------------------------
notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (manual)
--   drop function if exists public.fn_vehicle_expense_date_bounds(uuid);
--   drop function if exists public.fn_list_vehicle_expenses(uuid, date, date, text[], int, int);
--   drop view     if exists public.v_vehicle_expense_feed;
--   alter table public.vehicle_expenses drop constraint if exists vehicle_expenses_source_check;
--   alter table public.vehicle_expenses drop column if exists source;
--   alter table public.vehicle_expenses drop column if exists vendor;
--   alter table public.vehicle_expenses drop column if exists title;
--   alter table public.vehicle_expenses drop constraint if exists vehicle_expenses_category_check;
--   alter table public.vehicle_expenses
--     add constraint vehicle_expenses_category_check
--     check (category in ('fuel','repair','insurance','other'));
-- ==========================================================================
