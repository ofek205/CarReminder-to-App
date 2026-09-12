/**
 * The closed list of screens the marketing preview may be pointed at.
 *
 * This is the security boundary of the two-way sync, not a convenience.
 * The marketing page and the framed app talk over postMessage, and the
 * message carries a screen ID from this list, NEVER a path. If it carried a
 * path, anything able to post into the frame could steer the app anywhere,
 * and the frame runs on the app's own origin with whatever session the
 * visitor has. An unknown ID resolves to nothing and the message is dropped.
 *
 * Every entry is deliberately zero-network, zero-permission and
 * zero-localStorage. `/FindGarage` and `/AiAssistant` are absent on purpose:
 * FindGarage asks for geolocation, fires an Overpass query through the shared
 * overpass-proxy Edge Function and sweeps the visitor's `fg_*` cache keys, all
 * on mount, and aiProxy has no demo gate at all. Neither belongs one click
 * away from a public page. See docs/spec-marketing-demo-two-way-sync.md.
 */

// Mirrors DEMO_VEHICLE_ID / DEMO_VESSEL_ID in
// components/shared/demoVehicleData.js. Duplicated rather than imported so
// the marketing bundle does not pull that whole dataset in for two strings,
// and pinned by a unit test so the copies cannot drift apart.
export const DEMO_VEHICLE_ROUTE_ID = 'demo_vehicle_001';
export const DEMO_VESSEL_ROUTE_ID = 'demo_vessel_001';

export const DEMO_SCREENS = [
  { id: 'dashboard', path: '/Dashboard' },
  { id: 'vehicles', path: '/Vehicles' },
  { id: 'detail', path: `/VehicleDetail?id=${DEMO_VEHICLE_ROUTE_ID}` },
  { id: 'documents', path: '/Documents' },
  { id: 'vessels', path: '/Vehicles?category=vessel' },
];

/** The screen the preview boots into. Also the selector's opening mark. */
export const DEMO_HOME_ID = 'dashboard';

export function pathForScreen(id) {
  return DEMO_SCREENS.find(s => s.id === id)?.path || null;
}

/**
 * Reverse lookup: which list entry, if any, is this location?
 *
 * `/Vehicles` and `/Vehicles?category=vessel` share a pathname, so the query
 * has to be part of the decision. Getting this wrong would mark "הרכבים שלי"
 * while the frame shows the vessel list, which is exactly the kind of quiet
 * lie the whole feature exists to remove.
 *
 * Returns null for anything off the list, which the marketing side renders as
 * "no item marked" rather than guessing.
 */
export function screenIdFor(pathname, search = '') {
  if (!pathname) return null;
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  let category = '';
  try {
    category = new URLSearchParams(search || '').get('category') || '';
  } catch { category = ''; }

  if (path === '/dashboard') return 'dashboard';
  if (path === '/documents') return 'documents';
  if (path === '/vehicledetail') return 'detail';
  if (path === '/vehicles') {
    return category.toLowerCase() === 'vessel' ? 'vessels' : 'vehicles';
  }
  return null;
}
