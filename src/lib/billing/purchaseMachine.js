/**
 * The purchase state machine, as pure functions.
 *
 * WHY THIS IS NOT INSIDE THE HOOK
 *   Every test in this project runs against plain modules; nothing renders a
 *   component or a hook, and there is no React testing library in
 *   package.json. Rather than add one to reach this logic, the logic moves
 *   out. The decisions here are the ones worth pinning, and none of them
 *   need React to be true.
 *
 *   The hook keeps the effects: timers, the Play call, and setState.
 *
 * @see docs/ux-play-billing-purchase.md §5
 */

import { PurchaseOutcome } from './types';

/** UX §5, one per row of that table. */
export const PurchaseState = Object.freeze({
  LOADING_PRODUCTS: 'loading_products',
  UNAVAILABLE: 'unavailable',
  IDLE: 'idle',
  SHEET_OPEN: 'sheet_open',
  VERIFYING: 'verifying',
  SUCCESS: 'success',
  FAILED: 'failed',
  OWNED: 'owned',
  PENDING: 'pending',
  DEFERRED: 'deferred',
});

/**
 * Where a finished Play sheet lands us.
 *
 * ⚠️ THREE OF THE FIVE OUTCOMES ARE NOT FAILURES, and collapsing any of them
 * costs money or trust:
 *
 *   CANCELLED → IDLE, in silence. Closing the sheet is a legitimate act, and
 *     an error toast tells the user they did something wrong.
 *   PENDING   → DEFERRED. The store has not taken the money yet: Ask to Buy
 *     on iOS (a parent must approve), a slow payment method on Play.
 *     Granting would hand out a plan nobody paid for; failing would tell
 *     someone who WILL pay that they did not.
 *
 *     ⚠️ DEFERRED, NOT PENDING, AND THE DIFFERENCE IS THE COPY. PENDING is
 *     the state after verification ran late, when the card IS charged, and
 *     its banner says "התשלום נקלט". Reusing it here told a child waiting
 *     for a parent that the payment had landed. Unreachable on Android
 *     today, where the Play backend never returns PENDING.
 *   OWNED     → OWNED. This is what a reinstall looks like. Routing that user
 *     back to a purchase sheet is how somebody pays twice.
 *
 * Only PURCHASED continues to verification, and only an outcome we do not
 * recognise falls through to FAILED, which is the safe direction: an unknown
 * result must never be treated as a completed sale.
 *
 * @param {string} outcome
 * @returns {{ state: string, verify: boolean }}
 */
export function afterSheet(outcome) {
  switch (outcome) {
    case PurchaseOutcome.CANCELLED: return { state: PurchaseState.IDLE,    verify: false };
    case PurchaseOutcome.PENDING:   return { state: PurchaseState.DEFERRED, verify: false };
    case PurchaseOutcome.OWNED:     return { state: PurchaseState.OWNED,   verify: false };
    case PurchaseOutcome.PURCHASED: return { state: PurchaseState.VERIFYING, verify: true };
    default:                        return { state: PurchaseState.FAILED,  verify: false };
  }
}

/**
 * Where verification lands us, and the single most consequential rule here.
 *
 * ⚠️ NO PATH RETURNS FAILED. By the time this runs the card has been charged.
 * A server that answered "no", a server that threw and a server that never
 * answered are all the same thing from the user's side: the money left and
 * the plan has not arrived yet. That is PENDING, whose copy says the payment
 * was received and activation is running late.
 *
 * Calling it a failure would be the worst message this screen can produce,
 * because it invites the one action that makes things strictly worse, paying
 * a second time.
 *
 * @param {'ok'|'rejected'|'threw'|'timeout'} result
 * @returns {string}
 */
export function afterVerification(result) {
  return result === 'ok' ? PurchaseState.SUCCESS : PurchaseState.PENDING;
}

/**
 * Where the catalogue lands us.
 *
 * ⚠️ AN EMPTY LIST IS UNAVAILABLE, NOT IDLE. Idle renders buy buttons, and a
 * buy button with no product behind it is a control that cannot do anything.
 * The store answering with nothing is also not an error: the account is fine,
 * only the catalogue is missing, so the screen says so quietly rather than
 * showing a fault.
 *
 * @param {{ connected: boolean, products?: Array, threw?: boolean }} r
 * @returns {string}
 */
export function afterCatalogue({ connected, products, threw }) {
  if (threw || !connected) return PurchaseState.UNAVAILABLE;
  if (!Array.isArray(products) || products.length === 0) return PurchaseState.UNAVAILABLE;
  return PurchaseState.IDLE;
}

/**
 * May a purchase control be rendered at all?
 *
 * ⚠️ REQUIRES THE FLAG TO BE EXACTLY TRUE. useFeatureFlag resolves to
 * undefined while it loads, and a truthy check would flash a buy button
 * during that window on a screen where a mis-tap costs money.
 *
 * @param {boolean} flagEnabled
 * @param {boolean} hasBackend
 */
export function mayOfferPurchase(flagEnabled, hasBackend) {
  return flagEnabled === true && hasBackend === true;
}
