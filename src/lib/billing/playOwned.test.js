/**
 * The restore query returns only the restoring account's purchases.
 *
 * ⚠️ THE HOLE THIS PINS. Play's getPurchases answers for the device's GOOGLE
 * account, not for our account. One person with a personal and a business
 * workspace had account A's subscription sent with account B's id on the
 * mount restore, and B was credited with A's plan for free. The server now
 * refuses that too (verify-play-purchase, account_mismatch); this is the
 * client half, so B never sends it and never shows a PENDING banner for a
 * purchase that was never B's.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/capacitor', () => ({
  get isNative() { return true; },
  get isAndroid() { return true; },
  get isIOS() { return false; },
}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: {
    isBillingSupported: async () => ({ isBillingSupported: true }),
    getPurchases: async () => ({
      purchases: [
        { productIdentifier: 'plan_p9', purchaseToken: 'tok-a', appAccountToken: A },
        { productIdentifier: 'plan_p19', purchaseToken: 'tok-legacy' },
      ],
    }),
  },
  PURCHASE_TYPE: { SUBS: 'subs', INAPP: 'inapp' },
}));

const { getBillingBackend } = await import('./index');

describe('queryOwnedPurchases(accountId)', () => {
  it('gives account A its own purchase', async () => {
    const owned = await getBillingBackend().queryOwnedPurchases(A);
    expect(owned.map((p) => p.purchaseToken)).toContain('tok-a');
  });

  it('never hands account A\'s purchase to account B', async () => {
    const owned = await getBillingBackend().queryOwnedPurchases(B);
    expect(owned.map((p) => p.purchaseToken)).not.toContain('tok-a');
  });

  it('lets a purchase with no account link through, for the server to decide', async () => {
    // Bought before appAccountToken was sent. verify-play-purchase checks
    // what it can; the device cannot tell whose it is.
    const owned = await getBillingBackend().queryOwnedPurchases(B);
    expect(owned.map((p) => p.purchaseToken)).toEqual(['tok-legacy']);
  });

  it('returns everything when no account is given, as before', async () => {
    const owned = await getBillingBackend().queryOwnedPurchases();
    expect(owned).toHaveLength(2);
  });
});
