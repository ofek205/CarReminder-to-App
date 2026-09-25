/**
 * THE APPLE BACKEND, TESTED AGAINST THE PLUGIN'S SWIFT.
 *
 * ⚠️ THE MOCK IS THE POINT OF THIS FILE. On Android every early mock of
 * purchaseProduct simply succeeded, so a request the real plugin refused on
 * sight was green everywhere and not one purchase could have worked. The
 * fake below reproduces, rule for rule, what
 * node_modules/@capgo/native-purchases/ios/Sources/NativePurchasesPlugin/
 * actually does in 8.7.0:
 *
 *   purchaseProduct  rejects "productIdentifier is Empty, give an id"
 *                    rejects "Cannot find product for id <id>"
 *                    DROPS a non-uuid appAccountToken with no error
 *                    rejects "User cancelled" / "Transaction pending"
 *                    reports appAccountToken back as uuidString (UPPER CASE)
 *   getProducts      leaves unknown ids out and never rejects for them
 *   getPurchases     filters with `uuidString != filter` (case-sensitive)
 *   getStorefront    { countryCode }
 *
 * Each rule that could hide a bug has a negative control on the mock itself,
 * so if the fake ever stops being faithful the suite says so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const reportError = vi.fn();
vi.mock('@/lib/crashReporter', () => ({ reportError: (...a) => reportError(...a) }));

// ── the faithful fake ───────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Swift: UUID(uuidString:) then .uuidString, which is always upper case. */
const swiftUuid = (s) => (typeof s === 'string' && UUID_RE.test(s) ? s.toUpperCase() : null);

const ACCOUNT = '3f2b8c1e-5d4a-4b7e-9c21-0a1b2c3d4e5f';
const OTHER_ACCOUNT = '9e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a';

const fake = {
  /** What App Store Connect has, keyed by product id. */
  store: {},
  /** What the next sheet does: 'buy' | 'cancel' | 'pending'. */
  sheet: 'buy',
  /** Transactions in Transaction.currentEntitlements. */
  entitlements: [],
  storefront: 'ISR',
};

function productDictionary(id, price) {
  // Product.dictionary in Product+CapacitorPurchasesPlugin.swift
  return {
    identifier: id,
    description: `desc ${id}`,
    title: `title ${id}`,
    price,
    priceString: `₪${price.toFixed(2)}`,
    currencyCode: 'ILS',
    currencySymbol: '₪',
    isFamilyShareable: false,
    subscriptionGroupIdentifier: '21500000',
    subscriptionPeriod: { numberOfUnits: 1, unit: 2 },
    introductoryPrice: null,
    discounts: [],
  };
}

const NativePurchasesFake = {
  // `call.resolve(["isBillingSupported": true])`, unconditionally.
  isBillingSupported: vi.fn(async () => ({ isBillingSupported: true })),

  getProducts: vi.fn(async ({ productIdentifiers }) => ({
    products: (productIdentifiers || [])
      .filter((id) => fake.store[id])
      .map((id) => productDictionary(id, fake.store[id])),
  })),

  purchaseProduct: vi.fn(async (opts) => {
    const productIdentifier = opts?.productIdentifier ?? '';
    if (productIdentifier === '') throw new Error('productIdentifier is Empty, give an id');
    if (!fake.store[productIdentifier]) {
      throw new Error(`Cannot find product for id ${productIdentifier}`);
    }
    // `if let token, !token.isEmpty, let uuid = UUID(uuidString: token)` — no else.
    const token = opts?.appAccountToken ? swiftUuid(opts.appAccountToken) : null;
    if (fake.sheet === 'cancel') throw new Error('User cancelled');
    if (fake.sheet === 'pending') throw new Error('Transaction pending');
    // TransactionHelpers.buildTransactionResponse
    return {
      transactionId: '2000000987654321',
      jwsRepresentation: 'header.payload.signature',
      productIdentifier,
      purchaseDate: '2026-09-25T10:00:00Z',
      productType: 'subs',
      isUpgraded: false,
      ownershipType: 'purchased',
      environment: 'Sandbox',
      ...(token ? { appAccountToken: token } : {}),
      originalPurchaseDate: '2026-09-25T10:00:00Z',
      expirationDate: '2026-10-25T10:00:00Z',
      isActive: true,
      subscriptionState: 'subscribed',
      willCancel: false,
    };
  }),

  getPurchases: vi.fn(async ({ appAccountToken } = {}) => ({
    // collectPurchases: `if let filter, transaction.appAccountToken?.uuidString != filter { continue }`
    purchases: fake.entitlements.filter(
      (t) => appAccountToken === undefined || t.appAccountToken === appAccountToken,
    ),
  })),

  getStorefront: vi.fn(async () => ({ countryCode: fake.storefront })),

  // restorePurchases: `try await AppStore.sync()`, then resolve() with nothing.
  restorePurchases: vi.fn(async () => undefined),

  acknowledgePurchase: vi.fn(async ({ purchaseToken }) => {
    if (!/^\d+$/.test(String(purchaseToken))) throw new Error('Invalid purchaseToken format');
  }),
};

vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: NativePurchasesFake,
  PURCHASE_TYPE: { SUBS: 'subs', INAPP: 'inapp' },
}));

const {
  buildAppleBackend, appleBackend, isUuid, sameUuid, outcomeOfRejection, APPLE_PRODUCT_IDS,
} = await import('./appleBackend');
const { PurchaseOutcome } = await import('./types');

const FULL_STORE = { plan_p9: 9, plan_p19: 19, plan_p49: 49 };

beforeEach(() => {
  vi.clearAllMocks();
  fake.store = { ...FULL_STORE };
  fake.sheet = 'buy';
  fake.entitlements = [];
  fake.storefront = 'ISR';
});

// ── negative controls on the fake ───────────────────────────────────────

describe('the fake is faithful to the Swift', () => {
  it('drops a non-uuid appAccountToken without any error, as the plugin does', async () => {
    const txn = await NativePurchasesFake.purchaseProduct({
      productIdentifier: 'plan_p9', appAccountToken: 'acc-1',
    });
    expect(txn.transactionId).toBeTruthy();
    expect(txn).not.toHaveProperty('appAccountToken');
  });

  it('hands the token back in upper case', async () => {
    const txn = await NativePurchasesFake.purchaseProduct({
      productIdentifier: 'plan_p9', appAccountToken: ACCOUNT,
    });
    expect(txn.appAccountToken).toBe(ACCOUNT.toUpperCase());
  });

  it('matches nothing when getPurchases is filtered by a lower-case uuid', async () => {
    fake.entitlements = [{ transactionId: '1', productIdentifier: 'plan_p9', appAccountToken: ACCOUNT.toUpperCase() }];
    const { purchases } = await NativePurchasesFake.getPurchases({ appAccountToken: ACCOUNT });
    expect(purchases).toEqual([]);
  });

  it('leaves unknown ids out of getProducts instead of rejecting', async () => {
    fake.store = { plan_p9: 9 };
    const { products } = await NativePurchasesFake.getProducts({ productIdentifiers: [...APPLE_PRODUCT_IDS] });
    expect(products.map((p) => p.identifier)).toEqual(['plan_p9']);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────

describe('uuid helpers', () => {
  it('accepts what UUID(uuidString:) accepts, in either case', () => {
    expect(isUuid(ACCOUNT)).toBe(true);
    expect(isUuid(ACCOUNT.toUpperCase())).toBe(true);
  });

  it('rejects what UUID(uuidString:) rejects', () => {
    for (const bad of ['', 'acc-1', `{${ACCOUNT}}`, ACCOUNT.replace(/-/g, ''), null, undefined, 42]) {
      expect(isUuid(bad), String(bad)).toBe(false);
    }
  });

  it('compares tokens without regard to case', () => {
    expect(sameUuid(ACCOUNT.toUpperCase(), ACCOUNT)).toBe(true);
    expect(sameUuid(OTHER_ACCOUNT, ACCOUNT)).toBe(false);
    expect(sameUuid(undefined, ACCOUNT)).toBe(false);
  });

  it('classifies the plugin\'s own rejection strings exactly', () => {
    expect(outcomeOfRejection(new Error('User cancelled'))).toBe(PurchaseOutcome.CANCELLED);
    expect(outcomeOfRejection(new Error('Transaction pending'))).toBe(PurchaseOutcome.PENDING);
    expect(outcomeOfRejection(new Error('Cannot find product for id plan_p9'))).toBe(PurchaseOutcome.FAILED);
    expect(outcomeOfRejection(new Error('Payment cancelled by user'))).toBe(PurchaseOutcome.CANCELLED);
    expect(outcomeOfRejection(undefined)).toBe(PurchaseOutcome.FAILED);
  });
});

// ── purchase ────────────────────────────────────────────────────────────

describe('purchase()', () => {
  it('refuses a non-uuid account id BEFORE the sheet can open', async () => {
    const r = await buildAppleBackend().purchase('plan_p9', 'acc-1');
    expect(r.outcome).toBe(PurchaseOutcome.FAILED);
    expect(r.message).toMatch(/uuid/);
    expect(NativePurchasesFake.purchaseProduct).not.toHaveBeenCalled();
  });

  it('refuses a missing account id', async () => {
    const r = await buildAppleBackend().purchase('plan_p9', undefined);
    expect(r.outcome).toBe(PurchaseOutcome.FAILED);
    expect(NativePurchasesFake.purchaseProduct).not.toHaveBeenCalled();
  });

  it('sends the product, the account token and nothing Android-only', async () => {
    await buildAppleBackend().purchase('plan_p19', ACCOUNT);
    const sent = NativePurchasesFake.purchaseProduct.mock.calls[0][0];
    expect(sent.productIdentifier).toBe('plan_p19');
    expect(sent.appAccountToken).toBe(ACCOUNT);
    expect(sent.productType).toBe('subs');
    // No base plans on Apple. The Android guard does not exist in the Swift.
    expect(sent).not.toHaveProperty('planIdentifier');
    expect(sent).not.toHaveProperty('offerToken');
  });

  it('auto-finishes on iOS, where finishing carries no refund protection', async () => {
    await buildAppleBackend().purchase('plan_p9', ACCOUNT);
    expect(NativePurchasesFake.purchaseProduct.mock.calls[0][0].autoAcknowledgePurchases).toBe(true);
  });

  it('returns the StoreKit transaction id as the token the server verifies', async () => {
    const r = await buildAppleBackend().purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.PURCHASED);
    expect(r.productId).toBe('plan_p9');
    expect(r.purchaseToken).toBe('2000000987654321');
    expect(r.transactionId).toBe('2000000987654321');
    // The account link survived the round trip, so nothing is reported.
    expect(reportError).not.toHaveBeenCalled();
  });

  it('treats closing the sheet as a cancellation, not a failure', async () => {
    fake.sheet = 'cancel';
    const r = await buildAppleBackend().purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.CANCELLED);
  });

  it('treats Ask to Buy as pending, not as a failure', async () => {
    fake.sheet = 'pending';
    const r = await buildAppleBackend().purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.PENDING);
  });

  it('fails with the plugin\'s reason when the store does not have the product', async () => {
    fake.store = {};
    const r = await buildAppleBackend().purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.FAILED);
    expect(r.message).toBe('Cannot find product for id plan_p9');
  });

  it('reports a completed purchase that lost its account link', async () => {
    NativePurchasesFake.purchaseProduct.mockImplementationOnce(async () => ({
      transactionId: '2000000000000001', productIdentifier: 'plan_p9',
    }));
    const r = await buildAppleBackend().purchase('plan_p9', ACCOUNT);
    // Still PURCHASED: the sheet completed, so money may have moved.
    expect(r.outcome).toBe(PurchaseOutcome.PURCHASED);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][1].message).toBe('apple_purchase_account_token_lost');
  });
});

// ── catalogue ───────────────────────────────────────────────────────────

describe('listProducts()', () => {
  it('reads identifier as the product id and keeps StoreKit\'s own price string', async () => {
    const rows = await buildAppleBackend().listProducts();
    expect(rows.map((r) => r.productId)).toEqual(['plan_p9', 'plan_p19', 'plan_p49']);
    expect(rows.map((r) => r.planCode)).toEqual(['p9', 'p19', 'p49']);
    expect(rows[0].priceFormatted).toBe(productDictionary('plan_p9', 9).priceString);
    expect(rows[0].priceCurrency).toBe('ILS');
    expect(rows[0].basePlanId).toBeNull();
  });

  it('reports nothing when the whole catalogue came back', async () => {
    await buildAppleBackend().listProducts();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports a PARTIAL catalogue, which StoreKit does not treat as an error', async () => {
    fake.store = { plan_p9: 9 };
    fake.storefront = 'USA';
    const rows = await buildAppleBackend().listProducts();
    expect(rows).toHaveLength(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [type, err, extra] = reportError.mock.calls[0];
    expect(type).toBe('billing_catalogue');
    // The ids and the storefront are in the MESSAGE, which is what gets read.
    expect(err.message).toBe('apple_catalogue_missing [plan_p19,plan_p49] storefront=USA');
    expect(extra.missing).toEqual(['plan_p19', 'plan_p49']);
  });

  it('returns an empty list, not a throw, when the store has nothing', async () => {
    fake.store = {};
    await expect(buildAppleBackend().listProducts()).resolves.toEqual([]);
    expect(reportError.mock.calls[0][1].message).toMatch(/plan_p9,plan_p19,plan_p49/);
  });

  it('still reports when the storefront itself cannot be read', async () => {
    fake.store = {};
    NativePurchasesFake.getStorefront.mockRejectedValueOnce(new Error('boom'));
    await buildAppleBackend().listProducts();
    expect(reportError.mock.calls[0][1].message).toMatch(/storefront=unknown$/);
  });

  it('ignores a product it did not ask for', async () => {
    NativePurchasesFake.getProducts.mockResolvedValueOnce({
      products: [productDictionary('plan_p9', 9), productDictionary('someone_else', 1)],
    });
    const rows = await buildAppleBackend().listProducts();
    expect(rows.map((r) => r.productId)).toEqual(['plan_p9']);
  });
});

// ── restore ─────────────────────────────────────────────────────────────

describe('queryOwnedPurchases()', () => {
  it('returns only this account\'s subscriptions, matched without regard to case', async () => {
    fake.entitlements = [
      { transactionId: '11', productIdentifier: 'plan_p9', appAccountToken: ACCOUNT.toUpperCase() },
      { transactionId: '22', productIdentifier: 'plan_p19', appAccountToken: OTHER_ACCOUNT.toUpperCase() },
      { transactionId: '33', productIdentifier: 'plan_p49' },
    ];
    const owned = await buildAppleBackend().queryOwnedPurchases(ACCOUNT);
    expect(owned).toEqual([{
      outcome: PurchaseOutcome.OWNED, productId: 'plan_p9', purchaseToken: '11', transactionId: '11',
    }]);
  });

  it('never uses the plugin\'s filter, which compares upper case to our lower case', async () => {
    await buildAppleBackend().queryOwnedPurchases(ACCOUNT);
    const sent = NativePurchasesFake.getPurchases.mock.calls[0][0];
    expect(sent).not.toHaveProperty('appAccountToken');
    expect(sent.onlyCurrentEntitlements).toBe(true);
  });

  it('returns nothing, and says so, without an account id to filter by', async () => {
    fake.entitlements = [{ transactionId: '11', productIdentifier: 'plan_p9', appAccountToken: ACCOUNT.toUpperCase() }];
    await expect(buildAppleBackend().queryOwnedPurchases()).resolves.toEqual([]);
    expect(NativePurchasesFake.getPurchases).not.toHaveBeenCalled();
    expect(reportError.mock.calls[0][1].message).toBe('apple_restore_without_account_id');
  });

  it('asks Apple to sync first only when the user tapped restore', async () => {
    fake.entitlements = [{ transactionId: '11', productIdentifier: 'plan_p9', appAccountToken: ACCOUNT.toUpperCase() }];
    await buildAppleBackend().queryOwnedPurchases(ACCOUNT);
    expect(NativePurchasesFake.restorePurchases).not.toHaveBeenCalled();

    const owned = await buildAppleBackend().queryOwnedPurchases(ACCOUNT, { sync: true });
    expect(NativePurchasesFake.restorePurchases).toHaveBeenCalledTimes(1);
    // Synced first, then read.
    expect(NativePurchasesFake.restorePurchases.mock.invocationCallOrder[0])
      .toBeLessThan(NativePurchasesFake.getPurchases.mock.invocationCallOrder.at(-1));
    expect(owned).toHaveLength(1);
  });

  it('lets a failed sync throw, so the screen can say it could not check', async () => {
    NativePurchasesFake.restorePurchases.mockRejectedValueOnce(new Error('The operation couldn’t be completed.'));
    await expect(buildAppleBackend().queryOwnedPurchases(ACCOUNT, { sync: true })).rejects.toThrow();
  });

  it('ignores products that are not ours', async () => {
    fake.entitlements = [{ transactionId: '44', productIdentifier: 'old_thing', appAccountToken: ACCOUNT.toUpperCase() }];
    await expect(buildAppleBackend().queryOwnedPurchases(ACCOUNT)).resolves.toEqual([]);
  });
});

// ── identity and contract ───────────────────────────────────────────────

describe('appleBackend() identity', () => {
  it('is a singleton, because it will sit in a React dependency array', () => {
    const all = Array.from({ length: 10 }, () => appleBackend());
    expect(new Set(all).size).toBe(1);
  });

  it('exposes the whole BillingBackend contract', () => {
    const b = appleBackend();
    for (const m of ['connect', 'listProducts', 'purchase', 'queryOwnedPurchases', 'acknowledge']) {
      expect(typeof b[m], m).toBe('function');
    }
    expect(b.store).toBe('apple');
    expect(b.productIds).toEqual(APPLE_PRODUCT_IDS);
    // It files its own gap report, so the hook must stay quiet.
    expect(b.reportsCatalogueGaps).toBe(true);
  });

  it('connects, because the Swift always answers yes', async () => {
    await expect(appleBackend().connect()).resolves.toBe(true);
  });

  it('acknowledges by numeric transaction id', async () => {
    await expect(appleBackend().acknowledge('2000000987654321')).resolves.toBe(true);
    await expect(appleBackend().acknowledge('')).resolves.toBe(false);
  });
});
