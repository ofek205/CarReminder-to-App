/**
 * Apple StoreKit 2, through @capgo/native-purchases 8.7.0.
 *
 * ⚠️ NOT WIRED INTO getBillingBackend() YET, AND THAT IS DELIBERATE.
 * getBillingBackend() still returns null on iOS, so nothing here is reachable
 * by any user. Switching it on also needs the verify call routed to
 * verify-apple-purchase, the "Google Play" strings in PurchaseAction worded
 * per store, and the 3.1.1(a) decision in billingGate. Those live in files
 * another session is redesigning, so they ship together as slice 2.
 * See docs/plan-apple-iap.md §4.
 *
 * ⚠️ WRITTEN AGAINST THE PLUGIN'S SWIFT, NOT ITS README OR ITS .d.ts.
 * Every rule below is a line in
 *   node_modules/@capgo/native-purchases/ios/Sources/NativePurchasesPlugin/
 * and appleBackend.test.js reproduces each one in its mock. On Android the
 * README and the types disagreed with the native code four separate times,
 * and every one of those passed review.
 */

import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { reportError } from '@/lib/crashReporter';
import { PurchaseOutcome } from './types';

/**
 * The three App Store subscription ids.
 *
 * ⚠️ IDENTICAL TO PLAY'S ON PURPOSE, AND A SEPARATE CONSTANT ON PURPOSE.
 * One spelling per plan across both stores leaves nothing to cross, which is
 * how Play ended up with p9 holding a base plan named p49-monthly. They are
 * still two registries: Apple ids are permanent and cannot be reused after
 * deletion, so if App Store Connect ever refuses one, only this list moves.
 *
 * The server stays the authority. public.iap_products (store = 'apple') maps
 * an id to a plan, and an id missing there grants nothing.
 */
export const APPLE_PRODUCT_IDS = Object.freeze(['plan_p9', 'plan_p19', 'plan_p49']);

/** plan_p9 -> p9. The table is the authority; this only labels the card. */
const planCodeOf = (productId) => String(productId || '').replace(/^plan_/, '');

// The exact shape Swift's UUID(uuidString:) accepts: 8-4-4-4-12 hex digits,
// either case, no braces.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * ⚠️ CASE-INSENSITIVE, BECAUSE THE PLUGIN HANDS THE TOKEN BACK IN UPPER CASE.
 * Swift reports `transaction.appAccountToken?.uuidString`, and uuidString is
 * always upper case. Our account ids are lower case. A plain `===` would call
 * every one of our own purchases foreign.
 */
export function sameUuid(a, b) {
  return isUuid(a) && isUuid(b) && a.toLowerCase() === b.toLowerCase();
}

/**
 * Why did purchaseProduct reject?
 *
 * The first two strings are hardcoded in handlePurchaseResult() and are NOT
 * localised, so they are safe to match exactly on a Hebrew device:
 *
 *   case .userCancelled: call.reject("User cancelled")
 *   case .pending:       call.reject("Transaction pending")
 *
 * ⚠️ PENDING IS NOT A FAILURE. It is Ask to Buy (a parent has to approve) or
 * a payment that needs an extra step. Calling it FAILED would tell someone
 * whose purchase may still go through that it did not.
 *
 * Everything else arrives as `error.localizedDescription`, which IS localised,
 * so the fallback regex is best effort. It errs towards CANCELLED, the
 * harmless direction: a failure misread as a cancellation is a silent return
 * to idle, while the reverse tells somebody who changed their mind that
 * their payment failed.
 *
 * 🔴 CONFIRM ON A DEVICE: close the sheet and check the screen returns to
 * idle with no error.
 */
export function outcomeOfRejection(err) {
  const message = String(err?.message ?? err ?? '');
  if (message === 'User cancelled') return PurchaseOutcome.CANCELLED;
  if (message === 'Transaction pending') return PurchaseOutcome.PENDING;
  if (/cancel/i.test(message)) return PurchaseOutcome.CANCELLED;
  return PurchaseOutcome.FAILED;
}

/**
 * One catalogue row from one Product.dictionary.
 *
 * ⚠️ `identifier` IS THE PRODUCT ID HERE, UNLIKE ANDROID. The Swift builds
 * `"identifier": self.id` and never sets planIdentifier, and there are no
 * base plans. The Android fields are kept, null, so both stores hand the
 * screen the same shape.
 */
export function mapAppleProduct(p) {
  const productId = p?.identifier;
  return {
    productId,
    planCode: planCodeOf(productId),
    basePlanId: null,
    offerId: null,
    offerToken: null,
    // StoreKit's displayPrice, already localised. Never a number we format.
    priceFormatted: p?.priceString,
    priceCurrency: p?.currencyCode,
  };
}

/** Never lets a diagnostic become the thing that breaks the screen. */
function safeReport(type, err, extra) {
  try { reportError(type, err, extra); } catch { /* reporting must never throw */ }
}

/**
 * The storefront the device is buying from, for the catalogue report.
 *
 * ⚠️ THIS IS THE FACT THAT COST THREE DAYS ON ANDROID. Play returned nothing
 * because the tester's Play country was the US and the products are Israel
 * only, and nothing in our reports said which country was asking. StoreKit
 * gives no per-product reason at all, so the storefront is the most useful
 * thing we can attach. Bounded, because it is a diagnostic inside a
 * catalogue call that already has a ceiling of its own.
 */
async function currentStorefront() {
  try {
    const sf = await Promise.race([
      NativePurchases.getStorefront(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return sf?.countryCode || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function buildAppleBackend() {
  return {
    /** Which store this is. The Play backend predates the field. */
    store: 'apple',
    productIds: APPLE_PRODUCT_IDS,
    // listProducts() reports every missing id with the storefront, so the
    // hook's generic "catalogue empty" report would only be a duplicate.
    reportsCatalogueGaps: true,

    async connect() {
      // ⚠️ ALWAYS TRUE ON iOS, AND NOT BECAUSE StoreKit WAS ASKED. The Swift
      // is `call.resolve(["isBillingSupported": true])` with nothing else.
      // A device where purchases are disabled (Screen Time, MDM) still says
      // yes here, and the refusal only arrives at purchase time.
      const { isBillingSupported } = await NativePurchases.isBillingSupported();
      return isBillingSupported === true;
    },

    async listProducts() {
      const { products } = await NativePurchases.getProducts({
        productIdentifiers: [...APPLE_PRODUCT_IDS],
        // Read by Android only; the Swift logs it and ignores it.
        productType: PURCHASE_TYPE.SUBS,
      });

      const rows = (products || [])
        .filter((p) => APPLE_PRODUCT_IDS.includes(p?.identifier))
        .map(mapAppleProduct);

      /**
       * ⚠️ AN UNKNOWN ID IS SILENTLY LEFT OUT, NOT REJECTED. This is the
       * opposite of Android, where an empty result rejects with "Product not
       * found". Product.products(for:) simply returns fewer products, and the
       * Swift resolves whatever came back. A catalogue missing one plan is
       * therefore invisible unless we count, so we count and report every
       * gap, partial or total, with the ids and the storefront in the
       * MESSAGE, which is the column app_errors actually gets read by.
       */
      const missing = APPLE_PRODUCT_IDS.filter((id) => !rows.some((r) => r.productId === id));
      if (missing.length > 0) {
        const storefront = await currentStorefront();
        safeReport(
          'billing_catalogue',
          new Error(`apple_catalogue_missing [${missing.join(',')}] storefront=${storefront}`),
          { where: 'appleBackend.listProducts', requested: APPLE_PRODUCT_IDS, missing, storefront },
        );
      }
      return rows;
    },

    async purchase(productId, accountId) {
      if (!accountId) {
        return { outcome: PurchaseOutcome.FAILED, productId, message: 'no accountId' };
      }
      /**
       * ⚠️ REFUSED HERE, BECAUSE THE PLUGIN WOULD NOT REFUSE IT AT ALL.
       *
       *   if let token = appAccountToken, !token.isEmpty,
       *      let uuid = UUID(uuidString: token) { insert(.appAccountToken(uuid)) }
       *
       * There is no else. A token that is not a uuid is dropped without a
       * word, the sheet opens, the user pays, and the purchase carries no
       * link to any account. The server then has no honest way to credit
       * it. Stopping before the sheet costs a sale that could not have been
       * delivered; letting it through costs a charged user with nothing.
       */
      if (!isUuid(accountId)) {
        return {
          outcome: PurchaseOutcome.FAILED,
          productId,
          message: 'accountId is not a uuid; StoreKit would drop appAccountToken silently',
        };
      }

      try {
        const txn = await NativePurchases.purchaseProduct({
          productIdentifier: productId,
          productType: PURCHASE_TYPE.SUBS,
          // The link back to us. It travels inside Apple's signed
          // transaction, which is what verify-apple-purchase and the
          // notification endpoint both read it from.
          appAccountToken: accountId,
          /**
           * ⚠️ TRUE HERE, FALSE ON ANDROID, AND THE DIFFERENCE IS THE STORE.
           * On Play an unacknowledged purchase is refunded after three days,
           * and that refund protects a user whose grant never landed. Apple
           * has no such rule: finishing a transaction only stops StoreKit
           * redelivering it. And redelivery would buy us nothing, because the
           * plugin's own Transaction.updates listener finishes every
           * redelivered transaction at launch regardless of this flag.
           *
           * Recovery on iOS does not depend on the transaction staying open:
           * a finished subscription stays in Transaction.currentEntitlements
           * (restore reads that), and Apple notifies our server directly.
           */
          autoAcknowledgePurchases: true,
        });

        const transactionId = txn?.transactionId ? String(txn.transactionId) : '';
        if (!transactionId) {
          // The sheet completed, so money may have moved. PURCHASED with no
          // token verifies as "not yet", which renders PENDING, the honest
          // answer, and the server notification can still grant it.
          safeReport('billing_purchase', new Error('apple_purchase_no_transaction_id'), {
            where: 'appleBackend.purchase', productId,
          });
        } else if (isUuid(txn?.appAccountToken) && !sameUuid(txn.appAccountToken, accountId)) {
          /**
           * ⚠️ ANOTHER ACCOUNT'S SUBSCRIPTION CAME BACK, SO NOTHING WAS BOUGHT.
           * A purchase we start always carries OUR token, and StoreKit signs
           * it into any NEW transaction. A different token therefore means
           * StoreKit handed back an EXISTING transaction: this Apple ID is
           * already subscribed, for another account of ours. Nothing was
           * charged, and verifying it would render PENDING ("התשלום נקלט")
           * over a payment that never happened. FAILED's copy says exactly
           * the true thing: not completed, not charged.
           */
          safeReport('billing_purchase', new Error('apple_subscription_owned_by_other_account'), {
            where: 'appleBackend.purchase', productId, transactionId,
          });
          return {
            outcome: PurchaseOutcome.FAILED,
            productId,
            message: 'apple_subscription_owned_by_other_account',
          };
        } else if (!sameUuid(txn?.appAccountToken, accountId)) {
          // No token at all. Unreachable while the uuid check above holds.
          // Kept because the cost of it happening unseen is a charged user
          // we cannot credit.
          safeReport('billing_purchase', new Error('apple_purchase_account_token_lost'), {
            where: 'appleBackend.purchase', productId, transactionId,
          });
        }

        return {
          outcome: PurchaseOutcome.PURCHASED,
          productId,
          // ⚠️ `purchaseToken` IS THE STOREKIT TRANSACTION ID HERE, a numeric
          // string, because that is the field name the shared contract and
          // the hook use. `transactionId` carries the same value under its
          // real name so the verify call can send it as what it is.
          purchaseToken: transactionId || undefined,
          transactionId: transactionId || undefined,
        };
      } catch (err) {
        return { outcome: outcomeOfRejection(err), productId, message: err?.message };
      }
    },

    /**
     * The subscriptions this Apple ID holds FOR THIS ACCOUNT.
     *
     * ⚠️ FILTERED HERE, IN JS, AND NOT WITH THE PLUGIN'S OWN FILTER. The Swift
     * compares `transaction.appAccountToken?.uuidString != filter`, and
     * uuidString is upper case, so passing our lower-case account id there
     * matches nothing, ever, and restore would find nothing in silence.
     *
     * ⚠️ AND IT NEEDS THE ACCOUNT ID, UNLIKE PLAY'S. One Apple ID can hold a
     * subscription bought for a DIFFERENT CarReminder account. Sending that
     * one to the server would be refused, and a refusal renders PENDING,
     * which tells this user their payment is being activated when it belongs
     * to someone else. Without an account id there is nothing to filter by,
     * so it returns nothing rather than everything.
     */
    //
    // ⚠️ `sync` IS FOR A TAP, NEVER FOR THE AUTOMATIC RESTORE. It calls the
    // plugin's restorePurchases(), which is `AppStore.sync()` in the Swift,
    // and that may put Apple's own sign-in sheet in front of the user. Right
    // for someone who pressed "שחזור רכישות"; wrong for a screen that merely
    // opened. A failed or cancelled sync throws, and the caller reports it.
    async queryOwnedPurchases(accountId, { sync = false } = {}) {
      if (!isUuid(accountId)) {
        safeReport('billing_restore', new Error('apple_restore_without_account_id'), {
          where: 'appleBackend.queryOwnedPurchases',
        });
        return [];
      }
      // ⚠️ A FAILED SYNC DOES NOT SKIP THE LOCAL CHECK. Cancelling Apple's
      // sign-in, or being offline, throws from AppStore.sync(); the
      // subscriptions already on the phone are still readable, and a user who
      // holds one must not be told the check failed. It only becomes an
      // error when nothing is found either.
      let syncFailure = null;
      if (sync) {
        try { await NativePurchases.restorePurchases(); } catch (err) { syncFailure = err; }
      }
      const { purchases } = await NativePurchases.getPurchases({
        productType: PURCHASE_TYPE.SUBS,
        onlyCurrentEntitlements: true,
      });
      const owned = (purchases || [])
        .filter((t) => APPLE_PRODUCT_IDS.includes(t?.productIdentifier))
        .filter((t) => t?.transactionId)
        .filter((t) => sameUuid(t?.appAccountToken, accountId))
        .map((t) => ({
          outcome: PurchaseOutcome.OWNED,
          productId: t.productIdentifier,
          purchaseToken: String(t.transactionId),
          transactionId: String(t.transactionId),
        }));
      if (owned.length === 0 && syncFailure) throw syncFailure;
      return owned;
    },

    /**
     * Finishes a transaction. Rarely needed, since purchase() auto-finishes.
     * The Swift parses purchaseToken as a UInt64 transaction id and searches
     * Transaction.all, which includes finished ones, so a second call on an
     * already finished transaction resolves rather than rejecting.
     */
    async acknowledge(purchaseToken) {
      if (!purchaseToken) return false;
      await NativePurchases.acknowledgePurchase({ purchaseToken: String(purchaseToken) });
      return true;
    },
  };
}

/**
 * ⚠️ A SINGLETON, FOR THE SAME REASON THE PLAY BACKEND IS ONE.
 * The backend sits in a React dependency array. A new object per call
 * re-ran the catalogue effect on every render and left /Plans spinning all
 * night on a real Android device; see backendIdentity.test.js.
 */
let appleBackendSingleton = null;
export function appleBackend() {
  if (appleBackendSingleton === null) appleBackendSingleton = buildAppleBackend();
  return appleBackendSingleton;
}
