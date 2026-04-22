/**
 * safeText — centralised defence against stored XSS in user content.
 *
 * React escapes interpolated text by default, but we have a few places
 * that deliberately render HTML (search highlights, line breaks, etc.).
 * For those, run the string through DOMPurify before interpolating.
 * This module exposes two helpers:
 *
 *   sanitizeHtml(raw)  → a string safe to inject via dangerouslySetInnerHTML
 *   linesWithBreaks(s) → preserves user paragraph breaks without HTML
 *
 * Keep sanitization server-free. DOMPurify runs in the browser against the
 * same DOM that will render the output, which is the best defence against
 * tag-parser mismatches.
 */

import DOMPurify from 'dompurify';

// Tight allow-list. No tags that could execute or navigate, no event
// handlers, no data URLs.
const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'br', 'mark'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS:  ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'svg'],
  FORBID_ATTR:  ['onerror', 'onload', 'onclick', 'onmouseover', 'src', 'href', 'style'],
};

export function sanitizeHtml(raw) {
  if (raw == null) return '';
  try {
    return DOMPurify.sanitize(String(raw), PURIFY_CONFIG);
  } catch {
    // Fall back to text-only if DOMPurify fails for any reason.
    return String(raw).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }
}

/**
 * Preserve user-authored line breaks when rendered via
 * dangerouslySetInnerHTML. Escapes other HTML completely.
 */
export function linesWithBreaks(raw) {
  if (raw == null) return '';
  const escaped = String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped.replace(/\r?\n/g, '<br>');
}
