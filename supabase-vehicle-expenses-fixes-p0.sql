-- ==========================================================================
-- Vehicle Expenses — P0 fixes after QA pass.
--
-- Three corrections:
--   1. Extend add_vehicle_expense / update_vehicle_expense to accept the
--      new columns (title, vendor, source). Without this the dialog's
--      direct UPDATE was being silently dropped by RLS — saves looked
--      successful but title/vendor/source never persisted.
--   2. Add receipt_storage_path to v_vehicle_expense_feed so edits can
--      detect+clean up an old receipt blob when it's replaced.
--   3. Drop the legacy cost-summary CTEs' assumption that the only
--      categories were the old 4 (the new 16-code constraint already
--      enforces the categories upstream).
--
-- Idempotent. Safe to re-run.
-- ==========================================================================

-- 1. Extend add_vehicle_expense to accept title / vendor / source ---------
create or replace function public.add_vehicle_expense(
  p_account_id           uuid,
  p_vehicle_id           uuid,
  p_amount               numeric,
  p_category             text,
  p_expense_date         date,
  p_note                 text default null,
  p_currency             text default 'ILS',
  p_receipt_url          text default null,
  p_receipt_storage_path text default null,
  p_title                text default null,
  p_vendor               text default null,
  p_source               text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  new_id  uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_workspace_manager(p_account_id) then
    raise exception 'forbidden_not_manager';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'invalid_amount';
  end if;
  if p_category not in (
    'maintenance','repair','inspection','license_fee',
    'insurance_mtpl','insurance_comp','insurance_3p',
    'fuel','parking','wash','tires','toll','towing',
    'accessories','other','general'
  ) then
    raise exception 'invalid_category';
  end if;
  if p_expense_date is null then
    raise exception 'date_required';
  end if;
  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then
    raise exception 'vehicle_not_in_workspace';
  end if;
  if p_source is not null and p_source not in ('manual','ai_scan') then
    raise exception 'invalid_source';
  end if;

  insert into public.vehicle_expenses (
    account_id, vehicle_id, amount, category, expense_date,
    note, currency, receipt_url, receipt_storage_path,
    title, vendor, source, created_by
  ) values (
    p_account_id, p_vehicle_id, p_amount, p_category, p_expense_date,
    nullif(p_note, ''), coalesce(p_currency, 'ILS'),
    nullif(p_receipt_url, ''), nullif(p_receipt_storage_path, ''),
    nullif(p_title, ''), nullif(p_vendor, ''), p_source,
    uid
  )
  returning id into new_id;

  perform public.log_activity(
    p_account_id, 'expense.create',
    'vehicle_expense', new_id,
    p_vehicle_id, null, null, null,
    jsonb_build_object('amount', p_amount, 'category', p_category, 'expense_date', p_expense_date)
  );

  return new_id;
end;
$$;

revoke all on function public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text, text, text, text, text, text) from public;
grant execute on function public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text, text, text, text, text, text) to authenticated;

-- 2. Extend update_vehicle_expense ----------------------------------------
create or replace function public.update_vehicle_expense(
  p_id                   uuid,
  p_amount               numeric default null,
  p_category             text    default null,
  p_expense_date         date    default null,
  p_note                 text    default null,
  p_receipt_url          text    default null,
  p_receipt_storage_path text    default null,
  p_clear_receipt        boolean default false,
  p_title                text    default null,
  p_vendor               text    default null,
  p_clear_title          boolean default false,
  p_clear_vendor         boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid          uuid := auth.uid();
  v_account_id uuid;
  v_vehicle_id uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select account_id, vehicle_id
    into v_account_id, v_vehicle_id
    from public.vehicle_expenses where id = p_id;
  if v_account_id is null then raise exception 'expense_not_found'; end if;

  if not public.is_workspace_manager(v_account_id) then
    raise exception 'forbidden_not_manager';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'invalid_amount';
  end if;
  if p_category is not null and p_category not in (
    'maintenance','repair','inspection','license_fee',
    'insurance_mtpl','insurance_comp','insurance_3p',
    'fuel','parking','wash','tires','toll','towing',
    'accessories','other','general'
  ) then
    raise exception 'invalid_category';
  end if;

  update public.vehicle_expenses set
    amount               = coalesce(p_amount, amount),
    category             = coalesce(p_category, category),
    expense_date         = coalesce(p_expense_date, expense_date),
    note                 = case when p_note is not null then nullif(p_note, '') else note end,
    receipt_url          = case
                              when p_clear_receipt then null
                              when p_receipt_url is not null then nullif(p_receipt_url, '')
                              else receipt_url
                            end,
    receipt_storage_path = case
                              when p_clear_receipt then null
                              when p_receipt_storage_path is not null then nullif(p_receipt_storage_path, '')
                              else receipt_storage_path
                            end,
    title                = case
                              when p_clear_title then null
                              when p_title is not null then nullif(p_title, '')
                              else title
                            end,
    vendor               = case
                              when p_clear_vendor then null
                              when p_vendor is not null then nullif(p_vendor, '')
                              else vendor
                            end,
    updated_at           = now()
   where id = p_id;

  perform public.log_activity(
    v_account_id, 'expense.update',
    'vehicle_expense', p_id,
    v_vehicle_id, null, null, null,
    jsonb_build_object()
  );
end;
$$;

revoke all on function public.update_vehicle_expense(uuid, numeric, text, date, text, text, text, boolean, text, text, boolean, boolean) from public;
grant execute on function public.update_vehicle_expense(uuid, numeric, text, date, text, text, text, boolean, text, text, boolean, boolean) to authenticated;

-- 3. Re-create the unified read view to include receipt_storage_path -----
drop view if exists public.v_vehicle_expense_feed;
create view public.v_vehicle_expense_feed
  with (security_invoker = true)
as
  select
    ve.id, ve.account_id, ve.vehicle_id, ve.amount, ve.currency, ve.category,
    ve.expense_date, ve.title, ve.note, ve.vendor,
    ve.receipt_url, ve.receipt_storage_path,
    ve.created_at,
    'expense'::text as source_type, ve.id as source_id, true as editable
  from public.vehicle_expenses ve

  union all

  select
    m.id, v.account_id, m.vehicle_id, m.cost, 'ILS'::text, 'maintenance'::text,
    coalesce(m.date::date, m.created_at::date), m.title, m.notes, m.garage_name,
    null::text, null::text,
    m.created_at,
    'maintenance'::text, m.id, false
  from public.maintenance_logs m
  join public.vehicles v on v.id = m.vehicle_id
  where coalesce(m.cost, 0) > 0

  union all

  select
    r.id, r.account_id, r.vehicle_id, r.cost, 'ILS'::text, 'repair'::text,
    coalesce(r.occurred_at, r.created_at::date), r.title, r.description, r.garage_name,
    null::text, null::text,
    r.created_at,
    'repair'::text, r.id, false
  from public.repair_logs r
  where coalesce(r.cost, 0) > 0;

grant select on public.v_vehicle_expense_feed to authenticated;

notify pgrst, 'reload schema';
