-- ============================================================================
-- Sprint A — Base64-to-Storage Migration (DDL + audit + verification)
-- ============================================================================
--
-- This file is the DB side of the migration. The runtime code (`useFileUpload`
-- hook, `resolveFileUrl` helper) is shipped separately and will use the new
-- `*_storage_path` columns. The Node migration script
-- (scripts/migrate-base64-to-storage.mjs) reads the old base64 column,
-- uploads to Storage, then writes both columns.
--
-- Run order (each section is safe alone):
--   §1  AUDIT          — read-only "how big is the problem". RUN FIRST.
--   §2  SCHEMA         — adds *_storage_path columns. Idempotent.
--   §3  INDEXES        — supports the migration script's WHERE clauses.
--   §4  RLS            — confirms new columns inherit existing policies.
--   §5  GUARDS         — runtime CHECK to forbid NEW base64 inserts (LATER).
--   §6  VERIFY         — run AFTER the migration script to confirm clean.
--   §7  CLEANUP        — null-out base64 columns AFTER prod soak (LATER).
--
-- All sections are idempotent: safe to re-run.
-- All blocks use IF NOT EXISTS / IF EXISTS so partial reruns don't error.
--
-- Deployment plan:
--   staging:  §1 → §2 → §3 → §4 → run migration script → §6
--   prod:     §1 → §2 → §3 → §4 → run migration script → §6
--   later:    §5 (lock new base64 inserts), then §7 (drop old data)
--
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- §1 — AUDIT (READ-ONLY). Run first to know what you're up against.
-- ════════════════════════════════════════════════════════════════════════════
-- These queries do not change anything. They report:
--   • how many rows in each table currently store base64 data
--   • total bytes (compressed in DB) those base64 columns occupy
--   • how many rows already use https:// URLs (no migration needed)
--
-- Treat the bytes columns as approximate — `octet_length` measures the raw
-- string size, but Postgres TOAST can store it more compactly on disk.

-- 1.1 — documents.file_url
SELECT
  'documents.file_url'                                              AS source,
  COUNT(*)                                                          AS total_rows,
  COUNT(*) FILTER (WHERE file_url LIKE 'data:%')                    AS base64_rows,
  COUNT(*) FILTER (WHERE file_url LIKE 'https://%')                 AS https_rows,
  COUNT(*) FILTER (WHERE file_url IS NULL OR file_url = '')         AS empty_rows,
  pg_size_pretty(COALESCE(SUM(octet_length(file_url))
                          FILTER (WHERE file_url LIKE 'data:%'), 0))AS base64_bytes
FROM public.documents;

-- 1.2 — vehicles.vehicle_photo
SELECT
  'vehicles.vehicle_photo'                                                   AS source,
  COUNT(*)                                                                   AS total_rows,
  COUNT(*) FILTER (WHERE vehicle_photo LIKE 'data:%')                        AS base64_rows,
  COUNT(*) FILTER (WHERE vehicle_photo LIKE 'https://%')                     AS https_rows,
  COUNT(*) FILTER (WHERE vehicle_photo IS NULL OR vehicle_photo = '')        AS empty_rows,
  pg_size_pretty(COALESCE(SUM(octet_length(vehicle_photo))
                          FILTER (WHERE vehicle_photo LIKE 'data:%'), 0))    AS base64_bytes
FROM public.vehicles;

-- 1.3 — accidents.photos (JSONB array). Counts every base64 entry inside the
-- arrays, not rows. A single accident with 5 photos contributes 5.
WITH expanded AS (
  SELECT a.id, jsonb_array_elements_text(a.photos) AS photo
  FROM public.accidents a
  WHERE jsonb_typeof(a.photos) = 'array'
)
SELECT
  'accidents.photos[]'                                       AS source,
  COUNT(*)                                                   AS total_photos,
  COUNT(*) FILTER (WHERE photo LIKE 'data:%')                AS base64_photos,
  COUNT(*) FILTER (WHERE photo LIKE 'https://%')             AS https_photos,
  pg_size_pretty(COALESCE(SUM(octet_length(photo))
                          FILTER (WHERE photo LIKE 'data:%'), 0)) AS base64_bytes
FROM expanded;

-- 1.4 — accidents.other_driver_insurance_photo
SELECT
  'accidents.other_driver_insurance_photo'                                                  AS source,
  COUNT(*)                                                                                  AS total_rows,
  COUNT(*) FILTER (WHERE other_driver_insurance_photo LIKE 'data:%')                        AS base64_rows,
  COUNT(*) FILTER (WHERE other_driver_insurance_photo LIKE 'https://%')                     AS https_rows,
  pg_size_pretty(COALESCE(SUM(octet_length(other_driver_insurance_photo))
                          FILTER (WHERE other_driver_insurance_photo LIKE 'data:%'), 0))    AS base64_bytes
FROM public.accidents;

-- 1.5 — maintenance_logs.receipt_photo
SELECT
  'maintenance_logs.receipt_photo'                                          AS source,
  COUNT(*)                                                                  AS total_rows,
  COUNT(*) FILTER (WHERE receipt_photo LIKE 'data:%')                       AS base64_rows,
  COUNT(*) FILTER (WHERE receipt_photo LIKE 'https://%')                    AS https_rows,
  pg_size_pretty(COALESCE(SUM(octet_length(receipt_photo))
                          FILTER (WHERE receipt_photo LIKE 'data:%'), 0))   AS base64_bytes
FROM public.maintenance_logs;

-- 1.6 — community_posts.image_url
SELECT
  'community_posts.image_url'                                          AS source,
  COUNT(*)                                                             AS total_rows,
  COUNT(*) FILTER (WHERE image_url LIKE 'data:%')                      AS base64_rows,
  COUNT(*) FILTER (WHERE image_url LIKE 'https://%')                   AS https_rows,
  pg_size_pretty(COALESCE(SUM(octet_length(image_url))
                          FILTER (WHERE image_url LIKE 'data:%'), 0))  AS base64_bytes
FROM public.community_posts;

-- 1.7 — Total table sizes. Useful to gauge "how much will the DB shrink?"
SELECT
  schemaname,
  relname               AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid))       AS data_size,
  pg_size_pretty(pg_indexes_size(relid))        AS index_size,
  n_live_tup            AS approx_rows
FROM pg_stat_user_tables
WHERE relname IN ('documents', 'vehicles', 'accidents', 'maintenance_logs', 'community_posts')
ORDER BY pg_total_relation_size(relid) DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- §2 — SCHEMA. Add the new *_storage_path columns. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
-- One column per existing base64 field. They are nullable on purpose:
-- legacy rows stay valid (storage_path NULL → reader falls back to the
-- old base64 column via resolveFileUrl()). Once §7 wipes the old columns
-- the path becomes the single source of truth.
--
-- The accidents.photos[] array gets a parallel TEXT[] for paths. The
-- migration script preserves index alignment: photos[i] corresponds to
-- photo_storage_paths[i].

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_photo_storage_path TEXT;

ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS photo_storage_paths TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS other_driver_insurance_photo_storage_path TEXT;

ALTER TABLE public.maintenance_logs
  ADD COLUMN IF NOT EXISTS receipt_photo_storage_path TEXT;

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

-- Comments so future developers (and DataGrip/pgAdmin column tooltips) know
-- what these are for. PG stores them in pg_description.
COMMENT ON COLUMN public.documents.storage_path                                      IS 'Sprint A: path inside the vehicle-files Storage bucket. Replaces base64 in file_url. NULL for legacy rows.';
COMMENT ON COLUMN public.vehicles.vehicle_photo_storage_path                         IS 'Sprint A: path inside the vehicle-files Storage bucket. Replaces base64 in vehicle_photo.';
COMMENT ON COLUMN public.accidents.photo_storage_paths                               IS 'Sprint A: storage paths matched by index to the photos[] array.';
COMMENT ON COLUMN public.accidents.other_driver_insurance_photo_storage_path         IS 'Sprint A: path inside the vehicle-files Storage bucket.';
COMMENT ON COLUMN public.maintenance_logs.receipt_photo_storage_path                 IS 'Sprint A: path inside the vehicle-files Storage bucket.';
COMMENT ON COLUMN public.community_posts.image_storage_path                          IS 'Sprint A: path inside the vehicle-files Storage bucket.';


-- ════════════════════════════════════════════════════════════════════════════
-- §3 — INDEXES (partial, tiny). Speed up the migration script's "find rows
--      that still need to be migrated" query.
-- ════════════════════════════════════════════════════════════════════════════
-- These indexes only catch base64 rows. Once migration finishes they're
-- empty and consume ~zero space. We drop them in §7 to keep the schema clean.
-- All use IF NOT EXISTS — safe to re-run.

CREATE INDEX IF NOT EXISTS documents_base64_pending_idx
  ON public.documents (id)
  WHERE file_url LIKE 'data:%' AND storage_path IS NULL;

CREATE INDEX IF NOT EXISTS vehicles_base64_pending_idx
  ON public.vehicles (id)
  WHERE vehicle_photo LIKE 'data:%' AND vehicle_photo_storage_path IS NULL;

CREATE INDEX IF NOT EXISTS accidents_base64_insurance_pending_idx
  ON public.accidents (id)
  WHERE other_driver_insurance_photo LIKE 'data:%'
    AND other_driver_insurance_photo_storage_path IS NULL;

-- accidents.photos[] doesn't get a partial index — it's a JSONB array and
-- needs a row-by-row scan during migration. The migration script paginates.

CREATE INDEX IF NOT EXISTS maintenance_logs_base64_pending_idx
  ON public.maintenance_logs (id)
  WHERE receipt_photo LIKE 'data:%' AND receipt_photo_storage_path IS NULL;

CREATE INDEX IF NOT EXISTS community_posts_base64_pending_idx
  ON public.community_posts (id)
  WHERE image_url LIKE 'data:%' AND image_storage_path IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- §4 — RLS sanity check. Confirm the new columns inherit table-level policies.
-- ════════════════════════════════════════════════════════════════════════════
-- New columns added to an existing RLS-enabled table inherit the table's
-- policies automatically — Postgres has no per-column RLS for these tables
-- in our codebase. Run this query after §2 to confirm RLS is still ON.

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename) AS policy_count
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN ('documents', 'vehicles', 'accidents', 'maintenance_logs', 'community_posts')
ORDER BY tablename;

-- Expected: rowsecurity = true and policy_count >= 1 for every row.


-- ════════════════════════════════════════════════════════════════════════════
-- §5 — GUARDS (DO NOT RUN YET — only after §7).
-- ════════════════════════════════════════════════════════════════════════════
-- After the code migration is fully shipped AND §7 has wiped the legacy
-- base64 columns, we add CHECK constraints that REJECT any future write
-- of a base64 string into these columns. This catches:
--   • a buggy new code path that bypasses the upload helper
--   • a hand-rolled INSERT in an SQL console
--
-- DO NOT enable these constraints while legacy base64 data still exists —
-- the constraint check runs on every existing row and the migration will
-- fail mid-flight.
--
-- Block guarded out by `-- COMMENTED:` so a copy-paste accidental run
-- can't fire it. Uncomment when you're ready.
--
-- COMMENTED:
-- ALTER TABLE public.documents
--   ADD CONSTRAINT documents_file_url_not_base64
--   CHECK (file_url IS NULL OR file_url NOT LIKE 'data:%');
--
-- COMMENTED:
-- ALTER TABLE public.vehicles
--   ADD CONSTRAINT vehicles_vehicle_photo_not_base64
--   CHECK (vehicle_photo IS NULL OR vehicle_photo NOT LIKE 'data:%');
--
-- COMMENTED:
-- ALTER TABLE public.accidents
--   ADD CONSTRAINT accidents_insurance_photo_not_base64
--   CHECK (other_driver_insurance_photo IS NULL OR other_driver_insurance_photo NOT LIKE 'data:%');
--
-- COMMENTED:
-- ALTER TABLE public.maintenance_logs
--   ADD CONSTRAINT maintenance_logs_receipt_photo_not_base64
--   CHECK (receipt_photo IS NULL OR receipt_photo NOT LIKE 'data:%');
--
-- COMMENTED:
-- ALTER TABLE public.community_posts
--   ADD CONSTRAINT community_posts_image_url_not_base64
--   CHECK (image_url IS NULL OR image_url NOT LIKE 'data:%');
--
-- accidents.photos[] is a JSONB. The constraint expression is uglier:
-- COMMENTED:
-- ALTER TABLE public.accidents
--   ADD CONSTRAINT accidents_photos_no_base64
--   CHECK (
--     NOT EXISTS (
--       SELECT 1
--       FROM jsonb_array_elements_text(photos) p(elem)
--       WHERE elem LIKE 'data:%'
--     )
--   );


-- ════════════════════════════════════════════════════════════════════════════
-- §6 — VERIFICATION. Run AFTER the Node migration script.
-- ════════════════════════════════════════════════════════════════════════════
-- Each query should return base64_pending = 0. If any row >0, inspect those
-- IDs manually — usually the file failed validation in the migration script
-- (corrupt base64, unsupported MIME, oversized).

-- 6.1 — documents
SELECT
  COUNT(*) FILTER (WHERE file_url LIKE 'data:%' AND storage_path IS NULL)             AS base64_pending,
  COUNT(*) FILTER (WHERE file_url LIKE 'https://%' AND storage_path IS NOT NULL)      AS migrated,
  COUNT(*) FILTER (WHERE file_url LIKE 'data:%' AND storage_path IS NOT NULL)         AS legacy_kept,
  COUNT(*) FILTER (WHERE file_url IS NULL OR file_url = '')                           AS empty
FROM public.documents;

-- 6.2 — vehicles
SELECT
  COUNT(*) FILTER (WHERE vehicle_photo LIKE 'data:%' AND vehicle_photo_storage_path IS NULL)        AS base64_pending,
  COUNT(*) FILTER (WHERE vehicle_photo LIKE 'https://%' AND vehicle_photo_storage_path IS NOT NULL) AS migrated,
  COUNT(*) FILTER (WHERE vehicle_photo LIKE 'data:%' AND vehicle_photo_storage_path IS NOT NULL)    AS legacy_kept,
  COUNT(*) FILTER (WHERE vehicle_photo IS NULL OR vehicle_photo = '')                               AS empty
FROM public.vehicles;

-- 6.3 — accidents.photos[]. Any element still base64 → pending.
WITH expanded AS (
  SELECT a.id, ord.elem AS photo, ord.idx
  FROM public.accidents a,
       LATERAL jsonb_array_elements_text(a.photos) WITH ORDINALITY AS ord(elem, idx)
  WHERE jsonb_typeof(a.photos) = 'array'
)
SELECT
  COUNT(*) FILTER (WHERE photo LIKE 'data:%')      AS base64_photos_pending,
  COUNT(*) FILTER (WHERE photo LIKE 'https://%')   AS migrated_photos,
  COUNT(DISTINCT id) FILTER (WHERE photo LIKE 'data:%') AS accident_rows_with_pending_photos
FROM expanded;

-- 6.4 — accidents.other_driver_insurance_photo
SELECT
  COUNT(*) FILTER (WHERE other_driver_insurance_photo LIKE 'data:%' AND other_driver_insurance_photo_storage_path IS NULL)        AS base64_pending,
  COUNT(*) FILTER (WHERE other_driver_insurance_photo LIKE 'https://%' AND other_driver_insurance_photo_storage_path IS NOT NULL) AS migrated
FROM public.accidents;

-- 6.5 — maintenance_logs
SELECT
  COUNT(*) FILTER (WHERE receipt_photo LIKE 'data:%' AND receipt_photo_storage_path IS NULL)        AS base64_pending,
  COUNT(*) FILTER (WHERE receipt_photo LIKE 'https://%' AND receipt_photo_storage_path IS NOT NULL) AS migrated
FROM public.maintenance_logs;

-- 6.6 — community_posts
SELECT
  COUNT(*) FILTER (WHERE image_url LIKE 'data:%' AND image_storage_path IS NULL)        AS base64_pending,
  COUNT(*) FILTER (WHERE image_url LIKE 'https://%' AND image_storage_path IS NOT NULL) AS migrated
FROM public.community_posts;

-- 6.7 — DB size delta. Compare to the §1.7 numbers to see how much smaller
-- the data became. The numbers will only meaningfully drop AFTER §7 runs
-- (we don't delete the base64 columns until then).
SELECT
  relname               AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  n_live_tup            AS approx_rows
FROM pg_stat_user_tables
WHERE relname IN ('documents', 'vehicles', 'accidents', 'maintenance_logs', 'community_posts')
ORDER BY pg_total_relation_size(relid) DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- §7 — CLEANUP (DO NOT RUN until prod has soaked for ≥7 days post-migration).
-- ════════════════════════════════════════════════════════════════════════════
-- Once §6 reports base64_pending = 0 for every table AND the new flow has
-- been live in prod for at least a week without rollback, we wipe the legacy
-- base64 columns to actually shrink the DB.
--
-- This is destructive. The base64 data is gone. The Storage objects are
-- the only copy after this. Make sure your Storage retention/backup is set.
--
-- All blocks are wrapped in `-- COMMENTED:` to prevent accidental runs.
-- Uncomment one at a time when ready.

-- 7.1 — Null-out the base64 in documents.file_url. Keep the column itself
-- because new code still writes a signed URL there (alongside storage_path).
-- COMMENTED:
-- UPDATE public.documents
--   SET file_url = NULL
--   WHERE file_url LIKE 'data:%' AND storage_path IS NOT NULL;

-- 7.2 — vehicles
-- COMMENTED:
-- UPDATE public.vehicles
--   SET vehicle_photo = NULL
--   WHERE vehicle_photo LIKE 'data:%' AND vehicle_photo_storage_path IS NOT NULL;

-- 7.3 — accidents.photos[]: rebuild the array, keeping only items that have
-- already been migrated to a Storage path (where photo_storage_paths[i]
-- IS NOT NULL). Anything that didn't migrate is dropped.
-- COMMENTED:
-- UPDATE public.accidents a
-- SET photos = COALESCE((
--     SELECT jsonb_agg(p.url)
--     FROM unnest(a.photo_storage_paths) WITH ORDINALITY AS sp(path, idx)
--     JOIN LATERAL jsonb_array_elements_text(a.photos) WITH ORDINALITY AS pp(url, idx) ON pp.idx = sp.idx
--     WHERE sp.path IS NOT NULL AND pp.url LIKE 'https://%'
--   ), '[]'::jsonb)
-- WHERE jsonb_typeof(photos) = 'array' AND photos::text LIKE '%data:%';

-- 7.4 — accidents.other_driver_insurance_photo
-- COMMENTED:
-- UPDATE public.accidents
--   SET other_driver_insurance_photo = NULL
--   WHERE other_driver_insurance_photo LIKE 'data:%'
--     AND other_driver_insurance_photo_storage_path IS NOT NULL;

-- 7.5 — maintenance_logs
-- COMMENTED:
-- UPDATE public.maintenance_logs
--   SET receipt_photo = NULL
--   WHERE receipt_photo LIKE 'data:%' AND receipt_photo_storage_path IS NOT NULL;

-- 7.6 — community_posts
-- COMMENTED:
-- UPDATE public.community_posts
--   SET image_url = NULL
--   WHERE image_url LIKE 'data:%' AND image_storage_path IS NOT NULL;

-- 7.7 — Drop the partial migration indexes from §3. They're empty now.
-- COMMENTED:
-- DROP INDEX IF EXISTS public.documents_base64_pending_idx;
-- DROP INDEX IF EXISTS public.vehicles_base64_pending_idx;
-- DROP INDEX IF EXISTS public.accidents_base64_insurance_pending_idx;
-- DROP INDEX IF EXISTS public.maintenance_logs_base64_pending_idx;
-- DROP INDEX IF EXISTS public.community_posts_base64_pending_idx;

-- 7.8 — Reclaim disk. PG only releases space to the OS after VACUUM FULL.
-- Locks the table for the duration — schedule during low traffic.
-- COMMENTED:
-- VACUUM FULL ANALYZE public.documents;
-- VACUUM FULL ANALYZE public.vehicles;
-- VACUUM FULL ANALYZE public.accidents;
-- VACUUM FULL ANALYZE public.maintenance_logs;
-- VACUUM FULL ANALYZE public.community_posts;


-- ════════════════════════════════════════════════════════════════════════════
-- §8 — ROLLBACK (only if §2 caused something we didn't expect).
-- ════════════════════════════════════════════════════════════════════════════
-- Drops the new *_storage_path columns. Use only if migration is being
-- abandoned entirely. The runtime code's resolveFileUrl() handles missing
-- storage_path → falls back to base64. So removing the columns is safe
-- AS LONG AS the migration script hasn't run yet (no data depends on them).

-- COMMENTED:
-- ALTER TABLE public.documents          DROP COLUMN IF EXISTS storage_path;
-- ALTER TABLE public.vehicles           DROP COLUMN IF EXISTS vehicle_photo_storage_path;
-- ALTER TABLE public.accidents          DROP COLUMN IF EXISTS photo_storage_paths;
-- ALTER TABLE public.accidents          DROP COLUMN IF EXISTS other_driver_insurance_photo_storage_path;
-- ALTER TABLE public.maintenance_logs   DROP COLUMN IF EXISTS receipt_photo_storage_path;
-- ALTER TABLE public.community_posts    DROP COLUMN IF EXISTS image_storage_path;

-- DROP INDEX IF EXISTS public.documents_base64_pending_idx;
-- DROP INDEX IF EXISTS public.vehicles_base64_pending_idx;
-- DROP INDEX IF EXISTS public.accidents_base64_insurance_pending_idx;
-- DROP INDEX IF EXISTS public.maintenance_logs_base64_pending_idx;
-- DROP INDEX IF EXISTS public.community_posts_base64_pending_idx;
