/**
 * TripGuard — shared definitions, default config, and reason codes.
 *
 * This is a JS project (no TypeScript) so the "types" are expressed as JSDoc
 * @typedef blocks. They give editor/`tsc --noEmit` help to every consumer
 * (React UI, web mock) without a build step. The native Android/iOS plugins
 * mirror these shapes.
 */

/**
 * @typedef {Object} TripGuardDevice
 * @property {string} id   Stable device id — the Bluetooth MAC address on Android.
 * @property {string} name Human-readable device name (e.g. "Toyota_Audio").
 */

/**
 * @typedef {Object} TripGuardConfig
 * @property {boolean} enabled                 Master on/off.
 * @property {string[]} carDeviceIds           Device ids the user marked as "my car".
 * @property {number[]} activeDays             Weekdays the guard is active. 0=Sun … 6=Sat.
 * @property {{start:string,end:string}|null} activeHours  "HH:mm" range; null = all day.
 * @property {{startMonth:number,endMonth:number}|null} activeSeason  Months 1-12; null = all year.
 * @property {number} minTripMinutes           Min trip length before an alert can fire.
 * @property {number} alertDelaySeconds        Delay between disconnect and the alert.
 * @property {number} escalateAfterSeconds     Re-buzz if not acknowledged; 0 = off.
 */

/**
 * @typedef {Object} TripGuardStatus
 * @property {boolean} ready                   The master "🟢 active & ready" flag.
 * @property {string[]} reasons                Why it can't run (TRIP_GUARD_REASONS values).
 * @property {boolean} btAdapterOn
 * @property {string} btPermission             'granted' | 'denied' | 'prompt'
 * @property {string} notifPermission          'granted' | 'denied' | 'prompt'
 * @property {boolean} batteryOptimized
 */

/**
 * Reason codes for why the guard cannot currently run — drives the FR5
 * "active / can't run" indicator, the most safety-critical piece of UI.
 */
export const TRIP_GUARD_REASONS = Object.freeze({
  DISABLED: 'DISABLED',
  NO_DEVICE: 'NO_DEVICE',
  BT_OFF: 'BT_OFF',
  BT_PERM: 'BT_PERM',
  NOTIF_PERM: 'NOTIF_PERM',
  BATTERY: 'BATTERY',
});

/**
 * Safety-first defaults: the widest possible active window so a forgetful
 * parent is covered unless they deliberately narrow it. `enabled` starts
 * false — the feature is opt-in behind the onboarding + disclaimer.
 * @type {TripGuardConfig}
 */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  carDeviceIds: [],
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  activeHours: null,
  activeSeason: null,
  minTripMinutes: 2,
  alertDelaySeconds: 0,
  escalateAfterSeconds: 30,
});
