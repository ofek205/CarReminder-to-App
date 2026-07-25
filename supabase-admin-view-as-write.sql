-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-admin-view-as-write.sql — Phase 2: session-gated WRITE for view-as
--
-- Lets an admin ADD / EDIT the TARGET account's vehicles + documents through
-- the normal user screens while a view session is active. The real edit
-- screens already point at the target account (accountId override), so this is
-- purely a DB grant — no client changes needed for basic add/edit.
--
-- SECURITY (aligned with the security review — least-privilege, time-boxed):
--   * ADDITIVE permissive policies — RLS policies are OR'd, so these do NOT
--     modify or weaken any existing policy; they only ADD an admin write path.
--   * Gated on public.is_viewing(account_id): write is allowed ONLY while an
--     active, unexpired, audited view session for THAT account exists.
--   * is_viewing() is false for non-admins (only admins can open a session via
--     the is_admin()-gated RPCs) → ZERO impact on regular users.
--   * Destructive / ownership operations (delete account, transfer ownership,
--     member management, vehicle delete via delete_vehicle_with_share_choice)
--     run through their own ownership-checked RPCs which still reject the admin
--     (not a member) — so this grant does NOT enable them.
--
-- DEPENDS ON: public.is_viewing(uuid) from supabase-admin-view-as.sql.
-- Run ONCE in Supabase SQL Editor. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── VEHICLES ────────────────────────────────────────────────────────────────
drop policy if exists "view_write_vehicles_insert" on public.vehicles;
create policy "view_write_vehicles_insert" on public.vehicles
  for insert to authenticated
  with check (public.is_viewing(account_id));

drop policy if exists "view_write_vehicles_update" on public.vehicles;
create policy "view_write_vehicles_update" on public.vehicles
  for update to authenticated
  using (public.is_viewing(account_id))
  with check (public.is_viewing(account_id));

drop policy if exists "view_write_vehicles_delete" on public.vehicles;
create policy "view_write_vehicles_delete" on public.vehicles
  for delete to authenticated
  using (public.is_viewing(account_id));


-- ── DOCUMENTS ───────────────────────────────────────────────────────────────
drop policy if exists "view_write_documents_insert" on public.documents;
create policy "view_write_documents_insert" on public.documents
  for insert to authenticated
  with check (public.is_viewing(account_id));

drop policy if exists "view_write_documents_update" on public.documents;
create policy "view_write_documents_update" on public.documents
  for update to authenticated
  using (public.is_viewing(account_id))
  with check (public.is_viewing(account_id));

drop policy if exists "view_write_documents_delete" on public.documents;
create policy "view_write_documents_delete" on public.documents
  for delete to authenticated
  using (public.is_viewing(account_id));


-- ── MAINTENANCE_LOGS (written directly to the table by MaintenanceSection,
--    not via an RPC — so an additive table policy is enough). Scoped through
--    the parent vehicle's account. ───────────────────────────────────────────
drop policy if exists "view_write_maintenance_insert" on public.maintenance_logs;
create policy "view_write_maintenance_insert" on public.maintenance_logs
  for insert to authenticated
  with check (vehicle_id in (select v.id from public.vehicles v where public.is_viewing(v.account_id)));

drop policy if exists "view_write_maintenance_update" on public.maintenance_logs;
create policy "view_write_maintenance_update" on public.maintenance_logs
  for update to authenticated
  using (vehicle_id in (select v.id from public.vehicles v where public.is_viewing(v.account_id)));

drop policy if exists "view_write_maintenance_delete" on public.maintenance_logs;
create policy "view_write_maintenance_delete" on public.maintenance_logs
  for delete to authenticated
  using (vehicle_id in (select v.id from public.vehicles v where public.is_viewing(v.account_id)));


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TEST (transactional — rolls back, no side effects). Replace the UUID
-- with a real account that has vehicles; run as-is:
--
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub',(select id from auth.users
--       where lower(email)='ofek205@gmail.com'))::text, true);
--   select public.admin_start_view('<ACCOUNT_UUID>','write test');
--   -- should succeed (insert a throwaway vehicle into the target account):
--   insert into public.vehicles (account_id, nickname)
--     values ('<ACCOUNT_UUID>', '__viewas_write_test__');
--   rollback;
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- NOT in this file (deferred — write paths that go through RPCs, not direct
-- table writes, so they need their own is_viewing handling):
--   * maintenance_logs / repair_logs / vehicle_expenses (save_repair_with_children,
--     add_vehicle_expense RPCs check membership → reject admin in view-as)
--   * Storage WRITE (photo / document upload) — needs a bucket policy; verify
--     bucket name(s) + path layout first.
--   * delete_vehicle_with_share_choice (ownership-checked RPC) — vehicle delete
--     from the detail screen still routes through it; use the admin drawer's
--     admin_delete_vehicle for now.
-- ───────────────────────────────────────────────────────────────────────────
