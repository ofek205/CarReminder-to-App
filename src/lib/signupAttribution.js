/**
 * Signup attribution — "where did this user come from?"
 *
 * Context (2026-09-07): signups jumped ~18x and we had no way to tell why,
 * because signUp() stored only `full_name` and the analytics table is an
 * anonymous daily counter. This module captures the acquisition context of a
 * visit and stamps it onto the user record at signup time.
 *
 * SCOPE — read this before trusting the numbers:
 * This only works for WEB visits. A native app install from the App Store /
 * Play Store carries NO referrer and no UTM, by design of the stores — such
 * users are recorded as `store_or_direct`, and the real breakdown for them
 * lives in App Store Connect → Analytics → Sources and Play Console →
 * Acquisition. No amount of client code can recover it.
 *
 * DESIGN — one path, deliberately:
 *   1. captureAttribution() runs once per install/browser on first load,
 *      BEFORE the router can strip the query string. First-touch wins: we
 *      never overwrite a stored value, so the original campaign survives the
 *      OAuth redirect round-trip and any later internal navigation.
 *   2. persistAttributionIfNewUser() runs on SIGNED_IN and writes the stash
 *      into the user's auth metadata — for email AND OAuth signups alike.
 *      There is intentionally no second write path in signUp()'s options.data:
 *      two writers of one fact drift apart, and coordinating them is exactly
 *      the class of bug this codebase just spent a session removing.
 *
 * PRIVACY: we store the referrer's HOSTNAME only, never the full URL, and the
 * landing PATH without its query string (apart from the utm_* keys we read
 * explicitly). Referrer URLs and query strings routinely carry personal data;
 * none of it belongs in an analytics field.
 */

const STORE_KEY = 'cr_attribution';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

// A signup is "fresh" if the account was created within this window. Anything
// older is a RETURNING user signing in again — stamping today's attribution on
// them would fabricate history, so we skip. This is what keeps the field
// meaning "acquisition source" rather than "last visit source".
const NEW_USER_WINDOW_MS = 10 * 60 * 1000;

// Cap every stored string. Query params and referrers are attacker-controlled
// input; unbounded values have no business reaching the DB.
const MAX_LEN = 120;

function clean(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Capture the acquisition context of THIS visit, once. Idempotent and silent:
 * safe to call on every boot, never throws, no-ops if a value is already
 * stored (first-touch attribution).
 */
export function captureAttribution() {
  try {
    if (localStorage.getItem(STORE_KEY)) return; // first touch already recorded

    const params = new URLSearchParams(window.location?.search || '');
    const utm = {};
    for (const key of UTM_KEYS) {
      const v = clean(params.get(key));
      if (v) utm[key] = v;
    }

    // Hostname only — never the full referrer URL (see PRIVACY above).
    let referrerHost = null;
    try {
      const ref = document.referrer;
      if (ref) {
        const host = new URL(ref).hostname;
        // Same-origin referrers are internal navigation, not acquisition.
        if (host && host !== window.location.hostname) referrerHost = clean(host);
      }
    } catch { /* malformed referrer — ignore */ }

    // Explicit channel label so queries don't have to re-derive intent.
    const hasUtm = Object.keys(utm).length > 0;
    const channel = hasUtm ? 'campaign'
      : referrerHost ? 'referral'
      : 'store_or_direct';   // native install or typed/bookmarked — indistinguishable client-side

    const record = {
      channel,
      ...utm,
      ...(referrerHost ? { referrer_host: referrerHost } : {}),
      landing_path: clean(window.location?.pathname) || '/',
      captured_at: new Date().toISOString(),
    };

    localStorage.setItem(STORE_KEY, JSON.stringify(record));
  } catch { /* private mode / storage disabled — attribution is best-effort */ }
}

/** Read back the stored first-touch record, or null. */
export function getStoredAttribution() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

/**
 * Stamp the stored attribution onto a just-created user's auth metadata.
 * Called on SIGNED_IN for every provider. No-ops (cheaply, before any network
 * call) when:
 *   - the account is older than NEW_USER_WINDOW_MS → returning user, and
 *     writing would invent an acquisition source they never had;
 *   - the user already carries `signup_attribution` → first write stands;
 *   - nothing was captured on this device.
 *
 * Lands in raw_user_meta_data.signup_attribution, so it aggregates with the
 * same SQL shape already used for provider breakdowns. Fire-and-forget:
 * failure must never block the user reaching the app.
 */
export async function persistAttributionIfNewUser(user) {
  try {
    if (!user?.id || !user?.created_at) return;
    if (user.user_metadata?.signup_attribution) return;

    const createdAt = new Date(user.created_at).getTime();
    if (!Number.isFinite(createdAt)) return;
    if (Date.now() - createdAt > NEW_USER_WINDOW_MS) return;

    const attribution = getStoredAttribution();
    if (!attribution) return;

    const { supabase } = await import('./supabase');
    // updateUser merges into the caller's OWN metadata — no elevated rights,
    // no other user reachable. Client-writable, so treat it as a self-reported
    // analytics hint, never as a security or billing input.
    await supabase.auth.updateUser({ data: { signup_attribution: attribution } });
  } catch { /* best-effort analytics — never surface to the user */ }
}
