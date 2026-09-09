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
 * - On Capacitor native, routes through @capacitor/browser
 *   (SafariViewController on iOS, Custom Tabs on Android). The browser
 *   plugin shows the OS-native share / save sheet so the user can
 *   download the file without us implementing a separate native flow.
 *   This is REQUIRED on iOS — WKWebView's `window.open()` returns null
 *   by default (no delegate override in AppDelegate), which surfaced
 *   to users as "לא ניתן לפתוח את הקובץ - כתובת לא מאובטחת" even
 *   though the Supabase signed URL is perfectly valid HTTPS.
 * - On web, opens with `window.open(... noopener,noreferrer)` to
 *   prevent reverse tabnabbing.
 * - Converts whitelisted data: URLs to Blob URLs (modern browsers
 *   refuse top-level navigation to data: URLs since 2017). Web only —
 *   no data: URLs flow through native today.
 *
 * Returns a Promise<boolean>. true = the open call succeeded; false =
 * URL was rejected (untrusted, malformed data:) or the browser blocked
 * the open (popup blocker, native plugin error).
 */
export async function openFileUrlSafely(url, preOpened = null) {
  const discard = () => { try { preOpened?.close(); } catch { /* noop */ } };

  if (!isSafeFileUrl(url)) {
    console.warn('[security] Blocked attempt to open untrusted URL:', url);
    discard();
    return false;
  }
  if (typeof url === 'string' && url.startsWith('data:')) {
    discard();
    return openDataUrlAsBlob(url);
  }
  // Native path — Capacitor Browser plugin. Dynamic import so the
  // web bundle doesn't pay the plugin's parse cost, and so a missing
  // plugin (web only) falls through to window.open cleanly.
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, windowName: '_blank' });
      discard();
      return true;
    }
  } catch (err) {
    console.warn('[security] Capacitor Browser open failed, falling back to window.open:', err);
    // Fall through to the web path. Worst case the user sees the same
    // toast they would have seen before; at best the web fallback
    // happens to work on whichever WebView the platform is using.
  }
  // Prefer a tab reserved during the click. Opening a NEW window this late
  // is blocked by the popup blocker whenever the caller awaited anything
  // (e.g. minting a signed URL) — see reserveFileTab().
  if (preOpened && !preOpened.closed) {
    // Drop the opener before navigating so the file page can't reach back
    // into this tab — the same protection `noopener` gives below.
    try { preOpened.opener = null; } catch { /* best effort */ }
    preOpened.location.replace(url);
    return true;
  }
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  return !!win;
}

/**
 * Reserve a tab for a file whose URL still needs an async lookup.
 *
 * MUST be called SYNCHRONOUSLY inside the click handler. Browsers honour
 * `window.open()` only while the click's transient user activation is alive.
 * After an `await` — e.g. minting a Supabase signed URL — Safari (and Chrome,
 * once its short activation window lapses) treats the call as an unsolicited
 * popup and returns null. That surfaced to users as "לא ניתן לפתוח את הקובץ"
 * even though the URL was a perfectly valid HTTPS signed URL.
 *
 * Hand the returned handle to openFileUrlSafely() as `preOpened` — it will
 * navigate the tab, or close it if the URL turns out to be unusable.
 * Returns null on native (the Capacitor Browser plugin needs no activation)
 * and whenever the browser refuses outright.
 */
export function reserveFileTab() {
  try {
    if (window.Capacitor?.isNativePlatform?.()) return null;
    return window.open('', '_blank');
  } catch {
    return null;
  }
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
 * `accept` value for any upload that takes a document OR a photo.
 *
 * THE ORDER IS LOAD-BEARING ON ANDROID. Do not "tidy" it to put images
 * first. Android WebView builds the chooser intent in
 * FileChooserParams.createIntent() by calling setType() with the FIRST
 * entry of `accept` and nothing else; Capacitor's BridgeWebChromeClient
 * then attaches the remaining entries as EXTRA_MIME_TYPES. Since
 * Android 13, the platform intercepts ACTION_GET_CONTENT whose type is a
 * media type and hands it to the system photo picker, which can only
 * return images and videos. PDFs are then unreachable no matter what
 * EXTRA_MIME_TYPES says.
 *
 * Verified on an API 34 emulator:
 *   type=image/*        -> media.module/...PhotoPickerGetContentActivity
 *   type=application/pdf -> documentsui/...picker.PickActivity
 *
 * DocumentsUI honours EXTRA_MIME_TYPES, so leading with the PDF type
 * still lets the user pick an image; leading with the image type does
 * not let them pick a PDF. Keep a non-media type first.
 */
export const DOC_OR_IMAGE_ACCEPT = 'application/pdf,image/*';

const IMAGE_ACCEPT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp'];

/**
 * Does `accept` ask for anything a photo-gallery picker cannot hand back?
 *
 * Used to decide whether a Capacitor screen may take the native
 * Camera.getPhoto(CameraSource.Photos) shortcut. That returns one image
 * and only an image, so a caller that also wants PDFs must go through a
 * real <input type="file"> instead. Before this existed the native path
 * ignored `accept` outright and quietly served images to callers asking
 * for documents.
 */
/**
 * Read the real mime type out of a base64 data URL.
 *
 * Callers that ship a picked file to the AI proxy need this: the proxy
 * forwards media_type straight through to Gemini as inline_data
 * mime_type, so a guessed value is a wrong value on the wire. The
 * maintenance receipt scan used to guess "png, or else jpeg", which
 * mislabelled every WebP that compressImage produces and would have
 * declared a PDF to be a JPEG.
 *
 * Falls back to image/jpeg on anything unparseable, so a malformed input
 * still sends a type the document allowlist permits rather than nothing.
 */
export function dataUrlMimeType(dataUrl) {
  return dataUrl?.match(/^data:([^;,]+)/)?.[1] || 'image/jpeg';
}

/**
 * Is this file reference a PDF rather than something an <img> can render?
 *
 * Screens hold a receipt or attachment in one of two shapes: a base64 data
 * URL for a file the user just picked, and the stored URL when an existing
 * record is reopened. Both have to be recognised.
 *
 * Phrased as "is it a PDF" rather than "is it an image" on purpose. The
 * document allowlist is images plus PDF and nothing else, so the two are
 * equivalent, but this direction means a stored URL with no recognisable
 * extension keeps rendering as an image the way it does today instead of
 * silently degrading to a file pill.
 */
export function isPdfFileRef(ref) {
  if (!ref) return false;
  return ref.startsWith('data:application/pdf') || /\.pdf(\?|$)/i.test(ref);
}

export function acceptsNonImage(accept) {
  if (!accept) return false;
  return accept
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .some(t => !t.startsWith('image/') && !IMAGE_ACCEPT_EXTENSIONS.includes(t));
}

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
