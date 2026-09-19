/**
 * TripGuard — app-facing API (child-in-car safety reminder).
 *
 * Thin wrapper around the raw Capacitor plugin, in the style of
 * src/lib/capacitor.js: platform guards + safe fallbacks so the React layer
 * never crashes if a call fails or the platform isn't supported yet.
 *
 * Native on Android (Bluetooth manifest receiver) and iOS (AVAudioSession
 * route-change and/or CLLocationManager significant-change, user's choice:
 * see iosDetectionMode in definitions.js), plus web (mock).
 *
 * Re-exports the definitions so consumers import everything from one place:
 *   import { getTripGuardStatus, DEFAULT_CONFIG, TRIP_GUARD_REASONS } from '@/lib/tripGuard';
 */
import { isNative } from '@/lib/capacitor';
import { TripGuardPlugin } from './plugin.js';
import { DEFAULT_CONFIG, TRIP_GUARD_REASONS } from './definitions.js';

export * from './definitions.js';

/** Both native platforms and the web mock all implement the same contract. */
export function isTripGuardSupported() {
  return true;
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

/**
 * iOS ONLY (no-op elsewhere): cancels a pending escalation re-buzz. Android
 * doesn't need this exported at all: its notification buttons target a
 * native BroadcastReceiver directly, entirely outside Capacitor. iOS has no
 * such native-only path (see TripGuardNotifier.swift's big comment on why),
 * so the tap is relayed through @capacitor/local-notifications' own action
 * routing instead, and initTripGuardActionListener() below is the other half.
 */
export async function cancelTripGuardEscalation() {
  try {
    await TripGuardPlugin.cancelEscalation();
  } catch (e) {
    console.warn('[tripGuard] cancelEscalation failed:', e);
  }
}

/**
 * Call once at app boot (see main.jsx, alongside initKeyboard/initBackButton),
 * NOT inside SafetyReminder.jsx, because the whole point is that a tap can
 * arrive before that screen is ever mounted (the tap itself cold-launches
 * the app). @capacitor/local-notifications retains the event
 * (retainUntilConsumed) until a listener exists, so registering late still
 * works, but registering at boot is what makes "late" never matter.
 *
 * Matches purely on `extra.type === 'tripguard'`, not on platform: Android's
 * TripGuard alerts never go through @capacitor/local-notifications at all
 * (see above), so this listener is structurally a no-op there. It simply
 * never sees a matching event, no isIOS check needed.
 */
export function initTripGuardActionListener() {
  if (!isNative) return;
  import('@capacitor/local-notifications').then(({ LocalNotifications }) => {
    LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const extra = event && event.notification && event.notification.extra;
      if (!extra || extra.type !== 'tripguard') return;
      if (event.actionId === 'tripguard_ack' || event.actionId === 'tripguard_no_kids') {
        cancelTripGuardEscalation();
      }
    });
  }).catch((e) => console.warn('[tripGuard] could not attach action listener:', e));
}

/** Raw plugin handle — escape hatch for dev-only mock helpers (preview). */
export const __tripGuardPluginRaw = TripGuardPlugin;
