-- ==========================================================================
-- Checklist Runs — every execution of a checklist (draft or completed).
--
-- Relationship model:
--   vessel_checklists            ← TEMPLATE (user's own list, 1 per phase)
--   vessel_checklist_runs (NEW)  ← INSTANCE (a specific run: today's pre-trip)
--
-- A run is the historical fact: "this is what I actually checked today".
-- Drafts are runs with completed_at IS NULL.
--
-- Decisions locked during planning:
--   Q2  issue → ask user whether to also log in vessel_issues
--   Q3  every issue carries a note; optional "add to cork board" checkbox
--   Q4  90-day retention for COMPLETED runs (drafts never auto-deleted here)
--   Q5  midnight local = new day (handled in UI, not SQL)
--   Q6  yesterday's open drafts get archived by UI on mount
-- ==========================================================================

create table if not exists public.vessel_checklist_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.vessel_checklists(id) on delete set null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phase text not null,

  -- Snapshot of items at run time. Shape:
  --   [{ id, section, text, status, note, cork_note_id, issue_id }]
  --   status ∈ 'pending' | 'done' | 'issue'
  items jsonb not null default '[]'::jsonb,

  -- Optional free text the user adds at completion.
  summary_note text,

  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  archived_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vessel_checklist_runs_phase_check
    check (phase in ('engine','pre','post'))
);

-- Hub queries: "latest run for this vehicle+phase".
create index if not exists vessel_checklist_runs_vehicle_phase_idx
  on public.vessel_checklist_runs(vehicle_id, phase, started_at desc);

-- Draft lookup ("does this vehicle have an open run for phase?")
create index if not exists vessel_checklist_runs_open_draft_idx
  on public.vessel_checklist_runs(vehicle_id, phase)
  where completed_at is null and archived_at is null;

alter table public.vessel_checklist_runs enable row level security;

drop policy if exists vessel_checklist_runs_select on public.vessel_checklist_runs;
create policy vessel_checklist_runs_select on public.vessel_checklist_runs
  for select using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

drop policy if exists vessel_checklist_runs_insert on public.vessel_checklist_runs;
create policy vessel_checklist_runs_insert on public.vessel_checklist_runs
  for insert with check (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

drop policy if exists vessel_checklist_runs_update on public.vessel_checklist_runs;
create policy vessel_checklist_runs_update on public.vessel_checklist_runs
  for update using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

drop policy if exists vessel_checklist_runs_delete on public.vessel_checklist_runs;
create policy vessel_checklist_runs_delete on public.vessel_checklist_runs
  for delete using (
    account_id in (select account_id from public.account_members where user_id = auth.uid())
  );

-- Touch trigger
create or replace function public.vessel_checklist_runs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists vessel_checklist_runs_touch_tg on public.vessel_checklist_runs;
create trigger vessel_checklist_runs_touch_tg
  before update on public.vessel_checklist_runs
  for each row execute function public.vessel_checklist_runs_touch();

-- ──────────────────────────────────────────────────────────────────────
-- 90-day retention — deletes COMPLETED runs older than 90 days.
-- Drafts (completed_at IS NULL) are never touched here; the UI
-- archives stale drafts (see archived_at) via its mount-time pass.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.cleanup_old_checklist_runs()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.vessel_checklist_runs
  where completed_at is not null
    and completed_at < now() - interval '90 days';
$$;

-- If pg_cron is available, schedule daily at 03:00. Safe to run or skip.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cleanup_checklist_runs')
      where exists (select 1 from cron.job where jobname = 'cleanup_checklist_runs');
    perform cron.schedule(
      'cleanup_checklist_runs',
      '0 3 * * *',
      'select public.cleanup_old_checklist_runs();'
    );
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
