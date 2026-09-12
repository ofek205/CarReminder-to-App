-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-alert-mute-2026-09-10.sql
--
-- A per-kind mute switch for admin_alerts, and the first thing muted:
-- slow_query_storm.
--
-- WHY
--   `check_admin_alerts()` trigger 6 raises `slow_query_storm` when 10+
--   `type='slow_query'` rows land in app_errors inside 15 minutes. Those
--   rows come from withTimeout() in src/lib/supabaseQuery.js at a 5s
--   threshold. Three things make the resulting alert noise rather than
--   signal:
--
--     1. The 5s is measured as CLIENT WALL-CLOCK, network included. A user
--        on weak cellular, in a lift, or on a train produces `slow_query`
--        rows that have nothing to do with the database. The alert cannot
--        tell "the DB is struggling" from "someone is in a car park".
--     2. When it IS the database, the cause is the Micro compute tier, not
--        a missing index (see the 2026-06-25 perf investigation). There is
--        no code change that answers this alert.
--     3. Its own message text says "מעל 3 שניות" while the threshold has
--        been 5s since it was raised. The alert misreports its own trigger.
--
--   An alert nobody can act on, measuring the wrong thing, is not a warning.
--   It buries the five alert kinds that do matter, and it rides along in the
--   daily digest email every morning.
--
-- WHY THIS SHAPE, AND NOT EDITING check_admin_alerts()
--   That function is defined in at least TWO files in this repo
--   (supabase-admin-alerts.sql and supabase-admin-alerts-v2-error-triggers.sql).
--   CLAUDE.md records that 45 functions are redefined across multiple files
--   and that the apply order is unrecoverable, so a CREATE OR REPLACE built
--   from a file — rather than from the live definition — risks silently
--   reverting whatever else has landed in it since. This gate sits on the
--   INSERT instead: it needs no knowledge of the function body, and it
--   cannot revert anything.
--
-- WHY PRE-ACKNOWLEDGED RATHER THAN DROPPED
--   Both the nav red dot (`admin_alert_count_unacknowledged()`) and the
--   daily digest select on `acknowledged_at IS NULL`, so stamping the row
--   as acknowledged at insert time silences both. Dropping the row outright
--   would also work, but it would leave no trace, and a future reader
--   wondering "why do we never see slow-query alerts" would have nothing to
--   find. One row per 4 hours is cheap and self-documenting.
--
-- TO UNMUTE (e.g. after upgrading the compute tier, when the alert becomes
-- actionable again) — one statement, no migration:
--   update public.app_config
--      set value = 'false'::jsonb, updated_at = now()
--    where key = 'alert_mute_slow_query_storm';
--
-- SAFETY
--   Additive: one function, one trigger, one config row. No existing table,
--   function, policy or trigger is modified.
--
--   `sql-ledger.cjs` classifies this ONE_TIME_DATA, because section 3 is a
--   bare UPDATE. The classifier is deliberately conservative and cannot see
--   what the UPDATE does; the human call is that this file IS safe to
--   re-run, and here is the reasoning for whoever checks later:
--     • §1 is CREATE OR REPLACE + DROP/CREATE TRIGGER — idempotent.
--     • §2 is INSERT … ON CONFLICT DO UPDATE — idempotent.
--     • §3 only sets acknowledged_at on slow_query_storm rows that are
--       still NULL. Re-running acknowledges any that appeared since, which
--       is precisely the intent. It cannot touch another kind, cannot
--       un-acknowledge anything, and writes no new rows.
--   Record it as ONE_TIME_DATA anyway — the ledger should carry the tool's
--   verdict, with this note as the override rationale.
--
-- APPLY
--   Supabase SQL Editor, once. Then record it:
--     node scripts/sql-ledger.cjs record supabase-alert-mute-2026-09-10.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the gate ───────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default) on purpose. The only writer to
-- admin_alerts is check_admin_alerts(), which pg_cron runs as a role that
-- bypasses RLS anyway; and app_config already carries a public read policy.
-- There is no reason to hand a row-suppressing trigger definer rights.
create or replace function public.admin_alerts_mute_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_muted boolean;
begin
  -- Opt-in per kind. A kind with no `alert_mute_<kind>` row behaves exactly
  -- as it does today, so installing this trigger changes nothing until a
  -- flag is deliberately added.
  select coalesce(value = 'true'::jsonb, false)
    into v_muted
  from public.app_config
   where key = 'alert_mute_' || new.kind;

  if not coalesce(v_muted, false) then
    return new;
  end if;

  -- Muted. Keep at most one row per kind per 4 hours — the same dedup
  -- window check_admin_alerts() itself uses — so a persistent storm does
  -- not accumulate one row every 5 minutes for as long as it lasts.
  if exists (
    select 1 from public.admin_alerts
     where kind = new.kind
       and created_at >= now() - interval '4 hours'
  ) then
    return null;
  end if;

  -- Land it already acknowledged: invisible to the red dot and to the daily
  -- digest, still present for anyone who goes looking.
  new.acknowledged_at := now();
  new.acknowledged_by := null;
  return new;
end;
$$;

comment on function public.admin_alerts_mute_gate() is
  'BEFORE INSERT gate on admin_alerts. A kind with app_config key alert_mute_<kind> set to true lands pre-acknowledged (and at most once per 4h) instead of raising the red dot and the daily digest. Opt-in per kind; kinds without a flag are untouched.';

drop trigger if exists admin_alerts_mute on public.admin_alerts;
create trigger admin_alerts_mute
  before insert on public.admin_alerts
  for each row execute function public.admin_alerts_mute_gate();

-- ── 2. mute slow_query_storm ──────────────────────────────────────────────
-- `do update` rather than `do nothing`: re-running this file should restore
-- the intended state, not silently leave a previous 'false' in place.
insert into public.app_config (key, value, updated_at)
values ('alert_mute_slow_query_storm', 'true'::jsonb, now())
on conflict (key) do update
  set value = 'true'::jsonb, updated_at = now();

-- PostgREST schema cache reload, same as the other app_config migrations.
notify pgrst, 'reload schema';

-- ── 3. clear the backlog ──────────────────────────────────────────────────
-- Alerts already sitting unacknowledged would keep the red dot lit and keep
-- riding the digest even after the gate is installed, since the gate only
-- acts on new inserts. Acknowledge the existing ones. Scoped to this one
-- kind; nothing else is touched.
update public.admin_alerts
   set acknowledged_at = now()
 where kind = 'slow_query_storm'
   and acknowledged_at is null;

-- ── 4. verify ─────────────────────────────────────────────────────────────
-- One paste. Expect: muted = true, unacknowledged = 0, trigger_installed = 1.
--
--   select
--     (select value = 'true'::jsonb from public.app_config
--       where key = 'alert_mute_slow_query_storm')            as muted,
--     (select count(*) from public.admin_alerts
--       where kind = 'slow_query_storm'
--         and acknowledged_at is null)                        as unacknowledged,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.admin_alerts'::regclass
--         and tgname = 'admin_alerts_mute')                   as trigger_installed;
--
-- The telemetry itself is deliberately untouched — `type='slow_query'` rows
-- keep landing in app_errors. That history is what would justify a compute
-- tier upgrade later. To see it:
--
--   select date_trunc('day', created_at)   as day,
--          count(*)                        as slow_queries,
--          count(distinct extra->>'label') as distinct_labels
--     from public.app_errors
--    where type = 'slow_query'
--      and created_at >= now() - interval '30 days'
--    group by 1 order by 1 desc;
--
-- ROLLBACK:
--   drop trigger if exists admin_alerts_mute on public.admin_alerts;
--   drop function if exists public.admin_alerts_mute_gate();
--   delete from public.app_config where key = 'alert_mute_slow_query_storm';
