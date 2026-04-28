-- ==========================================================================
-- Phase 1 — Workspace Foundation
--
-- Goal: introduce the workspace concept at the data layer with ZERO
-- observable change for existing users. Strategy: workspace = account
-- (no rename), additive columns, additive view, no RLS rewrite.
--
-- Idempotent: safe to re-run. Reversible: see ROLLBACK block at bottom.
--
-- DO NOT APPLY THIS FILE TO PRODUCTION UNTIL STAGING/PROD DB SPLIT IS DONE.
-- (See CLAUDE.md §"הערה על DB". Today staging+prod share one project.)
-- ==========================================================================

-- 1. Additive columns on public.accounts -----------------------------------
-- type:         'personal' (default) | 'business'. Every existing row
--               receives 'personal' through the DEFAULT.
-- name:         human-readable workspace name. NULL for personal accounts
--               today; required at the form level for business accounts
--               (enforced in Phase 4, not here).
-- created_via:  audit field, e.g. 'bootstrap' (signup trigger),
--               'business_create' (Phase 4), 'guest_migration'.

alter table public.accounts
  add column if not exists type text not null default 'personal';

alter table public.accounts
  add column if not exists name text;

alter table public.accounts
  add column if not exists created_via text;

-- CHECK constraint added separately so we can validate against the
-- already-backfilled data. Wrapped in a guard so re-runs don't fail.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname  = 'accounts_type_check'
       and conrelid = 'public.accounts'::regclass
  ) then
    alter table public.accounts
      add constraint accounts_type_check
      check (type in ('personal', 'business'));
  end if;
end $$;

-- 2. Defensive backfill ----------------------------------------------------
-- The DEFAULT covers all rows (existing + future). This UPDATE is here
-- only to repair any row that might have been written before the column
-- existed (cannot happen given ADD COLUMN ... DEFAULT, but cheap to run).
update public.accounts
   set type = 'personal'
 where type is null;

-- 3. v_user_workspaces -----------------------------------------------------
-- Read-only projection joining account_members + accounts so the frontend
-- can fetch a user's full workspace list in one round trip.
--
-- security_invoker = true:  the view runs with the caller's privileges,
-- so the existing RLS on account_members applies unchanged. A user sees
-- only their own memberships (caller_id = user_id) — same boundary as
-- direct SELECTs on account_members today.

create or replace view public.v_user_workspaces
  with (security_invoker = true)
as
select
  m.user_id,
  m.account_id,
  m.role,
  m.status,
  m.joined_at,
  a.type        as account_type,
  a.name        as account_name,
  a.created_via as account_created_via,
  a.owner_user_id
  from public.account_members m
  join public.accounts a on a.id = m.account_id;

grant select on public.v_user_workspaces to authenticated;

-- 4. Bootstrap RPC + trigger — stamp the new metadata ----------------------
-- These are CREATE OR REPLACE versions of the functions defined in
-- supabase-new-user-bootstrap.sql. The ONLY change vs that file is the
-- INSERT into accounts: now explicit type='personal' and
-- created_via='bootstrap'. All other behavior is preserved verbatim,
-- including the auto-heal semantics and the warning-only failure mode
-- inside handle_new_user.

create or replace function public.ensure_user_account()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing_account_id uuid;
  new_account_id uuid;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  select account_id into existing_account_id
    from public.account_members
   where user_id = uid
     and status = 'פעיל'
   order by (role = 'בעלים') desc, joined_at asc nulls last
   limit 1;

  if existing_account_id is not null then
    return existing_account_id;
  end if;

  insert into public.accounts (owner_user_id, type, created_via)
    values (uid, 'personal', 'bootstrap')
    returning id into new_account_id;

  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_account_id, uid, 'בעלים', 'פעיל', now());

  return new_account_id;
end;
$$;

revoke all on function public.ensure_user_account() from public;
grant execute on function public.ensure_user_account() to authenticated;


create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
begin
  if exists (
    select 1 from public.account_members
     where user_id = new.id and status = 'פעיל'
  ) then
    return new;
  end if;

  begin
    insert into public.accounts (owner_user_id, type, created_via)
      values (new.id, 'personal', 'bootstrap')
      returning id into new_account_id;

    insert into public.account_members (account_id, user_id, role, status, joined_at)
      values (new_account_id, new.id, 'בעלים', 'פעיל', now());
  exception when others then
    raise warning 'handle_new_user failed for user_id=%: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Trigger itself unchanged; recreated defensively in case it drifted.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (run manually if Phase 1 must be reverted)
--
-- Order matters — drop view first, then constraint, then columns. Then
-- re-run supabase-new-user-bootstrap.sql to restore the original RPC
-- bodies (which lacked the type/created_via columns in the INSERT).
--
--   drop view if exists public.v_user_workspaces;
--   alter table public.accounts drop constraint if exists accounts_type_check;
--   alter table public.accounts drop column if exists created_via;
--   alter table public.accounts drop column if exists name;
--   alter table public.accounts drop column if exists type;
--   \i supabase-new-user-bootstrap.sql
--
-- After rollback, account_members and the accounts table are byte-equivalent
-- to their pre-Phase-1 shape. No data loss for any user.
-- ==========================================================================
