-- ==========================================================================
-- Phase 8 — Reports and Cost Tracking
--
-- Existing: repair_logs.cost numeric(12,2) is already in the schema
--           (staging-init-consolidated.sql). Treatments/repairs cost
--           tracking is a no-op migration here — the field is just
--           reused. UI will surface it in Reports.
--
-- New:      vehicle_expenses table for manual non-repair costs
--           (fuel, insurance, other, plus user-categorized 'repair'
--           entries that don't go through the repair_logs flow).
--
-- Reports:  three views (security_invoker = true) that aggregate
--           costs + activity. Date filters and vehicle filters are
--           applied at SELECT time by the UI.
--
-- Permissions: managers (בעלים/מנהל) write; managers + viewers (שותף)
--              read. Drivers cannot read/write expenses in v1 (the
--              brief says drivers should not modify costs; we extend
--              that to read for simplicity — re-evaluate in a later
--              phase if drivers need fuel-tracking visibility).
--
-- Idempotent. Reversible. DO NOT APPLY TO PRODUCTION.
-- ==========================================================================

-- 1. vehicle_expenses table -----------------------------------------------
create table if not exists public.vehicle_expenses (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid           not null references public.accounts(id)  on delete cascade,
  vehicle_id    uuid           not null references public.vehicles(id)  on delete cascade,
  amount        numeric(12, 2) not null check (amount >= 0),
  currency      text           not null default 'ILS',
  category      text           not null check (category in ('fuel','repair','insurance','other')),
  expense_date  date           not null,
  note          text,
  created_by    uuid                    references auth.users(id)       on delete set null,
  created_at    timestamptz    not null default now(),
  updated_at    timestamptz    not null default now()
);

create index if not exists vehicle_expenses_account_date_idx
  on public.vehicle_expenses (account_id, expense_date desc);
create index if not exists vehicle_expenses_vehicle_date_idx
  on public.vehicle_expenses (vehicle_id, expense_date desc);
create index if not exists vehicle_expenses_account_category_idx
  on public.vehicle_expenses (account_id, category);

alter table public.vehicle_expenses enable row level security;

-- SELECT: workspace members with at least viewer-level access.
-- Drivers (role='driver') have no read access in v1 — keeps cost
-- domain manager-controlled per the brief's intent.
drop policy if exists "vehicle_expenses_select" on public.vehicle_expenses;
create policy "vehicle_expenses_select"
  on public.vehicle_expenses
  for select
  to authenticated
  using (
    exists (
      select 1 from public.account_members m
       where m.account_id = vehicle_expenses.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
         and m.role       in ('בעלים', 'מנהל', 'שותף')
    )
  );

-- INSERT/UPDATE/DELETE only via RPCs (no policies = blocked for direct
-- postgrest writes; SECURITY DEFINER RPCs below validate + log).

grant select on public.vehicle_expenses to authenticated;

-- 2. RPCs ------------------------------------------------------------------

create or replace function public.add_vehicle_expense(
  p_account_id   uuid,
  p_vehicle_id   uuid,
  p_amount       numeric,
  p_category     text,
  p_expense_date date,
  p_note         text default null,
  p_currency     text default 'ILS'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_manager(p_account_id) then
    raise exception 'forbidden_not_manager';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount';
  end if;
  if p_category not in ('fuel','repair','insurance','other') then
    raise exception 'invalid_category';
  end if;
  if p_expense_date is null then
    raise exception 'date_required';
  end if;

  -- Vehicle must belong to the workspace.
  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then
    raise exception 'vehicle_not_in_workspace';
  end if;

  insert into public.vehicle_expenses
    (account_id, vehicle_id, amount, currency, category, expense_date, note, created_by)
  values
    (p_account_id, p_vehicle_id, p_amount, coalesce(p_currency, 'ILS'),
     p_category, p_expense_date, nullif(trim(coalesce(p_note, '')), ''), uid)
  returning id into new_id;

  perform public.log_activity(
    p_account_id, 'expense.add',
    'vehicle_expense', new_id,
    p_vehicle_id, null, p_note, null,
    jsonb_build_object('amount', p_amount,
                       'currency', coalesce(p_currency, 'ILS'),
                       'category', p_category,
                       'expense_date', p_expense_date)
  );

  return new_id;
end;
$$;

revoke all on function public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text) from public;
grant execute on function public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text) to authenticated;


create or replace function public.update_vehicle_expense(
  p_id           uuid,
  p_amount       numeric  default null,
  p_category     text     default null,
  p_expense_date date     default null,
  p_note         text     default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_vehicle_id uuid;
  old_amount numeric;
  old_category text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select account_id, vehicle_id, amount, category
    into v_account_id, v_vehicle_id, old_amount, old_category
    from public.vehicle_expenses where id = p_id;
  if v_account_id is null then raise exception 'expense_not_found'; end if;

  if not public.is_workspace_manager(v_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'invalid_amount';
  end if;
  if p_category is not null and p_category not in ('fuel','repair','insurance','other') then
    raise exception 'invalid_category';
  end if;

  update public.vehicle_expenses
     set amount       = coalesce(p_amount, amount),
         category     = coalesce(p_category, category),
         expense_date = coalesce(p_expense_date, expense_date),
         note         = case when p_note is null then note
                             else nullif(trim(p_note), '') end,
         updated_at   = now()
   where id = p_id;

  perform public.log_activity(
    v_account_id, 'expense.update',
    'vehicle_expense', p_id,
    v_vehicle_id, null, p_note, null,
    jsonb_build_object('old_amount', old_amount, 'old_category', old_category,
                       'new_amount', p_amount,   'new_category', p_category)
  );
end;
$$;

revoke all on function public.update_vehicle_expense(uuid, numeric, text, date, text) from public;
grant execute on function public.update_vehicle_expense(uuid, numeric, text, date, text) to authenticated;


create or replace function public.delete_vehicle_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_vehicle_id uuid;
  v_amount numeric;
  v_category text;
  v_date date;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select account_id, vehicle_id, amount, category, expense_date
    into v_account_id, v_vehicle_id, v_amount, v_category, v_date
    from public.vehicle_expenses where id = p_id;
  if v_account_id is null then raise exception 'expense_not_found'; end if;

  if not public.is_workspace_manager(v_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  delete from public.vehicle_expenses where id = p_id;

  perform public.log_activity(
    v_account_id, 'expense.delete',
    'vehicle_expense', p_id,
    v_vehicle_id, null, null, null,
    jsonb_build_object('amount', v_amount, 'category', v_category, 'expense_date', v_date)
  );
end;
$$;

revoke all on function public.delete_vehicle_expense(uuid) from public;
grant execute on function public.delete_vehicle_expense(uuid) to authenticated;

-- 3. Report views --------------------------------------------------------
-- All three are security_invoker = true, so RLS on the underlying
-- tables (vehicle_expenses + repair_logs + routes + route_stops) keeps
-- enforcing access. A user querying the view sees only rows their RLS
-- on the source tables would let them see.

-- Combined cost CTE — used inline by both vehicle_cost and monthly views.
-- We don't materialize this as a separate view because Postgres can
-- inline the CTE per call and apply pushdown predicates more
-- aggressively that way.

-- A. v_vehicle_cost_summary — totals + breakdown per (workspace, vehicle).
drop view if exists public.v_vehicle_cost_summary;
create view public.v_vehicle_cost_summary
  with (security_invoker = true)
as
with combined as (
  select account_id, vehicle_id, category, amount, expense_date as dt
    from public.vehicle_expenses
  union all
  select account_id, vehicle_id, 'repair'::text as category,
         coalesce(cost, 0)::numeric        as amount,
         coalesce(occurred_at, created_at::date) as dt
    from public.repair_logs
   where coalesce(cost, 0) > 0
)
select
  account_id,
  vehicle_id,
  count(*)::int                                                  as entry_count,
  sum(amount)::numeric                                           as total,
  sum(amount) filter (where category = 'fuel')::numeric          as by_fuel,
  sum(amount) filter (where category = 'repair')::numeric        as by_repair,
  sum(amount) filter (where category = 'insurance')::numeric     as by_insurance,
  sum(amount) filter (where category = 'other')::numeric         as by_other,
  max(dt)                                                        as last_expense_date
from combined
group by account_id, vehicle_id;

grant select on public.v_vehicle_cost_summary to authenticated;

-- B. v_monthly_expense_summary — totals per (workspace, month).
drop view if exists public.v_monthly_expense_summary;
create view public.v_monthly_expense_summary
  with (security_invoker = true)
as
with combined as (
  select account_id, expense_date as dt, category, amount
    from public.vehicle_expenses
  union all
  select account_id,
         coalesce(occurred_at, created_at::date) as dt,
         'repair'::text as category,
         coalesce(cost, 0)::numeric as amount
    from public.repair_logs
   where coalesce(cost, 0) > 0
)
select
  account_id,
  date_trunc('month', dt)::date                                  as month,
  sum(amount)::numeric                                           as total,
  sum(amount) filter (where category = 'fuel')::numeric          as by_fuel,
  sum(amount) filter (where category = 'repair')::numeric        as by_repair,
  sum(amount) filter (where category = 'insurance')::numeric     as by_insurance,
  sum(amount) filter (where category = 'other')::numeric         as by_other,
  count(*)::int                                                  as entry_count
from combined
group by account_id, date_trunc('month', dt);

grant select on public.v_monthly_expense_summary to authenticated;

-- C. v_activity_summary — route + stop counts per (workspace, month).
-- Derived from routes.created_at; route_stops are joined by route.
drop view if exists public.v_activity_summary;
create view public.v_activity_summary
  with (security_invoker = true)
as
select
  r.account_id,
  date_trunc('month', r.created_at)::date                       as month,
  count(distinct r.id)::int                                     as route_count,
  count(*) filter (where s.status = 'completed')::int           as completed_stops,
  count(*) filter (where s.status = 'issue')::int               as issue_stops,
  count(*) filter (where s.status = 'skipped')::int             as skipped_stops,
  count(*) filter (where s.status = 'pending')::int             as pending_stops
from public.routes r
left join public.route_stops s on s.route_id = r.id
group by r.account_id, date_trunc('month', r.created_at);

grant select on public.v_activity_summary to authenticated;

notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (manual)
--
--   drop view if exists public.v_activity_summary;
--   drop view if exists public.v_monthly_expense_summary;
--   drop view if exists public.v_vehicle_cost_summary;
--   drop function if exists public.delete_vehicle_expense(uuid);
--   drop function if exists public.update_vehicle_expense(uuid, numeric, text, date, text);
--   drop function if exists public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text);
--   drop policy   if exists "vehicle_expenses_select" on public.vehicle_expenses;
--   drop table    if exists public.vehicle_expenses;
--
-- repair_logs.cost is NOT touched by this migration; nothing to roll back
-- there. Existing private-user repair entries with cost values keep
-- working in the regular Maintenance UI as they do today.
-- ==========================================================================
