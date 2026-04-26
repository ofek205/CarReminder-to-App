/**
 * Recent sharees — local cache of emails the current user has shared
 * with before. Lets the share dialog offer one-tap suggestions instead
 * of asking the user to retype an address every time.
 *
 * Why localStorage (not the DB):
 *   The list is personal preference data — privately held, not shared
 *   across devices or with others on the account. Persisting it
 *   server-side would mean a new table + RLS policy for a feature that
 *   gracefully degrades when storage is missing (the dialog still
 *   works, the user just types). localStorage hits the right tradeoff.
 *
 * Keyed per user-id so logging out + back in as a different user
 * doesn't expose someone else's contacts.
 */

const KEY_PREFIX = 'cr_recent_share_emails_v1_';
const MAX_ENTRIES = 8;

function keyFor(userId) {
  return `${KEY_PREFIX}${userId || 'anon'}`;
}

export function getRecentShareEmails(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Newest-first, capped at MAX_ENTRIES.
    return parsed
      .filter(e => e && typeof e.email === 'string')
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
      .slice(0, MAX_ENTRIES);
  } catch { return []; }
}

export function rememberShareEmail(userId, email) {
  if (!userId || !email) return;
  const norm = String(email).trim().toLowerCase();
  if (!norm.includes('@')) return;
  try {
    const existing = getRecentShareEmails(userId);
    // De-dupe: if email already present, drop old entry so the new
    // lastUsedAt wins.
    const filtered = existing.filter(e => e.email !== norm);
    const next = [{ email: norm, lastUsedAt: Date.now() }, ...filtered].slice(0, MAX_ENTRIES);
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch { /* quota / private mode → silently skip */ }
}

export function clearRecentShareEmails(userId) {
  if (!userId) return;
  try { localStorage.removeItem(keyFor(userId)); } catch {}
}
