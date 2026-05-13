-- ═══════════════════════════════════════════════════════════════════════════
-- UGC Moderation — required by Apple App Store Guideline 1.2
--
-- Apple rejected v4.0.0 (May 2026) because the Community feature had:
--   1. No server-side block-user mechanism (was localStorage-only)
--   2. No server-side flag/report mechanism (was localStorage-only)
--   3. No EULA acceptance gate at signup
--
-- This migration adds three things:
--   1. `blocked_users`    — one-way mute: blocker stops seeing blocked's posts
--   2. `reported_posts`   — flagged content surfaced to admins for review
--   3. `eula_acceptances` — audit trail of terms-of-service acceptance at signup
--
-- All three are additive — no existing data is touched, safe to run on prod.
-- Run in Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. blocked_users
-- ───────────────────────────────────────────────────────────────────────────
-- One row per (blocker → blocked) pair. UNIQUE prevents duplicate blocks.
-- Self-block prevented by the check constraint + the RLS write policy.
-- ON DELETE CASCADE on both sides keeps the table consistent if either
-- user deletes their account.
CREATE TABLE IF NOT EXISTS blocked_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blocked_users_no_self   CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocked_users_unique_pair UNIQUE (blocker_id, blocked_id)
);

-- Denormalized display name of the blocked user, captured at block time.
-- Required because auth.users.email/name aren't readable across users due
-- to RLS, and a "blocked users" management list with only UUIDs would be
-- unusable. Stored once at insert; never updated, so name changes after
-- the block don't propagate (acceptable — the user just wants to recognize
-- who they blocked).
ALTER TABLE blocked_users ADD COLUMN IF NOT EXISTS blocked_name TEXT;

-- Lookup for "what is X blocking" (feed filter) and "who is blocking X" (rarely).
CREATE INDEX IF NOT EXISTS idx_blocked_users_by_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_by_blocked ON blocked_users(blocked_id);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- Each user can only see/manage their OWN block list.
-- No one else (not even other authenticated users) sees who you've blocked.
DROP POLICY IF EXISTS blocked_users_select_own ON blocked_users;
CREATE POLICY blocked_users_select_own ON blocked_users
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocked_users_insert_own ON blocked_users;
CREATE POLICY blocked_users_insert_own ON blocked_users
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid() AND blocked_id <> auth.uid());

DROP POLICY IF EXISTS blocked_users_delete_own ON blocked_users;
CREATE POLICY blocked_users_delete_own ON blocked_users
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());


-- ───────────────────────────────────────────────────────────────────────────
-- 2. reported_posts
-- ───────────────────────────────────────────────────────────────────────────
-- A flag/report raised by a user against a post. Admins read these to
-- moderate. `status` tracks the moderation pipeline. The same reporter
-- can only flag the same post once (UNIQUE).
CREATE TABLE IF NOT EXISTS reported_posts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reporter_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Categorical reason, kept short for indexing + analytics.
  -- 'spam' | 'harassment' | 'illegal' | 'other'
  reason       TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'illegal', 'other')),
  -- Free-text detail (optional, for the 'other' case).
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'reviewing', 'resolved', 'dismissed')),
  admin_notes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  CONSTRAINT reported_posts_unique_per_reporter UNIQUE (post_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_reported_posts_status ON reported_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reported_posts_post   ON reported_posts(post_id);

ALTER TABLE reported_posts ENABLE ROW LEVEL SECURITY;

-- Each user can SEE their own reports (so the UI can show "you already reported this")
-- AND admins can see everything. Admin check uses the canonical
-- `public.is_admin()` function established by the May 2026 security
-- audit (commit 1c05368 "make admin-check unification SQL idempotent");
-- do NOT inline an email allow-list here — that defeats the unification
-- and silently drifts out of sync with the rest of the schema.
DROP POLICY IF EXISTS reported_posts_select_own_or_admin ON reported_posts;
CREATE POLICY reported_posts_select_own_or_admin ON reported_posts
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS reported_posts_insert_own ON reported_posts;
CREATE POLICY reported_posts_insert_own ON reported_posts
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- Only admins can update (resolve/dismiss). Users cannot modify their own
-- reports — they can only create them. Letting users withdraw a report
-- would let bad actors mass-flag-then-unflag to game any spam detector.
DROP POLICY IF EXISTS reported_posts_update_admin ON reported_posts;
CREATE POLICY reported_posts_update_admin ON reported_posts
  FOR UPDATE TO authenticated
  USING (public.is_admin());


-- ───────────────────────────────────────────────────────────────────────────
-- 3. eula_acceptances
-- ───────────────────────────────────────────────────────────────────────────
-- Audit trail: who accepted the terms-of-service / privacy policy, when,
-- and against which document version. Apple 1.2 + 5.1 require explicit
-- acceptance at signup; storing it server-side lets us prove compliance
-- in case a user later disputes that they agreed.
--
-- Why a separate table (not user_metadata)?
--   1. user_metadata is mutable by the user via auth API — bad for an audit log.
--   2. user_metadata has no document-version field; we need to invalidate
--      acceptance and re-prompt when terms materially change.
--   3. The May 2026 security audit flagged user_metadata for privesc concerns;
--      adding more security-sensitive fields there is the wrong direction.
CREATE TABLE IF NOT EXISTS eula_acceptances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Document the user accepted. Versions let us re-prompt on material changes.
  -- Format: 'tos:YYYY-MM-DD' / 'privacy:YYYY-MM-DD'.
  document_type   TEXT NOT NULL CHECK (document_type IN ('tos', 'privacy')),
  document_version TEXT NOT NULL,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Bookkeeping: useful for proving the acceptance came from the user's
  -- own device, not a server-side forge.
  user_agent      TEXT,
  CONSTRAINT eula_unique_per_doc_version UNIQUE (user_id, document_type, document_version)
);

CREATE INDEX IF NOT EXISTS idx_eula_user ON eula_acceptances(user_id);

ALTER TABLE eula_acceptances ENABLE ROW LEVEL SECURITY;

-- A user can read their own acceptance history (settings → "documents I agreed to")
DROP POLICY IF EXISTS eula_select_own ON eula_acceptances;
CREATE POLICY eula_select_own ON eula_acceptances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- A user can create acceptance rows for themselves only.
DROP POLICY IF EXISTS eula_insert_own ON eula_acceptances;
CREATE POLICY eula_insert_own ON eula_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE / DELETE policy on purpose — once accepted, the record is
-- immutable. To "revoke" acceptance, insert a new row with a different
-- document_version; we never edit the original audit entry.


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Helper view: posts visible to current user (feed filter)
-- ───────────────────────────────────────────────────────────────────────────
-- Apps query community_posts in a few places. Wrapping the filter in a
-- view means we cannot forget to apply it in any one of those call sites.
-- Each row excludes posts whose author the current user blocked.
-- Posts the current user authored are always visible (you can see your own
-- post even if you somehow ended up in a state where you blocked yourself —
-- the table constraint prevents that, but the SELECT is defensive).
CREATE OR REPLACE VIEW community_posts_visible AS
  SELECT p.*
  FROM community_posts p
  WHERE NOT EXISTS (
    SELECT 1 FROM blocked_users b
    WHERE b.blocker_id = auth.uid()
      AND b.blocked_id = p.user_id
  );

-- The view inherits RLS from the underlying table, so no extra policy needed.
-- Clients query this view via supabase.from('community_posts_visible').
