/**
 * The action strip at the bottom of a plan card: price, control, disclosure.
 *
 * DESIGN CONTRACT (designer, 2026-09-19)
 *   "A quiet document with one action row." The card stays calm and readable,
 *   and exactly one zone carries chrome. A purchase is a moment of doubt, so
 *   this should read like a receipt rather than a pitch.
 *
 * ⚠️ PRESENTATIONAL ONLY. It takes `state` and calls back. Every transition
 * lives in lib/billing/purchaseMachine, which is pure and tested. Deciding
 * anything here would create a second source of truth no test is watching.
 *
 * ⚠️ IT NO LONGER KNOWS ABOUT SUBSCRIBERS, AND THE `manage` PROP IS GONE ON
 * PURPOSE. It rendered "ניהול המנוי" under a sentence promising that plans
 * could be switched in Google Play, which Play does not allow. /Plans now
 * decides who may buy (actionKind) and never mounts this component for a
 * subscriber on another plan, so the double-purchase guard lives in one
 * tested place instead of being split between the screen and here.
 *
 * @see docs/ux-play-billing-purchase.md §5
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Check } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { createPageUrl } from '@/utils';
import { PurchaseState } from '@/lib/billing/purchaseMachine';
import { storeCopy } from '@/lib/billing/storeCopy';

/** Numerals stay LTR inside Hebrew, or "₪9.00" renders reversed. */
function Num({ children }) {
  return <span dir="ltr" className="tabular-nums">{children}</span>;
}

/**
 * ⚠️ NOT A DISABLED BUTTON. A greyed control invites a tap and then
 * disappoints; absence promises nothing. UX §5 state 2.
 */
function Unavailable({ offline, copy }) {
  return (
    <p className="text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
      {offline
        ? 'אין חיבור לאינטרנט. המסלולים יוצגו כשהחיבור יחזור.'
        : copy.catalogueFailed}
    </p>
  );
}

/**
 * Terms of use and privacy policy, against the disclosure they qualify.
 *
 * ⚠️ REQUIRED BY APPLE FOR AN AUTO-RENEWING SUBSCRIPTION (3.1.2): functional
 * links to both, in the purchase flow, or the subscription is rejected.
 * Shown for every store because a subscription's terms are ours, not the
 * store's.
 *
 * ⚠️ INLINE LINKS WITH VERTICAL PADDING, ON PURPOSE. Padding on an inline
 * element enlarges the touch target to about 40px without growing the line
 * box, so the zone stays one 11px line tall while the links stay pressable.
 */
function LegalLinks() {
  const link = 'underline underline-offset-2 py-3';
  return (
    <p className="text-[11px] leading-relaxed" style={{ color: C.gray500 }}>
      <Link to={createPageUrl('TermsOfService')} className={link}>תנאי שימוש</Link>
      <span className="px-1" aria-hidden="true">·</span>
      <Link to={createPageUrl('PrivacyPolicy')} className={link}>מדיניות פרטיות</Link>
    </p>
  );
}

/** Same height and baseline as the price, so nothing shifts when it arrives. */
function PriceSkeleton() {
  return (
    <div
      className="h-8 w-24 rounded-lg animate-pulse"
      style={{ background: C.gray100 }}
      aria-label="טוען מחיר"
    />
  );
}

function Price({ formatted }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[28px] font-bold leading-none" style={{ color: C.gray800 }}>
        <Num>{formatted}</Num>
      </span>
      <span className="text-[13px]" style={{ color: C.gray500 }}>לחודש</span>
    </div>
  );
}

/**
 * @param {'google'|'apple'} [store]  whose sheet this is. Every sentence that
 *   names a store comes from storeCopy(store); omitted means Google, which is
 *   what every caller meant before the App Store existed.
 */
export default function PurchaseAction({
  state,
  priceFormatted,
  busy = false,
  offline = false,
  store,
  onBuy,
  onRestore,
}) {
  const copy = storeCopy(store);
  const unavailable = state === PurchaseState.UNAVAILABLE;
  const loading     = state === PurchaseState.LOADING_PRODUCTS;
  const owned       = state === PurchaseState.OWNED;
  const success     = state === PurchaseState.SUCCESS;
  const failed      = state === PurchaseState.FAILED;
  const pending     = state === PurchaseState.PENDING;
  // The store has not taken the money yet (Ask to Buy on iOS). Not PENDING:
  // PENDING means charged and late, and says so.
  const deferred    = state === PurchaseState.DEFERRED;

  // Locked while the Play sheet is open or the server is verifying: a second
  // tap during either would open a second sheet on a charged card.
  //
  // ⚠️ LOADING_PRODUCTS IS IN HERE, FOUND IN THE PREVIEW AND NOT BY READING.
  // The skeleton rendered beside a live "בחר מסלול", so the control was
  // pressable in the one window where no product exists behind it yet.
  const locked = busy
    || state === PurchaseState.LOADING_PRODUCTS
    || state === PurchaseState.SHEET_OPEN
    || state === PurchaseState.VERIFYING;

  /**
   * ⚠️ PENDING OFFERS RESTORE, NEVER A PURCHASE. ALSO FOUND IN THE PREVIEW.
   *
   * The state rendered a filled "בחר מסלול" to somebody who had already been
   * charged and was waiting for activation, which invites the single action
   * that makes their situation strictly worse. The UX doc says it outright:
   * a user who paid and taps again must reach restore, not a second sheet.
   */
  //
  // DEFERRED offers it too: once a parent approves, restore is what finds
  // the purchase, and a buy button would ask the store a second time.
  const showRestore = owned || pending || deferred;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.gray100}` }}>
      <div className="mb-3">
        {loading && <PriceSkeleton />}
        {!loading && !unavailable && priceFormatted && <Price formatted={priceFormatted} />}
      </div>

      {unavailable ? (
        <Unavailable offline={offline} copy={copy} />
      ) : (
        <>
          {success ? (
            <div
              className="flex items-center justify-center gap-2 h-12 rounded-2xl text-[15px] font-bold"
              style={{ background: C.successSubtle, color: C.successDark }}
            >
              <Check className="h-4 w-4" aria-hidden />
              המסלול שלך
            </div>
          ) : showRestore ? (
            /* ⚠️ OUTLINE, NOT FILLED. Same size and position as the buy
               button, different weight. That is what says "this is not a new
               charge" without a sentence. */
            <button
              type="button"
              onClick={onRestore}
              disabled={locked}
              className="w-full h-12 rounded-2xl text-[15px] font-bold disabled:opacity-60"
              style={{ background: 'transparent', color: C.primary, border: `1px solid ${C.primary}` }}
            >
              {pending || deferred ? 'בדוק שוב' : 'שחזר רכישה'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onBuy}
              disabled={locked}
              className="w-full h-12 rounded-2xl text-[15px] font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ background: C.primary }}
            >
              {locked && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {/* ⚠️ The verifying label matters even though the control is
                  inert: a disabled "בחר מסלול" sitting under a banner that
                  says the payment arrived reads as though the purchase did
                  not register. */}
              {state === PurchaseState.SHEET_OPEN ? copy.sheetOpen
                : state === PurchaseState.VERIFYING ? 'מפעילים את המסלול'
                : failed ? 'נסה שוב'
                : 'בחר מסלול'}
            </button>
          )}

          {owned && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
              {copy.owned}
            </p>
          )}

          {failed && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.errorDark }}>
              {copy.failed}
            </p>
          )}

          {/* Blue, not grey and not red: a status, not a problem. Nothing was
              charged, and this is the one state where that is the headline. */}
          {deferred && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.infoDark }}>
              {copy.deferred}
            </p>
          )}

          {pending && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.gray700 }}>
              התשלום נקלט וההפעלה מתעכבת. לא חויבת פעמיים ולא צריך לשלם שוב. אנחנו משלימים את ההפעלה, ואפשר גם לסגור ולפתוח את האפליקציה.
            </p>
          )}

          {/* ⚠️ REQUIRED BY BOTH STORES, and placed against the button on purpose.
              Pushed to the card footer it becomes legal boilerplate the eye
              skips; next to the control it belongs to the action. */}
          {!success && !pending && !deferred && (
            <>
              <p className="mt-2 text-[11px] leading-relaxed" style={{ color: C.gray500 }}>
                {copy.renewal}
              </p>
              {/* Not while the sheet is open or the server is verifying:
                  leaving the screen then hides the activation banner, and
                  the user returns to a screen that never said it worked. */}
              {!locked && <LegalLinks />}
            </>
          )}
        </>
      )}
    </div>
  );
}
