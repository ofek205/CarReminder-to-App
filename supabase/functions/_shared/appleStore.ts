// ═══════════════════════════════════════════════════════════════════════════
// App Store Server API access, shared by verify-apple-purchase and
// app-store-notifications. The Apple counterpart of googlePlay.ts.
//
// ⚠️ NO Deno.* AT IMPORT TIME, ON PURPOSE. Everything that reads the
// environment or the network takes it as an argument, so this file runs under
// vitest (appleStore.test.ts) as well as in the edge runtime. The decisions
// that grant or revoke a paid plan are the ones worth a test, and neither
// function can be run locally: there is no Deno here and deploying is Ofek's.
//
// SECRETS (Supabase → Edge Functions → Secrets, NOT GitHub Actions)
//   APPLE_IAP_KEY_ID        10 chars, from the In-App Purchase key
//   APPLE_IAP_ISSUER_ID     a uuid, shown above the keys list
//   APPLE_IAP_PRIVATE_KEY   the whole .p8 file, header and footer included
//
// ⚠️ NOT THE SIGN IN WITH APPLE KEY. apple-revoke uses APPLE_SIWA_*; that is
// a different key, of a different type, for a different API, and Apple
// rejects one where the other belongs with a bare 401.
// ═══════════════════════════════════════════════════════════════════════════

/** iOS bundle id. PLURAL, unlike Android's com.carreminder.app. */
export const BUNDLE_ID = 'com.carreminders.app';

/**
 * The domains Apple's changelog now recommends. The older
 * api.storekit(-sandbox).itunes.apple.com hosts "will continue to be
 * supported", so either works; these are the ones the docs name today.
 */
export const API_ROOT = {
  Production: 'https://api.storekit.apple.com',
  Sandbox: 'https://api.storekit-sandbox.apple.com',
} as const;

export type AppleEnvironment = keyof typeof API_ROOT;

export type AppleIapConfig = {
  keyId: string;
  issuerId: string;
  privateKey: string;
  bundleId: string;
};

/** Returns null unless all three secrets are present. Fail closed. */
export function readAppleIapConfig(
  getEnv: (name: string) => string | undefined,
): AppleIapConfig | null {
  const keyId = getEnv('APPLE_IAP_KEY_ID') || '';
  const issuerId = getEnv('APPLE_IAP_ISSUER_ID') || '';
  const privateKey = getEnv('APPLE_IAP_PRIVATE_KEY') || '';
  if (!keyId || !issuerId || !privateKey) return null;
  return { keyId, issuerId, privateKey, bundleId: BUNDLE_ID };
}

// ── base64url ───────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

function b64urlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ── the API token, ES256 ────────────────────────────────────────────────

/**
 * Imports the .p8 (PKCS#8 PEM, EC P-256).
 *
 * ⚠️ THE PEM HEADERS ARE MATCHED BY PATTERN, NOT SPELLED OUT. .githooks/pre-commit
 * refuses any staged line containing the literal private-key header, so
 * writing it here would block the commit as if a real key had been staged.
 * Same trick as googlePlay.ts. Tolerates the "\n"-escaped form a single-line
 * secret field produces.
 */
async function importP8(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-{5}BEGIN [A-Z ]*KEY-{5}/, '')
    .replace(/-{5}END [A-Z ]*KEY-{5}/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * The bearer token for the App Store Server API.
 *
 * ⚠️ aud IS 'appstoreconnect-v1' AND bid IS REQUIRED. Leaving out bid, or
 * sending the Sign in with Apple audience, is answered with a 401 that says
 * nothing about which claim was wrong.
 *
 * WebCrypto's ECDSA signature is already the raw r‖s pair JWS ES256 wants,
 * the same point apple-revoke documents. Twenty minutes is well inside
 * Apple's one-hour ceiling and covers a function that makes two calls.
 */
export async function makeAppStoreApiToken(
  cfg: AppleIapConfig,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const payload = {
    iss: cfg.issuerId,
    iat: nowSec,
    exp: nowSec + 20 * 60,
    aud: 'appstoreconnect-v1',
    bid: cfg.bundleId,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await importP8(cfg.privateKey);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

// ── JWS ─────────────────────────────────────────────────────────────────

/**
 * The payload of an Apple JWS, WITHOUT verifying its signature.
 *
 * ⚠️ SAFE ONLY BECAUSE OF WHERE IT IS USED, AND THAT IS THE WHOLE DESIGN.
 * Every JWS this project decodes either
 *   (a) came straight back from api.storekit*.itunes.apple.com, over TLS, in
 *       answer to a request we signed, so Apple is the party we are talking
 *       to, the same trust Google's API gets in googlePlay.ts; or
 *   (b) came in a notification, where it is used ONLY to learn which
 *       transaction to ask Apple about. Nothing in a notification is ever
 *       written to an account. A forged one can at most make us re-read the
 *       true state of a real subscription, which changes nothing.
 * Never decode a client-supplied JWS with this and act on the result.
 */
export function decodeJwsPayload<T = Record<string, unknown>>(jws: unknown): T | null {
  if (typeof jws !== 'string') return null;
  const parts = jws.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1])) as T;
  } catch {
    return null;
  }
}

/** The fields of JWSTransactionDecodedPayload this project reads. */
export type AppleTransaction = {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment?: string;
  inAppOwnershipType?: string;
  type?: string;
};

/** The fields of JWSRenewalInfoDecodedPayload this project reads. */
export type AppleRenewal = {
  autoRenewStatus?: number;
  gracePeriodExpiresDate?: number;
  productId?: string;
  autoRenewProductId?: string;
};

// ── calls ───────────────────────────────────────────────────────────────

export type Fetch = typeof fetch;

export type AppleCall<T> =
  | { ok: true; environment: AppleEnvironment; body: T }
  | { ok: false; status: number; errorCode: number | null; detail: string };

/**
 * GET against the App Store Server API, production first, then sandbox.
 *
 * ⚠️ BOTH ENVIRONMENTS, BECAUSE APP REVIEW BUYS IN SANDBOX. A reviewer's
 * purchase, and every TestFlight purchase, is a sandbox transaction reaching
 * our production server. Apple's guidance is to ask production and, when it
 * answers that the id is not found there, ask sandbox. Answering "no" to the
 * reviewer is an IAP rejection.
 *
 * `prefer` puts one environment first when the caller already has a hint
 * (a notification says which one it came from). It is only an order: the
 * other environment is still tried on a not-found.
 */
export async function appleGet<T>(
  path: string,
  token: string,
  fetchImpl: Fetch,
  prefer: AppleEnvironment = 'Production',
): Promise<AppleCall<T>> {
  const order: AppleEnvironment[] = prefer === 'Sandbox'
    ? ['Sandbox', 'Production']
    : ['Production', 'Sandbox'];

  let last: AppleCall<T> | null = null;
  for (const env of order) {
    const res = await fetchImpl(`${API_ROOT[env]}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, environment: env, body: (await res.json()) as T };

    const detail = await res.text();
    let errorCode: number | null = null;
    try { errorCode = Number(JSON.parse(detail)?.errorCode) || null; } catch { /* not json */ }
    last = { ok: false, status: res.status, errorCode, detail: detail.slice(0, 300) };

    // Only a not-found is worth asking the other environment about (Apple
    // answers an id from the other environment with 404, errorCode 4040010).
    // A 401 is our key, a 429 or 5xx is Apple, and neither changes by
    // switching. If both answer 404 the id exists nowhere, and Apple's
    // guidance is to grant nothing.
    if (res.status !== 404) return last;
  }
  return last!;
}

/** GET /inApps/v1/transactions/{transactionId} */
export async function getTransactionInfo(
  token: string,
  transactionId: string,
  fetchImpl: Fetch,
): Promise<AppleCall<{ transaction: AppleTransaction }>> {
  const r = await appleGet<{ signedTransactionInfo?: string }>(
    `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    token,
    fetchImpl,
  );
  if (!r.ok) return r;
  const transaction = decodeJwsPayload<AppleTransaction>(r.body?.signedTransactionInfo);
  if (!transaction) {
    return { ok: false, status: 502, errorCode: null, detail: 'unreadable signedTransactionInfo' };
  }
  return { ok: true, environment: r.environment, body: { transaction } };
}

export type StatusResponse = {
  environment?: string;
  bundleId?: string;
  data?: Array<{
    subscriptionGroupIdentifier?: string;
    lastTransactions?: Array<{
      originalTransactionId?: string;
      status?: number;
      signedTransactionInfo?: string;
      signedRenewalInfo?: string;
    }>;
  }>;
};

/** GET /inApps/v1/subscriptions/{transactionId} */
export async function getSubscriptionStatuses(
  token: string,
  transactionId: string,
  fetchImpl: Fetch,
  prefer: AppleEnvironment = 'Production',
): Promise<AppleCall<StatusResponse>> {
  return await appleGet<StatusResponse>(
    `/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`,
    token,
    fetchImpl,
    prefer,
  );
}

/**
 * POST /inApps/v1/notifications/test. Apple answers with a token and then
 * sends a TEST notification to the URL configured for that environment,
 * which is how the notification endpoint is proven live end to end.
 */
export async function requestTestNotification(
  token: string,
  environment: AppleEnvironment,
  fetchImpl: Fetch,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetchImpl(`${API_ROOT[environment]}/inApps/v1/notifications/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 300) };
}

// ── decisions ───────────────────────────────────────────────────────────

/** Status values from Get All Subscription Statuses. */
export const SubscriptionStatus = Object.freeze({
  ACTIVE: 1,
  EXPIRED: 2,
  BILLING_RETRY: 3,
  GRACE_PERIOD: 4,
  REVOKED: 5,
});

export type Entitlement = {
  found: boolean;
  entitled: boolean;
  status: number | null;
  productId: string | null;
  /** ISO string for current_period_end, or null. */
  periodEnd: string | null;
  transaction: AppleTransaction | null;
};

/**
 * Is the subscription that `originalTransactionId` starts entitled RIGHT NOW,
 * and until when?
 *
 * ⚠️ READS APPLE'S STATUS, NOT A NOTIFICATION TYPE. Same principle as
 * googlePlay.entitlementFrom(): a type describes an event, a status describes
 * the state that followed it, and only the second can be applied in any
 * order any number of times.
 *
 * ACTIVE and GRACE_PERIOD grant. Grace is a failed card Apple is still
 * retrying WITH access, a setting we turn on in App Store Connect; cutting
 * the plan there punishes someone whose bank declined once. BILLING_RETRY is
 * the same failed card with access switched off, so it does not grant.
 * A revocationDate (refund, family sharing withdrawn) never grants, whatever
 * the status says.
 *
 * ⚠️ IN GRACE, expiresDate IS ALREADY IN THE PAST, and account_plan() ages a
 * store plan out three days after current_period_end. So the period end we
 * write is the later of expiresDate and the grace deadline, or a subscriber
 * mid-grace would drop to free before Apple has finished retrying their card.
 */
export function entitlementFromStatuses(
  resp: StatusResponse | null | undefined,
  originalTransactionId: string,
): Entitlement {
  const none: Entitlement = {
    found: false, entitled: false, status: null, productId: null, periodEnd: null, transaction: null,
  };
  if (!originalTransactionId) return none;

  let entry: NonNullable<NonNullable<StatusResponse['data']>[number]['lastTransactions']>[number] | null = null;
  for (const group of resp?.data || []) {
    for (const lt of group?.lastTransactions || []) {
      if (String(lt?.originalTransactionId || '') === String(originalTransactionId)) entry = lt;
    }
  }
  if (!entry) return none;

  const transaction = decodeJwsPayload<AppleTransaction>(entry.signedTransactionInfo);
  const renewal = decodeJwsPayload<AppleRenewal>(entry.signedRenewalInfo);
  const status = Number(entry.status) || null;

  const revoked = transaction?.revocationDate !== undefined && transaction?.revocationDate !== null;
  const entitled = !!transaction && !revoked
    && (status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.GRACE_PERIOD);

  const expiresMs = Number(transaction?.expiresDate) || 0;
  const graceMs = status === SubscriptionStatus.GRACE_PERIOD
    ? Number(renewal?.gracePeriodExpiresDate) || 0
    : 0;
  const endMs = Math.max(expiresMs, graceMs);

  return {
    found: true,
    entitled,
    status,
    productId: transaction?.productId ? String(transaction.productId) : null,
    periodEnd: endMs > 0 ? new Date(endMs).toISOString() : null,
    transaction: transaction ?? null,
  };
}

/**
 * Does this transaction belong to our app and to this account?
 *
 * ⚠️ THE ACCOUNT CHECK IS WHAT STOPS A TRANSACTION ID BEING SPENT TWICE.
 * The caller proves they belong to `accountId`; that alone does not prove the
 * PURCHASE is theirs. A transaction id is not a secret, so without this a
 * signed-in user could post someone else's live subscription and have it
 * credit their own account. appAccountToken is set by our client at purchase
 * time and signed by Apple, so it is the binding.
 *
 * ⚠️ A MISSING TOKEN IS REFUSED, NOT WAVED THROUGH. Our client refuses to
 * open the sheet without one, so a transaction without it came from
 * somewhere else: an offer code, a family-shared copy, a promoted purchase
 * started in the App Store. None of those tell us which account to credit.
 *
 * Case-insensitive, because StoreKit renders uuids in upper case.
 */
export function linkProblem(
  txn: AppleTransaction | null | undefined,
  expected: { bundleId: string; accountId: string },
): 'unreadable' | 'bundle_mismatch' | 'no_account_token' | 'account_token_mismatch' | null {
  if (!txn) return 'unreadable';
  if (txn.bundleId !== expected.bundleId) return 'bundle_mismatch';
  const token = String(txn.appAccountToken || '').toLowerCase();
  if (!token) return 'no_account_token';
  if (token !== String(expected.accountId || '').toLowerCase()) return 'account_token_mismatch';
  return null;
}
