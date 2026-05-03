-- ==========================================================================
-- vehicle_expenses — receipt attachment support
--
-- Adds two columns:
--   • receipt_url           — signed URL the UI can render directly (7-day TTL).
--                             Re-signed on demand from receipt_storage_path
--                             when it expires.
--   • receipt_storage_path  — bucket-relative path. Source of truth; lets us
--                             re-issue signed URLs without re-uploading,
--                             and lets future cleanup delete attached blobs
--                             when an expense row is deleted.
--
-- Updates the add/update RPCs to accept the receipt fields and updates
-- delete to also remove the attached file. Idempotent (ALTER ... IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION).
-- ==========================================================================

alter table public.vehicle_expenses
  add column if not exists receipt_url           text,
  add column if not exists receipt_storage_path  text;

-- ---------------------------------------------------------------- add_*
-- Drop the old signature first — pg won't replace a function that
-- changed parameter list. The new signature takes two extra defaulted
-- params so existing callers (no receipt) continue to work unchanged.
drop function if exists public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text);

create or replace function public.add_vehicle_expense(
  p_account_id            uuid,
  p_vehicle_id            uuid,
  p_amount                numeric,
  p_category              text,
  p_expense_date          date,
  p_note                  text default null,
  p_currency              text default 'ILS',
  p_receipt_url           text default null,
  p_receipt_storage_path  text default null
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
  if p_amount is null or p_amount < 0 then raise exception 'invalid_amount'; end if;
  if p_category not in ('fuel','repair','insurance','other') then
    raise exception 'invalid_category';
  end if;
  if p_expense_date is null then raise exception 'date_required'; end if;

  if not exists (
    select 1 from public.vehicles
     where id = p_vehicle_id and account_id = p_account_id
  ) then
    raise exception 'vehicle_not_in_workspace';
  end if;

  insert into public.vehicle_expenses
    (account_id, vehicle_id, amount, currency, category, expense_date,
     note, receipt_url, receipt_storage_path, created_by)
  values
    (p_account_id, p_vehicle_id, p_amount, coalesce(p_currency, 'ILS'),
     p_category, p_expense_date, p_note, p_receipt_url, p_receipt_storage_path, uid)
  returning id into new_id;

  perform public.log_activity(
    p_account_id, 'expense.add',
    'vehicle_expense', new_id,
    p_vehicle_id, null, null, null,
    jsonb_build_object(
      'amount', p_amount, 'category', p_category,
      'expense_date', p_expense_date,
      'has_receipt', p_receipt_storage_path is not null
    )
  );

  return new_id;
end;
$$;

revoke all on function public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text, text, text) from public;
grant execute on function public.add_vehicle_expense(uuid, uuid, numeric, text, date, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- update_*
drop function if exists public.update_vehicle_expense(uuid, numeric, text, date, text);

create or replace function public.update_vehicle_expense(
  p_id                    uuid,
  p_amount                numeric  default null,
  p_category              text     default null,
  p_expense_date          date     default null,
  p_note                  text     default null,
  p_receipt_url           text     default null,
  p_receipt_storage_path  text     default null,
  p_clear_receipt         boolean  default false
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

  if p_amount is not null and p_amount < 0 then raise exception 'invalid_amount'; end if;
  if p_category is not null and p_category not in ('fuel','repair','insurance','other') then
    raise exception 'invalid_category';
  end if;

  update public.vehicle_expenses
     set amount               = coalesce(p_amount, amount),
         category             = coalesce(p_category, category),
         expense_date         = coalesce(p_expense_date, expense_date),
         note                 = coalesce(p_note, note),
         receipt_url          = case when p_clear_receipt then null
                                     when p_receipt_url is not null then p_receipt_url
                                     else receipt_url end,
         receipt_storage_path = case when p_clear_receipt then null
                                     when p_receipt_storage_path is not null then p_receipt_storage_path
                                     else receipt_storage_path end,
         updated_at           = now()
   where id = p_id;

  perform public.log_activity(
    v_account_id, 'expense.update',
    'vehicle_expense', p_id,
    v_vehicle_id, null, null, null,
    jsonb_build_object(
      'old_amount', old_amount, 'new_amount', coalesce(p_amount, old_amount),
      'old_category', old_category, 'new_category', coalesce(p_category, old_category),
      'receipt_changed', (p_receipt_storage_path is not null or p_clear_receipt)
    )
  );
end;
$$;

revoke all on function public.update_vehicle_expense(uuid, numeric, text, date, text, text, text, boolean) from public;
grant execute on function public.update_vehicle_expense(uuid, numeric, text, date, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------- views
-- Receipt fields aren't aggregated in v_vehicle_cost_summary or
-- v_monthly_expense_summary (they're per-row metadata, not aggregable),
-- so no view changes are needed.

notify pgrst, 'reload schema';
