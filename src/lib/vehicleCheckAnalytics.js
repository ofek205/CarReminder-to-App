/**
 * GA4 event for the public website plate check.
 *
 * Fired once a real lookup on /website has an outcome. The in-app page at
 * /vehicle-check uses the same component and must not send a hit, so the
 * path gate lives here rather than at the call site.
 *
 * The payload is a fixed whitelist. The plate, the typed input, query
 * strings, vehicle fields, and user ids are never read and never sent.
 * A missing gtag (app routes, blocked scripts, tests) is a no-op.
 * Nothing here may throw into the form.
 */

const FORM_LOCATIONS = new Set(['home_form', 'vehicle_check_page']);
const RESULT_STATUSES = new Set(['found', 'not_found', 'error']);

function isWebsitePath(pathname) {
  return pathname === '/website' || pathname.startsWith('/website/');
}

export function trackVehicleCheckSubmit({ formLocation, resultStatus } = {}) {
  try {
    if (typeof window === 'undefined') return;
    if (typeof window.gtag !== 'function') return;
    const pathname = window.location && window.location.pathname;
    if (typeof pathname !== 'string' || !isWebsitePath(pathname)) return;
    if (!FORM_LOCATIONS.has(formLocation)) return;

    const params = {
      page_path: pathname,
      form_location: formLocation,
      link_location: formLocation,
    };
    if (RESULT_STATUSES.has(resultStatus)) {
      params.result_status = resultStatus;
    }

    window.gtag('event', 'vehicle_check_submit', params);
  } catch {
    // A broken analytics call must not change the lookup the visitor just ran.
  }
}
