-- ═══════════════════════════════════════════════════════════════════════════
-- Community Social Interactions: Likes, Reactions, Saved Posts, Comment Likes
-- Run in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- Post likes (one per user per post)
CREATE TABLE IF NOT EXISTS community_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);
ALTER TABLE community_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "likes_read" ON community_likes FOR SELECT USING (true);
CREATE POLICY "likes_write" ON community_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "likes_delete" ON community_likes FOR DELETE USING (auth.uid() = user_id);

-- Emoji reactions (one per user per post, 4 types)
CREATE TABLE IF NOT EXISTS community_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  emoji TEXT NOT NULL CHECK (emoji IN ('👍', '❤️', '🔥', '👀')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);
ALTER TABLE community_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reactions_read" ON community_reactions FOR SELECT USING (true);
CREATE POLICY "reactions_write" ON community_reactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reactions_update" ON community_reactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "reactions_delete" ON community_reactions FOR DELETE USING (auth.uid() = user_id);

-- Saved posts
CREATE TABLE IF NOT EXISTS community_saved (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id UUID REFERENCES community_posts(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, post_id)
);
ALTER TABLE community_saved ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_read_own" ON community_saved FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "saved_write" ON community_saved FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_delete" ON community_saved FOR DELETE USING (auth.uid() = user_id);

-- Comment likes (one per user per comment)
CREATE TABLE IF NOT EXISTS community_comment_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  comment_id UUID REFERENCES community_comments(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, comment_id)
);
ALTER TABLE community_comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comment_likes_read" ON community_comment_likes FOR SELECT USING (true);
CREATE POLICY "comment_likes_write" ON community_comment_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comment_likes_delete" ON community_comment_likes FOR DELETE USING (auth.uid() = user_id);
