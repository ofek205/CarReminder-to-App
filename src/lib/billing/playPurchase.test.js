/**
 * THE PURCHASE CALL, TESTED AGAINST THE PLUGIN'S OWN RULE.
 *
 * ⚠️ WHY A FAITHFUL MOCK AND NOT A PERMISSIVE ONE. Every earlier billing test
 * mocked purchaseProduct as something that simply succeeds, so a request the
 * real plugin rejects on sight passed every test we had. The real Java opens
 * with:
 *
 *   if (productType.equals("subs") && planIdentifier is empty)
 *       call.reject("planIdentifier cannot be empty if productType is subs");
 *
 * and we never sent planIdentifier, so not one subscription purchase could
 * have worked, and the Play sheet never opened. The mock below reproduces that
 * guard exactly, so this class of bug fails here instead of on a phone.
 *
 * ⚠️ AND THE NAME IS A TRAP THE TESTS PIN. In a purchaseProduct REQUEST,
 * `planIdentifier` is the BASE PLAN id. In a getProducts RESULT, the field of
 * the same name is the PRODUCT id. The cases below assert which value goes
 * where, because reading the wrong one is the natural mistake.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/capacitor', () => ({
  get isNative() { return true; },
  get isAndroid() { return true; },
  get isIOS() { return false; },
}));

const purchaseProduct = vi.fn();
vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: {
    isBillingSupported: async () => ({ isBillingSupported: true }),
    purchaseProduct: (...args) => purchaseProduct(...args),
  },
  PURCHASE_TYPE: { SUBS: 'subs', INAPP: 'inapp' },
}));

const { getBillingBackend } = await import('./index');
const { PurchaseOutcome } = await import('./types');

/** Reproduces the plugin's Java guard verbatim, then succeeds. */
function faithfulPlugin(opts) {
  if (opts.productType === 'subs' && !opts.planIdentifier) {
    return Promise.reject(new Error('planIdentifier cannot be empty if productType is subs'));
  }
  return Promise.resolve({ purchaseToken: 'tok-123' });
}

beforeEach(() => {
  purchaseProduct.mockReset();
  purchaseProduct.mockImplementation(faithfulPlugin);
});

describe('purchase() against the real plugin rule', () => {
  it('succeeds when the base plan is supplied', async () => {
    const r = await getBillingBackend().purchase('plan_p9', 'acc-1', 'p9-monthly');
    expect(r.outcome).toBe(PurchaseOutcome.PURCHASED);
    expect(r.purchaseToken).toBe('tok-123');
  });

  it('sends the BASE PLAN id as planIdentifier, not the product id', async () => {
    // The name trap: in the request planIdentifier is the base plan, while in
    // the catalogue result the same field is the product. Sending the product
    // id here would pass the empty check and then match no base plan.
    await getBillingBackend().purchase('plan_p9', 'acc-1', 'p9-monthly');
    const sent = purchaseProduct.mock.calls[0][0];
    expect(sent.planIdentifier).toBe('p9-monthly');
    expect(sent.planIdentifier).not.toBe('plan_p9');
    expect(sent.productIdentifier).toBe('plan_p9');
    expect(sent.productType).toBe('subs');
  });

  it('refuses without a base plan, before calling the plugin at all', async () => {
    const r = await getBillingBackend().purchase('plan_p9', 'acc-1', undefined);
    expect(r.outcome).toBe(PurchaseOutcome.FAILED);
    // A message that names the cause, so the report says what went wrong.
    expect(r.message).toMatch(/basePlanId/);
    expect(purchaseProduct).not.toHaveBeenCalled();
  });

  it('proves the mock is faithful: the old call is rejected exactly as on the device', async () => {
    // A negative control on the mock itself. If this ever passed with no
    // planIdentifier, the rest of this file would be testing nothing.
    await expect(faithfulPlugin({ productIdentifier: 'plan_p9', productType: 'subs' }))
      .rejects.toThrow('planIdentifier cannot be empty if productType is subs');
  });

  it('does not send offerToken, which the plugin ignores for subscriptions', async () => {
    // An earlier version sent it with a comment claiming it chose the charged
    // offer. The plugin reads offerToken only in its one-time-product branch.
    await getBillingBackend().purchase('plan_p49', 'acc-1', 'p49-monthly');
    expect(purchaseProduct.mock.calls[0][0]).not.toHaveProperty('offerToken');
  });

  it('keeps autoAcknowledgePurchases false, so acknowledgement follows the grant', async () => {
    await getBillingBackend().purchase('plan_p19', 'acc-1', 'p19-monthly');
    expect(purchaseProduct.mock.calls[0][0].autoAcknowledgePurchases).toBe(false);
  });

  it('attaches our account id, the only link Play gives back', async () => {
    await getBillingBackend().purchase('plan_p19', 'acc-uuid-9', 'p19-monthly');
    expect(purchaseProduct.mock.calls[0][0].appAccountToken).toBe('acc-uuid-9');
  });
});
