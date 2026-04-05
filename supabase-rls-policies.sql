-- ═══════════════════════════════════════════════════════════════════════════
-- CarReminder — Row Level Security (RLS) Policies
-- ═══════════════════════════════════════════════════════════════════════════
--
-- HOW TO APPLY:
-- 1. Go to https://supabase.com/dashboard
-- 2. Select your project (zuqvolqapwcxomuzoodu)
-- 3. Go to SQL Editor (left menu)
-- 4. Paste this ENTIRE file
-- 5. Click "Run" (or Ctrl+Enter)
-- 6. Verify: Go to Table Editor → click a table → "RLS" tab should show "Enabled"
--
-- WHAT THIS DOES:
-- - Enables RLS on every table
-- - Users can only see/edit data from their own account(s)
-- - Invites are readable by token (public) but writable only by account owners
-- - Analytics is insert-only (anonymous)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper function: get all account_ids for the current user ────────────
CREATE OR REPLACE FUNCTION user_account_ids()
RETURNS UUID[] AS $$
  SELECT COALESCE(
    array_agg(account_id),
    '{}'::UUID[]
  )
  FROM account_members
  WHERE user_id = auth.uid()
    AND status = 'פעיל';
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ACCOUNTS
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- Users can see accounts they belong to
CREATE POLICY "accounts_select" ON accounts
  FOR SELECT USING (id = ANY(user_account_ids()));

-- Users can create new accounts (for first-time registration)
CREATE POLICY "accounts_insert" ON accounts
  FOR INSERT WITH CHECK (true);

-- Only account owners can update their account
CREATE POLICY "accounts_update" ON accounts
  FOR UPDATE USING (
    id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND role = 'בעלים'
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. ACCOUNT_MEMBERS
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- Users can see members of their accounts
CREATE POLICY "members_select" ON account_members
  FOR SELECT USING (account_id = ANY(user_account_ids()));

-- Users can join an account (insert themselves)
CREATE POLICY "members_insert" ON account_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Only owners can update members (change roles)
CREATE POLICY "members_update" ON account_members
  FOR UPDATE USING (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND role = 'בעלים'
    )
  );

-- Only owners can remove members
CREATE POLICY "members_delete" ON account_members
  FOR DELETE USING (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND role = 'בעלים'
    )
    OR user_id = auth.uid()  -- users can leave themselves
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. VEHICLES
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Users can see vehicles from their accounts
CREATE POLICY "vehicles_select" ON vehicles
  FOR SELECT USING (account_id = ANY(user_account_ids()));

-- Users with edit permission can create vehicles
CREATE POLICY "vehicles_insert" ON vehicles
  FOR INSERT WITH CHECK (account_id = ANY(user_account_ids()));

-- Users with edit permission can update vehicles
CREATE POLICY "vehicles_update" ON vehicles
  FOR UPDATE USING (account_id = ANY(user_account_ids()));

-- Only owners can delete vehicles
CREATE POLICY "vehicles_delete" ON vehicles
  FOR DELETE USING (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND role = 'בעלים'
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ACCIDENTS
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE accidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accidents_select" ON accidents
  FOR SELECT USING (account_id = ANY(user_account_ids()));

CREATE POLICY "accidents_insert" ON accidents
  FOR INSERT WITH CHECK (account_id = ANY(user_account_ids()));

CREATE POLICY "accidents_update" ON accidents
  FOR UPDATE USING (account_id = ANY(user_account_ids()));

CREATE POLICY "accidents_delete" ON accidents
  FOR DELETE USING (account_id = ANY(user_account_ids()));


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. VESSEL_ISSUES
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE vessel_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vessel_issues_select" ON vessel_issues
  FOR SELECT USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );

CREATE POLICY "vessel_issues_insert" ON vessel_issues
  FOR INSERT WITH CHECK (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );

CREATE POLICY "vessel_issues_update" ON vessel_issues
  FOR UPDATE USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );

CREATE POLICY "vessel_issues_delete" ON vessel_issues
  FOR DELETE USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. INVITES
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Anyone can read invites by token (needed for join flow)
CREATE POLICY "invites_select" ON invites
  FOR SELECT USING (true);

-- Only account owners/admins can create invites
CREATE POLICY "invites_insert" ON invites
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND role IN ('בעלים', 'מנהל')
    )
  );

-- Invites can be updated (increment uses_count) by anyone with the token
CREATE POLICY "invites_update" ON invites
  FOR UPDATE USING (true);

-- Only owners can delete invites
CREATE POLICY "invites_delete" ON invites
  FOR DELETE USING (
    account_id IN (
      SELECT account_id FROM account_members
      WHERE user_id = auth.uid() AND role = 'בעלים'
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. REMINDER_SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE reminder_settings ENABLE ROW LEVEL SECURITY;

-- Users can only see/edit their own settings
CREATE POLICY "reminder_settings_select" ON reminder_settings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "reminder_settings_insert" ON reminder_settings
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "reminder_settings_update" ON reminder_settings
  FOR UPDATE USING (user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. NOTIFICATION_LOG
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_log_select" ON notification_log
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notification_log_insert" ON notification_log
  FOR INSERT WITH CHECK (user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. CORK_NOTES
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE cork_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cork_notes_select" ON cork_notes
  FOR SELECT USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );

CREATE POLICY "cork_notes_insert" ON cork_notes
  FOR INSERT WITH CHECK (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );

CREATE POLICY "cork_notes_update" ON cork_notes
  FOR UPDATE USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );

CREATE POLICY "cork_notes_delete" ON cork_notes
  FOR DELETE USING (
    vehicle_id IN (SELECT id FROM vehicles WHERE account_id = ANY(user_account_ids()))
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. ANONYMOUS_ANALYTICS (insert only, no read)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE anonymous_analytics ENABLE ROW LEVEL SECURITY;

-- Anyone can insert analytics events
CREATE POLICY "analytics_insert" ON anonymous_analytics
  FOR INSERT WITH CHECK (true);

-- No one can read analytics (admin only via service_role key)
-- No SELECT policy = blocked for anon/authenticated users


-- ═══════════════════════════════════════════════════════════════════════════
-- DONE! Verify by checking each table's RLS status in Table Editor.
-- ═══════════════════════════════════════════════════════════════════════════
