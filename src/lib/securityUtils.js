/**
 * securityUtils.js
 * Centralized security helpers. URL validation, input sanitization.
 * Import from here to keep security logic DRY and testable.
 */

/**
 * Trusted domains for document/file URLs.
 * Only URLs from these domains are allowed to be opened.
 */
const TRUSTED_FILE_DOMAINS = [
  'supabase.co',          // Supabase Storage signed URLs
  'supabase.in',          // Supabase EU region
  'amazonaws.com',
  'cloudfront.net',
  'storage.googleapis.com',
  'blob.core.windows.net',
  'base44.com',           // legacy — pre-migration attachments may still use these
];

/**
 * Returns true only if the URL is:
 * 1. A valid URL
 * 2. Uses HTTPS
 * 3. Hosted on a trusted domain
 */
export function isSafeFileUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return TRUSTED_FILE_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * Open a file URL safely.
 * - Validates domain before opening
 * - Uses noopener,noreferrer to prevent reverse tabnapping
 * - Returns false if URL is not trusted
 */
export function openFileUrlSafely(url) {
  if (!isSafeFileUrl(url)) {
    console.warn('[security] Blocked attempt to open untrusted URL:', url);
    return false;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

//  File upload validation 

/** Allowed MIME types for document/attachment uploads */
export const ALLOWED_DOC_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
];

/** Allowed MIME types for vehicle photo uploads (images only) */
export const ALLOWED_PHOTO_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
];

/** Allowed file extensions (lowercase, with dot) */
const ALLOWED_DOC_EXTENSIONS   = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];
const ALLOWED_PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

/**
 * Validate a File object before uploading.
 * Checks MIME type, file extension, and size.
 *
 * @param {File}     file         - The File object to validate
 * @param {'doc'|'photo'} mode    - 'doc' allows PDF+images; 'photo' allows images only
 * @param {number}   maxMB        - Maximum file size in MB (default: 10)
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateUploadFile(file, mode = 'doc', maxMB = 10) {
  if (!file) return { ok: false, error: 'לא נבחר קובץ' };

  const allowedMime = mode === 'photo' ? ALLOWED_PHOTO_MIME_TYPES : ALLOWED_DOC_MIME_TYPES;
  const allowedExt  = mode === 'photo' ? ALLOWED_PHOTO_EXTENSIONS : ALLOWED_DOC_EXTENSIONS;

  // Check MIME type
  if (!allowedMime.includes(file.type)) {
    const label = mode === 'photo' ? 'JPG, PNG, WEBP' : 'JPG, PNG, PDF, WEBP';
    return { ok: false, error: `ניתן להעלות רק ${label}` };
  }

  // Check file extension (secondary check. prevents extension spoofing)
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowedExt.includes(ext)) {
    return { ok: false, error: 'סיומת הקובץ אינה מותרת' };
  }

  // Check size
  if (file.size > maxMB * 1024 * 1024) {
    return { ok: false, error: `הקובץ גדול מ-${maxMB}MB` };
  }

  return { ok: true };
}

/**
 * Sanitize a license plate string for lookup.
 * Allows only alphanumeric characters and dashes.
 * Strips anything else to prevent injection.
 */
export function sanitizePlateInput(plate) {
  if (typeof plate !== 'string') return '';
  return plate.replace(/[^א-תa-zA-Z0-9\-]/g, '').slice(0, 12).trim();
}

/**
 * Sanitize a single string field from API/external data.
 * Strips HTML tags and truncates to a safe length.
 */
export function sanitizeString(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  // Strip basic HTML tags to prevent XSS if value is ever rendered as HTML
  return value.replace(/<[^>]*>/g, '').slice(0, maxLength);
}

/**
 * Sanitize a date string. only allow ISO date format YYYY-MM-DD.
 */
export function sanitizeDateString(value) {
  if (typeof value !== 'string') return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

/**
 * Sanitize a numeric value within allowed bounds.
 */
export function sanitizeNumber(value, min = 0, max = 9_999_999) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(Math.max(n, min), max);
}
