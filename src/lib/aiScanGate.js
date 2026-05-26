/**
 * AI Scan Extraction Gate
 *
 * Lets us turn the AI document-scan feature OFF for everyone with a
 * single SQL update against `app_config`, without shipping a new app
 * release. Used when the underlying provider quota / model is
 * unhealthy and we want to steer users to manual entry instead of
 * letting failed scans pile up.
 *
 * Surfaces gated (all call aiRequest with `feature: 'scan_extraction'`):
 *   1. AddVehicle / EditVehicle / VehicleScanWizard — license book
 *   2. UserProfile / DriverLicenseScanDialog        — driver license
 *   3. MyExpenses / ExpenseFormDialog               — receipt
 *   4. Expenses (B2B) / ReceiptScanCard             — receipt
 *   5. Documents / DocUploadDialog                  — generic doc
 *   6. AddVehicle (vessels) / VesselScanWizard      — vessel license
 *
 * To DISABLE the feature in production (regular users only — admins
 * still bypass):
 *   UPDATE public.app_config
 *      SET value = 'false'::jsonb, updated_at = NOW()
 *    WHERE key = 'scan_extraction_enabled';
 *
 * To RE-ENABLE:
 *   UPDATE public.app_config
 *      SET value = 'true'::jsonb, updated_at = NOW()
 *    WHERE key = 'scan_extraction_enabled';
 *
 * Default behaviour when the row is missing OR the fetch fails:
 * "treat as enabled" for non-admins. This preserves the legacy
 * semantics the scan feature has shipped with for months. Delivered
 * by passing { defaultOnError: true } to the unified featureFlags
 * helper — new flags hide on error, this shipped flag stays open.
 *
 * Admin bypass: as of 2026-05-26, admins ALWAYS pass this gate even
 * when the flag is false in app_config. This lets QA test scan flows
 * without flipping the public toggle. The admin probe is shared with
 * featureFlags and cached for 60 s, so role changes propagate within
 * that window.
 */

import {
  isFeatureEnabled,
  invalidateFeatureFlagCache,
} from './featureFlags';

const FLAG_KEY              = 'scan_extraction_enabled';
const SESSION_SHOWN_KEY     = 'ai-scan-gate-shown';   // sessionStorage flag

// Listeners notified when a gated scan attempt happens. UI mounts a
// single <AiScanUnavailableDialog/> at Layout level that subscribes
// here. Multiple subscribers are allowed (e.g., a future analytics
// sink) but the dialog only opens for the FIRST one in a session.
const listeners = new Set();

/**
 * Subscribe to "scan attempted while feature is disabled" events.
 * Returns an unsubscribe function.
 */
export function onAiScanDisabled(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Internal — called by aiRequest when the gate denies a scan.
 */
export function emitAiScanDisabled() {
  for (const cb of listeners) {
    try { cb(); } catch { /* listener bug must not crash the proxy */ }
  }
}

/**
 * Has the user already seen the gate dialog in this browser session?
 * Used to avoid hammering the user with the modal every time they
 * click "scan" within the same visit.
 */
export function hasShownAiScanGateThisSession() {
  try {
    return sessionStorage.getItem(SESSION_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Mark the gate dialog as shown for this session. The dialog handler
 * calls this after rendering so future calls within the same tab
 * suppress the modal silently (the user already knows).
 */
export function markAiScanGateShown() {
  try {
    sessionStorage.setItem(SESSION_SHOWN_KEY, '1');
  } catch {}
}

/**
 * Returns true when AI scan extraction is allowed for the current
 * user. Admins always pass; regular users get the value of the
 * scan_extraction_enabled row in public.app_config, defaulting to
 * "enabled" on error to preserve the legacy ship behaviour.
 *
 * Caching + de-duplication are handled by the underlying featureFlags
 * helper (60-second TTL per key, in-flight de-dupe). Use
 * invalidateAiScanGateCache() to force an immediate re-read.
 *
 * NEVER throws.
 */
export async function isAiScanEnabled() {
  return isFeatureEnabled(FLAG_KEY, { defaultOnError: true });
}

/**
 * Force a refresh of the cached flag on next call. ALSO causes any
 * useFeatureFlag(FLAG_KEY) hooks mounted in the current tab to
 * re-read immediately (via featureFlags' pub-sub).
 */
export function invalidateAiScanGateCache() {
  invalidateFeatureFlagCache(FLAG_KEY);
}
