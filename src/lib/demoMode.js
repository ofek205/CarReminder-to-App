/**
 * Demo mode flag for the marketing site's read-only app preview.
 *
 * The preview lives in an iframe at /website/demo on the SAME ORIGIN as the
 * real app, which is what makes this flag necessary. Once the visitor taps
 * "רכבים" inside the frame, React Router pushes to /Vehicles, an ordinary
 * app route. Without a flag that outlives that navigation, the second screen
 * would boot the real auth stack and a signed-in visitor would be looking at
 * their own vehicles inside a marketing page.
 *
 * Module-level and URL-derived, deliberately:
 *   - It survives every in-frame navigation, because router pushes do not
 *     re-evaluate modules.
 *   - It does NOT survive a full page load, so it can never leak into a
 *     normal app tab. Opening /Vehicles directly is always the real app.
 *   - It is not readable or writable from storage, so an XSS cannot flip a
 *     real session into demo mode (or the reverse) the way the historical
 *     localStorage force-guest key could. See the H-4 audit note in
 *     GuestContext.jsx for why that distinction matters here.
 *
 * Known limit: a hard reload INSIDE the frame lands on a normal app route
 * with the flag cleared. The frame is sandboxed without browser chrome, so
 * a visitor has no ordinary way to trigger one, and the failure mode is the
 * safe direction (real app, real auth) rather than the unsafe one.
 */

export const DEMO_ENTRY_PATH = '/demo';

/**
 * Derived from the URL at import time, NOT set by a component.
 *
 * The first attempt had the entry route call an enableDemoMode() at module
 * scope, and it could not work: that route is lazy-loaded, so its module
 * evaluated long after Layout had already read the flag, composed the real
 * auth tree and bounced the visitor to /Auth. Reading location here runs
 * when Layout imports this module, which is before the first render.
 *
 * Captured ONCE from the initial URL rather than read live, so it survives
 * every in-frame navigation to a normal app route.
 */
const initialPath = typeof window === 'undefined' ? '' : window.location.pathname;

const demoMode = initialPath === DEMO_ENTRY_PATH
  || initialPath.startsWith(`${DEMO_ENTRY_PATH}/`);

// Dev-only: the flag is captured at import time and the URL has usually
// changed by the time anyone can inspect it, which made an earlier round of
// debugging read `false` on a preview that was working correctly. Exposing
// the boot-time values makes that mistake impossible to repeat.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__crDemoMode = { demoMode, initialPath };
}

export function isDemoMode() {
  return demoMode;
}

/**
 * Screens whose entire purpose is to write something.
 *
 * The preview gates writes at the data layer, which is correct but fires too
 * late on its own: a visitor could open "הוספת כלי תחבורה", fill the whole
 * form, and only learn at submit that it was never going to save. Stopping
 * at the door costs them nothing and stops the demo from having dead ends.
 *
 * Read screens are deliberately absent. Browsing, filtering and opening a
 * vehicle card are the demo, and gating those would make the app feel
 * locked rather than real.
 */
const WRITE_ONLY_ROUTES = [
  '/AddVehicle',
  '/BulkAddVehicles',
  '/AddAccident',
  '/EditVehicle',
  '/CreateRoute',
  '/ChecklistEditor',
  '/CreateBusinessWorkspace',
];

/**
 * Routes the preview must never land on, whatever route it out.
 *
 * `/Auth` is the whole list and it is a belt, not a feature. A sign-in screen
 * inside a 390px marketing frame is a dead end twice over: there is nothing
 * there for a visitor who has no account, and no browser chrome to leave with.
 * The known way in was MobileBackButton's navigate(-1), which is fixed at
 * source, and this catches any other path, a stray link or a guard, without
 * needing to have found it first.
 */
const FORBIDDEN_ROUTES = ['/Auth'];

export function isForbiddenDemoRoute(pathname) {
  if (!pathname) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  return FORBIDDEN_ROUTES.some(r => path === r.toLowerCase());
}

export function isWriteOnlyRoute(pathname) {
  if (!pathname) return false;
  const path = pathname.toLowerCase();
  return WRITE_ONLY_ROUTES.some(route => {
    const r = route.toLowerCase();
    return path === r || path.startsWith(`${r}/`);
  });
}
