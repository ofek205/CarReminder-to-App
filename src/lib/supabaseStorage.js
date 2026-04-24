/**
 * supabaseStorage — file upload helpers that replace
 * base44.integrations.Core.UploadFile.
 *
 * API is intentionally drop-in compatible: returns { file_url } just like
 * the Base44 version so call sites barely change.
 *
 * Paths inside the "vehicle-files" bucket:
 *   {account_id}/{vehicle_id}/{uuid}-{safeName}   ← repair attachments, docs
 *   scans/{user_id}/{uuid}-{safeName}             ← license/vessel scans
 *
 * All uploads go to a private bucket; we return a signed URL good for
 * 7 days. Long-lived display URLs are regenerated from storage_path on
 * read if they expire (handled by call sites reading via a helper).
 */
import { supabase } from './supabase';

const BUCKET = 'vehicle-files';
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

/** Strip unsafe chars from a file name so it's usable inside a storage path. */
function safeName(name) {
  const base = (name || 'file').toString().normalize('NFKD');
  return base
    .replace(/[^\w.\-]+/g, '_')   // keep ascii word chars, dot, dash
    .replace(/_+/g, '_')
    .slice(-80);                  // cap length
}

/** RFC4122 v4 — no dependency on uuid pkg. */
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Upload a file to a specific path prefix in the vehicle-files bucket
 * and return a signed URL + the raw storage_path for cleanup.
 *
 * @param {File|Blob} file
 * @param {string} pathPrefix  e.g. `${accountId}/${vehicleId}` or `scans/${uid}`
 * @returns {Promise<{ file_url: string, storage_path: string }>}
 */
export async function uploadToBucket(file, pathPrefix) {
  if (!file) throw new Error('uploadToBucket: missing file');
  if (!pathPrefix) throw new Error('uploadToBucket: missing pathPrefix');

  const name = file.name || 'upload.bin';
  const storage_path = `${pathPrefix}/${uuid()}-${safeName(name)}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storage_path, SIGNED_URL_TTL_SEC);
  if (signErr) {
    // Upload succeeded but URL signing failed — the file is in the bucket
    // with nothing pointing at it. Clean up so we don't pay for an orphan
    // the caller can't track (they never received the storage_path).
    await supabase.storage.from(BUCKET).remove([storage_path]).catch(() => {});
    throw new Error(`Signed URL failed: ${signErr.message}`);
  }

  return { file_url: data.signedUrl, storage_path };
}

/**
 * Drop-in replacement for base44.integrations.Core.UploadFile({ file }) when
 * the caller has an active accountId + vehicleId (repair attachments, etc).
 */
export async function uploadVehicleFile({ file, accountId, vehicleId }) {
  if (!accountId || !vehicleId) {
    throw new Error('uploadVehicleFile requires accountId and vehicleId');
  }
  return uploadToBucket(file, `${accountId}/${vehicleId}`);
}

/**
 * Drop-in replacement for UploadFile when the caller is scanning a document
 * *before* a vehicle exists (AddVehicle wizard, driver license scan, vessel
 * scan wizard). Scoped by user_id so RLS lets the owner access it.
 */
export async function uploadScanFile({ file, userId }) {
  if (!userId) throw new Error('uploadScanFile requires userId');
  return uploadToBucket(file, `scans/${userId}`);
}

/** Delete a file by its storage_path. Silent on 404 so repeated deletes are safe. */
export async function deleteFile(storage_path) {
  if (!storage_path) return;
  await supabase.storage.from(BUCKET).remove([storage_path]);
}

/**
 * Refresh an expired signed URL. Call sites that persist file_url in the DB
 * can use this if they ever store it long-term; today most consumers just
 * hit the URL directly within its 7-day window.
 */
export async function refreshSignedUrl(storage_path) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storage_path, SIGNED_URL_TTL_SEC);
  if (error) throw error;
  return data.signedUrl;
}
