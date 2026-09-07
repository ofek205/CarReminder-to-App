-- ============================================================================
-- SQL LEDGER — a record of what was actually applied to this database
-- ============================================================================
--
-- Run ONCE in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- WHY
-- ---
-- This project has no migration runner. Every .sql file is pasted in by hand,
-- and until now nothing recorded what was run, when, or against which database.
-- staging and prod share one database, so an unrecorded apply is an unrecorded
-- production change.
--
-- The cost of that gap has a name. supabase-vehicle-cap-upgrade-rpc-2026-07-25
-- opens by asserting that wave 1 was "הוחל 2026-07-25" — but all three
-- vehicle-cap files are uncommitted and no evidence exists either way. The repo
-- claims something is live in production and cannot prove it. That is what this
-- table is for.
--
-- WHAT IT IS NOT
-- --------------
-- Not a migration runner, and not a replay log. The 199 archived files cannot
-- be replayed — their order is unrecoverable (45 functions are defined in more
-- than one file) and a replay that ran 91% cleanly while silently reverting
-- hardened functions would be worse than none. This table records history going
-- forward from the baseline. It does not reconstruct the past.
--
-- THE LOAD-BEARING COLUMN IS sha256
-- ---------------------------------
-- Recording a filename proves nothing if the file changed afterwards. The hash
-- pins the exact bytes that were executed, which is what makes
-- `node scripts/sql-ledger.cjs drift` able to answer "did the database run what
-- this file now says?"
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.sql_ledger (
  id                  bigint generated always as identity primary key,
  filename            text        not null,
  sha256              text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at          timestamptz not null default now(),
  applied_by          uuid                 default auth.uid(),
  applied_by_email    text,
  target_database     text        not null default 'shared'
                      check (target_database in ('shared', 'staging', 'prod')),
  verdict             text        check (verdict in ('REPLAY_SAFE', 'NEEDS_REVIEW', 'ONE_TIME_DATA')),
  notes               text,
  verification_result text,
  rolled_back_at      timestamptz,
  rollback_reason     text
);

comment on table  public.sql_ledger              is 'One row per hand-applied .sql file. See scripts/sql-ledger.cjs.';
comment on column public.sql_ledger.sha256        is 'sha256 of the file contents at apply time. Detects post-apply edits.';
comment on column public.sql_ledger.target_database is 'staging and prod are the same database today; ''shared'' says so honestly.';
comment on column public.sql_ledger.verdict       is 'Classification from sql-ledger.cjs at apply time, not a live value.';

-- A file may legitimately be applied more than once (a REPLAY_SAFE function
-- redefinition, for instance), so filename is not unique. But the same bytes
-- applied twice to the same database is almost always a mistake worth seeing.
create unique index if not exists sql_ledger_unique_apply
  on public.sql_ledger (filename, sha256, target_database)
  where rolled_back_at is null;

create index if not exists sql_ledger_applied_at_idx on public.sql_ledger (applied_at desc);
create index if not exists sql_ledger_filename_idx   on public.sql_ledger (filename);

-- ---------------------------------------------------------------------------
-- 2. Access — admins only
-- ---------------------------------------------------------------------------
-- The ledger describes the shape of the database. It is not user data and no
-- client screen reads it, so nothing but an admin should see or write it.

alter table public.sql_ledger enable row level security;

drop policy if exists sql_ledger_admin_read  on public.sql_ledger;
drop policy if exists sql_ledger_admin_write on public.sql_ledger;

create policy sql_ledger_admin_read on public.sql_ledger
  for select using (public.is_current_user_admin());

create policy sql_ledger_admin_write on public.sql_ledger
  for all using (public.is_current_user_admin())
           with check (public.is_current_user_admin());

-- ---------------------------------------------------------------------------
-- 3. Recording
-- ---------------------------------------------------------------------------
-- `node scripts/sql-ledger.cjs record <file>` prints a ready-to-paste call.

create or replace function public.sql_ledger_record(
  p_filename text,
  p_sha256   text,
  p_verdict  text default null,
  p_target   text default 'shared',
  p_notes    text default null,
  p_verification text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    bigint;
  v_uid   uuid := auth.uid();
  v_email text;
  v_prior record;
begin
  -- Two legitimate callers, and only two:
  --   1. an admin user holding a JWT (the app, or a signed-in session)
  --   2. a privileged database role with no JWT at all — which is exactly what
  --      the Supabase SQL Editor is, and is the normal way SQL is applied here.
  --
  -- The first cut of this function only allowed (1). It failed on its very
  -- first real use with `42501: admin only`, because the SQL Editor runs as
  -- `postgres` with no JWT, so auth.uid() is null and is_current_user_admin()
  -- is false. An admin gate that locks out the only path the table exists to
  -- serve is not a gate, it is a bug.
  if v_uid is not null then
    if not public.is_current_user_admin() then
      raise exception 'sql_ledger_record: admin only' using errcode = '42501';
    end if;
  elsif current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'sql_ledger_record: no JWT and % is not a privileged role', current_user
      using errcode = '42501';
  end if;

  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'sql_ledger_record: sha256 must be 64 lowercase hex chars, got %', p_sha256
      using errcode = '22023';
  end if;

  -- Warn, do not block, when the same file was applied before with different
  -- bytes. That is legitimate for a function redefinition and suspicious for
  -- anything else, and only a human can tell which.
  select filename, sha256, applied_at into v_prior
  from public.sql_ledger
  where filename = p_filename
    and target_database = p_target
    and rolled_back_at is null
  order by applied_at desc
  limit 1;

  if found and v_prior.sha256 is distinct from p_sha256 then
    raise notice 'sql_ledger: % was already applied on % with different content (% -> %). Recording both.',
      p_filename, v_prior.applied_at, left(v_prior.sha256, 12), left(p_sha256, 12);
  end if;

  -- With no JWT there is no user to name, so record the database role instead.
  -- 'sql-editor:postgres' is more honest than a null column.
  if v_uid is not null then
    select email into v_email from auth.users where id = v_uid;
  else
    v_email := 'sql-editor:' || current_user;
  end if;

  insert into public.sql_ledger
    (filename, sha256, applied_by, applied_by_email, target_database, verdict, notes, verification_result)
  values
    (p_filename, p_sha256, v_uid, v_email, p_target, p_verdict, p_notes, p_verification)
  on conflict (filename, sha256, target_database) where rolled_back_at is null
  do update set
    notes               = coalesce(excluded.notes, public.sql_ledger.notes),
    verification_result = coalesce(excluded.verification_result, public.sql_ledger.verification_result)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.sql_ledger_record(text, text, text, text, text, text) from public, anon;
grant execute on function public.sql_ledger_record(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading it back
-- ---------------------------------------------------------------------------

-- Feed this to `node scripts/sql-ledger.cjs drift`:
--   select json_agg(json_build_object('filename', filename, 'sha256', sha256))
--   from public.sql_ledger_current;
create or replace view public.sql_ledger_current as
select distinct on (filename, target_database)
  filename, sha256, applied_at, applied_by_email, target_database, verdict, notes, verification_result
from public.sql_ledger
where rolled_back_at is null
order by filename, target_database, applied_at desc;

commit;

-- ============================================================================
-- ROLLBACK — if this needs to come out
-- ============================================================================
-- begin;
--   drop view     if exists public.sql_ledger_current;
--   drop function if exists public.sql_ledger_record(text, text, text, text, text, text);
--   drop table    if exists public.sql_ledger;
-- commit;

-- ============================================================================
-- VERIFY — run after applying
-- ============================================================================
-- select
--   to_regclass('public.sql_ledger')                        as table_exists,
--   to_regclass('public.sql_ledger_current')                as view_exists,
--   (select count(*) from pg_proc
--     where proname = 'sql_ledger_record')                  as fn_count,
--   (select relrowsecurity from pg_class
--     where oid = 'public.sql_ledger'::regclass)            as rls_on,
--   (select count(*) from pg_policies
--     where tablename = 'sql_ledger')                       as policy_count;
-- Expect: table_exists and view_exists non-null, fn_count = 1, rls_on = true,
--         policy_count = 2.

-- ============================================================================
-- FIRST ENTRY — record this file itself, so the ledger's own history is in it
-- ============================================================================
-- Get the hash with:  node scripts/sql-ledger.cjs hash supabase-sql-ledger-2026-09-01.sql
--
-- select public.sql_ledger_record(
--   p_filename => 'supabase-sql-ledger-2026-09-01.sql',
--   p_sha256   => '<paste the hash>',
--   p_verdict  => 'REPLAY_SAFE',
--   p_target   => 'shared',
--   p_notes    => 'Ledger bootstrap.',
--   p_verification => 'VERIFY block above returned the expected values.'
-- );
