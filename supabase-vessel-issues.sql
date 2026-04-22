-- ==========================================================================
-- vessel_issues — tracks open issues on a specific vessel.
--
-- Used by:
--   • VesselIssuesSection.jsx on VehicleDetail (for vessels)
--   • Checklist runner's "add to issues list" opt-in when an item is
--     flagged as a תקלה.
--
-- Fields mirror what the existing components write. This file is safe to
-- run against an empty DB or re-run if the table already exists (all
-- statements are idempotent).
-- ==========================================================================

create table if not exists public.vessel_issues (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,

  title text not null,
  description text,

  -- Loose enums; the UI maps these to display chips but we keep the
  -- column as free text so product can add categories without a migration.
  -- Values in use: hull / engine / electrical / plumbing / safety /
  --                rigging / other
  category text,

  -- 'low' | 'medium' | 'high' | 'urgent'
  priority text default 'medium',

  -- 'open' | 'in_progress' | 'done'
  status text default 'open',

  -- Date the user says the issue was detected/reported. Exposed as
  -- created_date in the UI (separate from created_at so a user can
  -- log past issues).
  created_date timestamptz default now(),
  completed_date timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vessel_issues_vehicle_idx
  on public.vessel_issues(vehicle_id, status, created_date desc);

alter table public.vessel_issues enable row level security;

drop policy if exists vessel_issues_select on public.vessel_issues;
create policy vessel_issues_select on public.vessel_issues
  for select using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

drop policy if exists vessel_issues_insert on public.vessel_issues;
create policy vessel_issues_insert on public.vessel_issues
  for insert with check (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

drop policy if exists vessel_issues_update on public.vessel_issues;
create policy vessel_issues_update on public.vessel_issues
  for update using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

drop policy if exists vessel_issues_delete on public.vessel_issues;
create policy vessel_issues_delete on public.vessel_issues
  for delete using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

create or replace function public.vessel_issues_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vessel_issues_touch_tg on public.vessel_issues;
create trigger vessel_issues_touch_tg
  before update on public.vessel_issues
  for each row execute function public.vessel_issues_touch();
