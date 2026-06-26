/**
 * docHash — a short content fingerprint for the Forms feature's electronic
 * signatures. Hashing the filled document content and stamping the hash next
 * to the signature gives the signature tamper-evidence: if any field changes
 * after signing, the recomputed hash won't match.
 *
 * Uses the Web Crypto SubtleCrypto API (available in all target browsers +
 * the Capacitor WebView). Returns a short uppercased hex prefix that's
 * readable on the printed document.
 */

/** SHA-256 of `str` → full lowercase hex string. */
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A short, human-readable fingerprint (first 16 hex chars, grouped) for
 * printing on the document, e.g. "A1B2-C3D4-E5F6-7890".
 */
export async function shortFingerprint(str) {
  const hex = (await sha256Hex(str)).toUpperCase();
  return hex.slice(0, 16).replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Build the canonical string that gets hashed for a signed document.
 * Stable key order so the same content always yields the same hash.
 */
export function canonicalize(obj) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    return Object.keys(v).sort().reduce((acc, k) => {
      // Don't fold signature image data into the hash — we hash the
      // CONTENT being signed, not the signatures themselves.
      if (k === 'signatures') return acc;
      acc[k] = walk(v[k]);
      return acc;
    }, {});
  };
  return JSON.stringify(walk(obj));
}
