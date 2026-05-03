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
 * MIME types we are willing to display from a `data:` URL inline.
 * MUST be a strict subset of ALLOWED_DOC_MIME_TYPES (no SVG / no HTML —
 * those can carry executable script and would break the noopener guarantee).
 */
const ALLOWED_DATA_URL_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf',
]);

/** Matches the prefix of a base64 data URL: `data:<mime>;base64,...` */
const DATA_URL_PREFIX_RE = /^data:([\w./+-]+);base64,/i;

/**
 * Returns true only if the URL is one of:
 * 1. https:// hosted on a trusted domain (Supabase, S3, GCS, etc.)
 * 2. data:<mime>;base64,... where <mime> is whitelisted (image/* + PDF)
 *
 * The data: branch exists because legacy documents (pre-Storage migration)
 * are persisted in the DB as base64 data URLs. They are safe to open as a
 * Blob in a new tab — the contents never reached an external origin and
 * the MIME whitelist excludes script-bearing types like SVG/HTML/JS.
 */
export function isSafeFileUrl(url) {
  if (!url || typeof url !== 'string') return false;

  const dataMatch = DATA_URL_PREFIX_RE.exec(url);
  if (dataMatch) {
    return ALLOWED_DATA_URL_MIMES.has(dataMatch[1].toLowerCase());
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return TRUSTED_FILE_DOMAINS.some((domain) => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * Convert a `data:<mime>;base64,<payload>` URL to a Blob URL the browser
 * is willing to open in a new tab. Modern browsers (Chrome 60+, Firefox 59+)
 * block top-level navigation to `data:` URLs as an anti-phishing measure,
 * which is exactly the failure mode behind the "כתובת לא מאובטחת" toast.
 *
 * The Blob URL is short-lived; we revoke it after 60 seconds, which is more
 * than enough for the new tab to load and decode the file.
 */
function openDataUrlAsBlob(url) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return false;
  const [, mime, b64] = match;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    const win = window.open(blobUrl, '_blank', 'noopener,noreferrer');
    // 60s gives the new tab time to load + render before we revoke.
    // Using a fixed timeout (instead of waiting for win.onload) avoids
    // cross-origin handle access issues with noopener-opened windows.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return !!win;
  } catch (err) {
    console.warn('[security] Failed to convert data URL to Blob:', err);
    return false;
  }
}

/**
 * Open a file URL safely.
 * - Validates origin / data-URL MIME before opening
 * - Uses noopener,noreferrer to prevent reverse tabnabbing
 * - Converts whitelisted data: URLs to Blob URLs (modern browsers refuse
 *   top-level navigation to data: URLs since 2017)
 * - Returns false if URL is not trusted, or if a popup blocker prevented
 *   window.open() (caller can show a fallback toast)
 */
export function openFileUrlSafely(url) {
  if (!isSafeFileUrl(url)) {
    console.warn('[security] Blocked attempt to open untrusted URL:', url);
    return false;
  }
  if (typeof url === 'string' && url.startsWith('data:')) {
    return openDataUrlAsBlob(url);
  }
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return !!win;
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
