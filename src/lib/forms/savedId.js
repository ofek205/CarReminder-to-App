/**
 * savedId — the user's own ת.ז, remembered per-device for form pre-fill.
 *
 * Deliberately localStorage, NOT the database: keeps this PII on the
 * device only (no server column, no migration, works offline). Shared by
 * all Forms templates so the user types their ID once.
 */
const KEY = (uid) => `cr_my_tz:${uid || 'anon'}`;

export function readSavedId(uid) {
  try { return localStorage.getItem(KEY(uid)) || ''; } catch { return ''; }
}

export function writeSavedId(uid, id) {
  try {
    if (id) localStorage.setItem(KEY(uid), id);
    else localStorage.removeItem(KEY(uid));
  } catch { /* quota / private mode — non-fatal */ }
}
