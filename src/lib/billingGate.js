/**
 * Billing surface gate — the ONE place that decides what a purchase screen
 * may show on the current platform.
 *
 * WHY THIS IS A MODULE AND NOT AN `isIOS` CHECK IN EACH SCREEN
 *   App Store Guideline 3.1.1(a) forbids an iOS app from showing a button, a
 *   link, or even a mention of buying anything outside the app. Google's
 *   consumption-only exemption is looser: it permits MENTIONING an external
 *   purchase without linking to it, and forbids mixing that with Play
 *   Billing. Those are different rules with different consequences, and the
 *   consequence of getting one wrong is the app being pulled.
 *
 *   Scattered `isIOS ? …` checks fail by omission: the screen someone adds
 *   next year without knowing the rule is the one that gets rejected. One
 *   function means there is a single thing to be right about, and a single
 *   thing to grep for during a store review.
 *
 * @see docs/ux-my-plan.md §5
 * @see docs/spec-monetization-plans-v2.md §5.4
 * @see docs/spec-monetization-legal-compliance.md §3.4
 */

import { isIOS, isAndroid, isNative } from '@/lib/capacitor';

/** In-app purchase (StoreKit / Play Billing) is the only permitted route. */
export const IAP = 'iap';
/** No purchase route at all: inform, do not sell, do not link. */
export const NONE = 'none';
/** Our own checkout, prices, and links are all permitted. */
export const WEB = 'web';

/**
 * Which purchase surface this platform allows.
 *
 * iOS native  -> 'iap'   StoreKit only. Our prices, our site, our checkout
 *                        are all forbidden, including as plain text.
 * Android native -> 'none'  Today the app ships no Play Billing, so under the
 *                        consumption-only exemption it may TELL the user
 *                        that a subscription exists elsewhere but may not
 *                        link to it. Adding Play Billing later means that
 *                        sentence has to be REMOVED: hybrid is forbidden.
 * browser / PWA -> 'web'   No store rules apply.
 *
 * @returns {'iap'|'none'|'web'}
 */
export function billingSurface() {
  if (isNative && isIOS) return IAP;
  if (isNative && isAndroid) return NONE;
  // Anything else is a browser. Note the ORDER: this falls through to 'web'
  // only after both native checks, so an unrecognised native platform can
  // never be treated as a browser and be handed a checkout link.
  if (isNative) return NONE;
  return WEB;
}

/**
 * May this surface show a control that starts a purchase?
 * True on iOS too, but there it means the StoreKit sheet, never our checkout.
 */
export function canPurchase() {
  return billingSurface() !== NONE;
}

/**
 * May this surface link to our website, our prices, or our checkout?
 *
 * ⚠️ FALSE ON iOS, AND THAT INCLUDES PLAIN TEXT. 3.1.1(a) covers "buttons,
 * external links, or other calls to action", and reviewers have rejected
 * apps for a bare URL in body copy. If this returns false, the screen must
 * not render the price of a web plan, the domain, or a "manage online"
 * sentence.
 */
export function canReferToWeb() {
  return billingSurface() === WEB;
}

/**
 * May this surface merely SAY that a paid plan exists elsewhere, without
 * linking or pricing it?
 *
 * This is the Android-only middle ground the consumption-only exemption
 * creates, and it is why `none` is not simply "show nothing".
 */
export function canMentionExternalPurchase() {
  return billingSurface() !== IAP;
}

/**
 * What a "you hit the cap" wall is allowed to offer.
 *
 * ⚠️ TWO SEPARATE RULES MEET HERE AND BOTH CONSTRAIN THE ANSWER.
 *
 * 1. ANTI-STEERING. On iOS a wall may not carry a button, a link, a price,
 *    or a mention of buying elsewhere. So for a PLAN cap on iOS the honest
 *    output is no call to action at all, until StoreKit exists in phase 7.
 *
 * 2. NEVER OFFER AN ACTION THAT CANNOT BE FULFILLED. This is the documented
 *    lesson from lib/aiScanGate.js, which deliberately ships no "try again"
 *    button because the flag is admin-controlled and a per-user retry would
 *    mislead. It applies twice over here:
 *      - on iOS there is nothing to press, so pressing must not be implied
 *      - and even on the web, /MyPlan is DISPLAY-ONLY until phase 6, so the
 *        label must not promise an upgrade it cannot perform. It says "see
 *        your plan and limits", which is exactly what happens.
 *
 * The `personal` kind is not platform-gated: its remedy is
 * CreateBusinessWorkspace, an in-app admin-approval request rather than a
 * purchase, so no store rule touches it.
 *
 * @param {'plan'|'personal'|null} kind  which cap refused
 * @returns {{cta: 'plan'|'business'|null, mayMentionPlans: boolean}}
 */
export function capWallAction(kind) {
  if (kind === 'personal') {
    return { cta: 'business', mayMentionPlans: false };
  }
  const surface = billingSurface();
  if (surface === IAP) {
    // iOS: nothing about plans, prices, or the site. Not even as prose.
    return { cta: null, mayMentionPlans: false };
  }
  if (surface === NONE) {
    // Android: may say a paid plan exists, may not link to it.
    return { cta: null, mayMentionPlans: true };
  }
  return { cta: 'plan', mayMentionPlans: true };
}
