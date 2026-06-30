/**
 * Push Notifications — server-side push via FCM (Android) + APNs (iOS).
 *
 * Complements LocalNotifications in notificationChannels.js:
 *   - LocalNotifications: app-scheduled, OS-fired (test/insurance/maint
 *     reminders the engine pre-computes from vehicle data).
 *   - PushNotifications (THIS file): server-fired from supabase Edge
 *     Function `dispatch-push`. Used for real-time events that ONLY the
 *     server knows about — shared-vehicle changes, comments on a post,
 *     admin broadcasts, anything that today is delivered via the
 *     `useSharedVehicleRealtime` WebSocket and therefore stops working
 *     the moment the app is backgrounded.
 *
 * Wire-up:
 *   1. `initPushNotifications(userId)` is called once on app boot for
 *      authenticated native users (see main.jsx / capacitor.js init path).
 *   2. The plugin requests permission, registers with FCM/APNs, and
 *      fires `registration` with a device-specific token.
 *   3. We upsert the token into supabase `device_tokens` keyed by
 *      (user_id, token) so the user gets pushes on every device they
 *      sign into. Old tokens for the same device naturally fall out
 *      because FCM/APNs rotate them and we always upsert latest.
 *   4. Foreground notifications fire the `pushNotificationReceived`
 *      listener. On Android we surface the banner via LocalNotifications
 *      (the OS does not auto-present a foreground `notification` message);
 *      on iOS the OS presents it itself via `presentationOptions`, so we
 *      do NOT forward — that would double the banner. OS push is the sole
 *      owner of the device banner; the bell + Realtime listener never fire
 *      local notifications for an app_notifications row.
 *   5. Notification taps fire `pushNotificationActionPerformed`, which
 *      dispatches a `cr:push-tapped` window event the router listens
 *      for to deep-link to the right screen.
 *
 * Web is a no-op throughout — push notifications use FCM/APNs which
 * require a native runtime.
 */

import { isNative } from './capacitor';
import { supabase } from './supabase';

const DEBUG = import.meta.env?.DEV;

// Module-level guard so multiple calls to initPushNotifications don't
// register twice. Capacitor's plugin handles re-register internally but
// each call returns a fresh token event — without this guard we'd upsert
// the same token N times per session.
let initialized = false;
let listenersAttached = false;
const listenerHandles = [];

/**
 * One-shot init. Idempotent. Returns true if push is now wired up, false
 * if running on web, the user denied permission, or any setup step
 * failed. Never throws.
 */
export async function initPushNotifications(userId) {
  if (!isNative) return false;
  if (!userId) {
    if (DEBUG) console.warn('[push] initPushNotifications called without userId');
    return false;
  }
  if (initialized) return true;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Permission check first. iOS surfaces a system dialog the first
    // time; Android 13+ does the same. On older Android the permission
    // check always returns granted (no runtime prompt for POST_NOTIFS
    // until API 33).
    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === 'granted';
    if (!granted) {
      const req = await PushNotifications.requestPermissions();
      granted = req.receive === 'granted';
    }
    if (!granted) {
      if (DEBUG) console.warn('[push] permission denied — push disabled');
      return false;
    }

    // Attach listeners before register() so we don't miss the
    // registration event on a fast-returning callback path.
    if (!listenersAttached) {
      const h1 = await PushNotifications.addListener('registration', async (token) => {
        try {
          await registerDeviceToken(userId, token.value);
        } catch (e) {
          if (DEBUG) console.warn('[push] registerDeviceToken failed:', e?.message);
        }
      });
      const h2 = await PushNotifications.addListener('registrationError', (err) => {
        if (DEBUG) console.warn('[push] registrationError:', err?.error);
      });
      const h3 = await PushNotifications.addListener('pushNotificationReceived', (notif) => {
        // Foreground delivery — surface via LocalNotifications so the
        // user sees a banner even with the app open. Without this, FCM
        // delivers silently to the foreground app and the user only
        // sees the banner if the app is in the background.
        forwardForegroundToLocal(notif);
      });
      const h4 = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        // User tapped the notification. action.notification.data contains
        // whatever the server attached as `data` in the FCM payload.
        try {
          window.dispatchEvent(new CustomEvent('cr:push-tapped', {
            detail: action?.notification?.data || {},
          }));
        } catch {}
      });
      listenerHandles.push(h1, h2, h3, h4);
      listenersAttached = true;
    }

    // register() asks the OS for an APNs/FCM token and triggers the
    // `registration` listener above. After this point the device is
    // discoverable from our server side.
    await PushNotifications.register();
    initialized = true;
    return true;
  } catch (e) {
    if (DEBUG) console.warn('[push] init failed:', e?.message || e);
    return false;
  }
}

/**
 * Tear down listeners. Called on logout so a newly-authenticated user
 * doesn't inherit the previous user's push token route.
 */
export async function teardownPushNotifications() {
  if (!isNative) return;
  try {
    while (listenerHandles.length > 0) {
      const h = listenerHandles.pop();
      try { await h?.remove(); } catch {}
    }
    listenersAttached = false;
    initialized = false;
  } catch {}
}

/**
 * Stable per-install identifier, persisted in localStorage. This is the KEY
 * that makes "one physical device = one device_tokens row" possible.
 *
 * Why it exists: FCM/APNs rotate a device's push token periodically. When the
 * table was keyed on (user_id, token), a rotation inserted a SECOND row and the
 * stale row lingered until a failed send pruned it — and in the window where
 * both tokens were still deliverable, ONE notification fanned out to the SAME
 * device twice. Keying on a per-install id instead lets the upsert UPDATE the
 * single row in place on rotation, so there is never a second row to duplicate.
 *
 * It survives app launches (localStorage on native persists), and regenerates
 * only on reinstall / app-data-clear — which is genuinely a new install; the
 * old row's token goes stale and is pruned on the next failed send.
 */
function getInstallId() {
  try {
    let id = localStorage.getItem('cr_install_id');
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.())
        || `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('cr_install_id', id);
    }
    return id;
  } catch {
    // localStorage unavailable — volatile id (degrades to old per-token rows).
    return (globalThis.crypto?.randomUUID?.()) || `inst-${Date.now()}`;
  }
}

/**
 * Upsert a device token in supabase. Keyed by (user_id, device_id) so the same
 * physical device keeps ONE row even as its push token rotates — a rotation
 * UPDATES the row (new token, same row) instead of inserting a duplicate. A
 * user across multiple devices still gets one row per device (distinct
 * device_id), and a device that signs into a different account gets its own
 * row (distinct user_id). Stale rows (after reinstall) are pruned by
 * dispatch-push when a send returns "not-registered".
 *
 * Deploy order: the (user_id, device_id) unique index must exist on the DB
 * (supabase-device-tokens-device-id-dedup-2026-06-29.sql) before a native
 * build shipping this onConflict reaches users — otherwise the upsert has no
 * matching constraint and throws (caught below; push registration stalls).
 */
async function registerDeviceToken(userId, token) {
  if (!userId || !token) return;
  const platform = await detectPlatform();
  const deviceId = getInstallId();
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { user_id: userId, token, platform, device_id: deviceId, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,device_id' }
    );
  if (error) throw error;
  if (DEBUG) console.log(`[push] device token registered (${platform})`);
}

async function detectPlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    const p = Capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'unknown';
  }
}

/**
 * Foreground push presentation — ANDROID ONLY.
 *
 * Each platform owns foreground presentation natively, and we forward only
 * where the OS leaves a gap:
 *   - iOS: capacitor.config `presentationOptions: ['badge','sound','alert']`
 *     tells the OS to present the banner itself while the app is foregrounded.
 *     Forwarding here too would show TWO banners — so we return early on iOS.
 *   - Android: a foreground FCM `notification` message is delivered to this
 *     listener and is NOT auto-presented by the system, so the app must
 *     surface it. That's this function's only job.
 *
 * No cross-path dedup flags: OS push is the SOLE owner of the device banner
 * for an app_notifications row. The in-app bell and the Realtime listener no
 * longer fire local notifications, so there is nothing left to coordinate
 * against — one push delivered foreground = exactly one banner (here, Android).
 */
async function forwardForegroundToLocal(notif) {
  try {
    const platform = await detectPlatform();
    if (platform !== 'android') return;

    const title = notif?.title || notif?.data?.title || 'CarReminder';
    const body  = notif?.body  || notif?.data?.body  || '';
    if (!title && !body) return;

    const { scheduleLocalNotification } = await import('./notificationChannels');
    await scheduleLocalNotification({
      id: `push-${Date.now()}`,
      title,
      body,
      scheduleAt: new Date(Date.now() + 300),
      extra: { source: 'push-foreground', ...(notif?.data || {}) },
    });
  } catch (e) {
    if (DEBUG) console.warn('[push] forwardForegroundToLocal failed:', e?.message);
  }
}
