-- ==========================================================================
-- Critical Fixes — Audit 2026-04-24
-- Addresses the top-3 data-integrity / security findings:
--   1. Vehicle delete leaves orphans in dependent tables → add ON DELETE CASCADE
--   2. Admin check lives only in the client → move to SECURITY DEFINER RPC
--   3. Two rapid adds of the same plate create duplicates → unique index
-- Safe to re-run.
-- ==========================================================================


-- ──────────────────────────────────────────────────────────────────────────
-- 1. Vehicle cascade delete
--     For every table whose vehicle_id references public.vehicles(id),
--     rewrite the FK with ON DELETE CASCADE. Uses a DO block that
--     introspects pg_constraint so we don't need to know the constraint
--     names ahead of time.
-- ──────────────────────────────────────────────────────────────────────────
do $$
declare
  rec record;
  target_tables text[] := array[
    'accidents', 'vessel_issues', 'documents', 'cork_notes',
    'repair_logs', 'maintenance_logs', 'vessel_checklist_runs',
    'notification_log'
  ];
begin
  for rec in
    select
      con.conname       as conname,
      cls.relname       as tablename
    from pg_constraint con
    join pg_class cls       on con.conrelid  = cls.oid
    join pg_class ref_cls   on con.confrelid = ref_cls.oid
    join pg_namespace ns    on cls.relnamespace = ns.oid
    where con.contype   = 'f'
      and ns.nspname    = 'public'
      and ref_cls.relname = 'vehicles'
      and cls.relname   = any(target_tables)
      and con.confdeltype <> 'c'   -- skip if already CASCADE
  loop
    raise notice 'rewriting FK %.% -> vehicles with CASCADE', rec.tablename, rec.conname;
    execute format('alter table public.%I drop constraint %I', rec.tablename, rec.conname);
    execute format(
      'alter table public.%I add constraint %I foreign key (vehicle_id) references public.vehicles(id) on delete cascade',
      rec.tablename, rec.conname
    );
  end loop;
end $$;

-- Safety net: for tables where the FK might not exist at all (because the
-- migration ran before the table was created), add a fresh FK if missing.
do $$
declare
  t text;
begin
  foreach t in array array['accidents','vessel_issues','documents','cork_notes',
                           'repair_logs','maintenance_logs','vessel_checklist_runs',
                           'notification_log']
  loop
    if not exists (
      select 1 from pg_constraint con
      join pg_class cls on con.conrelid = cls.oid
      join pg_class ref_cls on con.confrelid = ref_cls.oid
      where con.contype = 'f'
        and cls.relname = t
        and ref_cls.relname = 'vehicles'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='vehicle_id'
    ) then
      raise notice 'adding missing FK on %.vehicle_id', t;
      execute format(
        'alter table public.%I add constraint %I_vehicle_id_fkey foreign key (vehicle_id) references public.vehicles(id) on delete cascade',
        t, t
      );
    end if;
  end loop;
end $$;


-- ──────────────────────────────────────────────────────────────────────────
-- 2. Admin check — SECURITY DEFINER RPC
--     The client used to check admin-ness by comparing user metadata
--     against a hardcoded email. Anyone who could forge a JWT
--     (or just patch the JS bundle in-memory) could self-identify as
--     admin and then rely on RLS to see if they got through.
--
--     This RPC is the single source of truth. It runs with the caller's
--     auth.uid() as input, so the DB decides — not the client.
--     RLS on admin-only tables should call public.is_admin() instead of
--     baking an email list into the policy.
-- ──────────────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Hardcoded email list is OK server-side (client cannot read this function).
  -- Extend by editing the function or adding an admins table later.
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) in ('ofek205@gmail.com')
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Convenience overload: check if a specific user id is admin (for triggers).
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from auth.users u
    where u.id = uid
      and lower(u.email) in ('ofek205@gmail.com')
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- 3. Plate uniqueness per account
--     Prevents two rapid "add vehicle" calls with the same plate from
--     creating duplicates. Partial unique index on
--     (account_id, license_plate_normalized) — skips rows where
--     the plate hasn't been set yet (empty string).
-- ──────────────────────────────────────────────────────────────────────────
-- The index is partial so the frontend's "saving with empty plate" path
-- (vessels that don't always carry a reg number yet) keeps working.
create unique index if not exists vehicles_plate_unique_per_account
  on public.vehicles(account_id, license_plate_normalized)
  where license_plate_normalized is not null
    and license_plate_normalized <> '';
