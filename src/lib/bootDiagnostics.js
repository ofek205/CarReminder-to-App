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

/**
 * Return a structured snapshot suitable for sharing in a bug report.
 * Includes platform, app version, build number, both boot logs, and a
 * `summary` block that's safe to post in WhatsApp/Slack at a glance.
 *
 * Never includes secrets — env values are reported via envValidator's
 * snapshot (presence/length only).
 */
export function getBootSnapshot() {
  const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const platform = isIOS ? 'iOS' : isAndroid ? 'Android' : 'Web';

  // Extract iOS version from UA when possible (best-effort, never throws).
  let iosVersion = null;
  try {
    const m = ua.match(/OS (\d+)[._](\d+)(?:[._](\d+))?/);
    if (m) iosVersion = [m[1], m[2], m[3]].filter(Boolean).join('.');
  } catch {}

  // App version is injected via Vite at build time. Fallback: read from
  // <meta name="app-version"> if a build pipeline set it; else "unknown".
  let appVersion = 'unknown';
  try {
    if (typeof __APP_VERSION__ !== 'undefined') appVersion = String(__APP_VERSION__);  
    if (appVersion === 'unknown' && typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="app-version"]');
      if (meta?.content) appVersion = meta.content;
    }
  } catch {}

  const current = getCurrentBootLog();
  const previous = getPreviousBootLog();

  const succeeded = current.some(e => e.stage === 'boot_succeeded');
  const lastStage = current[current.length - 1];
  const previousSucceeded = previous.some(e => e.stage === 'boot_succeeded');
  const previousLastStage = previous[previous.length - 1];

  return {
    summary: {
      platform,
      iosVersion,
      appVersion,
      currentSucceeded: succeeded,
      currentLastStage: lastStage?.stage || null,
      currentTotalMs: lastStage?.t ?? 0,
      previousSucceeded,
      previousLastStage: previousLastStage?.stage || null,
      timestamp: new Date().toISOString(),
    },
    platform,
    iosVersion,
    appVersion,
    userAgent: ua.slice(0, 200),
    url: typeof window !== 'undefined' ? window.location?.href : null,
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    currentLog: current,
    previousLog: previous,
  };
}

/**
 * If the previous launch hung BEFORE React mounted, fire-and-forget the
 * snapshot to crashReporter so we have a remote post-mortem the next
 * time we open Admin → Bugs.
 *
 * Why "before React mounted" (not "didn't reach boot_succeeded"):
 *   `boot_succeeded` requires `__crAuthResolvedAt` to be set, which only
 *   happens after Supabase auth resolves. If a user force-quits the app
 *   before that, or has slow network, the previous boot looks "failed"
 *   to a naive check — but the app actually rendered and was usable.
 *   Reporting these creates noise. We tighten the bar to "didn't even
 *   reach `react_mount_rendered`", which means the user really did
 *   stare at a hung splash.
 *
 * Plus a 6-hour rate limit per device so a permanently-broken state
 * (e.g. corrupted local storage) doesn't flood Supabase on every relaunch.
 *
 * Safe to call from main.jsx — never blocks boot.
 */
const FLUSH_RATE_LIMIT_KEY = 'cr_boot_flush_last_at';
const FLUSH_RATE_LIMIT_MS = 6 * 60 * 60 * 1000; // 6 hours

export function flushPreviousFailedBoot() {
  try {
    const previous = getPreviousBootLog();
    if (!previous.length) return;
    // Already-succeeded launches: nothing to report.
    if (previous.some(e => e.stage === 'boot_succeeded')) return;
    // React mounted at all → user could see SOMETHING (even if just an
    // error UI from AppErrorBoundary). Not a "stuck on splash" case.
    if (previous.some(e => e.stage === 'react_mount_rendered')) return;
    // Env-error stops are already a clear UI signal — skip remote report.
    if (previous.some(e => e.stage === 'boot_env_error')) return;

    // Rate limit per-device.
    try {
      const lastAt = Number(localStorage.getItem(FLUSH_RATE_LIMIT_KEY) || 0);
      if (lastAt && Date.now() - lastAt < FLUSH_RATE_LIMIT_MS) return;
      localStorage.setItem(FLUSH_RATE_LIMIT_KEY, String(Date.now()));
    } catch {}

    // Dynamic import so a crashReporter init failure can never block boot.
    import('./crashReporter.js')
      .then(m => {
        try {
          const snap = getBootSnapshot();
          const lastStage = previous[previous.length - 1]?.stage || 'unknown';
          m.reportError(
            'boot_failed',
            new Error(`Previous launch hung at stage: ${lastStage}`),
            { snapshot: snap.summary, log: previous.slice(-20) }
          );
        } catch {}
      })
      .catch(() => {});
  } catch {}
}
