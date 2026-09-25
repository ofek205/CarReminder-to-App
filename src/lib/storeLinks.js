import { APPLE_STORE_URL, GOOGLE_PLAY_URL } from './marketingSchema';

const CT_PREFIX = 'website_';
const CT_MAX = 40;

function sanitizeLocation(location) {
  const loc = String(location ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  return loc || 'other';
}

export function appStoreUrl(location) {
  const loc = sanitizeLocation(location);
  const ct = (CT_PREFIX + loc).slice(0, CT_MAX);
  return `${APPLE_STORE_URL}?ct=${ct}`;
}

export function googlePlayUrl(location) {
  const loc = sanitizeLocation(location);
  const referrer = `utm_source=car-reminder.app&utm_medium=website&utm_campaign=${loc}`;
  return `${GOOGLE_PLAY_URL}&referrer=${encodeURIComponent(referrer)}`;
}
