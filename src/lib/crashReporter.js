/**
 * Crash reporter — fire-and-forget error logging.
 *
 * Errors are written to:
 *   1. localStorage 'app_error_log' (cap 50) — used by the Admin Bugs tab
 *   2. Supabase table 'app_errors' (best-effort, silently fails if the
 *      table doesn't exist or RLS blocks). Batched when offline.
 *
 * No third-party SDK (Sentry etc.) — keeps the bundle lean and avoids
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
      // Table may not exist yet, or RLS blocked — requeue silently
      items.forEach(pushQueue);
    }
  } catch {
    // Network/other — requeue so we retry later
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
 * Record an error. Always writes to localStorage; attempts a remote insert
 * (best-effort) a short time later so a crash storm can't flood Supabase.
 *
 * @param {string} type    — 'Error' | 'Promise' | 'React' | custom
 * @param {Error|string} error
 * @param {object} [extra] — free-form context (page, action, etc.)
 */
export function reportError(type, error, extra) {
  const entry = {
    type,
    message: (error?.message || String(error)).slice(0, 500),
    stack: (error?.stack || '').slice(0, 2000) || null,
    url: typeof window !== 'undefined' ? window.location.pathname : null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : null,
    extra: extra ? JSON.parse(JSON.stringify(extra)) : null,
    created_at: new Date().toISOString(),
    timestamp: Date.now(), // legacy field for localStorage reader
  };

  pushLocal(entry);
  pushQueue(entry);
  scheduleFlush();
}

// Flush queued errors when we come back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
}
