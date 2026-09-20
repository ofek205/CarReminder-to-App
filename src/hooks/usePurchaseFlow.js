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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBillingBackend } from '@/lib/billing';
import { reportError } from '@/lib/crashReporter';
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
 * ⚠️ SHORTER THAN THE VERIFICATION CEILING, AND DELIBERATELY SO.
 *
 * Nobody has paid anything yet at this point, so the cost of giving up early
 * is a screen that says the catalogue is unavailable, which is recoverable by
 * reopening it. The verification ceiling is long because the money has
 * already moved and patience there is worth more than a fast answer.
 */
const CATALOGUE_TIMEOUT_MS = 12000;

/** Rejects rather than resolving, so the caller's catch owns the failure. */
function withCatalogueTimeout(fn) {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('play_catalogue_timeout')), CATALOGUE_TIMEOUT_MS)),
  ]);
}

/**
 * @param {object}  opts
 * @param {boolean} opts.enabled    resolved play_billing_enabled
 * @param {string}  opts.accountId
 * @param {(t: {purchaseToken: string, productId: string}) => Promise<boolean>} opts.verifyPurchase
 * @param {() => void} [opts.onGranted]  fired once per successful grant
 */
export function usePurchaseFlow({ enabled, accountId, verifyPurchase, onGranted }) {
  const [state, setState] = useState(PurchaseState.LOADING_PRODUCTS);
  const [products, setProducts] = useState([]);
  const [activeProductId, setActiveProductId] = useState(null);

  /**
   * ⚠️ MEMOISED, AND ITS ABSENCE WAS THE ALL-NIGHT SPINNER ON A REAL DEVICE.
   *
   * This value sits in the dependency array of the catalogue effect below. On
   * Android getBillingBackend() used to mint a new object per call, so the
   * deps changed on every render, the effect re-ran, it set LOADING_PRODUCTS,
   * that re-rendered, and the loop closed on itself. The screen sat on a
   * spinning "בחר מסלול" overnight, re-querying Play the whole time.
   *
   * The real fix is in lib/billing: the Play backend is now a singleton, so
   * identity is stable for every caller. This useMemo stays as the second
   * layer, because a dependency array holding an object returned by a
   * function call is fragile by construction, and the failure mode is
   * invisible in a browser.
   */
  const backend = useMemo(() => getBillingBackend(), []);
  const aliveRef = useRef(true);

  /**
   * ⚠️ A SET, NOT A SINGLE REF, AND THE SINGLE REF WAS A REAL BUG.
   *
   * With one slot, two overlapping verifications overwrite each other and
   * `clearTimeout(ref.current)` cancels the LATER timer while the earlier one
   * survives. Twenty seconds on it fires against its own closure, whose
   * `settled` is still false, and writes PENDING over a SUCCESS that already
   * landed. It was unreachable while the only caller was a locked button, and
   * restoring at mount (below) is exactly what would have made it reachable.
   */
  const timersRef = useRef(new Set());
  const restoredRef = useRef(false);

  useEffect(() => () => {
    aliveRef.current = false;
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  /**
   * ⚠️ READ FROM AN EVENT, NOT AT RENDER. The first version called
   * `navigator.onLine` inline, which is a snapshot: losing the connection
   * triggered no re-render, so the offline state was designed, built,
   * verified and then unreachable in practice.
   */
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
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
        // ⚠️ A CEILING, BECAUSE WITHOUT ONE THIS HUNG FOREVER ON A REAL
        // DEVICE. connect() and getProducts() talk to the Play billing
        // client, which can fail to call back at all rather than rejecting:
        // newly created products take time to reach the device, and the
        // client's own connection is not guaranteed to resolve. The first
        // version awaited them bare, so the screen sat on a spinning
        // "בחר מסלול" with nothing to press and no way out.
        //
        // CLAUDE.md states the rule outright: never a permanent spinner. The
        // verification path already had a ceiling; this one did not, and the
        // omission only showed up on hardware.
        const list = await withCatalogueTimeout(async () => {
          const connected = await backend.connect();
          return connected ? await backend.listProducts() : null;
        });
        if (cancelled) return;
        setProducts(list || []);
        safeSet(afterCatalogue({ connected: list !== null, products: list }));
      } catch (err) {
        if (cancelled) return;
        // Reported rather than swallowed: a catalogue that never answers is
        // indistinguishable on screen from one that answers empty, and the
        // difference is what tells us whether Play is reachable at all.
        try {
          reportError('billing_catalogue', err, { where: 'usePurchaseFlow.catalogue' });
        } catch { /* reporting must never be the thing that breaks the screen */ }
        safeSet(afterCatalogue({ connected: false, threw: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, backend, safeSet]);

  const runVerification = useCallback(async (result) => {
    safeSet(PurchaseState.VERIFYING);
    let settled = false;
    // Captured per invocation, so `finish` can only ever cancel its OWN timer.
    let timer = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timersRef.current.delete(timer); }
      safeSet(afterVerification(outcome));
      /**
       * ⚠️ THE CACHE HAS TO BE TOLD, AND NOTHING USED TO TELL IT.
       *
       * The entitlement now exists in the database, but useAccountPlan holds
       * a 60-second staleTime and React Query has no idea anything moved. So
       * the card flipped to "המסלול שלך" while isCurrent() on the very same
       * screen still pointed at the free plan, and /MyPlan still read free.
       * Two contradictory answers to "which plan am I on", one screen apart,
       * in the seconds right after someone paid us.
       *
       * Fires OUTSIDE the state write and guarded, because a refetch failing
       * must not undo a purchase that already succeeded.
       */
      if (outcome === 'ok' && typeof onGranted === 'function') {
        try { onGranted(); } catch { /* a stale cache is not worth a crash */ }
      }
    };

    timer = setTimeout(() => finish('timeout'), VERIFY_TIMEOUT_MS);
    timersRef.current.add(timer);
    try {
      // ⚠️ accountId TRAVELS WITH THE TOKEN. The server refuses a
      // verification whose caller is not a member of the account being
      // credited, which is what stops a signed-in user posting somebody
      // else's account id alongside their own purchase.
      const ok = await verifyPurchase({
        purchaseToken: result.purchaseToken,
        productId: result.productId,
        accountId,
      });
      finish(ok ? 'ok' : 'rejected');
    } catch {
      finish('threw');
    }
  }, [verifyPurchase, accountId, safeSet, onGranted]);

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

  /**
   * ⚠️ AND THIS IS THE PART THAT WAS MISSING ENTIRELY.
   *
   * The comment above and docs/ux-play-billing-purchase.md §3.1 both said the
   * restore runs at launch, and nothing called it: it was wired only to a
   * button. A user whose app closed between the charge and the entitlement
   * would have had to find that button themselves, which in practice means
   * contacting support instead.
   *
   * Runs once per mount, and only once the catalogue has resolved, because
   * before that there is no connection to query through. `restoredRef` is
   * what stops the IDLE it can set from re-triggering it.
   */
  useEffect(() => {
    if (state !== PurchaseState.IDLE) return;
    if (restoredRef.current) return;
    restoredRef.current = true;
    restore();
  }, [state, restore]);

  return { state, products, activeProductId, online, buy, restore };
}
