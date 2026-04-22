-- ==========================================================================
-- Custom checklists — adds support for user-defined checklists beyond the
-- 3 built-in phases (engine / pre / post).
--
-- Changes:
--   1. New text column `name` on vessel_checklists (optional label).
--   2. Phase check widened to allow 'custom'.
--   3. Unique (vehicle_id, phase) constraint replaced with a PARTIAL
--      unique index: system phases still unique per vessel, but multiple
--      'custom' rows allowed.
--   4. Same phase widening applied to vessel_checklist_runs.
-- ==========================================================================

-- 1) Add name column (nullable; system phases derive their label from code).
alter table public.vessel_checklists
  add column if not exists name text;

-- 2) Widen phase enum on templates.
alter table public.vessel_checklists drop constraint if exists vessel_checklists_phase_check;
alter table public.vessel_checklists
  add constraint vessel_checklists_phase_check
  check (phase in ('engine','pre','post','custom'));

-- 3) Swap the table-level unique for a partial one. First drop the
-- auto-generated unique constraint on (vehicle_id, phase), if it still
-- exists under its default name.
do $$
declare
  c_name text;
begin
  select tc.constraint_name
    into c_name
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
   and ccu.table_schema = tc.table_schema
  where tc.table_schema = 'public'
    and tc.table_name   = 'vessel_checklists'
    and tc.constraint_type = 'UNIQUE'
    and ccu.column_name = 'phase'
  limit 1;
  if c_name is not null then
    execute format('alter table public.vessel_checklists drop constraint %I', c_name);
  end if;
end $$;

create unique index if not exists vessel_checklists_system_unique
  on public.vessel_checklists(vehicle_id, phase)
  where phase in ('engine','pre','post');

-- 4) Widen phase enum on runs.
alter table public.vessel_checklist_runs drop constraint if exists vessel_checklist_runs_phase_check;
alter table public.vessel_checklist_runs
  add constraint vessel_checklist_runs_phase_check
  check (phase in ('engine','pre','post','custom'));
