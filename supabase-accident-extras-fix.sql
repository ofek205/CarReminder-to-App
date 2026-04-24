-- ==========================================================================
-- Accidents — create the missing table + linkage to repair_logs
--
-- Discovery: `public.accidents` was referenced everywhere (AddAccident,
-- Accidents.jsx, rls-policies.sql) but never actually created during the
-- Base44 → Supabase migration. Any call to db.accidents.create/filter was
-- failing silently, which is why the AddAccident page appears broken
-- ("date picker doesn't work" — actually: the whole save path fails).
--
-- Schema derived from EMPTY_FORM in src/pages/AddAccident.jsx plus the
-- account/vehicle scaffolding every other feature table uses.
--
-- Idempotent: safe to re-run.
-- ==========================================================================

create table if not exists public.accidents (
  id                                    uuid primary key default gen_random_uuid(),
  account_id                            uuid not null references public.accounts(id) on delete cascade,
  vehicle_id                            uuid references public.vehicles(id) on delete set null,
  date                                  date,
  location                              text,
  description                           text,
  status                                text not null default 'פתוח',
  photos                                jsonb not null default '[]'::jsonb,
  other_driver_name                     text,
  other_driver_phone                    text,
  other_driver_plate                    text,
  other_driver_manufacturer             text,
  other_driver_model                    text,
  other_driver_year                     text,
  other_driver_insurance_company        text,
  other_driver_insurance_photo          text,
  created_at                            timestamptz not null default now(),
  updated_at                            timestamptz not null default now()
);

create index if not exists accidents_account_idx
  on public.accidents(account_id, date desc);

create index if not exists accidents_vehicle_idx
  on public.accidents(vehicle_id);

alter table public.accidents enable row level security;

drop policy if exists accidents_select on public.accidents;
create policy accidents_select on public.accidents
  for select using (
    account_id in (select account_id from public.account_members where user_id = auth.uid() and status = 'פעיל')
  );

drop policy if exists accidents_insert on public.accidents;
create policy accidents_insert on public.accidents
  for insert with check (
    account_id in (select account_id from public.account_members where user_id = auth.uid() and status = 'פעיל')
  );

drop policy if exists accidents_update on public.accidents;
create policy accidents_update on public.accidents
  for update using (
    account_id in (select account_id from public.account_members where user_id = auth.uid() and status = 'פעיל')
  );

drop policy if exists accidents_delete on public.accidents;
create policy accidents_delete on public.accidents
  for delete using (
    account_id in (select account_id from public.account_members where user_id = auth.uid() and status = 'פעיל')
  );

-- ──────────────────────────────────────────────────────────────────────────
-- repair_logs ↔ accidents link
-- Remove the wrong self-FK we added earlier (nonexistent → no-op), then
-- add the correct FK pointing at the freshly-created accidents table.
-- ──────────────────────────────────────────────────────────────────────────
alter table public.repair_logs
  drop column if exists accident_log_id;

drop index if exists public.repair_logs_accident_idx;

alter table public.repair_logs
  add column if not exists accident_id uuid
    references public.accidents(id) on delete set null;

create index if not exists repair_logs_accident_id_idx
  on public.repair_logs(accident_id)
  where accident_id is not null;

-- Auto-keep `updated_at` fresh on accidents updates.
create or replace function public.accidents_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_accidents_set_updated_at on public.accidents;
create trigger trg_accidents_set_updated_at
  before update on public.accidents
  for each row execute function public.accidents_set_updated_at();

notify pgrst, 'reload schema';
