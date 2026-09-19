/**
 * Browser-testable billing backend.
 *
 * WHY THIS EXISTS AND IS NOT TEST-ONLY CODE
 *   Play Billing runs only in a signed build on a Play track. Without a mock,
 *   the ten states in docs/ux-play-billing-purchase.md §5 could only be seen
 *   by shipping a build for each one, and the states that matter most, the
 *   ones after a real charge, are the hardest to reach deliberately.
 *
 *   This backend makes every state reachable in the preview in one click,
 *   including the two nobody can trigger on demand in production: a server
 *   verification that hangs, and a purchase that Play reports as already
 *   owned.
 *
 * ⚠️ IT IS SELECTED BY PLATFORM, NOT BY ENV. `import.meta.env.DEV` would put
 * the real plugin into a dev native build, where it cannot work, and would
 * strip the mock from a production web build where the purchase surface is
 * inert anyway. See ./index.js.
 */

import { PurchaseOutcome } from './types';

/** Mirrors the three Play products. Prices look like Play's strings. */
const MOCK_PRODUCTS = [
  { productId: 'plan_p9',  planCode: 'p9',  priceFormatted: '₪9.00',  priceCurrency: 'ILS' },
  { productId: 'plan_p19', planCode: 'p19', priceFormatted: '₪19.00', priceCurrency: 'ILS' },
  { productId: 'plan_p49', planCode: 'p49', priceFormatted: '₪49.00', priceCurrency: 'ILS' },
];

/**
 * What the next call should do. Driven from the preview so a reviewer can
 * walk every state without editing code.
 *
 * ⚠️ HUNG ON `globalThis`, NOT ON `window`. In a browser they are the same
 * object, so `window.__crBilling` still works in devtools, but `window` alone
 * makes this module throw under the node test environment and ties a piece of
 * plain logic to a DOM it never needs.
 *
 * Read at call time rather than captured, so flipping a value mid-session
 * takes effect on the next call instead of requiring a reload.
 */
const DEFAULTS = Object.freeze({
  connect: true,
  listProducts: 'ok',   // 'ok' | 'empty' | 'throw'
  purchase: 'purchased',
  owned: [],
  latencyMs: 400,
});

function scenario() {
  globalThis.__crBilling = { ...DEFAULTS, ...(globalThis.__crBilling || {}) };
  return globalThis.__crBilling;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {import('./types').BillingBackend} */
export const mockBackend = {
  async connect() {
    await wait(scenario().latencyMs);
    return scenario().connect === true;
  },

  async listProducts() {
    const s = scenario();
    await wait(s.latencyMs);
    // A store that answers with nothing is NOT an error, and the difference
    // matters: UX §5 state 2 renders the cards without a price rather than
    // showing a failure, because the account is fine and only the catalogue
    // is missing.
    if (s.listProducts === 'throw') throw new Error('mock: play unreachable');
    if (s.listProducts === 'empty') return [];
    return MOCK_PRODUCTS.map((p) => ({ ...p }));
  },

  async purchase(productId, accountId) {
    const s = scenario();
    await wait(s.latencyMs);

    if (!accountId) {
      // Refuse rather than buy: a purchase with nothing to attach it to is
      // money we cannot honour. obfuscatedAccountId is the only link Play
      // gives back, so an empty one is unrecoverable, not merely untidy.
      return { outcome: PurchaseOutcome.FAILED, productId, message: 'mock: no accountId' };
    }
    if (s.owned.includes(productId)) {
      return { outcome: PurchaseOutcome.OWNED, productId, purchaseToken: `mock-token-${productId}` };
    }

    switch (s.purchase) {
      case 'cancelled':   return { outcome: PurchaseOutcome.CANCELLED, productId };
      case 'pending':     return { outcome: PurchaseOutcome.PENDING, productId, purchaseToken: `mock-token-${productId}` };
      case 'failed':      return { outcome: PurchaseOutcome.FAILED, productId, message: 'mock: payment declined' };
      case 'unavailable': return { outcome: PurchaseOutcome.UNAVAILABLE, productId };
      default:
        s.owned = [...s.owned, productId];
        return { outcome: PurchaseOutcome.PURCHASED, productId, purchaseToken: `mock-token-${productId}` };
    }
  },

  async queryOwnedPurchases() {
    const s = scenario();
    await wait(s.latencyMs);
    return s.owned.map((productId) => ({
      outcome: PurchaseOutcome.OWNED,
      productId,
      purchaseToken: `mock-token-${productId}`,
    }));
  },

  async acknowledge() {
    await wait(scenario().latencyMs);
    return true;
  },
};
