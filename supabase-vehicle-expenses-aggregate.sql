-- ==========================================================================
-- Vehicle Expenses — aggregate ("all vehicles") support.
--
-- Phase 2 of the private-account expenses feature. The Phase-1 RPCs only
-- supported a single vehicle_id. This migration replaces them with new
-- signatures that scope by account_id and allow vehicle_id=null for the
-- "all my vehicles" view on /MyExpenses.
--
-- Changes:
--   1. fn_list_vehicle_expenses — new signature (p_account_id, p_vehicle_id,
--      p_from, p_to, p_categories, p_limit, p_offset). vehicle_id may be
--      null → totals + rows aggregated across every vehicle the user can
--      see in that account (RLS on v_vehicle_expense_feed still enforces).
--      Adds `by_vehicle` to totals: per-vehicle {total, count, name,
--      license_plate, ...} keyed by vehicle_id, populated for both modes.
--   2. fn_vehicle_expense_date_bounds — new signature (p_account_id,
--      p_vehicle_id default null). Bounds across all vehicles when
--      vehicle_id is null.
--
-- Old single-vehicle signatures are dropped because the frontend calls
-- are updated in the same release. If we ever need a backwards-compat
-- shim, add a wrapper that delegates to the new signature.
--
-- Idempotent: safe to re-run.
-- ==========================================================================

-- 1. Drop the legacy signatures (will recreate immediately below).
drop function if exists public.fn_list_vehicle_expenses(uuid, date, date, text[], int, int);
drop function if exists public.fn_vehicle_expense_date_bounds(uuid);

-- Drop the new signatures too so a re-run picks up any tweaks.
drop function if exists public.fn_list_vehicle_expenses(uuid, uuid, date, date, text[], int, int);
drop function if exists public.fn_vehicle_expense_date_bounds(uuid, uuid);


-- 2. Aggregate-aware list RPC --------------------------------------------
-- Single round trip: filtered rows + 4 aggregations (total, count,
-- by_category, by_source) + by_vehicle (always returned, useful in
-- aggregate mode). RLS on the underlying view applies because the
-- function is `security invoker`.
create or replace function public.fn_list_vehicle_expenses(
  p_account_id  uuid,
  p_vehicle_id  uuid,                       -- null = aggregate across the account
  p_from        date,
  p_to          date,
  p_categories  text[]  default null,       -- null = all
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
  v_by_vehicle   jsonb;
  v_has_more     boolean;
begin
  if p_account_id is null then
    raise exception 'account_id_required';
  end if;
  if p_from is null or p_to is null then
    raise exception 'date_range_required';
  end if;

  -- Single CTE evaluated once; planner reuses it for rows + 5 aggregations.
  -- The `account_id` predicate hits index_vehicle_expenses_account_id_date
  -- (and the corresponding indexes on the JOIN-backed UNION arms via
  -- the `vehicles` join in the view).
  with filtered as (
    select f.*
    from v_vehicle_expense_feed f
    where f.account_id = p_account_id
      and (p_vehicle_id is null or f.vehicle_id = p_vehicle_id)
      and f.expense_date between p_from and p_to
      and (
        p_categories is null
        or array_length(p_categories, 1) is null
        or f.category = any(p_categories)
      )
  ),
  page as (
    select * from filtered
    order by expense_date desc, created_at desc
    limit p_limit offset p_offset
  )
  select
    -- rows: page (already ordered)
    coalesce((select jsonb_agg(p.*) from page p), '[]'::jsonb),
    -- total
    coalesce((select sum(amount) from filtered), 0)::numeric,
    -- count
    coalesce((select count(*) from filtered), 0)::int,
    -- by_category: { category: sum }
    coalesce((
      select jsonb_object_agg(category, sum_amt)
      from (
        select category, sum(amount) as sum_amt
        from filtered
        group by category
      ) c
    ), '{}'::jsonb),
    -- by_source: { source_type: sum }  (expense / maintenance / repair)
    coalesce((
      select jsonb_object_agg(source_type, sum_amt)
      from (
        select source_type, sum(amount) as sum_amt
        from filtered
        group by source_type
      ) s
    ), '{}'::jsonb),
    -- by_vehicle: keyed by vehicle_id, with display fields so the UI
    --             can render a per-vehicle breakdown without a 2nd round trip.
    --             Joined to public.vehicles for nickname/plate/etc.
    --             RLS on vehicles applies (security invoker), so this
    --             only resolves rows the caller can see.
    coalesce((
      select jsonb_object_agg(
        vehicle_id::text,
        jsonb_build_object(
          'total',         sum_amt,
          'count',         cnt,
          'name',          coalesce(
                             nickname,
                             nullif(trim(concat_ws(' ', manufacturer, model)), ''),
                             license_plate,
                             'רכב'
                           ),
          'nickname',      nickname,
          'manufacturer',  manufacturer,
          'model',         model,
          'license_plate', license_plate,
          'vehicle_type',  vehicle_type
        )
      )
      from (
        select
          f.vehicle_id,
          sum(f.amount)   as sum_amt,
          count(*)        as cnt,
          v.nickname      as nickname,
          v.manufacturer  as manufacturer,
          v.model         as model,
          v.license_plate as license_plate,
          v.vehicle_type  as vehicle_type
        from filtered f
        join public.vehicles v on v.id = f.vehicle_id
        group by f.vehicle_id, v.nickname, v.manufacturer, v.model, v.license_plate, v.vehicle_type
      ) bv
    ), '{}'::jsonb),
    -- has_more: are there more rows beyond this page
    coalesce((select count(*) > p_offset + p_limit from filtered), false)
    into v_rows, v_total, v_count, v_by_category, v_by_source, v_by_vehicle, v_has_more;

  return jsonb_build_object(
    'rows',     v_rows,
    'totals',   jsonb_build_object(
      'total',       v_total,
      'count',       v_count,
      'by_category', v_by_category,
      'by_source',   v_by_source,
      'by_vehicle',  v_by_vehicle
    ),
    'has_more', v_has_more
  );
end;
$$;

revoke all on function public.fn_list_vehicle_expenses(uuid, uuid, date, date, text[], int, int) from public;
grant execute on function public.fn_list_vehicle_expenses(uuid, uuid, date, date, text[], int, int) to authenticated;


-- 3. Aggregate-aware date bounds -----------------------------------------
-- Cheap MIN/MAX. Used by the year-picker so the UI only offers years
-- that actually have data. p_vehicle_id null → bounds across all
-- vehicles in the account.
create or replace function public.fn_vehicle_expense_date_bounds(
  p_account_id uuid,
  p_vehicle_id uuid default null
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
  if p_account_id is null then return null; end if;
  select min(expense_date), max(expense_date)
    into v_min, v_max
    from v_vehicle_expense_feed
   where account_id = p_account_id
     and (p_vehicle_id is null or vehicle_id = p_vehicle_id);
  return jsonb_build_object('earliest', v_min, 'latest', v_max);
end;
$$;

revoke all on function public.fn_vehicle_expense_date_bounds(uuid, uuid) from public;
grant execute on function public.fn_vehicle_expense_date_bounds(uuid, uuid) to authenticated;


-- 4. Reload PostgREST cache ----------------------------------------------
notify pgrst, 'reload schema';


-- ==========================================================================
-- ROLLBACK (manual)
--   drop function if exists public.fn_vehicle_expense_date_bounds(uuid, uuid);
--   drop function if exists public.fn_list_vehicle_expenses(uuid, uuid, date, date, text[], int, int);
--   -- then re-run supabase-vehicle-expenses-feed.sql to restore the legacy
--   -- single-vehicle signatures.
-- ==========================================================================
