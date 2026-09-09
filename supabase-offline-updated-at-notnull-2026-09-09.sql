-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-offline-updated-at-notnull-2026-09-09.sql
--
-- Follow-up to supabase-offline-updated-at-2026-09-09.sql. That file set NOT
-- NULL only on the columns it created. Three tables already had `updated_at`
-- and were left nullable, which would have forced a "NULL means unknown,
-- refuse to auto-merge" branch into the client's conflict logic for those
-- three and nothing else.
--
-- MEASURED after applying the first file, which is why this is worth doing:
--
--     cork_notes           0 nulls / 17
--     reminder_settings    0 nulls / 614
--     user_profiles        0 nulls / 430
--
-- Zero nulls, so the branch is avoidable. Making the schema uniform is better
-- than teaching the client to tolerate a shape that exists only because those
-- three columns were created by an earlier, unrelated migration.
--
-- WHY A NEW FILE AND NOT AN EDIT
--   The first file is applied and recorded. The ledger's load-bearing field is
--   `sha256`, so editing it would detach it from the bytes that actually ran
--   and `drift` would mark it CHANGED forever. An addition is a new file.
--
-- ⚠️ DEFAULT BEFORE NOT NULL — this ordering is the entire risk here
--   NOT NULL without a default breaks every INSERT that omits the column. The
--   first migration paired the two for the columns it created; these three
--   were created elsewhere and their default is unknown, so this sets the
--   default FIRST and only then adds the constraint. Getting that backwards
--   would turn a tidy-up into an outage on three write paths.
--
-- SAFETY
--   • Idempotent: each step is guarded by a catalog check, so a second run
--     prints notices and changes nothing.
--   • Fails closed: `set not null` validates with a table scan. If a null
--     appeared between the measurement above and this run, the ALTER raises
--     and the transaction rolls back rather than half-applying.
--   • Tiny: 17, 614 and 430 rows. The validating scan is not a concern.
--   • No data is written. Unlike the first file there is no backfill, because
--     there is nothing to backfill.
--
-- CLASSIFICATION: REPLAY_SAFE
-- LEDGER: node scripts/sql-ledger.cjs record supabase-offline-updated-at-notnull-2026-09-09.sql
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $mig$
declare
  t        text;
  has_def  boolean;
  is_nn    boolean;
  targets  text[] := array[
    'cork_notes',
    'reminder_settings',
    'user_profiles'
  ];
begin
  foreach t in array targets loop

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) then
      raise notice 'SKIP    %  (no updated_at column — run the first file)', t;
      continue;
    end if;

    select (column_default is not null), (is_nullable = 'NO')
      into has_def, is_nn
    from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = 'updated_at';

    -- Default first. See the warning in the header.
    if not has_def then
      execute format('alter table public.%I alter column updated_at set default now()', t);
      raise notice 'DEFAULT %  set default now()', t;
    else
      raise notice 'DEFAULT %  already had a default, left as is', t;
    end if;

    if not is_nn then
      execute format('alter table public.%I alter column updated_at set not null', t);
      raise notice 'NOTNULL %  set not null', t;
    else
      raise notice 'NOTNULL %  already not null, left as is', t;
    end if;

  end loop;
end
$mig$;

commit;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION (read-only). All three rows must read true / true / true.
-- `has_trigger` is carried over from the first file and should already be true.
-- ═══════════════════════════════════════════════════════════════════════════
select
  c.relname                        as table_name,
  coalesce(a.attnotnull, false)    as is_not_null,
  (d.adbin is not null)            as has_default,
  exists (
    select 1 from pg_trigger g
    where g.tgrelid = c.oid
      and g.tgname = 'trg_' || c.relname || '_updated_at'
      and not g.tgisinternal
  )                                as has_trigger
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_attribute a
  on a.attrelid = c.oid and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d
  on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relname in ('cork_notes', 'reminder_settings', 'user_profiles')
order by is_not_null, has_default, c.relname;
