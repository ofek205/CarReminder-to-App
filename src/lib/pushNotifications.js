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
 *      listener, which forwards them to the existing LocalNotifications
 *      surface so the user sees a banner even with the app open.
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
          // Server push is live on this device → the in-app bell must skip its
          // fallback local-fire (dispatch-push already delivers each
          // app_notification; firing locally too = a duplicate banner).
          try { localStorage.setItem('cr_push_active', '1'); } catch {}
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
    // Drop the "push live" flag so the next account (which may not have push)
    // gets the bell's local-fire fallback again.
    try { localStorage.removeItem('cr_push_active'); } catch {}
  } catch {}
}

/**
 * Upsert a device token in supabase. Keyed by (user_id, token) so the
 * same physical device that signs into a different account gets its own
 * row, and the same user across devices accumulates one row per device.
 * Tokens FCM/APNs rotate are upserted afresh — old rows go stale and
 * get pruned by the cleanup logic in dispatch-push (any send that
 * returns "not-registered" causes the row to be deleted).
 */
async function registerDeviceToken(userId, token) {
  if (!userId || !token) return;
  const platform = await detectPlatform();
  const { error } = await supabase
    .from('device_tokens')
    .upsert(
      { user_id: userId, token, platform, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' }
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
 * When a push arrives while the app is in the foreground, FCM by
 * default delivers it silently. Mirror it through LocalNotifications so
 * the user still sees the banner / hears the sound.
 *
 * Dedup with the Realtime mirror (useSharedVehicleRealtime) and the
 * NotificationBell first-fetch mirror via the shared localStorage flag
 *   `app_push_fired_<app_notifications.id>`
 * The dispatch-push trigger now includes the row id under
 * `data.app_notif_id` precisely so this path can apply the same flag.
 * Without it a foregrounded user would see two banners per event —
 * one from this handler and one from the Realtime mirror that fires
 * 1500ms later for the same INSERT.
 *
 * If app_notif_id is missing (legacy trigger, system-test pushes, …)
 * we skip the dedup check and forward anyway — better to show a
 * possibly-duplicate banner than to swallow a legitimate push.
 */
async function forwardForegroundToLocal(notif) {
  try {
    const title = notif?.title || notif?.data?.title || 'CarReminder';
    const body  = notif?.body  || notif?.data?.body  || '';
    if (!title && !body) return;

    const appNotifId = notif?.data?.app_notif_id;
    if (appNotifId) {
      try {
        const dedupKey = `app_push_fired_${appNotifId}`;
        if (localStorage.getItem(dedupKey)) return; // Realtime already fired
        localStorage.setItem(dedupKey, '1');
      } catch { /* storage unavailable — fall through to schedule */ }
    }

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
