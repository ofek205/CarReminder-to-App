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
 * To DISABLE the feature in production:
 *   UPDATE public.app_config
 *      SET value = 'false'::jsonb, updated_at = NOW()
 *    WHERE key = 'scan_extraction_enabled';
 *
 * To RE-ENABLE:
 *   UPDATE public.app_config
 *      SET value = 'true'::jsonb, updated_at = NOW()
 *    WHERE key = 'scan_extraction_enabled';
 *
 * Default behaviour when the row is missing OR the fetch fails: TREAT
 * AS ENABLED. Defense-in-depth — a Supabase outage or a typo in the
 * row name must not silently kill every scan flow in the app.
 */

import { supabase } from './supabase';

const FLAG_KEY              = 'scan_extraction_enabled';
const CACHE_TTL_MS          = 60 * 1000;     // refetch at most once per minute
const SESSION_SHOWN_KEY     = 'ai-scan-gate-shown';   // sessionStorage flag

let cachedValue   = null;   // boolean | null
let cachedAt      = 0;
let inFlight      = null;   // de-dupe concurrent calls

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
 * Returns true when AI scan extraction is enabled (default), false
 * when an admin has flipped the feature off via app_config.
 *
 * Cached for CACHE_TTL_MS so a rapid sequence of scan clicks does
 * not hammer Postgres — the toggle is sticky and a 60-second lag on
 * re-enable is fine. Re-enable visibility can be forced via
 * invalidateAiScanGateCache().
 *
 * NEVER throws. Network / row-missing / parse errors all fall
 * through to the "enabled" default. The cost of treating a real
 * outage as "enabled" is one more error toast — the cost of treating
 * it as "disabled" is silently breaking every scan flow.
 */
export async function isAiScanEnabled() {
  const now = Date.now();
  if (cachedValue !== null && now - cachedAt < CACHE_TTL_MS) {
    return cachedValue;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', FLAG_KEY)
        .maybeSingle();
      if (error) throw error;
      // app_config.value is jsonb — Postgres returns true/false directly,
      // but a previous version stored the literal string 'false' which we
      // need to tolerate too. Anything not explicitly === false → enabled.
      const raw = data?.value;
      const disabled = raw === false || raw === 'false';
      cachedValue = !disabled;
    } catch (err) {
      // eslint-disable-next-line no-console
      if (import.meta.env?.DEV) console.warn('[aiScanGate] flag fetch failed:', err?.message);
      cachedValue = true;  // safe default
    } finally {
      cachedAt = Date.now();
      inFlight = null;
    }
    return cachedValue;
  })();

  return inFlight;
}

/**
 * Force a refresh of the cached flag on next call. Use after an
 * admin re-enables the feature when you want immediate effect for
 * the current user without waiting up to CACHE_TTL_MS.
 */
export function invalidateAiScanGateCache() {
  cachedValue = null;
  cachedAt = 0;
}
