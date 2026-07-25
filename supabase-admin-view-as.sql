-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as.sql — Admin "View-As" foundation (Phase 1A)
--
-- SECURITY MODEL (least-privilege, time-boxed, audited, server-enforced):
--   An admin can read a customer's row-level data ONLY while an explicit,
--   time-boxed, audited "view session" is active. The session row is the
--   ACCESS PRIMITIVE — not a cosmetic flag. Access is granted by RLS that
--   calls public.is_viewing(account_id); no active session ⇒ no access.
--
-- WHAT THIS FILE DOES:
--   1. admin_view_sessions table (+ RLS, RPC-only writes, index)
--   2. is_viewing(account_id) — the gate used by RLS
--   3. admin_start_view / admin_end_view / admin_current_view RPCs (logged)
--   4. Session-gated admin SELECT policies for the user-area tables that do
--      NOT already have an admin read path (accidents, repair_logs,
--      vehicle_expenses, routes, route_stops, stop_documentation,
--      driver_assignments, cork_notes, vessel_issues)
--
-- DEPENDS ON (must already exist):
--   - public.is_admin()         (supabase-admin-check-unification / critical-fixes)
--   - public.admin_log(...)     (supabase-admin-audit-log.sql)
--   - accounts / account_members / vehicles tables
--
-- NOTE ON THE 5 CORE TABLES (accounts, vehicles, documents, maintenance_logs,
--   account_members): these ALREADY have an UNCONDITIONAL admin read bypass
--   (supabase-admin-rls-bypass.sql) that AdminDashboard stats depend on
--   (db.accounts.list() / db.vehicles.list() at AdminDashboard.jsx:427-432,
--   1399-1402). Tightening those to is_viewing() requires first migrating the
--   dashboard aggregations to admin SECURITY DEFINER RPCs. That is tracked as
--   Phase 1A-H (hardening) — see docs/admin-view-as-spec.md §4 / security review
--   NO-GO #1 — and is NOT done in this file to avoid breaking production stats.
--
-- HOW TO APPLY: paste into Supabase SQL Editor and Run. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. SESSION TABLE
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.admin_view_sessions (
  id                bigint generated always as identity primary key,
  admin_user_id     uuid        not null default auth.uid(),
  target_account_id uuid        not null references public.accounts(id) on delete cascade,
  target_user_id    uuid,                       -- account owner, for display/audit
  reason            text,                        -- why the admin entered (audit)
  started_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 minutes'),
  ended_at          timestamptz                  -- null = still active
);

alter table public.admin_view_sessions enable row level security;

-- Admin may read only their OWN sessions. (Non-admins can never have rows.)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'admin_view_sessions' and policyname = 'view_sessions_select_own'
  ) then
    create policy view_sessions_select_own on public.admin_view_sessions
      for select using (admin_user_id = auth.uid() and public.is_admin());
  end if;
end $$;

-- No direct DML — only the SECURITY DEFINER RPCs below (run as owner) may write.
revoke insert, update, delete on public.admin_view_sessions from authenticated;
revoke insert, update, delete on public.admin_view_sessions from anon;
grant  select                  on public.admin_view_sessions to authenticated;

-- Fast lookup for is_viewing().
create index if not exists idx_admin_view_sessions_active
  on public.admin_view_sessions (admin_user_id, target_account_id, expires_at)
  where ended_at is null;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. is_viewing(account_id) — the RLS gate
-- ───────────────────────────────────────────────────────────────────────────
-- True only when the CURRENT user has an active, unexpired view session for
-- the given account. Because only admins can create sessions (RPCs below are
-- is_admin()-gated), this is implicitly admin-only — no extra is_admin() check
-- needed here, keeping it cheap for per-row RLS evaluation.
create or replace function public.is_viewing(p_account_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- Fail-closed: require admin AND an active session. (Only admins can create
  -- sessions today, so this is belt-and-suspenders; is_admin() takes no args so
  -- Postgres evaluates it once per query.)
  select public.is_admin() and exists (
    select 1
    from public.admin_view_sessions s
    where s.admin_user_id = auth.uid()
      and s.target_account_id = p_account_id
      and s.ended_at is null
      and s.expires_at > now()
  );
$$;

grant execute on function public.is_viewing(uuid) to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. RPCs — start / end / current  (all is_admin()-gated, all logged)
-- ───────────────────────────────────────────────────────────────────────────

-- 3a. Start a view session. Closes any prior open session (one active at a
--     time). Returns target display info for the client banner + context.
create or replace function public.admin_start_view(
  p_account_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_user uuid;
  v_name        text;
  v_type        text;
  v_email       text;
  v_expires     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select a.owner_user_id, a.name, a.type
    into v_target_user, v_name, v_type
  from public.accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  -- One active session at a time: close any still-open ones for this admin.
  update public.admin_view_sessions
     set ended_at = now()
   where admin_user_id = auth.uid()
     and ended_at is null;

  v_expires := now() + interval '30 minutes';

  insert into public.admin_view_sessions
    (admin_user_id, target_account_id, target_user_id, reason, expires_at)
  values
    (auth.uid(), p_account_id, v_target_user, p_reason, v_expires);

  select email into v_email from auth.users where id = v_target_user;

  perform public.admin_log(
    'view_start', 'account', p_account_id::text,
    jsonb_build_object('target_user_id', v_target_user, 'reason', coalesce(p_reason, ''))
  );

  return jsonb_build_object(
    'target_account_id', p_account_id,
    'target_user_id',    v_target_user,
    'target_name',       coalesce(v_name, ''),
    'target_type',       coalesce(v_type, 'personal'),
    'owner_email',       coalesce(v_email, ''),
    'expires_at',        v_expires
  );
end;
$$;

grant execute on function public.admin_start_view(uuid, text) to authenticated;


-- 3b. End the current admin's open view session(s).
create or replace function public.admin_end_view()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if not public.is_admin() then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select target_account_id into v_account
  from public.admin_view_sessions
  where admin_user_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  update public.admin_view_sessions
     set ended_at = now()
   where admin_user_id = auth.uid()
     and ended_at is null;

  if v_account is not null then
    perform public.admin_log('view_end', 'account', v_account::text, '{}'::jsonb);
  end if;
end;
$$;

grant execute on function public.admin_end_view() to authenticated;


-- 3c. Return the active session for the current admin (boot revalidation).
--     Returns NULL when none / expired / not admin.
create or replace function public.admin_current_view()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_admin() then
    return null;
  end if;

  select s.target_account_id, s.target_user_id, s.expires_at,
         a.name as acc_name, a.type as acc_type
    into r
  from public.admin_view_sessions s
  join public.accounts a on a.id = s.target_account_id
  where s.admin_user_id = auth.uid()
    and s.ended_at is null
    and s.expires_at > now()
  order by s.started_at desc
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'target_account_id', r.target_account_id,
    'target_user_id',    r.target_user_id,
    'target_name',       coalesce(r.acc_name, ''),
    'target_type',       coalesce(r.acc_type, 'personal'),
    'expires_at',        r.expires_at
  );
end;
$$;

grant execute on function public.admin_current_view() to authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. SESSION-GATED ADMIN READ POLICIES
--    Additive SELECT policies for user-area tables that currently have NO
--    admin read path. Each grants the admin read access ONLY while a view
--    session for that account is active. Non-admins are unaffected (they can
--    never have a session row, so is_viewing() is always false for them).
-- ───────────────────────────────────────────────────────────────────────────

-- account_id-scoped tables
drop policy if exists "view_select_accidents" on public.accidents;
create policy "view_select_accidents" on public.accidents
  for select to authenticated using (public.is_viewing(account_id));

drop policy if exists "view_select_repair_logs" on public.repair_logs;
create policy "view_select_repair_logs" on public.repair_logs
  for select to authenticated using (public.is_viewing(account_id));

drop policy if exists "view_select_vehicle_expenses" on public.vehicle_expenses;
create policy "view_select_vehicle_expenses" on public.vehicle_expenses
  for select to authenticated using (public.is_viewing(account_id));

drop policy if exists "view_select_routes" on public.routes;
create policy "view_select_routes" on public.routes
  for select to authenticated using (public.is_viewing(account_id));

drop policy if exists "view_select_route_stops" on public.route_stops;
create policy "view_select_route_stops" on public.route_stops
  for select to authenticated using (public.is_viewing(account_id));

drop policy if exists "view_select_stop_documentation" on public.stop_documentation;
create policy "view_select_stop_documentation" on public.stop_documentation
  for select to authenticated using (public.is_viewing(account_id));

drop policy if exists "view_select_driver_assignments" on public.driver_assignments;
create policy "view_select_driver_assignments" on public.driver_assignments
  for select to authenticated using (public.is_viewing(account_id));

-- vehicle_id-scoped child tables (resolve account via the parent vehicle)
drop policy if exists "view_select_cork_notes" on public.cork_notes;
create policy "view_select_cork_notes" on public.cork_notes
  for select to authenticated using (
    vehicle_id in (select v.id from public.vehicles v where public.is_viewing(v.account_id))
  );

drop policy if exists "view_select_vessel_issues" on public.vessel_issues;
create policy "view_select_vessel_issues" on public.vessel_issues
  for select to authenticated using (
    vehicle_id in (select v.id from public.vehicles v where public.is_viewing(v.account_id))
  );


-- ───────────────────────────────────────────────────────────────────────────
-- 5. PATCH my_vehicles_v — make the core vehicle screens follow view-as
-- ───────────────────────────────────────────────────────────────────────────
-- The original view is hard-scoped to auth.uid() (my accounts + shared-with-me)
-- and ignores account_id entirely. Dashboard / Vehicles / VehicleDetail /
-- EditVehicle / AccountSettings all read through it, so without this patch they
-- keep showing the ADMIN's own vehicles even during view-as. We add a third
-- branch that returns the target account's vehicles ONLY while a view session
-- is active. is_viewing() is false for non-admins → regular users unaffected.
--
-- DROP + CREATE (not CREATE OR REPLACE): the live view's frozen column list
-- predates newer `vehicles` columns, so re-expanding v.* shifts column
-- positions and CREATE OR REPLACE fails (42P16). No DB object depends on this
-- view (only the app, via select *), so dropping is safe; the recreated view is
-- a column superset. Wrapped in a transaction — any error rolls back and leaves
-- the original view intact.
begin;
drop view if exists public.my_vehicles_v;
create view public.my_vehicles_v as
  -- Vehicles I own (via my account). share_count = accepted shares on this
  -- vehicle (drives the "שותף עם N" badge — MUST stay, all clients read it).
  select v.*,
         false as is_shared_with_me,
         null::uuid as share_id,
         null::text as share_role,
         null::uuid as share_owner_user_id,
         (select count(*)::int from public.vehicle_shares s
            where s.vehicle_id = v.id and s.status = 'accepted') as share_count
    from public.vehicles v
   where v.account_id in (
     select account_id from public.account_members
      where user_id = auth.uid() and status = 'פעיל'
   )
  union all
  -- Vehicles shared with me (recipients don't see the owner's sharee list → 0)
  select v.*,
         true as is_shared_with_me,
         s.id as share_id,
         s.role as share_role,
         s.owner_user_id as share_owner_user_id,
         0 as share_count
    from public.vehicles v
    join public.vehicle_shares s on s.vehicle_id = v.id
   where s.shared_with_user_id = auth.uid()
     and s.status = 'accepted'
  union all
  -- Admin view-as: the TARGET account's vehicles, only while a session is active
  select v.*,
         false as is_shared_with_me,
         null::uuid as share_id,
         null::text as share_role,
         null::uuid as share_owner_user_id,
         (select count(*)::int from public.vehicle_shares s
            where s.vehicle_id = v.id and s.status = 'accepted') as share_count
    from public.vehicles v
   where public.is_viewing(v.account_id);
grant select on public.my_vehicles_v to authenticated;
commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST (run manually as the admin user, replace <ACCOUNT_UUID>):
--   select public.admin_start_view('<ACCOUNT_UUID>', 'smoke test');
--   select public.is_viewing('<ACCOUNT_UUID>');             -- expect true
--   select count(*) from public.accidents
--     where account_id = '<ACCOUNT_UUID>';                  -- expect rows
--   select public.admin_end_view();
--   select public.is_viewing('<ACCOUNT_UUID>');             -- expect false
--   select count(*) from public.accidents
--     where account_id = '<ACCOUNT_UUID>';                  -- expect 0
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PHASE 1A-H (NEXT — required before GO; not in this file):
--   1. Migrate AdminDashboard cross-account aggregations (AdminDashboard.jsx
--      :427-432, :1399-1402) to admin SECURITY DEFINER RPCs.
--   2. Replace the UNCONDITIONAL admin_select_all_* policies
--      (supabase-admin-rls-bypass.sql) on accounts/vehicles/documents/
--      maintenance_logs/account_members with is_viewing()-gated versions, so
--      ALL row-level customer reads become session-gated.
--   3. Add a session-gated Storage read policy (verify bucket name(s) + path
--      layout first) so photos/documents render during view-as.
-- ───────────────────────────────────────────────────────────────────────────
