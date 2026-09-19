/**
 * Which Storage objects does a document row own?
 *
 * A document can carry more than one file: the upload dialog writes the first
 * pick to `file_url` + `storage_path` and appends the rest to
 * `extra_file_urls` + `extra_storage_paths` (see
 * supabase-documents-multi-file.sql). Anything that deletes a document has to
 * clean up ALL of them, so the answer lives in one tested place instead of
 * being re-derived, and half-derived, at each call site — the primary path is
 * the obvious one to remember and the extras are the easy ones to forget.
 */

/**
 * Every bucket key the row points at, primary first.
 *
 * Falsy entries are dropped deliberately. Two kinds of row carry none:
 *   • guest documents, which live as base64 in localStorage and never reach
 *     the bucket, and
 *   • rows predating Sprint A.B, which stored base64 in `file_url` with no
 *     `storage_path` beside it.
 * Both write '' into the path fields, and handing '' to Storage is not a
 * harmless no-op — it is a removal request aimed at the bucket root.
 *
 * @param {object|null|undefined} doc  a `documents` row
 * @returns {string[]} storage paths, de-duplicated
 */
export function documentStoragePaths(doc) {
  const extras = Array.isArray(doc?.extra_storage_paths) ? doc.extra_storage_paths : [];
  const paths = [doc?.storage_path, ...extras]
    .filter(p => typeof p === 'string' && p.trim() !== '');
  // De-duplicated so a repeated path is not counted twice when a cleanup
  // failure is reported. Removing the same key twice is harmless in itself.
  return [...new Set(paths)];
}
