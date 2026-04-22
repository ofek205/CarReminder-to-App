/**
 * First-launch permission bootstrap.
 *
 * Asks for every native permission the app will eventually need, up-front
 * on the very first app launch, instead of surprising the user deep in
 * a workflow. Users get a single consecutive run of Android permission
 * dialogs — the standard pattern they already recognize from banking /
 * rideshare apps.
 *
 * Covered:
 *   • Geolocation   — needed by FindGarage (and any "near me" search).
 *                     Without this, FindGarage silently falls back to
 *                     Tel Aviv coordinates, which users have reported
 *                     as a bug because they're nowhere near Tel Aviv.
 *   • LocalNotifications — required on Android 13+ (POST_NOTIFICATIONS).
 *                     initNotifications() does its own ask, but we nudge
 *                     it here too so everything happens at once.
 *   • Camera         — license-plate scan, vehicle photo, driver-license
 *                     scan. Takes the camera prompt out of the middle
 *                     of an interaction flow.
 *
 * Called exactly once per install via a localStorage sentinel. If the
 * user denies any permission they can still grant it later from their
 * device settings — we don't nag.
 *
 * No-op on web (permissions there are requested inline by the browser
 * the first time we actually use them, which is the web-platform
 * convention).
 */

import { isNative } from './capacitor';

const SENTINEL_KEY = 'cr_perms_bootstrapped_v1';

export async function requestAllPermissionsOnFirstLaunch() {
  if (!isNative) return;
  try {
    if (localStorage.getItem(SENTINEL_KEY) === '1') return;
  } catch {
    // localStorage can throw in privacy mode; treat as "never prompted"
  }

  // Order matters for UX. Location is the highest-value prompt
  // (FindGarage is broken without it), so ask for it first while the
  // user is still paying attention. Notifications second because the
  // Android 13+ system dialog is modal. Camera last — deniable and
  // triggered again naturally by the camera plugin if we reach it.
  await requestGeolocation();
  await requestNotifications();
  await requestCamera();

  try { localStorage.setItem(SENTINEL_KEY, '1'); } catch {}
}

async function requestGeolocation() {
  try {
    const mod = await import('@capacitor/geolocation');
    const Geolocation = mod?.Geolocation;
    if (!Geolocation?.requestPermissions) return;
    await Geolocation.requestPermissions();
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Geolocation permission request failed:', err);
  }
}

async function requestNotifications() {
  try {
    const mod = await import('@capacitor/local-notifications');
    const LocalNotifications = mod?.LocalNotifications;
    if (!LocalNotifications?.requestPermissions) return;
    await LocalNotifications.requestPermissions();
  } catch (err) {
    if (import.meta.env.DEV) console.warn('LocalNotifications permission request failed:', err);
  }
}

async function requestCamera() {
  try {
    const mod = await import('@capacitor/camera');
    const Camera = mod?.Camera;
    if (!Camera?.requestPermissions) return;
    // 'camera' and 'photos' cover both taking a picture and picking
    // from the gallery (Android 13+ requires READ_MEDIA_IMAGES).
    await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Camera permission request failed:', err);
  }
}

/**
 * Escape hatch for settings screens that want a "request again" button.
 * Wiping the sentinel lets the bootstrap rerun next launch.
 */
export function resetPermissionBootstrap() {
  try { localStorage.removeItem(SENTINEL_KEY); } catch {}
}
