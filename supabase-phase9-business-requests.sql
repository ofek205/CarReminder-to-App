-- ==========================================================================
-- Phase 9, Step 3.5 — Business workspace creation requests
--
-- Policy: a regular user can self-create at most ONE business workspace.
-- Any further business workspace requires admin approval. The user
-- submits a request (name, business_meta, reason) which lands in
-- business_workspace_requests with status='pending'. An admin reviews
-- it via /AdminBusinessRequests and either approves (which actually
-- creates the workspace) or denies (with a note).
--
-- Idempotent. Reversible.
-- ==========================================================================

create table if not exists public.business_workspace_requests (
  id                  uuid primary key default gen_random_uuid(),
  requesting_user_id  uuid not null references auth.users(id) on delete cascade,
  requested_name      text not null,
  business_meta       jsonb,
  reason              text,
  status              text not null default 'pending'
                       check (status in ('pending', 'approved', 'denied')),
  reviewed_by         uuid references auth.users(id) on delete set null,
  reviewed_at         timestamptz,
  review_note         text,
  created_account_id  uuid references public.accounts(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists business_workspace_requests_status_idx
  on public.business_workspace_requests (status, created_at desc);
create index if not exists business_workspace_requests_user_idx
  on public.business_workspace_requests (requesting_user_id, created_at desc);

alter table public.business_workspace_requests enable row level security;

drop policy if exists "bwr_select_own_or_admin" on public.business_workspace_requests;
create policy "bwr_select_own_or_admin"
  on public.business_workspace_requests
  for select
  to authenticated
  using (
    requesting_user_id = auth.uid()
    or public.is_admin()
  );

grant select on public.business_workspace_requests to authenticated;

create or replace function public.user_self_created_business_count(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.accounts
   where owner_user_id = p_user_id
     and type          = 'business'
     and created_via   = 'business_create';
$$;

grant execute on function public.user_self_created_business_count(uuid) to authenticated;

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
  existing_count int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then raise exception 'name_required'; end if;
  if char_length(clean_name) > 120 then raise exception 'name_too_long'; end if;

  if not public.is_admin() then
    select public.user_self_created_business_count(uid) into existing_count;
    if existing_count >= 1 then
      raise exception 'business_workspace_limit_reached';
    end if;
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

create or replace function public.request_business_workspace(
  p_name          text,
  p_business_meta jsonb default null,
  p_reason        text  default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_id uuid;
  clean_name text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then raise exception 'name_required'; end if;
  if char_length(clean_name) > 120 then raise exception 'name_too_long'; end if;

  if public.user_self_created_business_count(uid) < 1 then
    raise exception 'no_existing_business_workspace';
  end if;

  if exists (
    select 1 from public.business_workspace_requests
     where requesting_user_id = uid and status = 'pending'
  ) then
    raise exception 'pending_request_exists';
  end if;

  insert into public.business_workspace_requests
    (requesting_user_id, requested_name, business_meta, reason, status)
  values
    (uid, clean_name, p_business_meta, nullif(trim(coalesce(p_reason,'')), ''), 'pending')
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.request_business_workspace(text, jsonb, text) from public;
grant execute on function public.request_business_workspace(text, jsonb, text) to authenticated;

create or replace function public.approve_business_workspace_request(
  p_request_id uuid,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid := auth.uid();
  req record;
  new_account_id uuid;
begin
  if admin_uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin() then raise exception 'forbidden_not_admin'; end if;

  select * into req from public.business_workspace_requests where id = p_request_id;
  if req.id is null then raise exception 'request_not_found'; end if;
  if req.status <> 'pending' then raise exception 'request_already_resolved'; end if;

  insert into public.accounts (owner_user_id, type, name, business_meta, created_via)
    values (req.requesting_user_id, 'business', req.requested_name, req.business_meta, 'business_create_approved')
    returning id into new_account_id;

  insert into public.account_members (account_id, user_id, role, status, joined_at)
    values (new_account_id, req.requesting_user_id, 'בעלים', 'פעיל', now());

  insert into public.workspace_audit_log
    (account_id, actor_user_id, action, target_kind, target_id, payload)
  values
    (new_account_id, admin_uid, 'workspace.create_approved', 'workspace', new_account_id,
     jsonb_build_object('name', req.requested_name, 'request_id', req.id, 'requested_by', req.requesting_user_id));

  update public.business_workspace_requests
     set status              = 'approved',
         reviewed_by         = admin_uid,
         reviewed_at         = now(),
         review_note         = nullif(trim(coalesce(p_review_note,'')), ''),
         created_account_id  = new_account_id
   where id = p_request_id;

  return new_account_id;
end;
$$;

revoke all on function public.approve_business_workspace_request(uuid, text) from public;
grant execute on function public.approve_business_workspace_request(uuid, text) to authenticated;

create or replace function public.deny_business_workspace_request(
  p_request_id uuid,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_uid uuid := auth.uid();
  req record;
begin
  if admin_uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_admin() then raise exception 'forbidden_not_admin'; end if;

  select * into req from public.business_workspace_requests where id = p_request_id;
  if req.id is null then raise exception 'request_not_found'; end if;
  if req.status <> 'pending' then raise exception 'request_already_resolved'; end if;

  update public.business_workspace_requests
     set status      = 'denied',
         reviewed_by = admin_uid,
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_review_note,'')), '')
   where id = p_request_id;
end;
$$;

revoke all on function public.deny_business_workspace_request(uuid, text) from public;
grant execute on function public.deny_business_workspace_request(uuid, text) to authenticated;

notify pgrst, 'reload schema';
