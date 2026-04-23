/**
 * Frequency Gate — decides whether a popup should be shown *right now* to
 * the current user, based on its frequency config + local impression history.
 *
 * Storage:
 *   localStorage['cr_popup_history_v1'] → {
 *     [popupId]: { impressions: number, dismissed: number, lastShownAt: ISO }
 *   }
 *   localStorage['cr_popup_last_global_at'] → ISO string (global throttle)
 *
 * We intentionally stay client-side for the per-user frequency. The
 * per-popup `max_impressions` is a soft cap (device-local). If the user
 * clears storage they start over — acceptable for non-billing nags.
 */

import { GLOBAL_THROTTLE_MINUTES } from './constants';

const HISTORY_KEY = 'cr_popup_history_v1';
const GLOBAL_KEY  = 'cr_popup_last_global_at';
const DAY_MS      = 24 * 60 * 60 * 1000;

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function writeHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}

function readGlobal() {
  try { return localStorage.getItem(GLOBAL_KEY); }
  catch { return null; }
}

function writeGlobal(iso) {
  try { localStorage.setItem(GLOBAL_KEY, iso); } catch {}
}

/**
 * Returns true if the global throttle allows another popup right now.
 * "At most one popup per 15 minutes" — prevents a storm of admin-created
 * campaigns from blasting the user on login.
 */
export function globalThrottleOk() {
  const last = readGlobal();
  if (!last) return true;
  const ageMs = Date.now() - new Date(last).getTime();
  return ageMs >= GLOBAL_THROTTLE_MINUTES * 60 * 1000;
}

export function recordGlobalShown() {
  writeGlobal(new Date().toISOString());
}

/**
 * Per-popup gate. Returns true if the popup's frequency rules allow display.
 *
 * popup.frequency shape:
 *   { kind: 'once' | 'every_session' | 'custom',
 *     every_days?: number, max_impressions?: number }
 *
 * 'every_session' is approximated via the `sessionImpressionIds` Set held
 * in memory by the engine — if we've already shown this popup in this
 * session, skip. Storage isn't the right tool here (persists across tabs).
 */
export function frequencyGateOk(popup, sessionImpressionIds) {
  const freq = popup.frequency || {};
  const history = readHistory();
  const entry = history[popup.id];

  // Soft max cap (applies to all kinds)
  if (freq.max_impressions && entry?.impressions >= freq.max_impressions) {
    return false;
  }

  switch (freq.kind) {
    case 'every_session':
      // Already shown this session → block. Otherwise ok.
      return !sessionImpressionIds?.has(popup.id);

    case 'custom': {
      const days = Number(freq.every_days);
      if (!days || days <= 0) return true;
      if (!entry?.lastShownAt) return true;
      const ageMs = Date.now() - new Date(entry.lastShownAt).getTime();
      return ageMs >= days * DAY_MS;
    }

    case 'once':
    default:
      // Shown even once before → never again on this device.
      return !entry?.impressions;
  }
}

/**
 * Called by the engine right before/after rendering a popup. Bumps
 * counters + updates lastShownAt.
 */
export function recordImpression(popupId) {
  const h = readHistory();
  const entry = h[popupId] || { impressions: 0, dismissed: 0, lastShownAt: null };
  entry.impressions += 1;
  entry.lastShownAt = new Date().toISOString();
  h[popupId] = entry;
  writeHistory(h);
  writeGlobal(new Date().toISOString());
}

export function recordDismissal(popupId) {
  const h = readHistory();
  const entry = h[popupId] || { impressions: 0, dismissed: 0, lastShownAt: null };
  entry.dismissed += 1;
  h[popupId] = entry;
  writeHistory(h);
}

/**
 * Wipes local frequency state for every popup. Useful for the admin
 * "test mode" so editing + previewing doesn't consume real quota.
 */
export function resetAllPopupHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(GLOBAL_KEY);
  } catch {}
}

// Dev helper for QA.
if (typeof window !== 'undefined') {
  window.__resetPopupHistory = resetAllPopupHistory;
}
