/**
 * THE MAPPING FROM PLAY'S CATALOGUE ROWS TO OUR PLAN CARDS.
 *
 * ⚠️ THE FIELD THIS TESTS MEANS TWO DIFFERENT THINGS DEPENDING ON PRODUCT
 * TYPE, WHICH IS EXACTLY WHY THE FIRST VERSION READ THE WRONG ONE AND LOOKED
 * CORRECT.
 *
 *   one-time product : identifier     = product id
 *   SUBSCRIPTION     : identifier     = BASE PLAN id
 *                      planIdentifier = product id
 *
 * The plugin's own definitions.d.ts states it: "If you group/filter Android
 * subscription results by `identifier`, you are grouping by base plan."
 *
 * Reading `identifier` yielded planCode 'p9-monthly', which matches no plan,
 * so every card rendered UNAVAILABLE: indistinguishable on screen from a
 * store that returned nothing. The same wrong value was then handed to
 * purchaseProduct and to our own server, where verification compares it with
 * the product id Google reports and answers product_mismatch, which parks a
 * charged user in PENDING for ever.
 *
 * ⚠️ AND IT IS NOT HYPOTHETICAL IN OUR CONSOLE. plan_p9 carries a base plan
 * named `p49-monthly`, and plan_p49 carries `p9-monthly`; they were created
 * crossed. Under the old mapping the ₪9 card and the ₪49 card would have
 * swapped places, so the last case here pins that exact configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const platform = { isNative: true, isAndroid: true, isIOS: false };
vi.mock('@/lib/capacitor', () => ({
  get isNative() { return platform.isNative; },
  get isAndroid() { return platform.isAndroid; },
  get isIOS() { return platform.isIOS; },
}));

let rows = [];
vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: {
    isBillingSupported: async () => ({ isBillingSupported: true }),
    getProducts: async () => ({ products: rows }),
  },
  PURCHASE_TYPE: { SUBS: 'subs', INAPP: 'inapp' },
}));

const { getBillingBackend } = await import('./index');

/** A row shaped the way the plugin actually returns SUBSCRIPTIONS. */
const subRow = (productId, basePlanId, extra = {}) => ({
  planIdentifier: productId,
  identifier: basePlanId,
  priceString: '₪9.00',
  currencyCode: 'ILS',
  offerId: null,
  offerToken: `tok-${basePlanId}`,
  ...extra,
});

beforeEach(() => { rows = []; });

describe('listProducts mapping', () => {
  it('takes the product id from planIdentifier, not identifier', async () => {
    rows = [subRow('plan_p9', 'p9-monthly')];
    const [p] = await getBillingBackend().listProducts();
    expect(p.productId).toBe('plan_p9');
    expect(p.planCode).toBe('p9');
  });

  it('never produces a planCode that looks like a base plan', async () => {
    // The precise old failure: 'p9-monthly' matches no row in plan_limits, so
    // the card silently renders as if the store had nothing to sell.
    rows = [subRow('plan_p19', 'p19-monthly')];
    const [p] = await getBillingBackend().listProducts();
    expect(p.planCode).not.toContain('monthly');
    expect(p.planCode).toBe('p19');
  });

  it('keeps the base plan id for diagnostics', async () => {
    rows = [subRow('plan_p49', 'p49-monthly')];
    const [p] = await getBillingBackend().listProducts();
    expect(p.basePlanId).toBe('p49-monthly');
  });

  it('carries the offer token, which the purchase needs', async () => {
    rows = [subRow('plan_p9', 'p9-monthly')];
    const [p] = await getBillingBackend().listProducts();
    expect(p.offerToken).toBe('tok-p9-monthly');
  });

  it('maps a one-time product shape, where identifier IS the product id', async () => {
    // No planIdentifier at all. The fallback has to hold, or a future
    // non-subscription product maps to undefined.
    rows = [{ identifier: 'one_off', priceString: '₪5.00', currencyCode: 'ILS' }];
    const [p] = await getBillingBackend().listProducts();
    expect(p.productId).toBe('one_off');
  });

  it('returns one row per product when Play sends one per offer', async () => {
    // "When multiple offers exist, getProducts() returns one entry per
    // eligible offer." Two rows for one product would let find() pick either.
    rows = [
      subRow('plan_p9', 'p9-monthly', { offerId: 'intro-1', priceString: '₪1.00' }),
      subRow('plan_p9', 'p9-monthly', { offerId: null, priceString: '₪9.00' }),
    ];
    const out = await getBillingBackend().listProducts();
    expect(out).toHaveLength(1);
    // The base plan wins, so the card shows the recurring price rather than a
    // first-month teaser the user would not keep paying.
    expect(out[0].priceFormatted).toBe('₪9.00');
    expect(out[0].offerId).toBeNull();
  });

  it('prefers the base plan regardless of the order Play sends them', async () => {
    rows = [
      subRow('plan_p9', 'p9-monthly', { offerId: null, priceString: '₪9.00' }),
      subRow('plan_p9', 'p9-monthly', { offerId: 'intro-1', priceString: '₪1.00' }),
    ];
    const out = await getBillingBackend().listProducts();
    expect(out).toHaveLength(1);
    expect(out[0].priceFormatted).toBe('₪9.00');
  });

  it('maps correctly even though OUR base plan names are crossed', async () => {
    // ⚠️ THIS IS THE LIVE PLAY CONSOLE CONFIGURATION, NOT AN INVENTED CASE.
    // plan_p9 holds a base plan called p49-monthly and vice versa. Because
    // the mapping now ignores the base plan entirely, the crossing is
    // cosmetic. Under the old mapping these two cards traded places, which
    // would have shown the unlimited plan at the ₪9 card's position.
    rows = [
      subRow('plan_p9', 'p49-monthly', { priceString: '₪9.00' }),
      subRow('plan_p49', 'p9-monthly', { priceString: '₪49.00' }),
    ];
    const out = await getBillingBackend().listProducts();
    const byCode = Object.fromEntries(out.map((p) => [p.planCode, p]));
    expect(byCode.p9.priceFormatted).toBe('₪9.00');
    expect(byCode.p49.priceFormatted).toBe('₪49.00');
    expect(byCode.p9.productId).toBe('plan_p9');
    expect(byCode.p49.productId).toBe('plan_p49');
  });

  it('treats an empty catalogue as empty rather than throwing', async () => {
    rows = [];
    await expect(getBillingBackend().listProducts()).resolves.toEqual([]);
  });
});
