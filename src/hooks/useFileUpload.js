/**
 * useFileUpload — single hook every screen uses to upload a file to
 * Supabase Storage. Replaces the legacy "FileReader → readAsDataURL →
 * save base64 in DB" pattern that was inherited from Base44.
 *
 * Why a hook (and not a plain helper)?
 *   - Screens need React state for the spinner / disabled button / error
 *     toast. Centralizing it here lets every screen render the same UX
 *     without 30 lines of useState boilerplate.
 *   - Lets us evolve the upload flow (chunked uploads, retries, EXIF
 *     scrubbing) without touching every call site.
 *
 * Usage:
 *
 *   const { upload, uploading, error, progress, reset } = useFileUpload({
 *     accountId,
 *     vehicleId,        // optional — falls back to scans/{accountId} bucket prefix
 *     mode: 'doc',      // 'doc' (image+pdf) or 'photo' (image-only)
 *     maxMB: 10,
 *   });
 *
 *   const handleSelect = async (e) => {
 *     const file = e.target.files?.[0];
 *     if (!file) return;
 *     try {
 *       const { fileUrl, storagePath } = await upload(file);
 *       // Save BOTH in the DB row:
 *       //   *_url          = fileUrl       (signed URL, valid 7 days)
 *       //   *_storage_path = storagePath   (used to refresh the URL later)
 *       await db.documents.create({ ..., file_url: fileUrl, storage_path: storagePath });
 *     } catch (err) {
 *       // error already mirrored in `error` state for inline display.
 *       toast.error(err.message);
 *     }
 *   };
 *
 * Notes:
 *   - Compresses images via compressImage() before upload (PDFs untouched).
 *   - Validates MIME + extension + size up front so the user gets a
 *     fast "wrong type" message instead of a slow upload-then-fail.
 *   - Returns the signed URL alongside the storage path. Persist BOTH:
 *     storing only the path forces every read to round-trip a sign call,
 *     which is wasteful when the signed URL is good for 7 days.
 */
import { useCallback, useState } from 'react';
import { uploadToBucket } from '@/lib/supabaseStorage';
import { compressImage } from '@/lib/imageCompress';
import { validateUploadFile } from '@/lib/securityUtils';

export default function useFileUpload({
  accountId,
  vehicleId,
  // subPath: optional folder name appended after accountId when there's
  // no vehicleId. Use for non-vehicle assets that still belong to the
  // account, e.g. external-driver license photos:
  //   useFileUpload({ accountId, subPath: 'drivers' })
  //   → path becomes `{accountId}/drivers/{uuid}-{file}`
  // The Storage RLS policy only checks the FIRST folder against the
  // user's account_members list, so anything after that is free.
  subPath,
  // userId: required for the orphan/scan path (when neither vehicleId
  // nor subPath is set). The bucket policy only accepts `scans/{user_id}`
  // for that branch — passing only accountId lands at `scans/{accountId}`
  // which the policy rejects. Real fix: callsites that legitimately
  // need pre-vehicle uploads should pass userId so we hit the policy
  // correctly.
  userId,
  mode = 'doc',
  maxMB = 10,
} = {}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setError(null);
    setProgress(0);
    setUploading(false);
  }, []);

  const upload = useCallback(async (file) => {
    setError(null);
    setProgress(0);

    // Fast-fail on validation BEFORE compressing — compressImage on a
    // 50 MB camera dump can take seconds, and a wrong file extension
    // shouldn't make the user wait.
    const v = validateUploadFile(file, mode, maxMB);
    if (!v.ok) {
      setError(v.error);
      throw new Error(v.error);
    }

    setUploading(true);
    try {
      // Pick a path prefix that matches the existing scheme used by
      // uploadVehicleFile / uploadScanFile, so RLS rules already in
      // place (account-id-scoped folders) keep working unchanged.
      let pathPrefix;
      if (accountId && vehicleId) {
        pathPrefix = `${accountId}/${vehicleId}`;
      } else if (accountId && subPath) {
        pathPrefix = `${accountId}/${subPath}`;
      } else if (userId) {
        // scans/{userId} is the policy-approved path for orphan
        // uploads (e.g. AddVehicle's photo before the vehicle row exists).
        pathPrefix = `scans/${userId}`;
      } else if (accountId) {
        // Legacy fallback — passes RLS only if the user is a member
        // of `accountId` AND the policy's account_members branch matches
        // `(foldername)[1]` against accountId. Kept for callsites still
        // wired this way; new callsites should pass either subPath or
        // userId for predictable behavior.
        pathPrefix = `${accountId}/uploads`;
      } else {
        throw new Error('useFileUpload: missing accountId or userId');
      }

      // Compress images before upload. PDFs and other docs pass through
      // unchanged because compressImage is a no-op for non-images.
      const fileForUpload = file.type?.startsWith('image/')
        ? await compressImage(file)
        : file;

      // No native upload-progress events on the JS Storage client today,
      // so we synthesize a coarse 0 → 50 → 100 hint for the UI. Replace
      // with the real progress stream once @supabase/storage-js exposes it.
      setProgress(50);
      const { file_url, storage_path } = await uploadToBucket(fileForUpload, pathPrefix);
      setProgress(100);

      return { fileUrl: file_url, storagePath: storage_path };
    } catch (err) {
      const msg = err?.message || 'שגיאה בהעלאת הקובץ';
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [accountId, vehicleId, subPath, userId, mode, maxMB]);

  return { upload, uploading, progress, error, reset };
}
