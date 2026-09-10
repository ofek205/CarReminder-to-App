const EVENTS = new Set(['store_click', 'web_signin_click', 'business_contact_click', 'check_submit', 'check_validation_error']);

// An integration point, not an analytics service. No storage or network calls.
// A future collector should subscribe only after its consent requirements
// have been met. Never pass form values, URLs with queries, or vehicle data.
export function marketingEvent(name, placement) {
  if (!EVENTS.has(name) || !['header', 'home', 'business', 'download'].includes(placement)) return;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('carreminder:marketing', { detail: { name, placement } }));
  }
}
