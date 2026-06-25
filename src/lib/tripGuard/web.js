/**
 * TripGuard — web mock implementation.
 *
 * Runs in the browser (dev + PWA) and stands in for the native plugin until
 * the Android/iOS code lands. It is a FAITHFUL mock: same method contract,
 * localStorage-backed config, fake paired devices, and a configurable status
 * so the React UI can preview every "can't run" state without a device.
 *
 * It deliberately does NOT try to detect real Bluetooth — the browser can't,
 * and the whole point of the native plugin is to work when the WebView is
 * dead. The mock simply lets us build and verify the UI layer.
 */
import { WebPlugin } from '@capacitor/core';
import { DEFAULT_CONFIG, TRIP_GUARD_REASONS } from './definitions.js';
import { shouldAlert } from '@/lib/tripWindow';

const LS_CONFIG = 'tripGuard.mock.config';
const LS_CONDITIONS = 'tripGuard.mock.conditions';
const LS_LOG = 'tripGuard.mock.log';

/** A few fake bonded devices — two "cars" and a pair of earbuds (the trap). */
const MOCK_DEVICES = [
  { id: '24:A4:3C:00:00:01', name: 'Toyota_Audio' },
  { id: '24:A4:3C:00:00:02', name: 'Mazda Bluetooth' },
  { id: 'B8:27:EB:00:00:03', name: 'AirPods Pro' },
];

export class TripGuardWeb extends WebPlugin {
  async listPairedDevices() {
    return { devices: MOCK_DEVICES.map((d) => ({ ...d })) };
  }

  async getConfig() {
    return this._readConfig();
  }

  async saveConfig(options) {
    const next = { ...DEFAULT_CONFIG, ...this._readConfig(), ...(options || {}) };
    localStorage.setItem(LS_CONFIG, JSON.stringify(next));
    this.notifyListeners('statusChanged', await this.getStatus());
  }

  async enable() {
    await this.saveConfig({ enabled: true });
  }

  async disable() {
    await this.saveConfig({ enabled: false });
  }

  async snoozeOnce() {
    // Mock: nothing to suppress in the browser; just acknowledge the call.
    return { snoozed: true };
  }

  async getStatus() {
    const config = this._readConfig();
    const cond = this._readConditions();
    const reasons = [];
    if (!config.enabled) reasons.push(TRIP_GUARD_REASONS.DISABLED);
    if (!config.carDeviceIds || config.carDeviceIds.length === 0) reasons.push(TRIP_GUARD_REASONS.NO_DEVICE);
    if (cond.btOff) reasons.push(TRIP_GUARD_REASONS.BT_OFF);
    if (cond.btDenied) reasons.push(TRIP_GUARD_REASONS.BT_PERM);
    if (cond.notifDenied) reasons.push(TRIP_GUARD_REASONS.NOTIF_PERM);
    // batteryOptimized is advisory, NOT a blocker (see TripGuardPlugin.java):
    // the manifest ACL receiver is exempt from Doze, so the guard still works.
    return {
      ready: reasons.length === 0,
      reasons,
      btAdapterOn: !cond.btOff,
      btPermission: cond.btDenied ? 'denied' : 'granted',
      notifPermission: cond.notifDenied ? 'denied' : 'granted',
      batteryOptimized: !!cond.batteryOptimized,
    };
  }

  async checkPermissions() {
    const cond = this._readConditions();
    return {
      bluetooth: cond.btDenied ? 'denied' : 'granted',
      notifications: cond.notifDenied ? 'denied' : 'granted',
    };
  }

  async requestPermissions() {
    // Mock: granting clears the denial flags.
    const cond = this._readConditions();
    delete cond.btDenied;
    delete cond.notifDenied;
    localStorage.setItem(LS_CONDITIONS, JSON.stringify(cond));
    this.notifyListeners('statusChanged', await this.getStatus());
    return this.checkPermissions();
  }

  async getTripLog() {
    return { entries: this._readLog() };
  }

  async openBatterySettings() {
    // No system settings on web — the native plugin opens the real screen.
    return undefined;
  }

  /**
   * DEV-ONLY (web mock): force indicator conditions so the UI's "can't run"
   * states can be previewed without a device. e.g. { btOff: true }.
   */
  async __setMockConditions(options) {
    const cond = { ...this._readConditions(), ...(options || {}) };
    localStorage.setItem(LS_CONDITIONS, JSON.stringify(cond));
    this.notifyListeners('statusChanged', await this.getStatus());
  }

  /**
   * DEV-ONLY (web mock): simulate a car disconnect to preview the alert flow.
   * Runs the real shouldAlert() rules so the preview matches production logic.
   */
  async __simulateTripEnd(options) {
    const config = this._readConfig();
    const now = Date.now();
    const tripMinutes = options && Number.isFinite(options.tripMinutes) ? options.tripMinutes : 5;
    const startedAt = now - tripMinutes * 60 * 1000;
    const willAlert = shouldAlert(config, startedAt, now);
    // Record in the mock trip log (newest entries are returned first).
    const log = this._readLog();
    log.unshift({ at: now, alerted: willAlert });
    localStorage.setItem(LS_LOG, JSON.stringify(log.slice(0, 10)));
    this.notifyListeners('tripEnded', { willAlert, tripMinutes });
    return { willAlert };
  }

  _readLog() {
    try {
      const raw = localStorage.getItem(LS_LOG);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _readConfig() {
    try {
      const raw = localStorage.getItem(LS_CONFIG);
      if (!raw) return { ...DEFAULT_CONFIG };
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  _readConditions() {
    try {
      const raw = localStorage.getItem(LS_CONDITIONS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
}
