// ═══════════════════════════════════════════════════════════════════════════
// Google Play Developer API access, shared by the functions that need it.
//
// ⚠️ verify-play-purchase STILL CARRIES ITS OWN COPY OF THIS CODE, AND THAT
// IS A DELIBERATE, TEMPORARY CHOICE RATHER THAN AN OVERSIGHT.
//   It is deployed and verified against the live project. Rewriting it to
//   import from here would mean redeploying a working, money-handling
//   function purely for tidiness, and a deploy is a step only Ofek can take.
//   Migrate it the next time it is deployed for a reason of its own. Until
//   then, any change to the signing or token-exchange logic has to be made
//   in BOTH places, which is the cost of leaving it, stated plainly so the
//   next person does not find the divergence by being bitten by it.
//
// SECRETS (Supabase → Edge Functions → Secrets, NOT GitHub Actions)
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   the whole service-account JSON
//
// ⚠️ A secret of the same name exists in GitHub Actions for the release
// build. They are unrelated stores and are not synced; an Edge Function
// cannot read GitHub's.
// ═══════════════════════════════════════════════════════════════════════════

/** Must match android/app/build.gradle applicationId. */
export const PACKAGE_NAME = 'com.carreminder.app';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API_ROOT = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

// ── JWT, RS256 ──────────────────────────────────────────────────────────────
// ⚠️ RS256 HERE, ES256 IN apple-revoke. Different key type, different
// algorithm; copying the Apple importKey call across fails with a message
// that reads like a bad key rather than a wrong algorithm.

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  // The JSON stores the PEM with literal \n escapes. Un-escaping is not
  // cosmetic: the base64 body must be contiguous or atob rejects it.
  //
  // ⚠️ THE HEADERS ARE MATCHED BY PATTERN, NOT SPELLED OUT. .githooks/pre-commit
  // refuses any staged line containing `BEGIN [A-Z ]*PRIVATE KEY`, so writing
  // the literal here blocks the commit as if a real key had been staged. The
  // gate is right to be that blunt; a character class costs nothing and also
  // accepts the `RSA PRIVATE KEY` spelling if a key is ever issued that way.
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-{5}BEGIN [A-Z ]*KEY-{5}/, '')
    .replace(/-{5}END [A-Z ]*KEY-{5}/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export type ServiceAccount = Record<string, string>;

/** Parses the secret, or returns null when it is absent or malformed. */
export function readServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa?.client_email && sa?.private_key && sa?.token_uri ? sa : null;
  } catch {
    return null;
  }
}

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await importServiceAccountKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body?.access_token) {
    // Surfaced verbatim because the two likely causes look identical from the
    // outside: the androidpublisher API not enabled on the project, and the
    // service account not invited in Play Console.
    throw new Error(`token_exchange_failed: ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
}

export type SubscriptionLookup =
  | { ok: true; sub: Record<string, unknown> }
  | { ok: false; status: number; detail: string };

/**
 * subscriptionsv2.get — the single source of truth about a purchase token.
 *
 * ⚠️ ALWAYS ASK, NEVER INFER. An RTDN message carries a notificationType that
 * looks authoritative and is not: messages arrive out of order, are delivered
 * more than once, and describe an event rather than the state that followed
 * it. Two notifications racing, applied by type, can leave an account
 * revoked after a renewal. Fetching state makes the handler idempotent and
 * order-independent, which is the property Pub/Sub actually requires.
 */
export async function getSubscriptionState(
  accessToken: string,
  purchaseToken: string,
): Promise<SubscriptionLookup> {
  const url = `${API_ROOT}/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await res.text() };
  }
  return { ok: true, sub: await res.json() };
}

/**
 * Is this subscription entitled to the plan RIGHT NOW?
 *
 * ⚠️ CANCELED IS NOT EXPIRED, AND CONFLATING THEM TAKES ACCESS SOMEBODY HAS
 * PAID FOR. SUBSCRIPTION_STATE_CANCELED means "will not renew"; the user
 * keeps the plan until expiryTime, which may be a month away. Play sends the
 * cancellation notification immediately, so a handler that revokes on
 * CANCELED cuts a paying customer off the moment they decide not to renew,
 * which is both wrong and the most memorable thing we could do on the way out.
 *
 * IN_GRACE_PERIOD is a failed card, not a decision. Access stays.
 * ON_HOLD and PAUSED both mean access has genuinely stopped.
 */
export function entitlementFrom(sub: Record<string, unknown>): {
  entitled: boolean;
  state: string;
  productId: string;
  expiry: string | null;
} {
  const state = String((sub as Record<string, unknown>)?.subscriptionState || '');
  const lineItems = ((sub as Record<string, unknown>)?.lineItems || []) as Array<Record<string, unknown>>;
  const productId = String(lineItems[0]?.productId || '');
  const expiry = String(lineItems[0]?.expiryTime || '') || null;

  const expiryMs = expiry ? Date.parse(expiry) : NaN;
  const stillInsidePaidPeriod = Number.isFinite(expiryMs) && expiryMs > Date.now();

  const entitled =
    state === 'SUBSCRIPTION_STATE_ACTIVE' ||
    state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' ||
    (state === 'SUBSCRIPTION_STATE_CANCELED' && stillInsidePaidPeriod);

  return { entitled, state, productId, expiry };
}

/**
 * Will this subscription renew when the current period ends?
 *
 * ⚠️ ENTITLED AND RENEWING ARE DIFFERENT QUESTIONS, AND WE ONLY STORED THE
 * FIRST. A cancelled subscription keeps its plan until expiryTime (see
 * entitlementFrom), so it was written as plain 'active', and /MyPlan then
 * told the person who had just cancelled "מתחדש ב...". Google answers the
 * second question directly in lineItems[].autoRenewingPlan.autoRenewEnabled.
 *
 * Returns null when Google does not say, and callers store null as
 * "unknown" rather than guessing either way.
 */
export function willRenewFrom(sub: Record<string, unknown>): boolean | null {
  const state = String((sub as Record<string, unknown>)?.subscriptionState || '');
  if (state === 'SUBSCRIPTION_STATE_CANCELED' || state === 'SUBSCRIPTION_STATE_EXPIRED') return false;
  const lineItems = ((sub as Record<string, unknown>)?.lineItems || []) as Array<Record<string, unknown>>;
  const plan = lineItems[0]?.autoRenewingPlan as Record<string, unknown> | undefined;
  if (plan && typeof plan.autoRenewEnabled === 'boolean') return plan.autoRenewEnabled;
  return null;
}

/**
 * The account id we attached at purchase time.
 *
 * The client passes our account uuid as `appAccountToken`, which Android
 * carries as the obfuscated external account id and the v2 API returns under
 * externalAccountIdentifiers. It is the only link back to us that survives an
 * upgrade, where Play issues a brand new purchase token.
 */
export function externalAccountIdFrom(sub: Record<string, unknown>): string | null {
  const ids = (sub as Record<string, unknown>)?.externalAccountIdentifiers as
    | Record<string, unknown>
    | undefined;
  const id = String(ids?.obfuscatedExternalAccountId || '');
  return id || null;
}
