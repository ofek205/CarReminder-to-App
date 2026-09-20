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
 * @see docs/ux-play-billing-purchase.md §5
 */

import React from 'react';
import { Loader2, Check } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { PurchaseState } from '@/lib/billing/purchaseMachine';

/** Numerals stay LTR inside Hebrew, or "₪9.00" renders reversed. */
function Num({ children }) {
  return <span dir="ltr" className="tabular-nums">{children}</span>;
}

/**
 * ⚠️ NOT A DISABLED BUTTON. A greyed control invites a tap and then
 * disappoints; absence promises nothing. UX §5 state 2.
 */
function Unavailable({ offline }) {
  return (
    <p className="text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
      {offline
        ? 'אין חיבור לאינטרנט. המסלולים יוצגו כשהחיבור יחזור.'
        : 'לא הצלחנו לטעון את המסלולים מ-Google Play. אפשר לנסות שוב בעוד רגע, וכל מה שיש לך בחשבון ממשיך לעבוד כרגיל.'}
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

export default function PurchaseAction({
  state,
  priceFormatted,
  busy = false,
  offline = false,
  manage = false,
  onBuy,
  onRestore,
  onManage,
}) {
  const unavailable = state === PurchaseState.UNAVAILABLE;
  const loading     = state === PurchaseState.LOADING_PRODUCTS;
  const owned       = state === PurchaseState.OWNED;
  const success     = state === PurchaseState.SUCCESS;
  const failed      = state === PurchaseState.FAILED;
  const pending     = state === PurchaseState.PENDING;

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
  const showRestore = owned || pending;

  return (
    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.gray100}` }}>
      <div className="mb-3">
        {loading && <PriceSkeleton />}
        {!loading && !unavailable && priceFormatted && <Price formatted={priceFormatted} />}
      </div>

      {unavailable ? (
        <Unavailable offline={offline} />
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
          ) : manage ? (
            /**
             * ⚠️ THIS BRANCH EXISTS BECAUSE THE SCREEN LET SOMEBODY BUY TWICE.
             *
             * After a purchase landed, every OTHER paid card stayed on a live
             * "בחר מסלול". Tapping it calls purchaseProduct() with no
             * replacement mode, which is not an upgrade: Play opens a second
             * subscription and charges for both. Seconds after paying us ₪9,
             * a curious tap on the ₪19 card cost real money twice over.
             *
             * A plan CHANGE is a genuine thing to want, and Play is where it
             * is actually performed, with proration it computes and we do
             * not. So the card keeps its price, drops the charge, and points
             * at the one place the change can be made correctly.
             */
            <button
              type="button"
              onClick={onManage}
              className="w-full h-12 rounded-2xl text-[15px] font-bold disabled:opacity-60"
              style={{ background: 'transparent', color: C.primary, border: `1px solid ${C.primary}` }}
            >
              ניהול המנוי
            </button>
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
              {pending ? 'בדוק שוב' : 'שחזר רכישה'}
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
              {state === PurchaseState.SHEET_OPEN ? 'ממתין ל-Google Play'
                : state === PurchaseState.VERIFYING ? 'מפעילים את המסלול'
                : failed ? 'נסה שוב'
                : 'בחר מסלול'}
            </button>
          )}

          {manage && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
              כבר יש לך מנוי פעיל. מעבר בין מסלולים וביטול נעשים ב-Google Play, שם גם מחושב ההפרש.
            </p>
          )}

          {owned && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
              כבר יש לך מנוי פעיל בחשבון Google הזה. נשחזר אותו לחשבון שלך באפליקציה, בלי חיוב נוסף.
            </p>
          )}

          {failed && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.errorDark }}>
              התשלום לא הושלם ולא חויבת. אפשר לנסות שוב או לבחור אמצעי תשלום אחר ב-Google Play.
            </p>
          )}

          {pending && (
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: C.gray700 }}>
              התשלום נקלט וההפעלה מתעכבת. לא חויבת פעמיים ולא צריך לשלם שוב. אנחנו משלימים את ההפעלה, ואפשר גם לסגור ולפתוח את האפליקציה.
            </p>
          )}

          {/* ⚠️ REQUIRED BY PLAY, and placed against the button on purpose.
              Pushed to the card footer it becomes legal boilerplate the eye
              skips; next to the control it belongs to the action. */}
          {/* ⚠️ AND NOT UNDER `manage` EITHER. The disclosure describes the
              charge this button is about to make, so printing it beside a
              control that makes no charge states a renewal the user is not
              agreeing to here. */}
          {!success && !pending && !manage && (
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: C.gray500 }}>
              החיוב מתחדש אוטומטית. ניתן לבטל בכל עת דרך Google Play.
            </p>
          )}
        </>
      )}
    </div>
  );
}
