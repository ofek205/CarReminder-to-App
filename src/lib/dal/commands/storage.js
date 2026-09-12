/**
 * File uploads as a command — the last server interaction that was still
 * outside the seam.
 *
 * Phase 0 routed table CRUD and RPCs through `dal.run`, but storage uploads
 * still called `supabaseStorage` directly from screens. That was fine while
 * uploads were online-only; it stops being fine the moment one has to survive
 * being made offline, because then it needs everything the seam provides:
 * durability, ordered replay, retry classification and a review inbox on
 * terminal failure.
 *
 * The file itself is NOT in the payload. Blobs live in their own IndexedDB
 * store (dal/blobStore.js) keyed by the storage path, and the queue item
 * carries only that path. Two reasons: an outbox item is serialised as JSON on
 * every queue mutation, so a megabyte photo inside it would be rewritten
 * repeatedly, and keeping binary out of the payload keeps the queue readable and
 * cheap to inspect.
 */
import { defineCommand } from '../registry';
import { uploadToPath } from '@/lib/supabaseStorage';
import { getBlob, deleteBlob } from '../blobStore';

/**
 * Upload one pending file to the path its row already references.
 *
 * ONLINE-REQUIRED as a command in its own right: it IS the network operation.
 * It reaches the outbox through the upload queue rather than through the
 * offline guard, which is why `offlineCapable` stays false — running it while
 * offline is meaningless, and the guard refusing it is correct.
 */
defineCommand('storage.upload', {
  offlineCapable: false,
  table: 'storage',
  kind: 'storage',
  run: async ({ storagePath }) => {
    const record = await getBlob(storagePath);
    if (!record?.blob) {
      // The blob is gone but its queue item survived: the store was cleared, or
      // the browser evicted it under quota pressure. Retrying can never
      // succeed, so fail with a code the drain classifies as TERMINAL — the
      // item lands in the review inbox instead of retrying forever against a
      // file that no longer exists.
      const err = new Error(`pending upload blob missing for ${storagePath}`);
      err.code = 'PGRST116';
      throw err;
    }

    // sign:false is deliberate — see the comment in uploadToPath. Signing here
    // would, on failure, DELETE a file the row already points at.
    await uploadToPath(record.blob, storagePath, { sign: false });

    // Only now is it safe to drop the local copy: the bytes are in the bucket
    // at the path the row references. Doing this before the upload confirmed
    // would lose the file if the upload failed.
    await deleteBlob(storagePath);
    return { storage_path: storagePath };
  },
});
