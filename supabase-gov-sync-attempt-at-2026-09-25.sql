-- ═══════════════════════════════════════════════════════════════════════════
-- gov-sync queue: when a vehicle was last TRIED, 2026-09-25
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: gov-sync-vehicles takes the 200 stalest vehicles each run. A vehicle
--   it holds (a ministry registry mid-reload) or whose request failed keeps
--   its old last_gov_sync_at, on purpose, because the 45-day hold grace
--   counts from it. So it stayed the stalest, and every run took the same
--   rows again. On 2026-09-25 the ministry's private-vehicle registry was
--   empty from 02:37 UTC to past 10:45, ~350 cars with a test history were
--   held, and from 07:20 no vehicle behind them (צמ"ה, trucks) was reached.
--
-- WHAT: one nullable column, stamped by the function on every vehicle a run
--   takes on, whatever the outcome. The queue orders by it first, so a held
--   vehicle goes to the back and everyone else gets a turn. Nothing else
--   reads it; last_gov_sync_at keeps its meaning (last SUCCESSFUL sync).
--   No default, so Postgres adds it as metadata only: no table rewrite.
--   No new index: the existing partial index still serves the staleness
--   filter, and sorting the stale set (at most the fleet) is trivial.
--
-- ORDER: either is safe. Until this runs, the function falls back to the
--   old order and stamps nothing. Run it BEFORE the deploy so the fix is
--   live from the first run.
--
-- SAFETY: re-runnable (if not exists). lock_timeout keeps the ALTER from
--   queueing behind a long transaction and stalling vehicle writes; if it
--   times out nothing changed, just run it again.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

alter table public.vehicles
  add column if not exists last_gov_sync_attempt_at timestamptz;

comment on column public.vehicles.last_gov_sync_attempt_at is
  'When gov-sync-vehicles last took this vehicle on, whatever the outcome. '
  'Queue order only. The 45-day hold grace still counts from last_gov_sync_at. '
  'Added by supabase-gov-sync-attempt-at-2026-09-25.sql';

commit;

-- Verify: expect one row, timestamp with time zone, YES.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'vehicles'
   and column_name  = 'last_gov_sync_attempt_at';
