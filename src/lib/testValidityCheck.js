// Plate check for the static test-reminder guide.
//
// One filtered request to the public private-car registry on data.gov.il
// (resource 053cea08-09bc-40ec-8f7a-156f0677aff3). The same resource and
// tokef_dt / mivchan_acharon_dt fields are already used by
// src/services/vehicleLookup.js. This page asks only for the date and
// identity columns, so the response does not include the plate, the VIN,
// or ownership.
//
// The plate is used to build that request and nowhere else. It is not
// written to storage, not put on the URL, and not sent to analytics.

const RESOURCE_ID = '053cea08-09bc-40ec-8f7a-156f0677aff3';
const DATA_GOV_SEARCH = 'https://data.gov.il/api/3/action/datastore_search';
// Same local proxy as vehicleLookup.js. Production and previews call data.gov.il
// directly; only a local dev host uses the Vite proxy, which avoids CORS.
const DEV_PROXY_SEARCH = '/gov-api/api/3/action/datastore_search';
const FIELDS = ['tokef_dt', 'mivchan_acharon_dt', 'tozeret_nm', 'kinuy_mishari', 'shnat_yitzur'];
const REQUEST_MS = 8000;
const EXPIRING_SOON_DAYS = 30;
const RESULT_STATUSES = new Set(['invalid', 'found', 'not_found', 'offline', 'network', 'error']);

function searchEndpoint() {
  if (typeof window === 'undefined') return DATA_GOV_SEARCH;
  const host = window.location?.hostname || '';
  const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  return local ? DEV_PROXY_SEARCH : DATA_GOV_SEARCH;
}

function browserIsOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function normalizePlateDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!/^[1-9]\d{6,7}$/.test(digits)) {
    return { ok: false, message: 'מספר רישוי צריך 7 או 8 ספרות.' };
  }
  return { ok: true, plate: digits };
}

function cleanText(value, max = 60) {
  if (value == null) return '';
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanDate(value) {
  const s = String(value ?? '').split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [year, month, day] = s.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return s;
}

function cleanYear(value, today = new Date()) {
  const year = parseInt(value, 10);
  if (year >= 1900 && year <= today.getFullYear() + 1) return String(year);
  return '';
}

export function daysUntil(isoDate, today = new Date()) {
  const clean = cleanDate(isoDate);
  if (!clean) return null;
  const [year, month, day] = clean.split('-').map(Number);
  const due = new Date(year, month - 1, day);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86400000);
}

export function formatHebrewDate(isoDate) {
  const clean = cleanDate(isoDate);
  if (!clean) return '';
  const [year, month, day] = clean.split('-');
  return `${day}.${month}.${year}`;
}

export function validityPhrase(days) {
  if (typeof days !== 'number') return '';
  if (days > 1) return `נותרו ${days} ימים`;
  if (days === 1) return 'נותר יום אחד';
  if (days === 0) return 'התוקף עד היום';
  const ago = Math.abs(days);
  if (ago === 1) return 'פג תוקף לפני יום';
  return `פג תוקף לפני ${ago} ימים`;
}

export function presentTestValidity(record, today = new Date()) {
  const testDueDate = cleanDate(record?.testDueDate);
  const lastTestDate = cleanDate(record?.lastTestDate);
  const days = testDueDate ? daysUntil(testDueDate, today) : null;
  const identity = [cleanText(record?.manufacturer), cleanText(record?.model)].filter(Boolean).join(' ');
  const year = cleanYear(record?.year, today);
  return {
    identityLine: [identity, year].filter(Boolean).join(', '),
    dueLabel: testDueDate ? formatHebrewDate(testDueDate) : '',
    duePhrase: days === null ? '' : validityPhrase(days),
    expired: typeof days === 'number' && days < 0,
    expiringSoon: typeof days === 'number' && days >= 0 && days <= EXPIRING_SOON_DAYS,
    lastTestLabel: lastTestDate ? formatHebrewDate(lastTestDate) : '',
    missingDue: !testDueDate,
  };
}

function sanitizeRecord(record, today) {
  return {
    testDueDate: cleanDate(record?.tokef_dt),
    lastTestDate: cleanDate(record?.mivchan_acharon_dt),
    manufacturer: cleanText(record?.tozeret_nm),
    model: cleanText(record?.kinuy_mishari),
    year: cleanYear(record?.shnat_yitzur, today),
  };
}

export async function lookupTestValidity(plateDigits, { fetchImpl = fetch, today = new Date(), signal } = {}) {
  if (signal?.aborted) return { status: 'aborted' };
  if (browserIsOffline()) return { status: 'offline' };
  const filters = encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plateDigits) }));
  const fields = encodeURIComponent(FIELDS.join(','));
  const url = `${searchEndpoint()}?resource_id=${encodeURIComponent(RESOURCE_ID)}&filters=${filters}&fields=${fields}&limit=1`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_MS);
  const onCallerAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return { status: 'error' };
    const json = await res.json();
    if (!json?.success || !json.result) return { status: 'error' };
    const record = json.result.records?.[0];
    if (!record) return { status: 'not_found' };
    return { status: 'found', record: sanitizeRecord(record, today) };
  } catch {
    if (signal?.aborted) return { status: 'aborted' };
    if (browserIsOffline()) return { status: 'offline' };
    return { status: 'network' };
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }
}

export function trackTestCheckSubmit(resultStatus) {
  try {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
    if (!RESULT_STATUSES.has(resultStatus)) return;
    const pathname = window.location && window.location.pathname;
    if (pathname !== '/website/guides/test-reminder') return;
    window.gtag('event', 'test_check_submit', {
      result_status: resultStatus,
      page_path: pathname,
    });
  } catch {
    // A broken analytics call must not change the check the visitor just ran.
  }
}
