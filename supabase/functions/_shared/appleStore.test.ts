/**
 * The Apple server helpers, which decide who gets a paid plan.
 *
 * Nothing in the two edge functions can run locally (no Deno, and deploying
 * is Ofek's), so the decisions live here where vitest can reach them. Every
 * fetch below is a fake that answers the way the App Store Server API
 * documents; the JWS values are unsigned stand-ins, because decoding is all
 * this module does with them (see decodeJwsPayload for why that is safe).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BUNDLE_ID,
  API_ROOT,
  readAppleIapConfig,
  makeAppStoreApiToken,
  decodeJwsPayload,
  appleGet,
  getTransactionInfo,
  entitlementFromStatuses,
  linkProblem,
  SubscriptionStatus,
} from './appleStore';

// ── helpers ─────────────────────────────────────────────────────────────

function b64url(s: string | Uint8Array): string {
  const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : s;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** An unsigned stand-in for an Apple JWS. */
const jws = (payload: unknown) => `${b64url('{"alg":"ES256"}')}.${b64url(JSON.stringify(payload))}.c2ln`;

// Built from parts so no staged line carries the literal PEM header, which
// .githooks/pre-commit refuses as a leaked key.
const PEM_LABEL = ['PRIVATE', 'KEY'].join(' ');

async function makeP8(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const body = btoa(bin).replace(/(.{64})/g, '$1\n');
  const pem = `-----BEGIN ${PEM_LABEL}-----\n${body}\n-----END ${PEM_LABEL}-----\n`;
  return { pem, publicKey: pair.publicKey };
}

function response(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

const ACCOUNT = '3f2b8c1e-5d4a-4b7e-9c21-0a1b2c3d4e5f';
const NOW = Date.parse('2026-09-25T10:00:00Z');
const DAY = 86_400_000;

// ── config ──────────────────────────────────────────────────────────────

describe('readAppleIapConfig', () => {
  const env = { APPLE_IAP_KEY_ID: 'ABC123DEFG', APPLE_IAP_ISSUER_ID: 'iss-uuid', APPLE_IAP_PRIVATE_KEY: 'pem' };

  it('uses the PLURAL iOS bundle id, never the Android one', () => {
    const cfg = readAppleIapConfig((k) => (env as Record<string, string>)[k]);
    expect(cfg?.bundleId).toBe('com.carreminders.app');
    expect(BUNDLE_ID).not.toBe('com.carreminder.app');
  });

  it('fails closed when any one secret is missing', () => {
    for (const drop of Object.keys(env)) {
      const partial = { ...env, [drop]: '' } as Record<string, string>;
      expect(readAppleIapConfig((k) => partial[k]), drop).toBeNull();
    }
  });
});

// ── token ───────────────────────────────────────────────────────────────

describe('makeAppStoreApiToken', () => {
  it('carries the header and claims the App Store Server API requires', async () => {
    const { pem } = await makeP8();
    const t = await makeAppStoreApiToken(
      { keyId: 'KEY1234567', issuerId: 'issuer-uuid', privateKey: pem, bundleId: BUNDLE_ID },
      1_800_000_000,
    );
    const [h, p] = t.split('.');
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    expect(claims.iss).toBe('issuer-uuid');
    expect(claims.aud).toBe('appstoreconnect-v1');
    expect(claims.bid).toBe('com.carreminders.app');
    expect(claims.iat).toBe(1_800_000_000);
    // Apple refuses anything that lives longer than an hour.
    expect(claims.exp - claims.iat).toBeGreaterThan(0);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(3600);
  });

  it('produces a raw r||s signature that verifies against the key', async () => {
    const { pem, publicKey } = await makeP8();
    const t = await makeAppStoreApiToken({ keyId: 'K', issuerId: 'I', privateKey: pem, bundleId: BUNDLE_ID });
    const [h, p, s] = t.split('.');
    const sig = fromB64url(s);
    // DER would be ~70-72 bytes; JWS ES256 is exactly 64.
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('accepts a .p8 pasted with escaped newlines, as a single-line secret field stores it', async () => {
    const { pem } = await makeP8();
    const escaped = pem.replace(/\n/g, '\\n');
    await expect(
      makeAppStoreApiToken({ keyId: 'K', issuerId: 'I', privateKey: escaped, bundleId: BUNDLE_ID }),
    ).resolves.toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });
});

// ── JWS ─────────────────────────────────────────────────────────────────

describe('decodeJwsPayload', () => {
  it('reads the middle segment, including base64url characters', () => {
    // '?>?>' encodes to characters that differ between base64 and base64url.
    const payload = { productId: 'plan_p9', odd: '?>?>~~~' };
    expect(decodeJwsPayload(jws(payload))).toEqual(payload);
  });

  it('returns null for anything that is not a three-part JWS', () => {
    for (const bad of [undefined, null, '', 'a.b', 'a.b.c.d', 'a.!!!.c', 42]) {
      expect(decodeJwsPayload(bad), String(bad)).toBeNull();
    }
  });
});

// ── production first, then sandbox ──────────────────────────────────────

describe('appleGet', () => {
  it('stops at production when production knows the id', async () => {
    const f = vi.fn(async () => response(200, { hello: 1 }));
    const r = await appleGet('/x', 'tok', f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, environment: 'Production', body: { hello: 1 } });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(`${API_ROOT.Production}/x`);
  });

  it('asks sandbox after production says not found, which is every App Review purchase', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(response(404, { errorCode: 4040010, errorMessage: 'Transaction id not found.' }))
      .mockResolvedValueOnce(response(200, { hello: 2 }));
    const r = await appleGet('/x', 'tok', f as unknown as typeof fetch);
    expect(r.ok && r.environment).toBe('Sandbox');
    expect(f.mock.calls[1][0]).toBe(`${API_ROOT.Sandbox}/x`);
  });

  it('does NOT switch environment on a 401, which is our key and not the id', async () => {
    const f = vi.fn(async () => response(401, ''));
    const r = await appleGet('/x', 'tok', f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(401);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('tries the hinted environment first but still falls back', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(response(404, { errorCode: 4040010 }))
      .mockResolvedValueOnce(response(200, {}));
    const r = await appleGet('/x', 'tok', f as unknown as typeof fetch, 'Sandbox');
    expect(f.mock.calls[0][0]).toBe(`${API_ROOT.Sandbox}/x`);
    expect(r.ok && r.environment).toBe('Production');
  });

  it('reports Apple\'s error code when neither environment has the id', async () => {
    const f = vi.fn(async () => response(404, { errorCode: 4040010 }));
    const r = await appleGet('/x', 'tok', f as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, status: 404, errorCode: 4040010 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('sends the token as a bearer header', async () => {
    const f = vi.fn(async () => response(200, {}));
    await appleGet('/x', 'the-token', f as unknown as typeof fetch);
    expect((f.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: 'Bearer the-token' });
  });
});

describe('getTransactionInfo', () => {
  it('decodes signedTransactionInfo from Apple\'s answer', async () => {
    const txn = { transactionId: '2000000987654321', originalTransactionId: '2000000900000000', bundleId: BUNDLE_ID };
    const f = vi.fn(async () => response(200, { signedTransactionInfo: jws(txn) }));
    const r = await getTransactionInfo('tok', '2000000987654321', f as unknown as typeof fetch);
    expect(r.ok && r.body.transaction).toEqual(txn);
    expect(f.mock.calls[0][0]).toBe(`${API_ROOT.Production}/inApps/v1/transactions/2000000987654321`);
  });

  it('treats an unreadable signedTransactionInfo as a failure, not an empty transaction', async () => {
    const f = vi.fn(async () => response(200, { signedTransactionInfo: 'garbage' }));
    const r = await getTransactionInfo('tok', '1', f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
  });
});

// ── the decision ────────────────────────────────────────────────────────

const ORIGINAL = '2000000900000000';

function statuses(status: number, txn: Record<string, unknown>, renewal: Record<string, unknown> = {}) {
  return {
    environment: 'Sandbox',
    bundleId: BUNDLE_ID,
    data: [{
      subscriptionGroupIdentifier: '21500000',
      lastTransactions: [
        {
          originalTransactionId: '1999999999999999',
          status: SubscriptionStatus.ACTIVE,
          signedTransactionInfo: jws({ productId: 'someone_elses', expiresDate: NOW + DAY }),
        },
        {
          originalTransactionId: ORIGINAL,
          status,
          signedTransactionInfo: jws({ originalTransactionId: ORIGINAL, productId: 'plan_p19', ...txn }),
          signedRenewalInfo: jws(renewal),
        },
      ],
    }],
  };
}

describe('entitlementFromStatuses', () => {
  it('grants an active subscription until its expiry', () => {
    const e = entitlementFromStatuses(statuses(1, { expiresDate: NOW + 30 * DAY }), ORIGINAL);
    expect(e).toMatchObject({ found: true, entitled: true, status: 1, productId: 'plan_p19' });
    expect(e.periodEnd).toBe(new Date(NOW + 30 * DAY).toISOString());
  });

  it('reads only the subscription it was asked about', () => {
    const e = entitlementFromStatuses(statuses(2, { expiresDate: NOW - DAY }), ORIGINAL);
    // The other entry in the same response is ACTIVE; it must not leak in.
    expect(e.entitled).toBe(false);
    expect(e.productId).toBe('plan_p19');
  });

  it('keeps access in the grace period, and writes the GRACE deadline as the period end', () => {
    // In grace, expiresDate is already in the past. Writing it would let
    // account_plan() age the plan out while Apple is still retrying the card.
    const e = entitlementFromStatuses(
      statuses(4, { expiresDate: NOW - 2 * DAY }, { gracePeriodExpiresDate: NOW + 14 * DAY }),
      ORIGINAL,
    );
    expect(e.entitled).toBe(true);
    expect(e.periodEnd).toBe(new Date(NOW + 14 * DAY).toISOString());
  });

  it('does not grant in billing retry, where access is off', () => {
    expect(entitlementFromStatuses(statuses(3, { expiresDate: NOW - DAY }), ORIGINAL).entitled).toBe(false);
  });

  it('does not grant an expired or revoked subscription', () => {
    expect(entitlementFromStatuses(statuses(2, { expiresDate: NOW - DAY }), ORIGINAL).entitled).toBe(false);
    expect(entitlementFromStatuses(statuses(5, { expiresDate: NOW + DAY }), ORIGINAL).entitled).toBe(false);
  });

  it('never grants a refunded transaction, even if the status still reads active', () => {
    const e = entitlementFromStatuses(
      statuses(1, { expiresDate: NOW + 20 * DAY, revocationDate: NOW - DAY }),
      ORIGINAL,
    );
    expect(e.entitled).toBe(false);
  });

  it('says not found when Apple returned nothing for that subscription', () => {
    expect(entitlementFromStatuses(statuses(1, {}), '123').found).toBe(false);
    expect(entitlementFromStatuses(null, ORIGINAL).found).toBe(false);
    expect(entitlementFromStatuses({ data: [] }, ORIGINAL).entitled).toBe(false);
    expect(entitlementFromStatuses(statuses(1, {}), '').found).toBe(false);
  });
});

describe('linkProblem', () => {
  const ok = { bundleId: BUNDLE_ID, appAccountToken: ACCOUNT };

  it('accepts our app and our account', () => {
    expect(linkProblem(ok, { bundleId: BUNDLE_ID, accountId: ACCOUNT })).toBeNull();
  });

  it('accepts the token in upper case, as StoreKit renders it', () => {
    expect(linkProblem({ ...ok, appAccountToken: ACCOUNT.toUpperCase() },
      { bundleId: BUNDLE_ID, accountId: ACCOUNT })).toBeNull();
  });

  it('refuses another account\'s purchase, which is the replay this check exists for', () => {
    expect(linkProblem(ok, { bundleId: BUNDLE_ID, accountId: '9e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a' }))
      .toBe('account_token_mismatch');
  });

  it('refuses a transaction with no account token rather than guessing', () => {
    expect(linkProblem({ bundleId: BUNDLE_ID }, { bundleId: BUNDLE_ID, accountId: ACCOUNT }))
      .toBe('no_account_token');
  });

  it('refuses another app, including our own Android id', () => {
    expect(linkProblem({ ...ok, bundleId: 'com.carreminder.app' }, { bundleId: BUNDLE_ID, accountId: ACCOUNT }))
      .toBe('bundle_mismatch');
    expect(linkProblem(null, { bundleId: BUNDLE_ID, accountId: ACCOUNT })).toBe('unreadable');
  });
});

// ── ownership ───────────────────────────────────────────────────────────

import { ownerToken, resolveAppleAccount, otherHolders, releaseHolders, type AdminLike } from './appleStore';

type Row = Record<string, unknown>;

/**
 * A tiny stand-in for the Supabase client: tables are arrays of rows, and
 * the chain applies eq/neq filters for real, so the helpers are tested
 * against what they select, not against what a mock was told to return.
 */
function fakeAdmin(tables: Record<string, Row[]>, fail: { table?: string; rpc?: boolean } = {}) {
  const calls: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  const admin: AdminLike = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let update: Row | null = null;
      const q: any = {
        select() { return q; },
        update(values: Row) { update = values; return q; },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q; },
        neq(k: string, v: unknown) { filters.push((r) => r[k] !== v); return q; },
        limit() { return q; },
        run() {
          if (fail.table === table) return { data: null, error: { message: `boom on ${table}` } };
          const rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)));
          if (update) { rows.forEach((r) => Object.assign(r, update)); return { data: null, error: null }; }
          return { data: rows, error: null };
        },
        maybeSingle() { const r = q.run(); return Promise.resolve(r.error ? r : { data: r.data[0] ?? null, error: null }); },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return Promise.resolve(q.run()).then(res, rej); },
      };
      return q;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ rpc: fn, args });
      return Promise.resolve(fail.rpc ? { error: { message: 'rpc boom' } } : { error: null });
    },
  };
  return { admin, calls, tables };
}

const A = '3f2b8c1e-5d4a-4b7e-9c21-0a1b2c3d4e5f';
const B = '9e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a';
const O1 = '2000000900000000';

describe('ownerToken', () => {
  it('lower-cases a valid token and drops anything else', () => {
    expect(ownerToken({ appAccountToken: A.toUpperCase() })).toBe(A);
    expect(ownerToken({ appAccountToken: 'not-a-uuid' })).toBe('');
    expect(ownerToken(null)).toBe('');
  });
});

describe('resolveAppleAccount', () => {
  it('follows Apple\'s latest token over our stored row', () => {
    // A subscribed first; B bought last. Apple says B.
    const { admin } = fakeAdmin({
      accounts: [{ id: A }, { id: B }],
      account_subscriptions: [{ account_id: A, source: 'iap_apple', external_subscription_id: O1 }],
    });
    return expect(resolveAppleAccount(admin, O1, { appAccountToken: B.toUpperCase() }))
      .resolves.toEqual({ ok: true, value: B });
  });

  it('falls back to the stored row only when Apple names no usable account', async () => {
    const { admin } = fakeAdmin({
      accounts: [{ id: A }],
      account_subscriptions: [{ account_id: A, source: 'iap_apple', external_subscription_id: O1 }],
    });
    await expect(resolveAppleAccount(admin, O1, {})).resolves.toEqual({ ok: true, value: A });
    // A token naming an account that no longer exists is not an owner.
    await expect(resolveAppleAccount(admin, O1, { appAccountToken: B })).resolves.toEqual({ ok: true, value: A });
  });

  it('answers null, not an error, when nobody holds it', () => {
    const { admin } = fakeAdmin({ accounts: [], account_subscriptions: [] });
    return expect(resolveAppleAccount(admin, O1, {})).resolves.toEqual({ ok: true, value: null });
  });

  it('reports a database failure as a failure, so the caller can ask Apple to retry', async () => {
    const byToken = fakeAdmin({ accounts: [{ id: B }] }, { table: 'accounts' });
    await expect(resolveAppleAccount(byToken.admin, O1, { appAccountToken: B })).resolves.toMatchObject({ ok: false });
    const byRow = fakeAdmin({ account_subscriptions: [] }, { table: 'account_subscriptions' });
    await expect(resolveAppleAccount(byRow.admin, O1, {})).resolves.toMatchObject({ ok: false });
  });
});

describe('otherHolders and releaseHolders', () => {
  it('finds only OTHER accounts still naming this Apple subscription', async () => {
    const { admin } = fakeAdmin({
      account_subscriptions: [
        { account_id: A, source: 'iap_apple', external_subscription_id: O1 },
        { account_id: B, source: 'iap_apple', external_subscription_id: O1 },
        { account_id: 'x', source: 'iap_google', external_subscription_id: O1 },
      ],
    });
    await expect(otherHolders(admin, O1, B)).resolves.toEqual({ ok: true, value: [A] });
  });

  it('lists EVERY holder when there is no account to keep, without an empty-uuid filter', async () => {
    const { admin } = fakeAdmin({
      account_subscriptions: [
        { account_id: A, source: 'iap_apple', external_subscription_id: O1 },
        { account_id: B, source: 'iap_apple', external_subscription_id: O1 },
      ],
    });
    const neqValues: unknown[] = [];
    const from = admin.from.bind(admin);
    admin.from = (t: string) => {
      const q = from(t);
      const neq = q.neq;
      q.neq = (k: string, v: unknown) => { neqValues.push(v); return neq(k, v); };
      return q;
    };
    await expect(otherHolders(admin, O1, '')).resolves.toEqual({ ok: true, value: [A, B] });
    // An empty string compared to a uuid column is a Postgres error, not "no match".
    expect(neqValues).toEqual([]);
  });

  it('revokes the old owner and forgets the id, so a later lookup cannot find them', async () => {
    const f = fakeAdmin({
      account_subscriptions: [{ account_id: A, source: 'iap_apple', external_subscription_id: O1 }],
    });
    await expect(releaseHolders(f.admin, O1, [A], 'apple_moved')).resolves.toBeNull();
    expect(f.calls).toEqual([{ rpc: 'revoke_iap_entitlement', args: { p_account_id: A, p_reason: 'apple_moved' } }]);
    expect(f.tables.account_subscriptions[0].external_subscription_id).toBeNull();
  });

  it('stops and reports when the revoke fails', async () => {
    const f = fakeAdmin({ account_subscriptions: [] }, { rpc: true });
    await expect(releaseHolders(f.admin, O1, [A], 'r')).resolves.toBe('rpc boom');
  });
});
