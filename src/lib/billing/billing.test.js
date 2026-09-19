/**
 * The invariants here are the ones a screen cannot re-derive, and two of them
 * are the difference between a working purchase flow and one that takes money
 * it cannot honour.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/capacitor', () => ({
  isNative: false,
  isAndroid: false,
  isIOS: false,
}));

import { mockBackend } from './mockBackend';
import { getBillingBackend, iapReady } from './index';
import { PurchaseOutcome } from './types';

const ACCOUNT = 'acc-1';

beforeEach(() => {
  globalThis.__crBilling = { latencyMs: 0, owned: [] };
});

describe('iapReady', () => {
  it('is false when the flag is off, even though the browser has a backend', () => {
    expect(getBillingBackend()).not.toBeNull();
    expect(iapReady(false)).toBe(false);
  });

  it('is false for anything that is not exactly true', () => {
    // The flag hook can resolve to undefined while loading. A truthy-ish
    // check would render a purchase button during that window.
    for (const v of [undefined, null, 0, '', 'true', 1]) {
      expect(iapReady(v)).toBe(false);
    }
  });

  it('is true only when the flag is on and a backend exists', () => {
    expect(iapReady(true)).toBe(true);
  });
});

describe('purchase outcomes', () => {
  it('reports cancellation as its own outcome, not as a failure', async () => {
    globalThis.__crBilling.purchase = 'cancelled';
    const r = await mockBackend.purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.CANCELLED);
    expect(r.outcome).not.toBe(PurchaseOutcome.FAILED);
    // Nothing to verify: a cancelled purchase must not reach the server.
    expect(r.purchaseToken).toBeUndefined();
  });

  it('reports pending separately from both success and failure', async () => {
    globalThis.__crBilling.purchase = 'pending';
    const r = await mockBackend.purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.PENDING);
    expect(r.outcome).not.toBe(PurchaseOutcome.PURCHASED);
    expect(r.outcome).not.toBe(PurchaseOutcome.FAILED);
  });

  it('refuses to purchase without an account to attach it to', async () => {
    // obfuscatedAccountId is the only link Play returns. A purchase made
    // without one cannot be matched to anybody, so the money would be taken
    // and the entitlement unassignable.
    const r = await mockBackend.purchase('plan_p9', '');
    expect(r.outcome).toBe(PurchaseOutcome.FAILED);
    expect(r.purchaseToken).toBeUndefined();
  });

  it('reports an already-owned product as OWNED rather than purchasing again', async () => {
    globalThis.__crBilling.owned = ['plan_p9'];
    const r = await mockBackend.purchase('plan_p9', ACCOUNT);
    expect(r.outcome).toBe(PurchaseOutcome.OWNED);
    expect(r.purchaseToken).toBeTruthy();
  });

  it('surfaces a prior purchase through queryOwnedPurchases, which is the launch-time safety net', async () => {
    await mockBackend.purchase('plan_p19', ACCOUNT);
    const owned = await mockBackend.queryOwnedPurchases();
    expect(owned.map((o) => o.productId)).toContain('plan_p19');
    expect(owned[0].purchaseToken).toBeTruthy();
  });
});

describe('product catalogue', () => {
  it('carries the store price as a preformatted string, never a number', async () => {
    const products = await mockBackend.listProducts();
    for (const p of products) {
      expect(typeof p.priceFormatted).toBe('string');
      expect(p).not.toHaveProperty('priceIlsMonth');
      // A number would invite local formatting, and the displayed price must
      // be the store's own or Play policy is breached.
      expect(Number.isFinite(p.priceFormatted)).toBe(false);
    }
  });

  it('maps every product to a real plan code', async () => {
    const products = await mockBackend.listProducts();
    expect(products.map((p) => p.planCode).sort()).toEqual(['p19', 'p49', 'p9']);
  });

  it('treats an empty catalogue as empty, not as an error', async () => {
    globalThis.__crBilling.listProducts = 'empty';
    await expect(mockBackend.listProducts()).resolves.toEqual([]);
  });

  it('throws only when the store is actually unreachable', async () => {
    globalThis.__crBilling.listProducts = 'throw';
    await expect(mockBackend.listProducts()).rejects.toThrow();
  });
});
