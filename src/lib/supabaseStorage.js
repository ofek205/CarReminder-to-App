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
/**
 * Compute the path a file WILL occupy, without uploading it.
 *
 * Exported for the offline upload queue (dal/uploadQueue.js). The path is
 * generated entirely client-side from a v4 uuid, so it can be decided while
 * offline and is collision-free. That is what lets a row be created offline
 * carrying its real, permanent `storage_path`: the file is uploaded to exactly
 * that path when connectivity returns, so the row never needs a placeholder
 * value or a second write to correct it.
 */
export function buildStoragePath(pathPrefix, fileName) {
  if (!pathPrefix) throw new Error('buildStoragePath: missing pathPrefix');
  return `${pathPrefix}/${uuid()}-${safeName(fileName || 'upload.bin')}`;
}

export async function uploadToBucket(file, pathPrefix) {
  if (!file) throw new Error('uploadToBucket: missing file');
  if (!pathPrefix) throw new Error('uploadToBucket: missing pathPrefix');
  return uploadToPath(file, buildStoragePath(pathPrefix, file.name));
}

/**
 * Upload a file to an EXPLICIT path that was decided earlier.
 *
 * Same body as the original uploadToBucket, with the path passed in rather than
 * generated, so a queued offline upload lands where its row already points.
 */
export async function uploadToPath(file, storage_path, { sign = true } = {}) {
  if (!file) throw new Error('uploadToPath: missing file');
  if (!storage_path) throw new Error('uploadToPath: missing storage_path');

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  // A QUEUED upload passes sign:false, and that is not just an optimisation.
  // The signing-failure branch below DELETES the uploaded file, on the
  // reasoning that the caller never received the storage_path so the object
  // would be an untrackable orphan. For a queued upload that reasoning is
  // inverted: the row already points at this exact path, so removing the file
  // would destroy a successful upload the database still references. The URL is
  // re-signed on read anyway (useSignedUrl / refreshSignedUrl), so there is
  // nothing to gain by signing here.
  if (!sign) return { file_url: null, storage_path };

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
