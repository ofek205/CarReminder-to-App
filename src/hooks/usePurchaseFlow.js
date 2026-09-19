/**
 * The React shell around the purchase state machine.
 *
 * ⚠️ IT DECIDES NOTHING. Every transition comes from
 * `@/lib/billing/purchaseMachine`, which is pure and covered by 30 tests.
 * What lives here is only what cannot be pure: timers, the Play call, and
 * setState. Duplicating a rule here would create a second source of truth
 * that no test is watching.
 *
 * @see docs/ux-play-billing-purchase.md §5
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getBillingBackend } from '@/lib/billing';
import {
  PurchaseState, afterSheet, afterVerification, afterCatalogue, mayOfferPurchase,
} from '@/lib/billing/purchaseMachine';

export { PurchaseState };

/**
 * ⚠️ A CEILING ON VERIFICATION, BECAUSE THE ALTERNATIVE IS A PERMANENT SPINNER
 * ON A SCREEN WHERE THE USER HAS ALREADY BEEN CHARGED.
 *
 * When it fires the state becomes PENDING and never FAILED, per
 * afterVerification('timeout').
 */
const VERIFY_TIMEOUT_MS = 20000;

/**
 * @param {object}  opts
 * @param {boolean} opts.enabled    resolved play_billing_enabled
 * @param {string}  opts.accountId
 * @param {(t: {purchaseToken: string, productId: string}) => Promise<boolean>} opts.verifyPurchase
 */
export function usePurchaseFlow({ enabled, accountId, verifyPurchase }) {
  const [state, setState] = useState(PurchaseState.LOADING_PRODUCTS);
  const [products, setProducts] = useState([]);
  const [activeProductId, setActiveProductId] = useState(null);

  const backend = getBillingBackend();
  const aliveRef = useRef(true);
  const timerRef = useRef(null);

  useEffect(() => () => {
    aliveRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Guards against setting state on a component the user navigated away from
  // while the Play sheet was open, which is an ordinary thing to do.
  const safeSet = useCallback((next) => {
    if (aliveRef.current) setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!mayOfferPurchase(enabled, backend !== null)) {
      setState(PurchaseState.UNAVAILABLE);
      return undefined;
    }
    setState(PurchaseState.LOADING_PRODUCTS);
    (async () => {
      try {
        const connected = await backend.connect();
        const list = connected ? await backend.listProducts() : [];
        if (cancelled) return;
        setProducts(list);
        safeSet(afterCatalogue({ connected, products: list }));
      } catch {
        if (!cancelled) safeSet(afterCatalogue({ connected: false, threw: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, backend, safeSet]);

  const runVerification = useCallback(async (result) => {
    safeSet(PurchaseState.VERIFYING);
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timerRef.current);
      safeSet(afterVerification(outcome));
    };

    timerRef.current = setTimeout(() => finish('timeout'), VERIFY_TIMEOUT_MS);
    try {
      const ok = await verifyPurchase({
        purchaseToken: result.purchaseToken,
        productId: result.productId,
      });
      finish(ok ? 'ok' : 'rejected');
    } catch {
      finish('threw');
    }
  }, [verifyPurchase, safeSet]);

  const buy = useCallback(async (productId) => {
    if (!backend) return;
    setActiveProductId(productId);
    safeSet(PurchaseState.SHEET_OPEN);

    const result = await backend.purchase(productId, accountId);
    const { state: next, verify } = afterSheet(result.outcome);

    if (verify) { await runVerification(result); return; }
    safeSet(next);
    // Only a cancellation clears the active product: every other terminal
    // state still describes the plan the user was acting on.
    if (next === PurchaseState.IDLE) setActiveProductId(null);
  }, [backend, accountId, runVerification, safeSet]);

  /**
   * ⚠️ THE SAFETY NET, AND THE REASON IT RUNS AT MOUNT AND NOT ONLY ON A TAP.
   *
   * If the app closed between the charge and the entitlement, Play still holds
   * the purchase and we hold nothing. Waiting for the user to find a button
   * means waiting for them to contact support instead.
   */
  const restore = useCallback(async () => {
    if (!backend) return;
    const owned = await backend.queryOwnedPurchases();
    if (owned.length === 0) { safeSet(PurchaseState.IDLE); return; }
    setActiveProductId(owned[0].productId);
    await runVerification(owned[0]);
  }, [backend, runVerification, safeSet]);

  return { state, products, activeProductId, buy, restore };
}
