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

const LOCAL_KEY = 'app_error_log';
const QUEUE_KEY = 'app_error_queue';
const MAX_LOCAL = 50;
const MAX_QUEUE = 100;
const FLUSH_DEBOUNCE_MS = 2000;

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
 * @param {string} type   . 'Error' | 'Promise' | 'React' | custom
 * @param {Error|string} error
 * @param {object} [extra]. free-form context (page, action, etc.)
 */
export function reportError(type, error, extra) {
  const msg = error?.message || String(error);
  if (NOISE_RE.test(msg)) return;

  const entry = {
    type,
    message: (error?.message || String(error)).slice(0, 500),
    stack: (error?.stack || '').slice(0, 2000) || null,
    url: typeof window !== 'undefined' ? window.location.pathname : null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
    user_id: readCurrentUserId(),
    extra: extra ? JSON.parse(JSON.stringify(extra)) : null,
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
 * that makes a user frustrated but doesn't crash the app.
 *
 * @param {string} action  . short label: 'save_document', 'delete_vehicle', 'share_vehicle'
 * @param {Error|string} error
 * @param {object} [context] . free-form: { vehicleId, page, etc. }
 */
export function reportUserError(action, error, context) {
  reportError('user_action', error, { action, ...context });
}

// Flush queued errors when we come back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
}
