/**
 * Breadcrumbs — ring buffer of recent user actions, attached to every
 * crash report so the admin can answer: "what was the user doing in
 * the seconds before this error fired?"
 *
 * Stored in sessionStorage so it survives soft React reloads but is
 * cleared on a fresh tab. Capped at MAX entries to bound memory.
 *
 * Categories:
 *   • nav       — route change (auto-recorded by an effect in App.jsx)
 *   • click     — significant user-initiated click (button, tab, card)
 *   • mutation  — write operation start (save, delete, upload, share)
 *   • api       — Supabase RPC / query start (auto from supabaseQuery)
 *   • toast     — user-visible toast that fired (success/error)
 *   • lifecycle — app boot / resume / background events
 *
 * Producers call addBreadcrumb({ kind, label, route, data? }).
 * The crash reporter pulls the current list via getBreadcrumbs() at the
 * moment of the error.
 */

const KEY = 'app_breadcrumbs';
const MAX = 30;

function safeRead() {
  try {
    const raw = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function safeWrite(list) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // sessionStorage might be unavailable (Safari private mode / iframe).
    // Falling back to in-memory is fine — breadcrumbs are best-effort.
  }
}

/**
 * Record a breadcrumb. Keeps the most-recent MAX entries.
 *
 * @param {object} crumb
 * @param {'nav'|'click'|'mutation'|'api'|'toast'|'lifecycle'} crumb.kind
 * @param {string} crumb.label   short text — "click: save vehicle", "nav: /AddVehicle"
 * @param {string} [crumb.route] route at time of the breadcrumb (auto-filled)
 * @param {object} [crumb.data]  small extra context — kept under 500 chars after stringify
 */
export function addBreadcrumb(crumb) {
  if (!crumb || !crumb.kind || !crumb.label) return;
  const entry = {
    kind: crumb.kind,
    label: String(crumb.label).slice(0, 120),
    route: crumb.route || (typeof window !== 'undefined' ? window.location.pathname : null),
    ts: Date.now(),
  };
  if (crumb.data) {
    try {
      const s = JSON.stringify(crumb.data);
      // Cap individual breadcrumb data to keep the total payload manageable
      // — 30 breadcrumbs × 500 chars data = 15KB max, well under any limit.
      entry.data = s.length > 500 ? s.slice(0, 500) + '…' : s;
    } catch {
      entry.data = '[unstringifiable]';
    }
  }

  const list = safeRead();
  list.push(entry);
  while (list.length > MAX) list.shift();
  safeWrite(list);
}

/**
 * Get the current breadcrumb list. Called by the crash reporter at the
 * moment of an error to attach context. Returns a plain array (a copy,
 * so callers can mutate freely without affecting the buffer).
 */
export function getBreadcrumbs() {
  return safeRead();
}

/**
 * Wipe the buffer. Used on explicit logout to prevent the next user
 * from inheriting the previous user's trail.
 */
export function clearBreadcrumbs() {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(KEY);
  } catch {}
}

/**
 * Convenience helpers — wrappers for the common kinds. Use these so the
 * `kind` string is consistent across the codebase (no typos like 'click'
 * vs 'clicked').
 */
export const crumb = {
  nav:       (label, data) => addBreadcrumb({ kind: 'nav',       label, data }),
  click:     (label, data) => addBreadcrumb({ kind: 'click',     label, data }),
  mutation:  (label, data) => addBreadcrumb({ kind: 'mutation',  label, data }),
  api:       (label, data) => addBreadcrumb({ kind: 'api',       label, data }),
  toast:     (label, data) => addBreadcrumb({ kind: 'toast',     label, data }),
  lifecycle: (label, data) => addBreadcrumb({ kind: 'lifecycle', label, data }),
};
