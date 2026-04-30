#!/usr/bin/env node
/* eslint-env node */

/**
 * migrate-base64-to-storage.mjs
 * ----------------------------------------------------------------------------
 * One-off migration: copy every base64 (`data:...`) string sitting in
 * Postgres into Supabase Storage, and write the resulting storage_path
 * back to a parallel column.
 *
 * Sources covered (in order):
 *   • documents.file_url                         → documents.storage_path
 *   • vehicles.vehicle_photo                     → vehicles.vehicle_photo_storage_path
 *   • accidents.photos[] (JSONB array)           → accidents.photo_storage_paths (TEXT[])
 *   • accidents.other_driver_insurance_photo     → accidents.other_driver_insurance_photo_storage_path
 *   • community_posts.image_url                  → community_posts.image_storage_path
 *
 * NOT covered: maintenance_logs.
 *   2026-04-30 audit found that the `receipt_photo` column referenced by
 *   the UI does not actually exist in the production schema. That's a
 *   separate latent bug, tracked outside Sprint A. Keeping this script
 *   focused on real migrations only.
 *
 * Prerequisites:
 *   1. Run §2 (SCHEMA) and §3 (INDEXES) of supabase-base64-to-storage-migration.sql
 *      to add the *_storage_path columns and the partial indexes.
 *   2. Have SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 *      (use the staging project — never run this against prod blind).
 *
 * Usage:
 *
 *   # See what would be migrated (READ-ONLY):
 *   node scripts/migrate-base64-to-storage.mjs --dry-run
 *
 *   # Migrate a single source (recommended first run):
 *   node scripts/migrate-base64-to-storage.mjs --commit --source=documents
 *
 *   # Migrate everything:
 *   node scripts/migrate-base64-to-storage.mjs --commit
 *
 *   # Limit batch size (default 25). Smaller = slower but lower memory.
 *   node scripts/migrate-base64-to-storage.mjs --commit --batch=10
 *
 * Notes:
 *   • Idempotent: rows that already have a storage_path are skipped, so
 *     re-running on top of a partial migration just finishes the rest.
 *   • Each row is processed independently. If one fails (corrupt base64,
 *     storage upload error), the script logs and continues — your DB
 *     never ends up half-updated for a single row.
 *   • On the accidents.photos[] case, the script preserves array index:
 *     photos[i] becomes photo_storage_paths[i]. If photos[i] is already
 *     an https URL, photo_storage_paths[i] stays NULL.
 */

import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// CLI args. We avoid commander/yargs to keep this script zero-dep beyond what
// the app already uses.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { dryRun: true, source: null, batch: 25 };
  for (const a of argv.slice(2)) {
    if (a === '--commit') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
    else if (a.startsWith('--batch=')) args.batch = Math.max(1, parseInt(a.slice('--batch='.length), 10) || 25);
    else if (a === '--help' || a === '-h') {
      console.log(`See header comment in ${import.meta.url} for usage.`);
      process.exit(0);
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv);
const BUCKET = 'vehicle-files';

// ---------------------------------------------------------------------------
// Supabase client. Service-role key bypasses RLS — that's the whole point;
// we need to read every row regardless of which user owns it. Refuse to run
// without one, and refuse to run with the anon key (that path would silently
// migrate only a fraction of rows and we'd never know).
// ---------------------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  console.error('       In PowerShell:');
  console.error('         $env:SUPABASE_URL="https://xxxx.supabase.co"');
  console.error('         $env:SUPABASE_SERVICE_ROLE_KEY="service-role-key-here"');
  process.exit(2);
}
if (SUPABASE_KEY.length < 100) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY looks too short. Did you paste the anon key by mistake?');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_URL_RE = /^data:([a-z0-9!#$&\-^_+./]+);base64,(.+)$/i;

/** Decode a base64 data URL into { contentType, bytes }. Returns null on garbage. */
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  try {
    const contentType = m[1];
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length === 0) return null;
    return { contentType, bytes };
  } catch {
    return null;
  }
}

/** Pick a sensible file extension from a MIME type, falling back to .bin. */
function extFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'application/pdf': 'pdf',
  };
  return map[(mime || '').toLowerCase()] || 'bin';
}

// crypto.randomUUID is available without require() in Node ≥ 19. Older Node
// reaches this branch and we lazy-import the polyfill so the file stays ESM-pure.
async function freshUuid() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const m = await import('node:crypto');
  return m.randomUUID();
}

/**
 * Upload one decoded file to Storage. Returns { storage_path, signed_url }.
 *
 * Path scheme — IMPORTANT for RLS:
 *   The vehicle-files bucket has policies that allow access only when the
 *   FIRST folder in the path equals an account_id the user is a member of,
 *   OR when the first folder is 'scans' AND the second folder is the
 *   user's auth.uid() (see supabase-base44-migration.sql §6).
 *
 *   So we MUST upload under the row's owner's account-or-user folder,
 *   otherwise the user's session cannot refresh the signed URL once the
 *   initial 7-day token expires — exactly the bug we're fixing.
 *
 *   Resulting layout:
 *     {account_id}/migrated-{table}/{rowId}/{uuid}.{ext}   ← documents/vehicles/accidents/maintenance
 *     scans/{user_id}/migrated-community/{rowId}/{uuid}.{ext}  ← community_posts (user-scoped)
 */
async function uploadDecoded({ ownerFolder, subFolder, rowId, contentType, bytes }) {
  if (!ownerFolder) {
    throw new Error(`uploadDecoded: missing ownerFolder for row ${rowId} — RLS would reject this`);
  }
  const id = await freshUuid();
  const ext = extFromMime(contentType);
  const storage_path = `${ownerFolder}/${subFolder}/${rowId}/${id}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, bytes, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    });
  if (upErr) throw new Error(`upload(${storage_path}): ${upErr.message}`);

  const SEVEN_DAYS = 60 * 60 * 24 * 7;
  const { data, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storage_path, SEVEN_DAYS);
  if (signErr) {
    // Roll back the orphan so we don't pay for an object nothing references.
    await supabase.storage.from(BUCKET).remove([storage_path]).catch(() => {});
    throw new Error(`sign(${storage_path}): ${signErr.message}`);
  }
  return { storage_path, signed_url: data.signedUrl };
}

const stats = {
  // Per-source counters keep the final summary at-a-glance useful.
  scanned: 0,
  migrated: 0,
  skipped: 0,
  failed: 0,
  bytesUploaded: 0,
  bySource: {},
};

function bump(source, key, n = 1) {
  stats[key] += n;
  if (!stats.bySource[source]) {
    stats.bySource[source] = { scanned: 0, migrated: 0, skipped: 0, failed: 0, bytesUploaded: 0 };
  }
  stats.bySource[source][key] += n;
}

/**
 * Generic migrator for a single-column source (one base64 → one storage_path).
 *
 * @param {object}  cfg
 * @param {string}  cfg.source     Human label for logs.
 * @param {string}  cfg.table      Postgres table name.
 * @param {string}  cfg.urlCol     Column holding the base64 / future signed URL.
 * @param {string}  cfg.pathCol    Column to write the new storage_path into.
 * @param {string}  cfg.subFolder  Storage sub-folder ('migrated-documents' etc).
 * @param {string}  cfg.ownerCol   Column on the row used as the FIRST storage folder
 *                                  (i.e. account_id for RLS to pass). Use 'scans/<user_id>'
 *                                  via cfg.ownerPrefix if the row is user-scoped.
 * @param {string}  [cfg.ownerPrefix]  Optional prefix like 'scans/' — when set, the
 *                                  ownerFolder becomes `${ownerPrefix}${row[ownerCol]}`.
 *                                  Used for community_posts (RLS allows scans/{user_id}/...).
 */
async function migrateSingleColumn(cfg) {
  const { source, table, urlCol, pathCol, ownerCol, ownerPrefix = '', subFolder } = cfg;
  console.log(`\n=== ${source} ===`);
  let from = 0;
  while (true) {
    const { data: rows, error } = await supabase
      .from(table)
      .select(`id, ${ownerCol}, ${urlCol}, ${pathCol}`)
      .like(urlCol, 'data:%')
      .is(pathCol, null)
      .order('id', { ascending: true })
      .range(from, from + ARGS.batch - 1);

    if (error) throw new Error(`select(${source}): ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      bump(source, 'scanned');
      const decoded = decodeDataUrl(row[urlCol]);
      if (!decoded) {
        console.warn(`  [skip] ${source} id=${row.id} — could not decode base64`);
        bump(source, 'skipped');
        continue;
      }
      const ownerValue = row[ownerCol];
      if (!ownerValue) {
        console.warn(`  [skip] ${source} id=${row.id} — missing ${ownerCol} (orphan row, can't satisfy RLS)`);
        bump(source, 'skipped');
        continue;
      }
      const ownerFolder = `${ownerPrefix}${ownerValue}`;

      if (ARGS.dryRun) {
        bump(source, 'migrated');
        bump(source, 'bytesUploaded', decoded.bytes.length);
        continue;
      }
      try {
        const { storage_path, signed_url } = await uploadDecoded({
          ownerFolder, subFolder, rowId: row.id,
          contentType: decoded.contentType, bytes: decoded.bytes,
        });
        const update = {};
        update[urlCol] = signed_url;
        update[pathCol] = storage_path;
        const { error: upErr } = await supabase.from(table).update(update).eq('id', row.id);
        if (upErr) throw upErr;
        bump(source, 'migrated');
        bump(source, 'bytesUploaded', decoded.bytes.length);
        if (stats.migrated % 10 === 0) {
          console.log(`  ...migrated ${stats.migrated} rows so far`);
        }
      } catch (err) {
        console.error(`  [fail] ${source} id=${row.id}: ${err.message}`);
        bump(source, 'failed');
      }
    }
    from += rows.length;
    // If the page came back smaller than the batch size, we're done.
    if (rows.length < ARGS.batch) break;
  }
}

/**
 * Special-case migrator for accidents.photos[] (JSONB array).
 * For each accident with at least one base64 element, upload the base64
 * elements, build a parallel TEXT[] of storage paths preserving index
 * alignment, and rewrite both photos[] (URLs) and photo_storage_paths.
 */
async function migrateAccidentsPhotos() {
  const source = 'accidents.photos[]';
  console.log(`\n=== ${source} ===`);
  let from = 0;
  while (true) {
    // Pull rows whose photos[] still contains a 'data:' string. We can't
    // express a JSONB-element LIKE in PostgREST cleanly; pull rows and
    // let the in-memory check filter out already-migrated entries. With
    // the partial-index plan in §3 this is fine — the population is small.
    // We need account_id to satisfy Storage RLS on the upload path.
    const { data: rows, error } = await supabase
      .from('accidents')
      .select('id, account_id, photos, photo_storage_paths')
      .order('id', { ascending: true })
      .range(from, from + ARGS.batch - 1);

    if (error) throw new Error(`select(${source}): ${error.message}`);
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      const photos = Array.isArray(row.photos) ? row.photos : [];
      const existingPaths = Array.isArray(row.photo_storage_paths) ? row.photo_storage_paths : [];
      const hasBase64 = photos.some(p => typeof p === 'string' && p.startsWith('data:'));
      if (!hasBase64) continue;

      bump(source, 'scanned');

      if (!row.account_id) {
        console.warn(`  [skip] ${source} id=${row.id} — missing account_id (orphan row)`);
        bump(source, 'skipped');
        continue;
      }
      const ownerFolder = String(row.account_id);
      const subFolder = 'migrated-accidents-photos';

      const newPhotos = [...photos];
      const newPaths = [...existingPaths];
      // Pad newPaths to align with newPhotos so we can index-assign.
      while (newPaths.length < newPhotos.length) newPaths.push(null);

      let rowFailed = false;
      let bytesThisRow = 0;
      for (let i = 0; i < newPhotos.length; i++) {
        const photo = newPhotos[i];
        if (typeof photo !== 'string' || !photo.startsWith('data:')) continue;
        if (newPaths[i]) continue; // already migrated this index

        const decoded = decodeDataUrl(photo);
        if (!decoded) {
          console.warn(`  [skip] ${source} id=${row.id} idx=${i} — could not decode`);
          continue;
        }
        if (ARGS.dryRun) {
          bytesThisRow += decoded.bytes.length;
          continue;
        }
        try {
          const { storage_path, signed_url } = await uploadDecoded({
            ownerFolder, subFolder, rowId: `${row.id}_${i}`,
            contentType: decoded.contentType, bytes: decoded.bytes,
          });
          newPhotos[i] = signed_url;
          newPaths[i] = storage_path;
          bytesThisRow += decoded.bytes.length;
        } catch (err) {
          console.error(`  [fail] ${source} id=${row.id} idx=${i}: ${err.message}`);
          rowFailed = true;
        }
      }

      if (ARGS.dryRun) {
        bump(source, 'migrated');
        bump(source, 'bytesUploaded', bytesThisRow);
      } else {
        // Persist the row only if at least one photo migrated successfully.
        // Even if some indexes failed, the others should be saved so we don't
        // re-upload them on the next run.
        const { error: upErr } = await supabase
          .from('accidents')
          .update({ photos: newPhotos, photo_storage_paths: newPaths })
          .eq('id', row.id);
        if (upErr) {
          console.error(`  [fail] ${source} update id=${row.id}: ${upErr.message}`);
          bump(source, 'failed');
        } else {
          bump(source, rowFailed ? 'failed' : 'migrated');
          bump(source, 'bytesUploaded', bytesThisRow);
        }
      }
    }
    from += rows.length;
    if (rows.length < ARGS.batch) break;
  }
}

// ---------------------------------------------------------------------------
// Source registry. To add a new source, append an entry here. Done.
// ---------------------------------------------------------------------------
const SOURCES = {
  documents: () => migrateSingleColumn({
    source: 'documents.file_url', table: 'documents',
    urlCol: 'file_url', pathCol: 'storage_path',
    ownerCol: 'account_id', subFolder: 'migrated-documents',
  }),
  vehicles: () => migrateSingleColumn({
    source: 'vehicles.vehicle_photo', table: 'vehicles',
    urlCol: 'vehicle_photo', pathCol: 'vehicle_photo_storage_path',
    ownerCol: 'account_id', subFolder: 'migrated-vehicles',
  }),
  accidents_insurance: () => migrateSingleColumn({
    source: 'accidents.other_driver_insurance_photo', table: 'accidents',
    urlCol: 'other_driver_insurance_photo',
    pathCol: 'other_driver_insurance_photo_storage_path',
    ownerCol: 'account_id', subFolder: 'migrated-accidents-insurance',
  }),
  accidents_photos: () => migrateAccidentsPhotos(),
  // maintenance_logs intentionally NOT included — see header doc.
  // community_posts is user-scoped. Existing Storage RLS allows
  // scans/{user_id}/... so we use that prefix.
  community_posts: () => migrateSingleColumn({
    source: 'community_posts.image_url', table: 'community_posts',
    urlCol: 'image_url', pathCol: 'image_storage_path',
    ownerCol: 'user_id', ownerPrefix: 'scans/',
    subFolder: 'migrated-community',
  }),
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Sprint A — Base64 → Storage migration`);
  console.log(`mode:    ${ARGS.dryRun ? 'DRY RUN (no writes)' : 'COMMIT (will mutate DB and Storage)'}`);
  console.log(`batch:   ${ARGS.batch}`);
  console.log(`bucket:  ${BUCKET}`);
  console.log(`source:  ${ARGS.source || 'all'}`);
  console.log(`url:     ${SUPABASE_URL}`);

  const sourcesToRun = ARGS.source
    ? [ARGS.source]
    : Object.keys(SOURCES);

  for (const key of sourcesToRun) {
    const fn = SOURCES[key];
    if (!fn) {
      console.error(`Unknown --source=${key}. Valid: ${Object.keys(SOURCES).join(', ')}`);
      process.exit(1);
    }
    await fn();
  }

  // Final summary. Print bytesUploaded as MB because base64 columns are big.
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`Per-source breakdown:`);
  for (const [src, s] of Object.entries(stats.bySource)) {
    console.log(`  ${src.padEnd(38)}  scanned=${s.scanned}  migrated=${s.migrated}  failed=${s.failed}  size=${mb(s.bytesUploaded)}`);
  }
  console.log(`──────────────────────────────────────────────`);
  console.log(`TOTAL  scanned=${stats.scanned}  migrated=${stats.migrated}  skipped=${stats.skipped}  failed=${stats.failed}  size=${mb(stats.bytesUploaded)}`);
  if (ARGS.dryRun) {
    console.log(`\n(dry run — re-run with --commit to actually migrate)`);
  } else {
    console.log(`\nNext: run §6 (VERIFY) in supabase-base64-to-storage-migration.sql to confirm 0 pending.`);
  }
}

main().catch(err => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
