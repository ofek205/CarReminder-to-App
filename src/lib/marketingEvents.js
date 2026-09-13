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

/**
 * GA4 store-click event, alongside (not instead of) marketingEvent above —
 * this is the actual analytics collector, that one is still the inert
 * placeholder its own comment describes. `store` is 'apple' or 'google';
 * `href` is the real store URL, echoed back so it shows up in GA4 without
 * needing a lookup. No-ops if gtag hasn't loaded (it always has on a
 * /website/* page, since marketing-prerender.mjs injects it into every
 * one, but this is called from shared components too, defensively).
 */
export function trackStoreClickGA4(store, href) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const isApple = store === 'apple';
  window.gtag('event', isApple ? 'app_store_click' : 'play_store_click', {
    link_url: href,
    store: isApple ? 'app_store' : 'google_play',
    page_path: window.location.pathname,
  });
}
