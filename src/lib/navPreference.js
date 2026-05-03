// Driver nav-app preference: 'waze' | 'google' | null.
//
// Stored in localStorage so it persists across sessions on the same
// device. Per-driver, per-device — there's no server-side state.
//
// Resolution order at action time:
//   1. If the driver has chosen + remembered a preference → open that app
//      directly with the destination.
//   2. Otherwise the caller (NavigateButton) shows a one-time chooser
//      sheet with "remember my choice" so future taps go straight to the
//      app.

const KEY = 'cardocs.navPreference';
export const NAV_OPTIONS = ['waze', 'google'];

export function getNavPreference() {
  try {
    const v = localStorage.getItem(KEY);
    return NAV_OPTIONS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function setNavPreference(value) {
  try {
    if (!NAV_OPTIONS.includes(value)) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, value);
  } catch {
    /* private mode / quota — silently no-op */
  }
}

export function clearNavPreference() {
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

// Build the deep link for a chosen app + destination. The destination
// can be either coordinates ({lat, lng}) — preferred when available —
// or a free-text address that the navigation app resolves itself.
export function buildNavUrl(app, destination) {
  if (!destination) return null;
  const hasCoords = Number.isFinite(destination.lat) && Number.isFinite(destination.lng);
  if (app === 'waze') {
    return hasCoords
      ? `https://waze.com/ul?ll=${destination.lat},${destination.lng}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(destination.address || '')}&navigate=yes`;
  }
  if (app === 'google') {
    return hasCoords
      ? `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination.address || '')}&travelmode=driving`;
  }
  return null;
}

export function openNav(app, destination) {
  const url = buildNavUrl(app, destination);
  if (!url) return false;
  window.open(url, '_blank');
  return true;
}
