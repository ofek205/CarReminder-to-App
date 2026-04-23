-- ═══════════════════════════════════════════════════════════════════════════
-- Admin Popups — V1 MVP
--
-- Data model for the "ניהול פופ-אפים" admin tab. Allows non-engineer
-- admins to create, target, and measure Engagement/Marketing popups.
-- System-critical popups (WelcomePopup, MileageReminderPopup, etc) stay
-- in code; they're not managed here.
--
-- Three tables:
--   admin_popups          — the popup definition (config via jsonb)
--   admin_popup_versions  — audit log for rollback (every update snapshots)
--   admin_popup_events    — impressions / dismissals / clicks (analytics)
--
-- RLS:
--   - authenticated users can SELECT active, currently-in-window popups
--     (so the runtime engine can fetch them)
--   - only admins can INSERT / UPDATE / DELETE (via is_current_user_admin)
--   - events are insertable by any authenticated user (own record only)
--     and readable by admins
--
-- Run ONCE in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Main popup definition ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_popups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  category        text NOT NULL CHECK (category IN ('engagement', 'marketing', 'campaign', 'announcement')),
  status          text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'archived')) DEFAULT 'draft',
  description     text,
  -- Content blob: { title, body, primary_cta:{label,action,target}, secondary_cta, icon }
  content         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Design blob: { theme: 'info'|'success'|'warning'|'promo'|'brand', size: 'center'|'bottom-sheet'|'top-banner'|'corner-toast' }
  design          jsonb NOT NULL DEFAULT '{"theme":"brand","size":"center"}'::jsonb,
  -- Trigger blob: { kind: 'on_login'|'on_page_view'|'after_delay'|'manual', path?, delay_seconds? }
  trigger         jsonb NOT NULL DEFAULT '{"kind":"on_login"}'::jsonb,
  -- Conditions blob: { segment:'all'|'car'|'motorcycle'|..., has_vehicle, user_type }
  conditions      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Frequency blob: { kind:'once'|'every_session'|'custom', every_days, max_impressions }
  frequency       jsonb NOT NULL DEFAULT '{"kind":"once"}'::jsonb,
  priority        integer NOT NULL DEFAULT 100,
  starts_at       timestamptz,
  ends_at         timestamptz,
  -- System popups are shown in the admin list as read-only (owned by product code).
  -- Kept false for v1 — no rows should have it true until we migrate the code-owned popups.
  is_system       boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast filter for the runtime engine's "fetch active" query.
CREATE INDEX IF NOT EXISTS admin_popups_active_idx
  ON admin_popups (status, priority DESC, starts_at, ends_at)
  WHERE status = 'active';

-- Update updated_at automatically on row change.
CREATE OR REPLACE FUNCTION admin_popups_touch() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_popups_touch_trg ON admin_popups;
CREATE TRIGGER admin_popups_touch_trg
  BEFORE UPDATE ON admin_popups
  FOR EACH ROW EXECUTE FUNCTION admin_popups_touch();

-- ── Version snapshots (audit / rollback) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_popup_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  popup_id    uuid NOT NULL REFERENCES admin_popups(id) ON DELETE CASCADE,
  snapshot    jsonb NOT NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_popup_versions_popup_idx
  ON admin_popup_versions (popup_id, created_at DESC);

-- Automatically capture a snapshot on every UPDATE so rollback is possible
-- without adding code to the client. Cheap insurance against bad edits.
CREATE OR REPLACE FUNCTION admin_popups_snapshot() RETURNS trigger AS $$
BEGIN
  INSERT INTO admin_popup_versions (popup_id, snapshot, created_by)
  VALUES (
    OLD.id,
    jsonb_build_object(
      'name', OLD.name, 'category', OLD.category, 'status', OLD.status,
      'description', OLD.description, 'content', OLD.content,
      'design', OLD.design, 'trigger', OLD.trigger, 'conditions', OLD.conditions,
      'frequency', OLD.frequency, 'priority', OLD.priority,
      'starts_at', OLD.starts_at, 'ends_at', OLD.ends_at
    ),
    auth.uid()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS admin_popups_snapshot_trg ON admin_popups;
CREATE TRIGGER admin_popups_snapshot_trg
  BEFORE UPDATE ON admin_popups
  FOR EACH ROW EXECUTE FUNCTION admin_popups_snapshot();

-- ── Analytics events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_popup_events (
  id          bigserial PRIMARY KEY,
  popup_id    uuid NOT NULL REFERENCES admin_popups(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('shown', 'dismissed', 'clicked')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_popup_events_popup_idx
  ON admin_popup_events (popup_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_popup_events_recent_idx
  ON admin_popup_events (created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE admin_popups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_popup_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_popup_events   ENABLE ROW LEVEL SECURITY;

-- Runtime: any authenticated user can READ active popups so the engine
-- can evaluate them client-side. All server-side state is public by design
-- (title, body, conditions) — nothing sensitive here.
CREATE POLICY "popups_public_read_active" ON admin_popups
  FOR SELECT TO authenticated
  USING (status = 'active');

-- Admins: full access.
CREATE POLICY "popups_admin_full" ON admin_popups
  FOR ALL TO authenticated
  USING (is_current_user_admin())
  WITH CHECK (is_current_user_admin());

-- Version history: admins only.
CREATE POLICY "popup_versions_admin_read" ON admin_popup_versions
  FOR SELECT TO authenticated USING (is_current_user_admin());
CREATE POLICY "popup_versions_admin_write" ON admin_popup_versions
  FOR INSERT TO authenticated WITH CHECK (is_current_user_admin());

-- Events: anyone authenticated can insert (the runtime engine records
-- impressions). Admins read the whole log; users cannot read it (privacy).
CREATE POLICY "popup_events_insert_own" ON admin_popup_events
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "popup_events_admin_read" ON admin_popup_events
  FOR SELECT TO authenticated USING (is_current_user_admin());

-- ── Helper: 7-day stats per popup (used by the admin list) ─────────────────
CREATE OR REPLACE FUNCTION admin_popup_stats_7d()
RETURNS TABLE (popup_id uuid, shown integer, dismissed integer, clicked integer)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    e.popup_id,
    COUNT(*) FILTER (WHERE e.kind = 'shown')::integer     AS shown,
    COUNT(*) FILTER (WHERE e.kind = 'dismissed')::integer AS dismissed,
    COUNT(*) FILTER (WHERE e.kind = 'clicked')::integer   AS clicked
  FROM admin_popup_events e
  WHERE e.created_at > now() - interval '7 days'
  GROUP BY e.popup_id;
$$;

GRANT EXECUTE ON FUNCTION admin_popup_stats_7d() TO authenticated;
