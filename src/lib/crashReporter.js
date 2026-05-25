/**
 * Crash reporter. fire-and-forget error logging.
 *
 * Errors are written to:
 *   1. localStorage 'app_error_log' (cap 50). used by the Admin Bugs tab
 *   2. Supabase table 'app_errors' (best-effort, silently fails if the
 *      table doesn't exist or RLS blocks). Batched when offline.
 *
 * No third-party SDK (Sentry etc.). keeps the bundle lean and avoids
 * sending data to external services without an explicit contract.
 *
 * To enable remote reporting, run scripts/supabase-add-app-errors.sql.
 */

import { supabase } from './supabase';
import { getBreadcrumbs } from './breadcrumbs';

const LOCAL_KEY = 'app_error_log';
const QUEUE_KEY = 'app_error_queue';
const SESSION_KEY = 'app_error_session_id';
const MAX_LOCAL = 50;
const MAX_QUEUE = 100;
const FLUSH_DEBOUNCE_MS = 2000;

// App version snapshot — embedded by Vite at build time.
// We pin this so the admin can identify "regression in 5.2.6" without
// having to cross-reference timestamps with git history.
const APP_VERSION = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null);

// Cached session id — generated once per tab session (sessionStorage).
// Lets the admin group "all errors from this broken session" together
// in the AdminHealth drill-down.
let cachedSessionId = null;
function getSessionId() {
  if (cachedSessionId) return cachedSessionId;
  try {
    if (typeof sessionStorage === 'undefined') return null;
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      // crypto.randomUUID exists everywhere we run (Capacitor WKWebView /
      // Chromium 92+ / Node 19+). Fallback to a short base36 just in case.
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    cachedSessionId = id;
    return id;
  } catch { return null; }
}

// Known-benign errors that should not be logged to the bugs table.
// Each pattern is a real noise source observed in production telemetry:
//   • Stale chunks: deploy changes chunk hashes; cached HTML tries to
//     fetch the old hash and fails. Auto-reload in main.jsx recovers.
//   • Supabase lock: auth token refresh contention between tabs/requests.
//     The "stolen" request retries internally; session always works.
//   • WebKit messageHandlers: Capacitor native bridge probed on a
//     non-native context (regular browser, older WebView, FB in-app).
const NOISE_RE = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module|Lock was stolen|was released because another request stole it|webkit\.messageHandlers/i;

let flushTimer = null;

function safeParse(str, fallback = []) {
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
}

function pushLocal(entry) {
  try {
    const log = safeParse(localStorage.getItem(LOCAL_KEY));
    log.push(entry);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(log.slice(-MAX_LOCAL)));
  } catch {}
}

function pushQueue(entry) {
  try {
    const q = safeParse(localStorage.getItem(QUEUE_KEY));
    q.push(entry);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch {}
}

function popQueue() {
  try {
    const q = safeParse(localStorage.getItem(QUEUE_KEY));
    localStorage.removeItem(QUEUE_KEY);
    return q;
  } catch { return []; }
}

async function flushQueue() {
  if (!navigator.onLine) return;
  const items = popQueue();
  if (items.length === 0) return;
  try {
    const { error } = await supabase.from('app_errors').insert(items);
    if (error) {
      // Table may not exist yet, or RLS blocked. requeue silently
      items.forEach(pushQueue);
    }
  } catch {
    // Network/other. requeue so we retry later
    items.forEach(pushQueue);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, FLUSH_DEBOUNCE_MS);
}

/**
 * Best-effort grab of the current user id at the moment of the error.
 *
 * Reads the persisted Supabase auth state directly from storage (sync,
 * cheap) instead of awaiting `supabase.auth.getUser()` so a crash inside
 * an async error handler can't deadlock or take an extra tick before
 * the entry is pushed. Returns null for guest/anon callers.
 */
function readCurrentUserId() {
  try {
    if (typeof window === 'undefined') return null;
    // Supabase v2 stores the session under a key like `sb-<projectRef>-auth-token`
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const id = parsed?.user?.id || parsed?.currentSession?.user?.id;
      if (id) return id;
    }
  } catch {}
  return null;
}

/**
 * Record an error. Always writes to localStorage; attempts a remote insert
 * (best-effort) a short time later so a crash storm can't flood Supabase.
 *
 * The v2 reporter (Phase 1 observability upgrade) attaches structured
 * context columns alongside the legacy `extra` jsonb:
 *   • route        — current page (window.location.pathname)
 *   • action       — what the user was trying to do (passed via extra.action
 *                    or inferred from breadcrumbs)
 *   • session_id   — same value for every error in this tab session
 *   • breadcrumbs  — last 30 user actions (from src/lib/breadcrumbs.js)
 *   • severity     — critical | error | warning | info (defaults: see below)
 *   • app_version  — package.json version pinned at build time
 *   • visible      — did the user SEE this error? (true for user_visible / user_action)
 *
 * @param {string} type   . 'Error' | 'Promise' | 'React' | 'user_action' |
 *                          'user_visible' | custom
 * @param {Error|string} error
 * @param {object} [extra]. free-form context. Special keys consumed here:
 *                          - action: top-level column
 *                          - severity: top-level column
 *                          - visible: top-level column
 */
export function reportError(type, error, extra) {
  const msg = error?.message || String(error);
  if (NOISE_RE.test(msg)) return;

  // Pull dedicated columns out of extra so the table is queryable, leave
  // the rest as the free-form jsonb. Default severity: crashes/promises
  // are 'error', React renders are 'critical', everything else 'error'.
  const action   = extra && typeof extra.action   === 'string' ? extra.action   : null;
  const severity = extra && typeof extra.severity === 'string'
    ? extra.severity
    : (type === 'React' ? 'critical' : 'error');
  const visible  = extra && typeof extra.visible === 'boolean'
    ? extra.visible
    : (type === 'user_visible' || type === 'user_action');

  // Strip the promoted keys from extra so we don't double-store them.
  let cleanExtra = null;
  if (extra) {
    try {
      const copy = JSON.parse(JSON.stringify(extra));
      delete copy.action;
      delete copy.severity;
      delete copy.visible;
      // Keep extra null when empty to avoid {} pollution.
      cleanExtra = Object.keys(copy).length ? copy : null;
    } catch { cleanExtra = null; }
  }

  const route = typeof window !== 'undefined' ? window.location.pathname : null;

  const entry = {
    type,
    message: (error?.message || String(error)).slice(0, 500),
    stack: (error?.stack || '').slice(0, 2000) || null,
    url: route,
    route,
    action,
    session_id: getSessionId(),
    severity,
    visible,
    app_version: APP_VERSION,
    breadcrumbs: getBreadcrumbs(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
    user_id: readCurrentUserId(),
    extra: cleanExtra,
    created_at: new Date().toISOString(),
    timestamp: Date.now(), // legacy field for localStorage reader
  };

  pushLocal(entry);
  pushQueue(entry);
  scheduleFlush();
}

/**
 * Report a user-facing action failure (save, delete, upload, share, etc.).
 * Unlike reportError (which captures crashes/unhandled errors), this captures
 * the moment a user tries to do something and it fails — the kind of problem
 * that makes a user frustrated but doesn't crash the app. Always marked
 * visible=true so it surfaces in the "שגיאות שמשתמשים ראו" admin tab.
 *
 * @param {string} action  . short label: 'save_document', 'delete_vehicle', 'share_vehicle'
 * @param {Error|string} error
 * @param {object} [context] . free-form: { vehicleId, page, etc. }
 */
export function reportUserError(action, error, context) {
  reportError('user_action', error, { action, visible: true, ...context });
}

/**
 * Report a user-VISIBLE error — i.e. a toast or banner the user actually
 * saw. This is the foundation of the "שגיאות שמשתמשים ראו" admin view:
 * stack-trace-less errors that nevertheless caused frustration. Always
 * marked visible=true and severity='error'.
 *
 * Caller pattern (see src/lib/userErrorReport.js for the toast wrapper):
 *   reportVisibleError('לא הצלחנו לעדכן את הרכב', { route, action: 'save_vehicle' });
 *
 * @param {string} message — the exact text the user saw (already in Hebrew)
 * @param {object} [context] — { action, severity, ...freeform }
 */
export function reportVisibleError(message, context) {
  reportError('user_visible', { message }, { visible: true, severity: 'error', ...context });
}

// Flush queued errors when we come back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
}
