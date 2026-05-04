/**
 * Boot diagnostics — synchronous, persistent boot-stage logger.
 *
 * Why this exists, in addition to crashReporter:
 *   - crashReporter writes async (Supabase batch flush) and only records
 *     stages flagged as native/error. If iOS hangs before the flush,
 *     we lose the trail.
 *   - This module writes synchronously to localStorage on EVERY stage,
 *     so even a hard hang leaves a complete timeline behind. Next launch
 *     (or a debug URL) can read it and show exactly where the boot froze.
 *
 * Design constraints:
 *   - Zero external imports. Anything that throws must NEVER block boot.
 *   - O(1) per stage. We cap the buffer to a small ring.
 *   - Safe in non-browser contexts (SSR, jest) — guarded localStorage access.
 */

const KEY_CURRENT = 'cr_boot_log';     // current launch
const KEY_PREVIOUS = 'cr_boot_log_prev'; // previous launch (for post-mortem)
const MAX_STAGES = 80;
const STARTED_AT_KEY = 'cr_boot_started_at';

let bootStartedAt = 0;

function nowMs() {
  try { return Date.now(); } catch { return 0; }
}

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // QuotaExceeded or storage disabled — silently drop.
  }
}

/**
 * Initialize a new boot log. Rotates the previous one to *_prev so we
 * keep one launch of history for "the last time it failed" diagnostics.
 * Idempotent: calling twice in the same launch is a no-op.
 */
export function initBootLog() {
  if (bootStartedAt) return;
  bootStartedAt = nowMs();
  try {
    const previousLog = localStorage.getItem(KEY_CURRENT);
    if (previousLog) safeWrite(KEY_PREVIOUS, JSON.parse(previousLog));
  } catch { /* ignore */ }
  try { localStorage.setItem(STARTED_AT_KEY, String(bootStartedAt)); } catch {}
  safeWrite(KEY_CURRENT, []);
}

/**
 * Record one boot stage. Synchronous and resilient: never throws.
 *
 * @param {string} stage      short, snake_case identifier (e.g. 'react_mount_start')
 * @param {object} [extra]    arbitrary JSON-serializable context
 */
export function recordBootStage(stage, extra) {
  if (!bootStartedAt) initBootLog();
  let safeExtra = null;
  try {
    safeExtra = extra ? JSON.parse(JSON.stringify(extra)) : null;
  } catch {
    safeExtra = { _serializeError: true };
  }
  const entry = {
    stage: String(stage).slice(0, 60),
    t: nowMs() - bootStartedAt,    // ms since boot start
    ts: nowMs(),                   // wall clock
    extra: safeExtra,
  };
  try {
    const log = safeRead(KEY_CURRENT);
    log.push(entry);
    safeWrite(KEY_CURRENT, log.slice(-MAX_STAGES));
  } catch { /* ignore */ }
}

/**
 * Return the current launch's boot log (oldest first).
 */
export function getCurrentBootLog() {
  return safeRead(KEY_CURRENT);
}

/**
 * Return the previous launch's boot log (oldest first). Useful when the
 * current launch never reached the page that displays diagnostics.
 */
export function getPreviousBootLog() {
  return safeRead(KEY_PREVIOUS);
}

/**
 * Mark the boot as successfully completed. Used by the diagnostic page
 * to color-code "this launch failed" vs "this launch succeeded".
 */
export function markBootSucceeded() {
  recordBootStage('boot_succeeded');
}

/**
 * Erase both current and previous logs. Available from the diagnostic
 * page so users / QA can reset state and start a clean repro.
 */
export function clearBootLogs() {
  try {
    localStorage.removeItem(KEY_CURRENT);
    localStorage.removeItem(KEY_PREVIOUS);
    localStorage.removeItem(STARTED_AT_KEY);
  } catch {}
}
