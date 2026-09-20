/**
 * The one place a screen asks for a billing backend.
 *
 * Selection is by PLATFORM, never by build mode. `import.meta.env.DEV` would
 * hand the mock to a production web build (harmless but wrong) and, far worse,
 * hand the real plugin to a dev native build where it cannot connect, which
 * looks exactly like a broken integration.
 *
 * @see docs/ux-play-billing-purchase.md
 */

import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { isAndroid, isNative } from '@/lib/capacitor';
import { mockBackend } from './mockBackend';
import { PurchaseOutcome } from './types';

export { PurchaseOutcome };

/**
 * The three Play subscription ids.
 *
 * ⚠️ THE SERVER IS STILL THE AUTHORITY. public.iap_products maps a product id
 * to a plan and is what grant_iap_entitlement() trusts. This list exists only
 * because the client has to name the products before Play will price them,
 * and an id that is not in the table simply fails to grant.
 *
 * Play ids are permanent and cannot be reused, so these are effectively
 * immutable once the products exist in the console.
 */
const PLAY_PRODUCT_IDS = Object.freeze(['plan_p9', 'plan_p19', 'plan_p49']);

/** plan_p9 -> p9. The table is the authority; this only labels the card. */
const planCodeOf = (productId) => String(productId || '').replace(/^plan_/, '');

/**
 * Did the user simply close the Play sheet?
 *
 * ⚠️ BEST EFFORT, AND THE ONE THING IN THIS FILE THAT CANNOT BE CONFIRMED
 * WITHOUT A DEVICE. The plugin's type definitions expose no error-code enum,
 * so a cancellation arrives as a thrown error like any other and has to be
 * recognised from its shape. Play's own response code for it is 1
 * (USER_CANCELED), which is what the numeric check is for.
 *
 * Getting this wrong in the FALSE direction is the expensive one: a
 * cancellation misread as a failure shows "התשלום לא הושלם" to somebody who
 * simply changed their mind. Getting it wrong the other way is harmless, a
 * silent return to idle.
 *
 * 🔴 CONFIRM ON A REAL DEVICE: open the sheet, press back, and check that the
 * screen returns to idle with no error.
 */
function isUserCancellation(err) {
  const code = err?.code ?? err?.responseCode;
  if (code === 1 || code === '1') return true;
  return /cancel/i.test(err?.message || '');
}

/**
 * Google Play Billing, through @capgo/native-purchases.
 *
 * ⚠️ WRITTEN AGAINST THE INSTALLED .d.ts, NOT THE README, AND THEY DISAGREE.
 * The npm page states that `restorePurchases()` hands back an array of
 * transactions. The shipped definitions declare `Promise<void>`. The method
 * that actually returns owned purchases is `getPurchases()`, and building the
 * restore path on the documented call would have produced a safety net that
 * silently found nothing, every time.
 */
function buildPlayBackend() {
  return {
    async connect() {
      const { isBillingSupported } = await NativePurchases.isBillingSupported();
      return isBillingSupported === true;
    },

    async listProducts() {
      const { products } = await NativePurchases.getProducts({
        productIdentifiers: [...PLAY_PRODUCT_IDS],
        productType: PURCHASE_TYPE.SUBS,
      });
      return (products || []).map((p) => ({
        productId: p.identifier,
        planCode: planCodeOf(p.identifier),
        // The store's own localised string. Never a number we format: the
        // plugin's own docs warn that a hardcoded price is a store rejection,
        // and a displayed price that differs from the charged one is a policy
        // breach rather than a cosmetic bug.
        priceFormatted: p.priceString,
        priceCurrency: p.currencyCode,
      }));
    },

    async purchase(productId, accountId) {
      if (!accountId) {
        return { outcome: PurchaseOutcome.FAILED, productId, message: 'no accountId' };
      }
      try {
        const txn = await NativePurchases.purchaseProduct({
          productIdentifier: productId,
          productType: PURCHASE_TYPE.SUBS,
          // The only link Play gives back. Our account_id is a uuid, which is
          // exactly what Android accepts here (uuid, max 64 chars).
          appAccountToken: accountId,
          // ⚠️ DEFAULTS TO TRUE, AND TRUE WOULD BE WRONG FOR US.
          // Auto-acknowledging marks the purchase as honoured before our
          // server has seen the token. Play refunds an unacknowledged
          // purchase after three days, and that refund is the user's
          // protection if our grant never lands. Acknowledging up front
          // throws it away. We acknowledge after the entitlement is written.
          autoAcknowledgePurchases: false,
        });
        return {
          outcome: PurchaseOutcome.PURCHASED,
          productId,
          purchaseToken: txn?.purchaseToken,
        };
      } catch (err) {
        if (isUserCancellation(err)) {
          return { outcome: PurchaseOutcome.CANCELLED, productId };
        }
        return { outcome: PurchaseOutcome.FAILED, productId, message: err?.message };
      }
    },

    async queryOwnedPurchases() {
      const { purchases } = await NativePurchases.getPurchases({
        productType: PURCHASE_TYPE.SUBS,
        onlyCurrentEntitlements: true,
      });
      // ⚠️ NO LOCAL ACTIVE/EXPIRED FILTER BEYOND THAT FLAG, ON PURPOSE.
      // `isActive` and `willCancel` are documented as iOS-only and always
      // null on Android, so the device genuinely cannot tell a refunded
      // subscription from a live one. The plugin's own guidance is to use the
      // Play Developer API, which is what our verification step does. So
      // every token here goes to the server and the server decides; a
      // refunded purchase simply fails verification and grants nothing.
      return (purchases || []).map((t) => ({
        outcome: PurchaseOutcome.OWNED,
        productId: t.productIdentifier ?? t.productId,
        purchaseToken: t.purchaseToken,
      }));
    },

    async acknowledge(purchaseToken) {
      if (!purchaseToken) return false;
      await NativePurchases.acknowledgePurchase({ purchaseToken });
      return true;
    },
  };
}

/**
 * ⚠️ A SINGLETON, AND THE LACK OF ONE IS WHAT LEFT /Plans SPINNING ALL NIGHT
 * ON A REAL DEVICE WHILE EVERY BROWSER CHECK PASSED.
 *
 * getBillingBackend() used to call buildPlayBackend() on every invocation, so
 * it handed back a NEW object each time. usePurchaseFlow puts that object in
 * the dependency array of the effect that loads the catalogue. A fresh
 * identity every render means the effect re-runs every render:
 *
 *     catalogue resolves -> setState -> re-render -> new backend object
 *       -> deps changed -> effect re-runs -> setState(LOADING_PRODUCTS)
 *       -> re-render -> new backend object -> ...
 *
 * The screen never leaves LOADING_PRODUCTS, and re-queries Play forever. The
 * catalogue timeout added earlier does not rescue it: the timeout fires,
 * UNAVAILABLE is set, that is itself a state change, and the next render
 * starts the whole cycle again. A twelve-second flip-flop reads as a
 * permanent spinner, which is precisely what was reported.
 *
 * ⚠️ AND THIS IS WHY THE PREVIEW NEVER SHOWED IT. The browser branches return
 * `mockBackend` (a module-level object) or `null`, both of which are
 * referentially stable, so the loop is unreachable off Android. A bug that
 * only exists on the platform the preview cannot run is the argument for
 * fixing identity HERE, at the source, rather than asking every caller to
 * remember a useMemo.
 *
 * Safe as a singleton because the object is stateless: every method is a
 * direct call into the plugin, and it holds no connection or cursor of its own.
 */
let playBackendSingleton = null;
function playBackend() {
  if (playBackendSingleton === null) playBackendSingleton = buildPlayBackend();
  return playBackendSingleton;
}

/**
 * Opens Play's own subscription page, where a subscriber cancels or changes
 * payment method.
 *
 * ⚠️ THIS IS THE ONLY CANCEL ROUTE THAT EXISTS, AND FOR A WHILE IT WAS WIRED
 * TO NOTHING. The function was written, documented in the UX spec as the
 * /MyPlan control, and then never imported by a screen, so a subscriber had
 * no way out of the plan from inside the app. Play expects that route to
 * exist; more to the point, a subscription with no visible exit is the kind
 * of thing people charge back rather than cancel.
 *
 * ⚠️ RETURNS A BOOLEAN RATHER THAN THROWING. The caller is a button on a
 * screen that must keep working. A plugin that is missing, or a device with
 * no Play Store, is a reason to show the user a fallback sentence, never a
 * reason to take down /MyPlan.
 *
 * @returns {Promise<boolean>} true when the store page was handed off to
 */
export async function openStoreSubscriptionManagement() {
  if (!canOpenStoreSubscriptionManagement()) return false;
  try {
    await NativePurchases.manageSubscriptions();
    return true;
  } catch {
    return false;
  }
}

/**
 * Can this platform actually open that page?
 *
 * ⚠️ EXPORTED SO A SCREEN CAN DECIDE WHETHER TO RENDER THE CONTROL AT ALL,
 * rather than rendering one that returns false in silence. /MyPlan shows the
 * manage button by subscription SOURCE, which is right: someone who bought on
 * their phone and is reading in a browser should still learn where the
 * subscription lives. But the sheet is a native Play surface, so on that
 * browser the sentence is the honest thing to show and the button is not.
 */
export function canOpenStoreSubscriptionManagement() {
  return isNative && isAndroid;
}

/**
 * @returns {import('./types').BillingBackend|null}
 */
export function getBillingBackend() {
  // Native selection stays PLATFORM-based and never looks at DEV, because a
  // dev native build must still get the real plugin. Handing it the mock
  // there would fake a working integration on a device.
  if (isNative && isAndroid) return playBackend();

  // ⚠️ THE BROWSER BRANCH IS DEV-ONLY, AND THE FIRST VERSION GOT THIS WRONG.
  //
  // It returned the mock for every browser, and the commit message called a
  // mock in a production web build "harmless but wrong". It is neither.
  // useFeatureFlag resolves `enabled` as `isAdmin === true || flagValue ===
  // true`, so an admin bypasses the flag, and a mock backend made
  // mayOfferPurchase() true for them. Every admin opening /Plans on the live
  // site would have seen "בחר מסלול" buttons priced ₪9.00 by a fake store.
  //
  // Nothing could be granted (verification returns false), so no data was at
  // risk. It was simply a lying screen, shown to the people most likely to
  // trust it.
  if (!isNative) return import.meta.env.DEV ? mockBackend : null;

  return null;
}

/**
 * Is there a purchase sheet that can actually open right now?
 *
 * ⚠️ THIS IS THE DISTINCTION billingSurface() DOES NOT MAKE, and the reason
 * flipping Android to IAP was never a one-line change. billingSurface()
 * answers "which store governs this platform". It does NOT answer "is there
 * something to press", and until a store is implemented those two questions
 * had identical answers everywhere, which is how they came to be conflated.
 *
 * capWallAction() returns no CTA for IAP because that branch was written for
 * iOS, where there is genuinely no sheet. Reusing it for Android after Play
 * Billing ships would strip the call to action from the cap wall at the exact
 * moment we finally have something to sell.
 *
 * Callers must pass the resolved `play_billing_enabled` flag. This module does
 * not read it, so it stays synchronous and free of a data dependency; the flag
 * arrives from useFeatureFlag where the screen already has it.
 *
 * @param {boolean} flagEnabled
 * @returns {boolean}
 */
export function iapReady(flagEnabled) {
  if (flagEnabled !== true) return false;
  return getBillingBackend() !== null;
}
