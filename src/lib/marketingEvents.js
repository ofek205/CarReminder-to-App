const EVENTS = new Set(['store_click', 'web_signin_click', 'business_contact_click', 'check_submit', 'check_validation_error', 'demo_open', 'demo_screen']);

// An integration point, not an analytics service. No storage or network calls.
// A future collector should subscribe only after its consent requirements
// have been met. Never pass form values, URLs with queries, or vehicle data.
export function marketingEvent(name, placement) {
  if (!EVENTS.has(name) || !['header', 'home', 'business', 'download'].includes(placement)) return;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('carreminder:marketing', { detail: { name, placement } }));
  }
}

// GA4 store clicks are not sent from React. src/lib/siteGtagSnippet.js
// installs one document listener that emits app_store_click and
// play_store_click. A gtag() call in an onClick handler would send the
// same event a second time. marketingEvent() above stays the inert
// in-app signal it has always been.
