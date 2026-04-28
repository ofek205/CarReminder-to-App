-- ==========================================================================
-- Phase 4 — Business Vehicle Ownership
--
-- What this migration does:
--   1. Adds accounts.business_meta (jsonb) for B2B-only fields
--      (company name, ח.פ., contact email, etc.)
--   2. Creates workspace_audit_log — append-only B2B audit trail
--   3. Adds a trigger blocking UPDATE vehicles SET account_id = ...
--      Vehicles cannot move between workspaces in v1: storage paths
--      are keyed on the original account_id, and child rows
--      (documents, repair_logs, accidents) share the same account_id
--      via denormalization. Allowing a move would orphan files and
--      strand cross-table joins.
--   4. Adds RPC create_business_workspace(name, business_meta) —
--      atomically creates an accounts row (type='business') + an
--      account_members row for the caller as 'בעלים' + an audit entry.
--
-- What this migration does NOT do (deferred to later phases):
--   - new "fleet_manager" / "driver" role values   → Phase 2
--   - driver_assignments table                     → Phase 6
--   - per-driver vehicle scoping                   → Phase 6
--   - invitation flow for new members              → Phase 5
--
-- Until Phase 2 + 6 land, business workspace members use the existing
-- role triple (בעלים / מנהל / שותף):
--   - בעלים / מנהל ≅ "Manager" — full CRUD on vehicles
--   - שותף            ≅ read-only "viewer"
-- The "driver scoped to assigned vehicles" requirement from the brief
-- is acknowledged here and revisited in Phase 6.
--
-- Idempotent. Reversible. DO NOT APPLY TO PRODUCTION.
-- ==========================================================================

-- 1. accounts.business_meta -----------------------------------------------
alter table public.accounts
  add column if not exists business_meta jsonb;

-- 2. workspace_audit_log --------------------------------------------------
create table if not exists public.workspace_audit_log (
  id            bigint generated always as identity primary key,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  actor_user_id uuid          references auth.users(id)      on delete set null,
  action        text not null,
  target_kind   text,
  target_id     uuid,
  payload       jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists workspace_audit_log_account_id_created_at_idx
  on public.workspace_audit_log (account_id, created_at desc);

alter table public.workspace_audit_log enable row level security;

-- Policy: read access only for active 'בעלים' / 'מנהל' of the account
-- (members can audit their own workspace; viewers/'שותף' cannot).
drop policy if exists "audit_select_managers_only" on public.workspace_audit_log;
create policy "audit_select_managers_only"
  on public.workspace_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.account_members m
       where m.account_id = workspace_audit_log.account_id
         and m.user_id    = auth.uid()
         and m.status     = 'פעיל'
         and m.role in ('בעלים', 'מנהל')
    )
  );

-- No INSERT/UPDATE/DELETE policies for any role: writes happen through
-- SECURITY DEFINER RPCs (create_business_workspace + future Phase 5/6
-- RPCs). PostgREST direct writes are blocked by absence of policy.

grant select on public.workspace_audit_log to authenticated;

-- 3. Vehicle account_id immutability --------------------------------------
-- Once a vehicle is created in a workspace, its account_id is locked.
-- Owners can rename, edit specs, delete — but cannot move it to a
-- different workspace. SECURITY DEFINER RPCs in future phases that
-- need to bypass this can drop the trigger temporarily inside a
-- transaction; no app-level path crosses this boundary in v1.

create or replace function public.prevent_vehicle_account_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.account_id is distinct from old.account_id then
    raise exception
      'vehicle_account_id_immutable: vehicle % cannot move from workspace % to %',
      old.id, old.account_id, new.account_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_vehicle_account_change on public.vehicles;
create trigger prevent_vehicle_account_change
  before update on public.vehicles
  for each row
  execute function public.prevent_vehicle_account_change();

-- 4. RPC: create_business_workspace ---------------------------------------
-- Atomic: account row + member row + audit entry. SECURITY DEFINER so
-- the function runs with table-owner privileges and bypasses the
-- members_insert_weak policy that rejects direct 'בעלים' inserts (same
-- pattern as ensure_user_account in supabase-new-user-bootstrap.sql).

create or replace function public.create_business_workspace(
  p_name          text,
  p_business_meta jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  new_id uuid;
  clean_name text;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then
    raise exception 'name_required';
  end if;

  if char_length(clean_name) > 120 then
    raise exception 'name_too_long';
  end if;

  insert into public.accounts (owner_user_id, type, name, business_meta, created_via)
    values (uid, 'business', clean_name, p_business_meta, 'business_create')
    returning id into new_id;

  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_id, uid, 'בעלים', 'פעיל', now());

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (new_id, uid, 'workspace.create', 'workspace', new_id,
     jsonb_build_object('name', clean_name, 'business_meta', p_business_meta));

  return new_id;
end;
$$;

revoke all on function public.create_business_workspace(text, jsonb) from public;
grant execute on function public.create_business_workspace(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

-- ==========================================================================
-- ROLLBACK (manual)
--
--   drop function if exists public.create_business_workspace(text, jsonb);
--   drop trigger  if exists prevent_vehicle_account_change on public.vehicles;
--   drop function if exists public.prevent_vehicle_account_change();
--   drop table    if exists public.workspace_audit_log;
--   alter table   public.accounts drop column if exists business_meta;
--
-- After rollback, business workspaces created via this RPC remain in
-- accounts (type='business') but cannot be created via the dropped
-- RPC. To fully delete them: DELETE FROM accounts WHERE type='business'
-- AND created_via='business_create'; — but only do this on staging,
-- and only after verifying no real data depends on them.
-- ==========================================================================
