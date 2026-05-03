/**
 * dbGuards — runtime assertions that block patterns we know are bugs.
 *
 * Today this module exists for one reason: to scream loudly at the
 * developer the moment someone tries to write a base64 `data:` URL
 * into a column that is supposed to hold a Storage URL or path.
 *
 * Why a runtime guard when we also have ESLint rules?
 *   - ESLint catches the obvious shape (`readAsDataURL` calls).
 *   - But base64 strings sneak in through other paths: a copy-pasted
 *     <img src="data:..."> from the AI assistant, an OCR scanner that
 *     returns `data:` URLs, an upload helper imported from an old
 *     branch. By the time we notice, the DB already has 50 MB rows
 *     that crash the share dialog. This guard fires *at the call site*
 *     in development and logs to monitoring in production, so the
 *     regression never lands silently.
 *
 * Use these in any service-layer "save" function that touches a column
 * known to hold a URL or storage path. Cheap to call (one regex check),
 * no perf concern.
 */

// Anything longer than this is almost certainly an inlined file, not a
// legit short data URL like `data:text/plain;base64,YQ==`. We still
// allow tiny data URLs because some libraries use them for transparent
// 1×1 spacers, favicons, etc.
const MAX_LEGIT_DATA_URL_LEN = 1024; // 1 KB

const DATA_URL_RE = /^data:[a-z0-9!#$&\-^_+./]+;base64,/i;

/**
 * Throw (in dev) / warn (in prod) if `value` looks like an oversized
 * base64 data URL being written into the DB.
 *
 * @param {unknown} value      The string about to be persisted.
 * @param {string}  fieldName  Human-readable label for the error message.
 * @param {object}  [opts]
 * @param {boolean} [opts.allowSmall=true]  Tiny data URLs (favicons etc) pass.
 */
export function assertNotBase64(value, fieldName, opts = {}) {
  const { allowSmall = true } = opts;

  if (typeof value !== 'string') return;
  if (!DATA_URL_RE.test(value)) return;
  if (allowSmall && value.length <= MAX_LEGIT_DATA_URL_LEN) return;

  const sizeKb = Math.round(value.length / 1024);
  const msg =
    `[dbGuards] Refusing to write a base64 data: URL into "${fieldName}" ` +
    `(${sizeKb} KB). Upload via useFileUpload() and store the storage_path + signed URL instead. ` +
    `See supabase-base64-to-storage-migration.sql for context.`;

  // In dev — fail hard so the bug is impossible to miss.
  // In prod — log to console.error so it shows up in Sentry/LogRocket
  // without taking down the user's flow. We deliberately do NOT throw
  // in production because a thrown exception during a save would lose
  // the user's data; better to record the legacy row than lose it.
  if (import.meta?.env?.DEV) {
    throw new Error(msg);
  }
  // eslint-disable-next-line no-console
  console.error(msg);
}

/**
 * Convenience: walk an object and assert every named field is not a
 * base64 data URL. Useful right before a `db.X.create(payload)` call.
 *
 *   assertObjectNotBase64(payload, ['file_url', 'image_url', 'photo_url']);
 */
export function assertObjectNotBase64(obj, fieldNames) {
  if (!obj || typeof obj !== 'object') return;
  for (const f of fieldNames) {
    assertNotBase64(obj[f], f);
  }
}
