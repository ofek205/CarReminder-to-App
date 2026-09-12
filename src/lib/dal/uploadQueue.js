/**
 * The entry point a screen uses to attach a file while possibly offline.
 *
 * Design: docs/offline-architecture-spec.md §5.6, with one simplification the
 * spec did not anticipate. It assumed a row would be created with a "pending"
 * storage_path and patched after the upload. That turned out to be unnecessary:
 * `buildStoragePath` generates the path client-side from a v4 uuid, so the FINAL
 * path is knowable while offline. The row is therefore created once, carrying
 * its real permanent path, and the file is later uploaded to exactly that path.
 * No placeholder value, no second write to correct it, and no window in which
 * the row holds a value that means "not really".
 *
 * What a caller gets back is deliberately the same shape whether it went to the
 * network or to the queue: `{ file_url, storage_path }`. A screen that already
 * knows how to put a storage_path on a row needs no offline-specific branch.
 * The only difference is that `file_url` is a local object URL rather than a
 * signed one, so the image renders from the local blob until the real file
 * lands — §5.6's requirement, satisfied by the return value rather than by
 * per-component special cases.
 */
import { onlineManager } from '@tanstack/react-query';
import { buildStoragePath, uploadToBucket } from '@/lib/supabaseStorage';
import { putBlob, localUrlFor, deleteBlob } from './blobStore';
import { enqueue } from './outbox';
import { supabase } from '@/lib/supabase';

async function currentUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Attach a file, online or offline.
 *
 * Online it uploads immediately, which keeps today's behaviour exactly as it is.
 * Offline it stores the blob, queues the upload, and hands back the real path so
 * the row can be written now.
 *
 * Throws if the file cannot be secured either way, because the alternative —
 * returning a path for a file that exists nowhere — would put a permanently
 * broken reference in the database. A refusal the user can retry is better than
 * a row that will never resolve.
 */
export async function attachFile({ file, pathPrefix }) {
  if (!file) throw new Error('attachFile: missing file');
  if (!pathPrefix) throw new Error('attachFile: missing pathPrefix');

  if (onlineManager.isOnline()) {
    return uploadToBucket(file, pathPrefix);
  }

  const userId = await currentUserId();
  if (!userId) {
    // No attributable session: the blob would be unowned, and the drain filters
    // by owner, so it could never be uploaded. Refuse rather than store it.
    throw new Error('attachFile: no session — cannot queue an upload offline');
  }

  const storagePath = buildStoragePath(pathPrefix, file.name);
  const stored = await putBlob(storagePath, file, userId);
  if (!stored) {
    // Too large, quota reached, or IndexedDB unavailable. blobStore refuses
    // rather than evicting, so an earlier pending photo is not sacrificed for
    // this one.
    throw new Error('attachFile: could not store the file for later upload');
  }

  const opId = await enqueue({
    command: 'storage.upload',
    payload: { storagePath },
    userId,
    table: 'storage',
  });
  if (!opId) {
    // The queue rejected it, so nothing would ever upload this blob. Drop it
    // instead of leaving an orphan occupying the quota forever.
    await deleteBlob(storagePath);
    throw new Error('attachFile: could not queue the upload');
  }

  return {
    file_url: await localUrlFor(storagePath),
    storage_path: storagePath,
    _pendingUpload: true,
  };
}
