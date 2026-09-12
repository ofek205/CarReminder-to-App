-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-offline-updated-at-2026-09-09.sql
--
-- Adds `updated_at` plus a BEFORE UPDATE trigger to every table an offline
-- write can UPDATE. This is the one open prerequisite blocking offline
-- updates (spec §5.1/§5.5, and the "WHY THE ENABLED SET IS SMALL" block at
-- the top of src/lib/dal/queueWrite.js).
--
-- WHY
--   52 commands declare `offlineCapable: true`. Six are switched on, and all
--   six are cork notes and tasks. The stated reason updates stay off:
--
--     "CONFLICT DETECTION needs `updated_at` + a trigger on every
--      offline-write table, and `vehicles` has none — only `created_at`.
--      Without it, an UPDATE queued three hours ago silently overwrites a
--      newer server value on flush: the 'silently corrupt data' class the
--      seam refactor closed."
--
--   That is the whole blocker for 46 update and delete commands. After this
--   runs, enabling them becomes per-command client work rather than a
--   database dependency.
--
-- WHY SERVER-MAINTAINED AND NOT CLIENT-SUPPLIED
--   The client is precisely the party that was offline, and its clock is not
--   trustworthy: a persisted cache snapshot stamped in the FUTURE was already
--   a real bug in this app, fixed in 182bbd1. A trigger is the only place the
--   timestamp cannot be back-dated by the writer whose staleness we are trying
--   to detect.
--
-- SCOPE — 16 tables, derived mechanically, not chosen by hand
--   Every table reached by an `offlineCapable` command whose `run` body calls
--   `.update(` or `.upsert(`, read out of the command registry on staging at
--   3d6e4ea:
--
--     accidents                      accident.update
--     app_notifications              appNotification.markRead
--     cork_notes                     corkNote.update, task.toggleDone
--     maintenance_logs               maintenance.update
--     maintenance_reminder_prefs     maintPref.update
--     notification_log               notificationLog.markRead
--     reminder_settings              reminderSettings.update
--     reminder_snoozes               reminderSnooze.upsert
--     repair_types                   repairType.update
--     user_notification_preferences  emailPrefs.setSubscription
--     user_preferences               userPreferences.setLastActive
--     user_profiles                  profile.update
--     vehicles                       vehicle.update
--     vessel_checklist_runs          checklistRun.update
--     vessel_checklists              checklist.update
--     vessel_issues                  vesselIssue.update
--
--   DELIBERATELY NOT INCLUDED: `documents` and `repair_logs` have an offline
--   DELETE command but no offline UPDATE. The documented conflict rule is
--   about an UPDATE clobbering a newer value; a delete has a different
--   question (delete a row someone else just changed?) which is a product
--   decision, not a column. Adding the column to them would imply a
--   protection that is not designed yet.
--
-- ⚠️ ORDERING CONSTRAINT — RUN THIS BEFORE ANY CLIENT CHANGE
--   `LIGHT_COLUMNS` in src/lib/supabaseEntities.js lists explicit columns for
--   light-mode reads, and conflict detection will need `updated_at` in the
--   `vehicles` entry. Adding it to that list BEFORE this migration runs takes
--   production down. That is not a hypothetical — the file records it:
--
--     "2026-05-26 (round 2): removed `updated_at` and `status` — neither
--      exists on the base public.vehicles table, so PostgREST was failing
--      every light-mode query with a 400 'column does not exist' and the
--      calling pages were showing their empty state (MyExpenses,
--      AccountSettings, Reports, etc.)."
--
--   So: this SQL first, verified by the query at the bottom, and only then the
--   client change. Never the reverse.
--
-- SAFETY / WHAT THIS CANNOT BREAK
--   • Idempotent. Adding the column, the backfill, the default, the NOT NULL
--     and the trigger are each guarded by a catalog check, so a second run is
--     a series of no-ops that only prints notices.
--   • Skips any table that does not exist in this database rather than
--     aborting, so a schema drift between environments cannot half-apply it.
--   • `add column` with no default is a metadata-only operation in PG11+, so
--     it does not rewrite the table. The default and NOT NULL are set after
--     the backfill, in that order, so no row is ever momentarily invalid.
--   • RLS is untouched. No policy references `updated_at`, and adding a
--     column does not alter existing policies.
--   • The function is plain (invoker) rather than SECURITY DEFINER, because a
--     trigger already runs with the privileges of the statement's caller and
--     this needs nothing more.
--
-- ⚠️ THIS TOUCHES EVERY ROW — CHECK SIZES FIRST
--   For each table that does not yet have the column, this runs a full-table
--   `update ... set updated_at = created_at` and then `set not null`. Those
--   are not free on a large table:
--     • the backfill rewrites every row, so the table roughly doubles on disk
--       until autovacuum reclaims the dead tuples;
--     • `set not null` takes an ACCESS EXCLUSIVE lock and scans the table to
--       validate, which blocks reads and writes on it for the duration.
--   On this app's tables that is expected to be seconds, but `app_notifications`
--   and `notification_log` grow per user per event and are the two that could
--   be big. RUN THE PRE-FLIGHT below first. If any table is large enough to
--   worry about, apply this file for the small tables, then handle the large
--   ones one at a time in a quiet window — or drop the `set not null` for them
--   and treat a null `updated_at` as "unknown, refuse to auto-merge" in the
--   client, which is the safe reading anyway.
--
-- ── PRE-FLIGHT (read-only, run this BEFORE the migration) ─────────────────
--   Estimated row counts from the planner, so it costs nothing even if a
--   table is huge. Anything in the millions deserves its own window.
--
--     select c.relname as table_name,
--            to_char(c.reltuples::bigint, 'FM999,999,999') as est_rows,
--            pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
--            exists (select 1 from pg_attribute a
--                    where a.attrelid = c.oid and a.attname = 'updated_at'
--                      and a.attnum > 0 and not a.attisdropped) as already_has_column
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace
--     where n.nspname = 'public'
--       and c.relname in (
--         'accidents','app_notifications','cork_notes','maintenance_logs',
--         'maintenance_reminder_prefs','notification_log','reminder_settings',
--         'reminder_snoozes','repair_types','user_notification_preferences',
--         'user_preferences','user_profiles','vehicles','vessel_checklist_runs',
--         'vessel_checklists','vessel_issues')
--     order by c.reltuples desc;
--
--   A table already showing `already_has_column = true` is skipped by the
--   migration entirely, so its size does not matter.
--
-- KNOWN CONSEQUENCE, worth stating rather than discovering
--   If any table here already has an `updated_at` that application code sets
--   to a MEANINGFUL value (a historical import, say), the trigger now
--   overwrites it with now() on every update. That is the intended semantic
--   for conflict detection, but it is a behaviour change for such a caller.
--   The verification query at the bottom reports which tables already had the
--   column, which is where to look if that matters.
--
-- CLASSIFICATION: REPLAY_SAFE
-- LEDGER: after running, `node scripts/sql-ledger.cjs record supabase-offline-updated-at-2026-09-09.sql`
--         and paste the verification output into `p_notes`. Do NOT edit this
--         file after it is applied and recorded — the ledger's load-bearing
--         field is `sha256`, so an edit detaches it from the bytes that ran
--         and `drift` marks it CHANGED forever. A follow-up is a NEW file.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- One shared trigger function for all 16 tables. `search_path` is pinned
-- because Supabase's linter flags functions without it; the body only calls
-- now(), which lives in pg_catalog and is always resolvable.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

comment on function public.set_updated_at() is
  'Maintains updated_at on offline-writable tables. Server-side on purpose: '
  'conflict detection cannot trust a timestamp from the client that was offline. '
  'Added by supabase-offline-updated-at-2026-09-09.sql';

do $mig$
declare
  t              text;
  trg            text;
  had_column     boolean;
  has_created_at boolean;
  targets        text[] := array[
    'accidents',
    'app_notifications',
    'cork_notes',
    'maintenance_logs',
    'maintenance_reminder_prefs',
    'notification_log',
    'reminder_settings',
    'reminder_snoozes',
    'repair_types',
    'user_notification_preferences',
    'user_preferences',
    'user_profiles',
    'vehicles',
    'vessel_checklist_runs',
    'vessel_checklists',
    'vessel_issues'
  ];
begin
  foreach t in array targets loop

    -- Skip rather than abort: a table missing here means schema drift, and
    -- taking down the whole migration for it would leave the rest unapplied.
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'SKIP    %  (table not found in this database)', t;
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into had_column;

    if not had_column then
      -- Metadata-only in PG11+ because no default is given here.
      execute format('alter table public.%I add column updated_at timestamptz', t);

      -- Backfill from created_at where the table has one, so existing rows
      -- carry a meaningful timestamp instead of "the moment of migration".
      -- A row whose updated_at equals its created_at has genuinely never been
      -- edited, which is the truth we want on disk.
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = t and column_name = 'created_at'
      ) into has_created_at;

      if has_created_at then
        execute format('update public.%I set updated_at = created_at where updated_at is null', t);
      end if;

      -- Anything still null (no created_at, or a null one) gets now().
      execute format('update public.%I set updated_at = now() where updated_at is null', t);

      -- Default and NOT NULL only after the backfill, so no row is ever
      -- momentarily in violation.
      execute format('alter table public.%I alter column updated_at set default now()', t);
      execute format('alter table public.%I alter column updated_at set not null', t);

      raise notice 'ADDED   %  updated_at (backfilled from %)', t,
        case when has_created_at then 'created_at' else 'now()' end;
    else
      raise notice 'PRESENT %  updated_at already existed, left as is', t;
    end if;

    -- The trigger, guarded by name so a re-run does not stack duplicates.
    trg := 'trg_' || t || '_updated_at';
    if not exists (
      select 1 from pg_trigger
      where tgname = trg
        and tgrelid = format('public.%I', t)::regclass
        and not tgisinternal
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        trg, t
      );
      raise notice 'TRIGGER %  attached %', t, trg;
    else
      raise notice 'TRIGGER %  already attached, left as is', t;
    end if;

  end loop;
end
$mig$;

commit;

-- PostgREST caches the schema. Without this the new column exists in Postgres
-- but is invisible to the API, which would make the client change above look
-- broken for no visible reason.
notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (read-only). Run this after the migration and paste the output
-- into the ledger's `p_notes`. Every row must read t / t / t.
-- ═══════════════════════════════════════════════════════════════════════════
select
  c.relname                                        as table_name,
  (a.attname is not null)                          as has_updated_at,
  coalesce(a.attnotnull, false)                    as is_not_null,
  exists (
    select 1 from pg_trigger g
    where g.tgrelid = c.oid
      and g.tgname = 'trg_' || c.relname || '_updated_at'
      and not g.tgisinternal
  )                                                as has_trigger
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_attribute a
  on a.attrelid = c.oid and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public'
  and c.relname in (
    'accidents', 'app_notifications', 'cork_notes', 'maintenance_logs',
    'maintenance_reminder_prefs', 'notification_log', 'reminder_settings',
    'reminder_snoozes', 'repair_types', 'user_notification_preferences',
    'user_preferences', 'user_profiles', 'vehicles', 'vessel_checklist_runs',
    'vessel_checklists', 'vessel_issues'
  )
order by has_trigger, has_updated_at, c.relname;
