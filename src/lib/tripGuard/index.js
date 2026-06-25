/**
 * TripGuard — app-facing API (child-in-car safety reminder).
 *
 * Thin wrapper around the raw Capacitor plugin, in the style of
 * src/lib/capacitor.js: platform guards + safe fallbacks so the React layer
 * never crashes if a call fails or the platform isn't supported yet.
 *
 * Scope today: Android-first (native) + web (mock). iOS is a separate spike —
 * isTripGuardSupported() returns false there so the UI can show "בקרוב"
 * instead of a broken control.
 *
 * Re-exports the definitions so consumers import everything from one place:
 *   import { getTripGuardStatus, DEFAULT_CONFIG, TRIP_GUARD_REASONS } from '@/lib/tripGuard';
 */
import { isIOS } from '@/lib/capacitor';
import { TripGuardPlugin } from './plugin.js';
import { DEFAULT_CONFIG, TRIP_GUARD_REASONS } from './definitions.js';

export * from './definitions.js';

/** Functional on Android (native) and web (mock). iOS pending the spike. */
export function isTripGuardSupported() {
  return !isIOS;
}

/** @returns {Promise<import('./definitions.js').TripGuardDevice[]>} */
export async function listCarDevices() {
  try {
    const { devices } = await TripGuardPlugin.listPairedDevices();
    return Array.isArray(devices) ? devices : [];
  } catch (e) {
    console.warn('[tripGuard] listPairedDevices failed:', e);
    return [];
  }
}

/** @returns {Promise<import('./definitions.js').TripGuardConfig>} */
export async function getTripGuardConfig() {
  try {
    return await TripGuardPlugin.getConfig();
  } catch (e) {
    console.warn('[tripGuard] getConfig failed:', e);
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveTripGuardConfig(config) {
  await TripGuardPlugin.saveConfig(config);
}

/**
 * Always resolves to a usable status. On error it returns a NOT-ready status
 * — never a false "ready", because a false green is the dangerous failure
 * mode for a safety feature.
 * @returns {Promise<import('./definitions.js').TripGuardStatus>}
 */
export async function getTripGuardStatus() {
  try {
    return await TripGuardPlugin.getStatus();
  } catch (e) {
    console.warn('[tripGuard] getStatus failed:', e);
    return {
      ready: false,
      reasons: [TRIP_GUARD_REASONS.DISABLED],
      btAdapterOn: false,
      btPermission: 'denied',
      notifPermission: 'denied',
      batteryOptimized: false,
    };
  }
}

export async function enableTripGuard() {
  await TripGuardPlugin.enable();
}

export async function disableTripGuard() {
  await TripGuardPlugin.disable();
}

export async function snoozeTripGuardOnce() {
  await TripGuardPlugin.snoozeOnce();
}

export async function checkTripGuardPermissions() {
  return TripGuardPlugin.checkPermissions();
}

export async function requestTripGuardPermissions() {
  return TripGuardPlugin.requestPermissions();
}

/** Opens the system battery-optimisation settings (improves bg reliability). */
export async function openBatterySettings() {
  try {
    await TripGuardPlugin.openBatterySettings();
  } catch (e) {
    console.warn('[tripGuard] openBatterySettings failed:', e);
  }
}

/** Recent detected trip ends (newest first), for the in-app transparency log. */
export async function getTripLog() {
  try {
    const { entries } = await TripGuardPlugin.getTripLog();
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    console.warn('[tripGuard] getTripLog failed:', e);
    return [];
  }
}

/**
 * Subscribe to live status changes (for the FR5 indicator).
 * @returns {Promise<import('@capacitor/core').PluginListenerHandle>}
 */
export function onTripGuardStatusChanged(callback) {
  return TripGuardPlugin.addListener('statusChanged', callback);
}

/** Raw plugin handle — escape hatch for dev-only mock helpers (preview). */
export const __tripGuardPluginRaw = TripGuardPlugin;
