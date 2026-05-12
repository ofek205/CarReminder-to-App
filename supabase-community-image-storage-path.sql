-- community_posts — add storage_path column for image uploads
-- ============================================================
-- Pre-production QA finding H1: community_posts.image_url was used
-- to store the base64 data URL of the post's image (1-3 MB per
-- compressed photo). Every Community feed load re-served those
-- blobs in the JSON payload — N posts × ~2 MB egress per visit.
--
-- New posts upload the image to Supabase Storage (vehicle-files
-- bucket, prefix `community/{user_id}/`) and store:
--   • image_url             — a signed URL valid for 7 days
--   • image_storage_path    — the immutable bucket key for refresh
--
-- The signed URL is what <img> renders. When it expires, the
-- existing useSignedUrl hook regenerates from storage_path. Old
-- posts (created before the storage migration) keep the base64
-- inside image_url with image_storage_path = NULL — PostCard
-- detects "url starts with data:" and skips the refresh path.
--
-- Safe migration:
--   • New column nullable, default NULL — existing rows untouched.
--   • Idempotent via IF NOT EXISTS.
--   • No RLS / constraint changes.
-- ============================================================

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS image_storage_path text;

DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'community_posts'
      AND column_name  = 'image_storage_path';
  RAISE NOTICE 'community_posts.image_storage_path present: %', cnt;
END $$;
