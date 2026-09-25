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
 * Android native -> 'iap'  Play Billing. See the warning below.
 * browser / PWA -> 'web'   No store rules apply.
 *
 * ⚠️ ANDROID MOVED FROM 'none' TO 'iap' ON 2026-09-20, AND IT HAD TO.
 *
 * 'none' encoded the consumption-only exemption, which permits an app that
 * sells nothing in-app to MENTION that a subscription exists elsewhere. The
 * app stopped qualifying the moment the Play Billing library shipped inside
 * the binary and three subscriptions went live in the console. Play forbids
 * the HYBRID: Play Billing present AND an external purchase referred to.
 *
 * Until this change unavailableCopy(NONE) was rendering
 * "רכישה אינה זמינה באפליקציה. המנוי מנוהל באתר." on Android, in a build that
 * already carried Play Billing. That sentence, in that build, is the
 * violation itself, and it was live on the internal track.
 *
 * ⚠️ THE TRIGGER IS THE BUILD, NOT THE FEATURE FLAG. play_billing_enabled
 * controls whether we OFFER a purchase; it does not remove the Billing
 * library from the APK. So the exemption is gone whether the flag is on or
 * off, and this function must stay flag-independent. Whether there is a
 * sheet to press is a different question, answered by iapReady().
 *
 * @returns {'iap'|'none'|'web'}
 */
export function billingSurface() {
  if (isNative && isIOS) return IAP;
  if (isNative && isAndroid) return IAP;
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
 * ⚠️ FALSE ON ANDROID SINCE 2026-09-20. This used to be the Android middle
 * ground created by the consumption-only exemption. Shipping Play Billing
 * ended that exemption, so Android may no longer refer to a purchase made
 * anywhere else. Today only a browser may.
 *
 * If what a screen wants is to say "a paid plan exists" without pointing
 * outside the app, that is mayMentionPaidPlans(), not this.
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
 * ⚠️ THE SECOND ARGUMENT IS NOT OPTIONAL POLISH, IT IS THE WHOLE POINT NOW.
 *
 * Since Android became 'iap' this function would otherwise strip the call to
 * action from the cap wall on the one platform that finally has something to
 * sell, because the IAP branch was written for iOS where there genuinely is
 * no sheet. `iapReady` is the missing distinction: 'iap' says which store
 * governs the platform, `iapReady` says whether a sheet can actually open
 * right now. They were identical everywhere until Play Billing shipped,
 * which is how they came to be conflated in the first place.
 *
 * Callers pass `iapReady(flag)` from lib/billing. This module stays free of
 * the flag so it remains synchronous and testable.
 *
 * @param {'plan'|'personal'|null} kind  which cap refused
 * @param {{iapReady?: boolean}} [opts]  is there a purchase sheet to open
 * @returns {{cta: 'plan'|'business'|null, mayMentionPlans: boolean}}
 */
export function capWallAction(kind, opts = {}) {
  const iapReady = opts.iapReady === true;
  if (kind === 'personal') {
    return { cta: 'business', mayMentionPlans: false };
  }

  const surface = billingSurface();

  if (surface === WEB) return { cta: 'plan', mayMentionPlans: true };

  // An unrecognised native platform: no store to sell through and no link we
  // are willing to hand it. The conservative answer is the only safe one.
  if (surface === NONE) return { cta: null, mayMentionPlans: false };

  // ── surface === IAP ──────────────────────────────────────────────────────
  // ⚠️ TWO STORES LAND HERE SINCE ANDROID MOVED TO 'iap', AND THEY DIFFER ON
  // THE LEGAL QUESTION, NOT ONLY ON THE PRACTICAL ONE.
  //
  //   Android: Play Billing is in the binary and three subscriptions are live,
  //            so NAMING a paid plan is both permitted and true. What Play
  //            forbids is pointing at an EXTERNAL purchase, which no copy
  //            behind `mayMentionPlans` does. Keeping this true is also what
  //            stops the flip to 'iap' silently deleting a helpful sentence
  //            from four cap walls that were never in breach.
  //
  //   iOS:     3.1.1(a) covers prose. Naming our own plan is ordinary once
  //            the StoreKit sheet can sell it in the app, and a hint at an
  //            outside purchase while it cannot. So on iOS BOTH answers
  //            follow iapReady, unlike Android, where Play's rule is about
  //            the Billing library being in the build (the "hybrid").
  //
  // The CTA is the separate question, and the one `iapReady` answers: a
  // button may only appear where a sheet can actually open.
  if (isAndroid) return { cta: iapReady ? 'plan' : null, mayMentionPlans: true };
  if (isIOS) return { cta: iapReady ? 'plan' : null, mayMentionPlans: iapReady };
  return { cta: null, mayMentionPlans: false };
}

/**
 * May this surface merely NAME a paid plan, without linking anywhere outside
 * the app?
 *
 * ⚠️ NOT THE SAME QUESTION AS canMentionExternalPurchase(), AND THE TWO
 * STOPPED AGREEING WHEN ANDROID BECAME 'iap'.
 *
 * "A paid plan exists" is a statement about our own product. "Buy it over
 * there" is steering. Android may now do the first and must not do the
 * second, so a single gate can no longer answer both.
 */
export function mayMentionPaidPlans(opts = {}) {
  const surface = billingSurface();
  if (surface === WEB) return true;
  // ⚠️ iOS FOLLOWS iapReady, SEE capWallAction. Omitting the option keeps
  // the fail-closed answer, so a caller that never learned about StoreKit
  // stays silent rather than naming a plan the app cannot sell.
  if (surface === IAP && isIOS) return opts.iapReady === true;
  // ⚠️ ENUMERATED, NOT `!== IAP`. The first version was written as
  // `billingSurface() !== IAP || isAndroid`, which quietly returned TRUE for
  // an unrecognised native platform, because 'none' is also not 'iap'. A
  // store whose rules we do not know is the one place that must be silent,
  // and a negation gave it the permissive answer by default.
  if (surface === IAP) return isAndroid;
  return false;
}
