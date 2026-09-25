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
export const PLAY_PRODUCT_IDS = Object.freeze(['plan_p9', 'plan_p19', 'plan_p49']);

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

      /**
       * ⚠️ `planIdentifier` IS THE PRODUCT ID. `identifier` IS THE BASE PLAN.
       * THE FIRST VERSION READ THE WRONG ONE, AND THE FIELDS SWAP MEANING
       * BETWEEN PRODUCT TYPES, WHICH IS WHY IT LOOKED RIGHT.
       *
       * For a one-time product the plugin sets identifier = product id. For a
       * SUBSCRIPTION it sets identifier = BASE PLAN id and planIdentifier =
       * product id. Its own definitions.d.ts says so outright: "If you
       * group/filter Android subscription results by `identifier`, you are
       * grouping by base plan."
       *
       * Reading `identifier` therefore produced planCode 'p9-monthly' instead
       * of 'p9'. Nothing matches that, so every card would have rendered
       * UNAVAILABLE with no price and no button: the SAME screen as a store
       * that returned nothing at all. And a purchase would have been started
       * with a base plan id, which Play rejects, while the server compared
       * our claim against Google's real product id and answered
       * product_mismatch, leaving a charged user in PENDING for ever.
       *
       * ⚠️ AND THIS IS WHY THE SWAPPED BASE PLAN NAMES IN PLAY CONSOLE WERE
       * NOT HARMLESS. plan_p9 carries a base plan named p49-monthly and
       * plan_p49 carries p9-monthly. Under the old mapping those two cards
       * would have traded places.
       */
      const mapped = (products || []).map((p) => {
        const productId = p.planIdentifier || p.identifier;
        return {
          productId,
          planCode: planCodeOf(productId),
          // ⚠️ REQUIRED TO BUY A SUBSCRIPTION AT ALL, NOT A DIAGNOSTIC. It was
          // first kept "for diagnostics" and never sent, and the plugin refuses
          // every subscription purchase without it (see purchase() below).
          basePlanId: p.identifier || null,
          // null on the base plan itself, set on a promotional offer.
          offerId: p.offerId ?? null,
          // Kept for diagnostics ONLY. ⚠️ An earlier comment here claimed the
          // purchase needed it, and that was false for subscriptions: the
          // plugin reads offerToken solely in its one-time-product branch.
          offerToken: p.offerToken ?? null,
          // The store's own localised string. Never a number we format: the
          // plugin's own docs warn that a hardcoded price is a store rejection,
          // and a displayed price that differs from the charged one is a policy
          // breach rather than a cosmetic bug.
          priceFormatted: p.priceString,
          priceCurrency: p.currencyCode,
        };
      });

      /**
       * ⚠️ ONE ROW PER PRODUCT, BECAUSE THE PLUGIN RETURNS ONE PER OFFER.
       * Its docs: "When multiple offers exist, getProducts() returns one entry
       * per eligible offer." A plan with an introductory offer therefore
       * arrives twice, and `products.find(...)` would take whichever came
       * first. The base plan wins over a promotional offer so the card shows
       * the recurring price rather than a first-month teaser.
       */
      const byProduct = new Map();
      for (const m of mapped) {
        const seen = byProduct.get(m.productId);
        if (!seen || (seen.offerId && !m.offerId)) byProduct.set(m.productId, m);
      }
      return [...byProduct.values()];
    },

    async purchase(productId, accountId, basePlanId) {
      if (!accountId) {
        return { outcome: PurchaseOutcome.FAILED, productId, message: 'no accountId' };
      }
      if (!basePlanId) {
        // Refused here, with a message that names the cause, rather than
        // handed to a plugin that refuses it anyway with a message nobody
        // was reporting.
        return { outcome: PurchaseOutcome.FAILED, productId, message: 'no basePlanId for subscription' };
      }
      try {
        const txn = await NativePurchases.purchaseProduct({
          productIdentifier: productId,
          productType: PURCHASE_TYPE.SUBS,
          /**
           * ⚠️ REQUIRED FOR EVERY SUBSCRIPTION, AND FROM THE DAY THIS BACKEND
           * WAS WRITTEN WE NEVER SENT IT, SO NOT ONE PURCHASE COULD HAVE WORKED.
           *
           * The plugin's Java opens purchaseProduct with:
           *
           *   if (productType.equals("subs") && planIdentifier is empty)
           *       call.reject("planIdentifier cannot be empty if productType is subs");
           *
           * so the Play sheet never opened. The rejection surfaced as
           * FAILED, which renders "התשלום לא הושלם ולא חויבת", accurately as
           * it happens, because nothing was charged: nothing was even asked.
           *
           * ⚠️ AND THE NAME IS A TRAP. Here `planIdentifier` means the BASE
           * PLAN id, which the plugin matches against getBasePlanId(). In the
           * getProducts() RESULT, the field of the same name holds the PRODUCT
           * id. One word, two meanings, one call apart. Our catalogue row
           * carries the base plan as `basePlanId` precisely so this line
           * cannot confuse the two.
           *
           * ⚠️ AND offerToken IS NOT SENT, ON PURPOSE. An earlier version
           * sent it, with a comment claiming it chose the charged offer. For
           * subscriptions the plugin ignores it entirely; it is read only in
           * the one-time-product branch. The base plan chooses the offer, and
           * the plugin takes that base plan's first offer.
           */
          planIdentifier: basePlanId,
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

    /**
     * @param {string} [accountId]  the account doing the restore
     *
     * ⚠️ ONLY THIS ACCOUNT'S PURCHASES. Play returns every subscription on
     * the device's GOOGLE account, and one person may hold a personal and a
     * business workspace. The mount restore in workspace B sent A's token
     * with B's id, and the server credited B with A's plan. verify-play-
     * purchase now refuses that (account_mismatch), and this is the other
     * half: B never sends it, so B's screen does not sit on a PENDING banner
     * for a purchase that was never B's. The plugin returns the account a
     * purchase was made for as appAccountToken, verbatim as we sent it. A
     * purchase without one predates that link and goes to the server to
     * decide.
     */
    async queryOwnedPurchases(accountId) {
      const { purchases } = await NativePurchases.getPurchases({
        productType: PURCHASE_TYPE.SUBS,
        onlyCurrentEntitlements: true,
      });
      const mine = (purchases || []).filter(
        (t) => !accountId || !t.appAccountToken || t.appAccountToken === accountId,
      );
      // ⚠️ NO LOCAL ACTIVE/EXPIRED FILTER BEYOND THAT FLAG, ON PURPOSE.
      // `isActive` and `willCancel` are documented as iOS-only and always
      // null on Android, so the device genuinely cannot tell a refunded
      // subscription from a live one. The plugin's own guidance is to use the
      // Play Developer API, which is what our verification step does. So
      // every token here goes to the server and the server decides; a
      // refunded purchase simply fails verification and grants nothing.
      return mine.map((t) => ({
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
