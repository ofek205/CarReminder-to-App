-- Documents — support multiple files per record
-- ============================================================
-- Wave 6 request: a document can be split across up to 5 files
-- (e.g. an insurance policy + receipt + cover letter). The
-- existing `documents.file_url` + `documents.storage_path`
-- continue to hold the PRIMARY file for backward compatibility.
-- Two new JSONB columns hold the additional files:
--
--   extra_file_urls       jsonb DEFAULT '[]'  — array of strings
--   extra_storage_paths   jsonb DEFAULT '[]'  — array of strings
--
-- Same length, same order — `extra_file_urls[i]` corresponds to
-- `extra_storage_paths[i]` for the same uploaded file. The split
-- mirrors the existing primary `file_url` / `storage_path` pair
-- so the client can refresh signed URLs the same way.
--
-- Safe migration:
--   • DEFAULT '[]'::jsonb means every existing row reads as having
--     zero extras after the migration. No backfill needed.
--   • No constraint changes, no triggers, no RLS changes.
--   • Idempotent via IF NOT EXISTS — re-running is a no-op.
--
-- Run order: this SQL must land BEFORE the frontend code that
-- reads/writes these columns. The frontend stays backward
-- compatible (treats missing columns as empty) so a brief
-- between-stages window is harmless.
-- ============================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extra_file_urls     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extra_storage_paths jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Sanity check — log the new column counts (helpful when running
-- in the Supabase SQL editor; the message appears in the result
-- pane).
DO $$
DECLARE
  url_count int;
  path_count int;
BEGIN
  SELECT COUNT(*) INTO url_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'extra_file_urls';
  SELECT COUNT(*) INTO path_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'extra_storage_paths';
  RAISE NOTICE 'documents.extra_file_urls present: %; documents.extra_storage_paths present: %', url_count, path_count;
END $$;
