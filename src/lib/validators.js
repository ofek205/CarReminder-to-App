/**
 * Shared input validators.
 *
 * Prior to this module the same email regex was hand-rolled in three
 * separate files (AuthPage, Contact, ExternalDriverFormDialog) with a
 * subtle variation between them — one used `[^\s@]` (strict, disallows
 * @ in local-part / domain) and another used `\S` (looser, would accept
 * `a@@b.com`). The stricter form is correct; this module standardizes on it.
 */

// Practical email shape — matches RFC 5321 for the cases users actually
// type. Not a perfect parser (no one's is), but tight enough to reject
// the most common typos like missing `.`, missing `@`, or @@.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_REGEX.test(String(value || '').trim());
}
