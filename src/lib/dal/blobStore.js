/**
 * Durable storage for files waiting to be uploaded.
 *
 * Design: docs/offline-architecture-spec.md §5.6. A photo taken offline has to
 * survive a reload, a crash and an app kill, exactly like the write that
 * references it — a queued row pointing at a file that evaporated is worse than
 * no offline support at all.
 *
 * Keyed by `storage_path`, which is the natural key here: the path is computed
 * client-side before the upload (see buildStoragePath in supabaseStorage.js), so
 * it is already the stable identifier shared by the row, the queue item and the
 * blob. Nothing needs a second id to tie them together.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * It is NOT base64 in a database column. That is the trap `assertNotBase64` and
 * `guardFileFields` (lib/dbGuards.js) exist to prevent, and §5.6 calls out
 * explicitly. Blobs live here, in IndexedDB, as Blobs. The row carries only a
 * `storage_path` string, so every existing guard keeps working untouched and
 * nothing large ever reaches Postgres.
 *
 * Its own IndexedDB database, separate from both the RQ cache (disposable, wiped
 * by `buster` every release) and the outbox (small JSON records). Photos are
 * megabytes; mixing them into a store that is serialised as one JSON blob on
 * every write would be ruinous.
 */
import { createStore, get, set, del, keys, clear } from 'idb-keyval';

const blobStore = createStore('cr-upload-blobs', 'blobs');

// Same WKWebView guard as the other IDB users: a call can hang forever after
// the app is backgrounded mid-transaction, so each one races a timeout that
// RESOLVES rather than rejects. A wedged IndexedDB degrades to "no offline
// upload", never to a stalled screen.
const IDB_TIMEOUT_MS = 5000;   // higher than the cache's 2.5s: blobs are large
function race(promise, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), IDB_TIMEOUT_MS)),
  ]);
}

/**
 * Per-file and total ceilings.
 *
 * Without them a user photographing a whole vehicle inspection offline could
 * fill the origin's storage quota, and the browser's response to that is to
 * start evicting — potentially the very data this feature exists to protect.
 * Refusing the 11th photo honestly is better than losing the first ten.
 */
export const MAX_BLOB_BYTES = 15 * 1024 * 1024;        // one file
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;       // everything pending

/** Bytes currently held. */
export async function totalBytes() {
  const paths = await race(keys(blobStore), []);
  let total = 0;
  for (const path of paths) {
    const rec = await race(get(path, blobStore), null);
    total += rec?.size || 0;
  }
  return total;
}

/**
 * Store a blob against the path it will be uploaded to.
 *
 * Returns false when it was refused (too large, quota reached, or IndexedDB
 * unavailable) so the caller can fall back to refusing the write rather than
 * creating a row that points at a file which does not exist anywhere.
 */
export async function putBlob(storagePath, file, userId) {
  if (!storagePath || !file || !userId) return false;
  const size = file.size || 0;
  if (size > MAX_BLOB_BYTES) return false;
  if ((await totalBytes()) + size > MAX_TOTAL_BYTES) return false;

  const record = {
    // The Blob itself. Structured-clone handles Blob/File natively, so it is
    // stored as binary rather than a string — no base64 inflation, and no
    // conversion cost on read.
    blob: file,
    size,
    type: file.type || 'application/octet-stream',
    name: file.name || 'upload.bin',
    // Stamped for the same reason outbox items are: identity is not knowable
    // synchronously at module load, so scoping by store key is not an option.
    userId,
    createdAt: new Date().toISOString(),
  };
  return race(set(storagePath, record, blobStore).then(() => true), false);
}

/** Retrieve a stored blob record, or null. */
export async function getBlob(storagePath) {
  if (!storagePath) return null;
  return race(get(storagePath, blobStore), null);
}

/** Drop a blob. Called after a CONFIRMED upload, or when its write is cancelled. */
export async function deleteBlob(storagePath) {
  if (!storagePath) return;
  await race(del(storagePath, blobStore), undefined);
}

/** Paths still holding a blob, for one user. */
export async function listBlobPaths(userId) {
  const paths = await race(keys(blobStore), []);
  const mine = [];
  for (const path of paths) {
    const rec = await race(get(path, blobStore), null);
    if (rec?.userId === userId) mine.push(path);
  }
  return mine;
}

/**
 * A URL the UI can render before the upload happens.
 *
 * The caller MUST revoke it (URL.revokeObjectURL) when the element unmounts, or
 * the blob stays pinned in memory for the life of the document.
 */
export async function localUrlFor(storagePath) {
  const rec = await getBlob(storagePath);
  if (!rec?.blob) return null;
  try {
    return URL.createObjectURL(rec.blob);
  } catch {
    return null;
  }
}

/**
 * Wipe every pending blob.
 *
 * Called at identity boundaries alongside the outbox: a photo of someone's
 * vehicle documents is customer data at rest, and leaving it for the next
 * person to sign in on the device is the same leak §6 is about.
 */
export async function clearBlobs() {
  await race(clear(blobStore), undefined);
}
