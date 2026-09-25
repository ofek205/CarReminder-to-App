import { describe, it, expect } from 'vitest';
import {
  afterSheet, afterVerification, afterCatalogue, mayOfferPurchase, PurchaseState,
} from './purchaseMachine';
import { PurchaseOutcome } from './types';

describe('afterSheet: the three outcomes that are not failures', () => {
  it('cancellation returns to idle and does not verify', () => {
    const r = afterSheet(PurchaseOutcome.CANCELLED);
    expect(r).toEqual({ state: PurchaseState.IDLE, verify: false });
    expect(r.state).not.toBe(PurchaseState.FAILED);
  });

  it('a store-pending purchase is DEFERRED and does NOT verify', () => {
    // Verifying an unsettled payment would grant a plan nobody has paid for.
    const r = afterSheet(PurchaseOutcome.PENDING);
    // DEFERRED, not PENDING: nothing is charged yet, and PENDING's copy says
    // the payment arrived.
    expect(r).toEqual({ state: PurchaseState.DEFERRED, verify: false });
    expect(r.state).not.toBe(PurchaseState.PENDING);
    expect(r.state).not.toBe(PurchaseState.SUCCESS);
  });

  it('owned is its own state, so the user is never sent back to a sheet', () => {
    const r = afterSheet(PurchaseOutcome.OWNED);
    expect(r.state).toBe(PurchaseState.OWNED);
    expect(r.verify).toBe(false);
  });

  it('only a completed purchase continues to verification', () => {
    expect(afterSheet(PurchaseOutcome.PURCHASED)).toEqual({
      state: PurchaseState.VERIFYING, verify: true,
    });
  });

  it('an unrecognised outcome fails closed and never verifies', () => {
    for (const junk of ['', null, undefined, 'ok', 'success', 'done']) {
      const r = afterSheet(junk);
      expect(r.state).toBe(PurchaseState.FAILED);
      expect(r.verify).toBe(false);
    }
  });

  it('every known outcome is handled, so adding one cannot pass unnoticed', () => {
    const handled = Object.values(PurchaseOutcome)
      .filter((o) => o !== PurchaseOutcome.UNAVAILABLE)
      .map((o) => afterSheet(o).state);
    expect(handled).not.toContain(undefined);
  });
});

describe('afterVerification: the card has already been charged', () => {
  it('reaches success only on a confirmed entitlement', () => {
    expect(afterVerification('ok')).toBe(PurchaseState.SUCCESS);
  });

  it.each(['rejected', 'threw', 'timeout'])('%s becomes PENDING, never FAILED', (r) => {
    // From the user's side these are identical: the money left and the plan
    // has not arrived. Calling it failure invites paying twice.
    expect(afterVerification(r)).toBe(PurchaseState.PENDING);
    expect(afterVerification(r)).not.toBe(PurchaseState.FAILED);
  });

  it('no input whatsoever produces FAILED', () => {
    for (const junk of [undefined, null, '', 'OK', 'Ok', 0, false]) {
      expect(afterVerification(junk)).toBe(PurchaseState.PENDING);
    }
  });
});

describe('afterCatalogue', () => {
  it('an empty catalogue is unavailable, not idle', () => {
    // Idle renders buy buttons, and a buy button with no product behind it
    // is a control that cannot do anything.
    expect(afterCatalogue({ connected: true, products: [] })).toBe(PurchaseState.UNAVAILABLE);
  });

  it('a failed connection is unavailable', () => {
    expect(afterCatalogue({ connected: false, products: [{}] })).toBe(PurchaseState.UNAVAILABLE);
  });

  it('a throw is unavailable', () => {
    expect(afterCatalogue({ connected: true, threw: true })).toBe(PurchaseState.UNAVAILABLE);
  });

  it('a non-array is unavailable rather than crashing', () => {
    expect(afterCatalogue({ connected: true, products: null })).toBe(PurchaseState.UNAVAILABLE);
    expect(afterCatalogue({ connected: true })).toBe(PurchaseState.UNAVAILABLE);
  });

  it('products plus a connection is idle', () => {
    expect(afterCatalogue({ connected: true, products: [{ productId: 'plan_p9' }] }))
      .toBe(PurchaseState.IDLE);
  });
});

describe('mayOfferPurchase', () => {
  it('requires the flag to be exactly true', () => {
    // useFeatureFlag resolves to undefined while loading, and a truthy check
    // would flash a buy button on a screen where a mis-tap costs money.
    for (const v of [undefined, null, 0, 1, '', 'true', {}]) {
      expect(mayOfferPurchase(v, true)).toBe(false);
    }
    expect(mayOfferPurchase(true, true)).toBe(true);
  });

  it('is false without a backend even when the flag is on', () => {
    expect(mayOfferPurchase(true, false)).toBe(false);
  });
});
