-- ==========================================================================
-- Vessel Checklists — simple editable per-phase checklists per vessel.
--
-- Design:
--   • ONE row per (vehicle_id, phase). phase ∈ ('engine','pre','post').
--       engine = בדיקות לפני הנעת מנוע
--       pre    = הכנה לפני יציאה להפלגה שגרתית
--       post   = קיפול לאחר חזרה מהים
--   • items is jsonb: [{ id: uuid, text: "מצילות", checked: bool }, ...]
--   • last_completed_at stamped when user taps "סיים".
--   • RLS mirrors vehicles: members of the account see & edit.
-- ==========================================================================

create table if not exists public.vessel_checklists (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phase text not null,
  items jsonb not null default '[]'::jsonb,
  last_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, phase)
);

-- Enforce allowed phases (idempotent — safe to re-run if an older
-- 2-phase version already exists).
alter table public.vessel_checklists drop constraint if exists vessel_checklists_phase_check;
alter table public.vessel_checklists
  add constraint vessel_checklists_phase_check
  check (phase in ('engine','pre','post'));

create index if not exists vessel_checklists_vehicle_idx
  on public.vessel_checklists(vehicle_id);

alter table public.vessel_checklists enable row level security;

-- Members of the account can read/write their vessel's checklists.
drop policy if exists vessel_checklists_select on public.vessel_checklists;
create policy vessel_checklists_select on public.vessel_checklists
  for select using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );

drop policy if exists vessel_checklists_insert on public.vessel_checklists;
create policy vessel_checklists_insert on public.vessel_checklists
  for insert with check (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );

drop policy if exists vessel_checklists_update on public.vessel_checklists;
create policy vessel_checklists_update on public.vessel_checklists
  for update using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );

drop policy if exists vessel_checklists_delete on public.vessel_checklists;
create policy vessel_checklists_delete on public.vessel_checklists
  for delete using (
    account_id in (
      select account_id from public.account_members where user_id = auth.uid()
    )
  );

-- Auto-bump updated_at
create or replace function public.vessel_checklists_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vessel_checklists_touch_tg on public.vessel_checklists;
create trigger vessel_checklists_touch_tg
  before update on public.vessel_checklists
  for each row execute function public.vessel_checklists_touch();
