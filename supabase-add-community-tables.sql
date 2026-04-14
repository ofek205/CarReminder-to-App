-- ═══════════════════════════════════════════════════════════════════════════
-- Community Tables — Posts + Comments + Notifications
-- Run in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS community_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('vehicle', 'vessel')),
  body TEXT NOT NULL,
  image_url TEXT,
  linked_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_posts_domain ON community_posts(domain, created_at DESC);

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "posts_read" ON community_posts FOR SELECT USING (true);
CREATE POLICY "posts_write" ON community_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "posts_delete" ON community_posts FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS community_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON community_comments(post_id, created_at ASC);

ALTER TABLE community_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_read" ON community_comments FOR SELECT USING (true);
-- Allow authenticated users to insert comments (own user_id or AI comments for own posts)
CREATE POLICY "comments_write" ON community_comments FOR INSERT WITH CHECK (
  auth.uid() = user_id
  OR (is_ai = true AND post_id IN (SELECT id FROM community_posts WHERE user_id = auth.uid()))
);
CREATE POLICY "comments_delete" ON community_comments FOR DELETE USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS community_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  commenter_name TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_community_notifs ON community_notifications(user_id, is_read, created_at DESC);

ALTER TABLE community_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifs_read_own" ON community_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifs_write" ON community_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "notifs_update_own" ON community_notifications FOR UPDATE USING (auth.uid() = user_id);
