-- ═══════════════════════════════════════════════════════════════════════════
-- Admin RLS bypass — lets the AdminDashboard stats tab aggregate across ALL
-- accounts instead of just the admin's own row.
--
-- Problem before: refetchData() in AdminDashboard.jsx uses db.accounts.list()
-- / db.vehicles.list() etc. These are regular PostgREST queries subject to
-- the per-user ownership policies in supabase-rls-policies.sql, so an admin
-- would see only their own data. The users tab worked because it goes through
-- admin_list_accounts() which is SECURITY DEFINER. Stats aggregations are
-- client-side so they need their own admin-scoped SELECT policies.
--
-- is_current_user_admin() must already exist (from supabase-admin-functions.sql).
-- Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE POLICY "admin_select_all_accounts"
  ON accounts FOR SELECT
  TO authenticated
  USING (is_current_user_admin());

CREATE POLICY "admin_select_all_vehicles"
  ON vehicles FOR SELECT
  TO authenticated
  USING (is_current_user_admin());

CREATE POLICY "admin_select_all_maintenance_logs"
  ON maintenance_logs FOR SELECT
  TO authenticated
  USING (is_current_user_admin());

CREATE POLICY "admin_select_all_documents"
  ON documents FOR SELECT
  TO authenticated
  USING (is_current_user_admin());

CREATE POLICY "admin_select_all_account_members"
  ON account_members FOR SELECT
  TO authenticated
  USING (is_current_user_admin());
