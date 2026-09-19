/**
 * The sticky banner shown between "the card was charged" and "the plan is on".
 *
 * ⚠️ A CHECK MARK, NOT A SPINNER, AND THAT IS THE WHOLE DESIGN.
 *   A spinner says "wait". A check says "your money arrived". The user has
 *   just been charged, and the one thing they need in that second is
 *   confirmation the payment landed, not a loading indicator that reads as a
 *   stall. Progress is carried by a 2px indeterminate hairline on the bottom
 *   edge only, so the banner still communicates "working" without becoming a
 *   loading state.
 *
 * ⚠️ IT IS ALSO A BANNER RATHER THAN A SPINNER ON THE BUTTON. The button is
 *   small, it is below the fold on a long list, and it is the wrong size for
 *   the most reassuring message on the screen. Sticky means it survives
 *   scrolling, which is exactly when a worried user starts scrolling.
 *
 * @see docs/ux-play-billing-purchase.md §5 state 6
 */

import React from 'react';
import { Check } from 'lucide-react';
import { C } from '@/lib/designTokens';

export default function VerifyingBanner({ pending = false }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-20 -mx-4 mb-4 px-4 py-3 overflow-hidden"
      style={{
        background: C.successSubtle,
        borderTop: `1px solid ${C.successBright}`,
        borderBottom: `1px solid ${C.successBright}`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5"
          style={{ background: C.successBright }}
        >
          <Check className="h-3 w-3 text-white" aria-hidden />
        </span>
        <div>
          <p className="text-[14px] font-bold" style={{ color: C.successDark }}>
            {pending ? 'התשלום נקלט וההפעלה מתעכבת' : 'התשלום נקלט. מפעילים את המסלול.'}
          </p>
          <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: C.gray700 }}>
            {pending
              ? 'לא חויבת פעמיים ולא צריך לשלם שוב. אנחנו משלימים את ההפעלה.'
              : 'זה בדרך כלל לוקח כמה שניות.'}
          </p>
        </div>
      </div>

      {/* The only motion on the screen. Absent once we stop expecting an
          answer, because a bar that keeps moving forever is the stuck spinner
          this component exists to avoid. */}
      {!pending && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden"
          style={{ background: C.successLighter }}
          aria-hidden
        >
          <div
            className="h-full w-1/3 animate-[cr-verify-slide_1.4s_ease-in-out_infinite]"
            style={{ background: C.successBright }}
          />
        </div>
      )}
    </div>
  );
}
