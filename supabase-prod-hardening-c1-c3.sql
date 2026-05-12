-- Pre-Production Hardening — RLS critical fixes (C1, C2, C3)
-- ============================================================
-- Closes three release-blocking findings from the pre-production QA
-- report:
--
--   C1. `invites` allowed ANY anon user to SELECT/UPDATE every row
--       in the system. Tokens could be enumerated and accepted.
--
--   C2. `community_notifications` allowed any authenticated user to
--       INSERT a notification targeting any other user_id. Phishing
--       and spam vector. SELECT/UPDATE were already correctly scoped
--       to auth.uid(), but the INSERT policy was `WITH CHECK (true)`.
--
--   C3. DELETE policies on shared-vehicle tables let any member of
--       the account (drivers / viewers included) delete EVERY row.
--       A malicious driver could destroy a business's whole history.
--       Restricted to בעלים / מנהל.
--
-- ── Run order ──────────────────────────────────────────────
-- This file is idempotent — every CREATE POLICY is preceded by a
-- matching DROP POLICY IF EXISTS, and every helper uses CREATE OR
-- REPLACE. Safe to re-run if the first attempt is interrupted.
--
-- ── Backward compatibility ─────────────────────────────────
-- • JoinInvite still works because supabase.rpc('redeem_invite_token')
--   runs SECURITY DEFINER and bypasses RLS entirely.
-- • AccountSettings list/create invites still work — both call sites
--   pass an account_id the current user owns or manages.
-- • Notification bell SELECT/UPDATE keep working — they're already
--   scoped to user_id = auth.uid() (we just rename the policy).
-- • Community notifications INSERT now requires the inserter to be
--   the author of the source post; the in-app fan-out hooks already
--   only fire for the author's own actions.
-- • DELETE on accidents/maintenance_logs/repair_logs/cork_notes/
--   vessel_issues now requires manager-level membership. Drivers and
--   viewers (שותף) keep SELECT/INSERT/UPDATE on their own entries.
-- ============================================================


-- ── Helper: account_ids where the current user has manager-level
-- privileges (owner OR manager). Mirrors user_account_ids() but
-- adds the role filter. SECURITY DEFINER + STABLE so the planner
-- can cache it across policy checks in the same statement.
CREATE OR REPLACE FUNCTION user_manager_account_ids()
RETURNS UUID[] AS $$
  SELECT COALESCE(
    array_agg(account_id),
    '{}'::UUID[]
  )
  FROM account_members
  WHERE user_id = auth.uid()
    AND status = 'פעיל'
    AND role IN ('בעלים', 'מנהל');
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ════════════════════════════════════════════════════════════
-- C1 — invites: lock to manager-level of the same account
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "invites_select" ON invites;
DROP POLICY IF EXISTS "invites_insert" ON invites;
DROP POLICY IF EXISTS "invites_update" ON invites;
DROP POLICY IF EXISTS "invites_delete" ON invites;

CREATE POLICY "invites_select"
  ON invites FOR SELECT
  USING (account_id = ANY(user_manager_account_ids()));

CREATE POLICY "invites_insert"
  ON invites FOR INSERT
  WITH CHECK (account_id = ANY(user_manager_account_ids()));

-- Updates only via redeem_invite_token RPC (SECURITY DEFINER bypasses
-- this) or by a manager of the account (e.g. revoking an invite).
CREATE POLICY "invites_update"
  ON invites FOR UPDATE
  USING (account_id = ANY(user_manager_account_ids()));

CREATE POLICY "invites_delete"
  ON invites FOR DELETE
  USING (account_id = ANY(user_manager_account_ids()));


-- ════════════════════════════════════════════════════════════
-- C2 — community_notifications: scope INSERT, tighten SELECT/UPDATE
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "notifs_read_own" ON community_notifications;
DROP POLICY IF EXISTS "notifs_write"    ON community_notifications;
DROP POLICY IF EXISTS "notifs_update_own" ON community_notifications;
DROP POLICY IF EXISTS "notifs_select"   ON community_notifications;
DROP POLICY IF EXISTS "notifs_insert"   ON community_notifications;
DROP POLICY IF EXISTS "notifs_update"   ON community_notifications;
DROP POLICY IF EXISTS "notifs_delete"   ON community_notifications;

-- Recipient only.
CREATE POLICY "notifs_select"
  ON community_notifications FOR SELECT
  USING (user_id = auth.uid());

-- Recipient only — used to mark notifications as read.
CREATE POLICY "notifs_update"
  ON community_notifications FOR UPDATE
  USING (user_id = auth.uid());

-- Recipient only — let users dismiss their own notifications.
CREATE POLICY "notifs_delete"
  ON community_notifications FOR DELETE
  USING (user_id = auth.uid());

-- INSERT: closed to the public API. Allowed only when the inserter
-- is the author of the source post (community fan-out from the
-- author's own actions). Direct-from-client inserts targeting
-- arbitrary user_ids are blocked. Server-side workflows that need
-- to notify arbitrary users should use a SECURITY DEFINER RPC,
-- which bypasses RLS.
CREATE POLICY "notifs_insert"
  ON community_notifications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM community_posts p
      WHERE p.id = community_notifications.post_id
        AND p.user_id = auth.uid()
    )
  );


-- ════════════════════════════════════════════════════════════
-- C3 — DELETE restrictions on shared-vehicle tables
-- ════════════════════════════════════════════════════════════
-- accidents — drop the loose ANY(user_account_ids()) DELETE, recreate
-- restricted to manager-level only.
DROP POLICY IF EXISTS "accidents_delete" ON accidents;
CREATE POLICY "accidents_delete"
  ON accidents FOR DELETE
  USING (account_id = ANY(user_manager_account_ids()));

-- maintenance_logs — these are scoped via vehicle ownership, so we
-- join through vehicles. Manager-level on the OWNING account only.
DROP POLICY IF EXISTS "maintenance_logs_delete" ON maintenance_logs;
CREATE POLICY "maintenance_logs_delete"
  ON maintenance_logs FOR DELETE
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles
      WHERE account_id = ANY(user_manager_account_ids())
    )
  );

-- repair_logs — has account_id directly per base44 schema.
DROP POLICY IF EXISTS "repair_logs_delete" ON repair_logs;
CREATE POLICY "repair_logs_delete"
  ON repair_logs FOR DELETE
  USING (account_id = ANY(user_manager_account_ids()));

-- cork_notes — vehicle-scoped, same pattern as maintenance_logs.
DROP POLICY IF EXISTS "cork_notes_delete" ON cork_notes;
CREATE POLICY "cork_notes_delete"
  ON cork_notes FOR DELETE
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles
      WHERE account_id = ANY(user_manager_account_ids())
    )
  );

-- vessel_issues — vehicle-scoped.
DROP POLICY IF EXISTS "vessel_issues_delete" ON vessel_issues;
CREATE POLICY "vessel_issues_delete"
  ON vessel_issues FOR DELETE
  USING (
    vehicle_id IN (
      SELECT id FROM vehicles
      WHERE account_id = ANY(user_manager_account_ids())
    )
  );


-- ════════════════════════════════════════════════════════════
-- Verification
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  helper_ok boolean;
  notif_ok  boolean;
  policy_count int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'user_manager_account_ids'
  ) INTO helper_ok;

  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'community_notifications'
      AND policyname = 'notifs_insert'
  ) INTO notif_ok;

  SELECT COUNT(*) INTO policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('invites','community_notifications',
                       'accidents','maintenance_logs',
                       'repair_logs','cork_notes','vessel_issues');

  RAISE NOTICE 'helper user_manager_account_ids: %', helper_ok;
  RAISE NOTICE 'community_notifications insert policy installed: %', notif_ok;
  RAISE NOTICE 'total policies on hardened tables: %', policy_count;
END $$;
