import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useFirstTimeTour from '@/hooks/useFirstTimeTour';
import { SYSTEM_POPUP_IDS, logSystemPopupEvent } from '@/lib/popups/systemPopups';

/**
 * FirstTimeTour. 4-step contextual tooltip tour for first-time users.
 *
 * Each step points at a real UI element identified by `data-tour="..."`.
 * Renders a full-viewport dark backdrop, a yellow spotlight ring around the
 * target, and a floating tooltip card with a small arrow. Positioning is
 * re-computed on window resize and orientation change.
 *
 * Usage: place `<FirstTimeTour enabled={isAuthenticated && !isGuest} />`
 * somewhere on /Dashboard. The 4 target elements must have data-tour
 * attributes matching the STEPS list below.
 *
 * See useFirstTimeTour for state + localStorage logic.
 */

const DEFAULT_STEPS = [
  {
    key: 'add-vehicle',
    title: 'מוסיפים רכב כאן',
    body: 'מספר רישוי בלבד, וכל הפרטים ימולאו אוטומטית.',
  },
  {
    key: 'notif-bell',
    title: 'תזכורות בזמן',
    body: 'טסט, ביטוח וטיפולים. נזכיר לפני שיפוג התוקף, לא אחרי.',
  },
  {
    key: 'ai-tab',
    title: 'שאל את ברוך ויוסי',
    body: 'מומחי AI זמינים 24/7 לכל שאלה על הרכב או הסירה שלך.',
  },
  {
    key: 'menu',
    title: 'התפריט שלך',
    body: 'הגדרות, שיתוף חשבון, מוסכים וכל השאר נמצאים כאן.',
  },
];

const VIEWPORT_PAD = 12;
const CARD_WIDTH = 300;
const ARROW_SIZE = 10;

// Color palettes. 'default' is the land-vehicle green theme that the
// dashboard tour uses; 'vessel' swaps to the marine teal/cyan used
// across vessel-detail pages for visual consistency.
const THEMES = {
  default: {
    badgeBg:      '#E8F2EA',
    badgeColor:   '#2D5233',
    dotActive:    '#2D5233',
    buttonGrad:   'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
    buttonShadow: 'rgba(45,82,51,0.35)',
    ring:         '#FFBF00',
    ringGlow:     'rgba(255,191,0,0.25)',
    titleColor:   '#1C3620',
  },
  vessel: {
    badgeBg:      '#CFFAFE',
    badgeColor:   '#0E7490',
    dotActive:    '#0C7B93',
    buttonGrad:   'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
    buttonShadow: 'rgba(12,123,147,0.35)',
    ring:         '#00BCD4',
    ringGlow:     'rgba(0,188,212,0.25)',
    titleColor:   '#083544',
  },
};

/**
 * @param {object}  props
 * @param {boolean} props.enabled         - gate the tour on/off
 * @param {Array}   [props.steps]         - custom steps [{key,title,body}]
 * @param {string}  [props.storageKey]    - localStorage key for "seen" flag
 * @param {boolean} [props.persistSeen]   - if false, don't persist dismissal;
 *                                          tour reopens every eligible mount
 */
export default function FirstTimeTour({
  enabled,
  steps = DEFAULT_STEPS,
  storageKey,
  persistSeen = true,
  theme = 'default',
}) {
  const STEPS = steps;
  const T = THEMES[theme] || THEMES.default;
  const { open, step, next, prev, goTo, skip, finish, totalSteps } = useFirstTimeTour({
    enabled,
    totalSteps: STEPS.length,
    storageKey,
    persistSeen,
  });

  const [targetRect, setTargetRect] = useState(null);
  const [cardPos, setCardPos] = useState({ top: 0, left: 0, placement: 'below' });
  const cardRef = useRef(null);
  const nextBtnRef = useRef(null);
  const touchStartRef = useRef(null); // for swipe detection
  const loggedShownRef = useRef(false);
  const loggedResultRef = useRef(false);

  //  Analytics: one 'shown' per tour session, one terminal event per result.
  useEffect(() => {
    if (!open) return;
    if (!loggedShownRef.current) {
      logSystemPopupEvent(SYSTEM_POPUP_IDS.firstTimeTour, 'shown');
      loggedShownRef.current = true;
    }
  }, [open]);
  useEffect(() => {
    // Tour transitioned open → closed. If the user reached the last step
    // we count it as 'clicked' (completion); otherwise it's a dismissal.
    if (!open && loggedShownRef.current && !loggedResultRef.current) {
      const completed = step >= totalSteps - 1;
      logSystemPopupEvent(SYSTEM_POPUP_IDS.firstTimeTour, completed ? 'clicked' : 'dismissed');
      loggedResultRef.current = true;
    }
  }, [open, step, totalSteps]);

  //  Scroll lock while the tour is open 
  // Problem the user hit: with nothing blocking touch on the backdrop,
  // a swipe would scroll the page under the spotlight, leaving the ring
  // pointing at empty space. We block both mouse-wheel and touch-move
  // at the document level, which still lets our own `scrollIntoView`
  // run because it happens imperatively (not via a user gesture).
  useEffect(() => {
    if (!open) return;
    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const blockWheel = (e) => e.preventDefault();
    const blockTouch = (e) => {
      // Allow scroll inside the tooltip card itself (long body text on
      // small screens) but block everywhere else.
      if (cardRef.current && cardRef.current.contains(e.target)) return;
      e.preventDefault();
    };
    window.addEventListener('wheel', blockWheel, { passive: false });
    window.addEventListener('touchmove', blockTouch, { passive: false });
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      window.removeEventListener('wheel', blockWheel);
      window.removeEventListener('touchmove', blockTouch);
    };
  }, [open]);

  //  Keyboard navigation: Esc skips, arrows navigate 
  // In RTL Hebrew the reading direction is right→left, so ArrowLeft
  // feels like "forward" and ArrowRight like "back", mirroring the
  // calendar convention we set elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { skip(); return; }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); next(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); if (step > 0) prev(); return; }
      if (e.key === 'Enter')      { e.preventDefault(); next(); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, skip, next, prev, step]);

  //  Auto-focus the primary CTA when a step opens (a11y + quick tap) 
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try { nextBtnRef.current?.focus({ preventScroll: true }); } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [open, step]);

  // Find target + compute position on every step change + on resize.
  // If the target isn't in the DOM yet (e.g. it appears only after the
  // user selects a category first), we poll every 400ms instead of
  // failing. The overlay stays invisible until the target materializes,
  // so the user can keep interacting with the page.
  useLayoutEffect(() => {
    if (!open) return;
    const currentKey = STEPS[step]?.key;
    if (!currentKey) return;

    let pollTimer = null;

    const compute = () => {
      const el = document.querySelector(`[data-tour="${currentKey}"]`);
      if (!el) {
        setTargetRect(null);
        // Keep polling. target may appear after the user interacts with
        // the page (selecting a category, expanding a section, etc.).
        pollTimer = setTimeout(compute, 400);
        return;
      }
      // Always pull the target toward the center of the viewport so the
      // card has room above AND below. Use smooth scroll when the target
      // is only a little off; instant when it's far away to keep the
      // spotlight from chasing the page. scrollIntoView is imperative,
      // so it bypasses the wheel/touch listeners set above.
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const needsScroll = r.top < 80 || r.bottom > vh - 80;
      if (needsScroll) {
        const delta = Math.abs(r.top - vh / 2);
        el.scrollIntoView({
          behavior: delta > vh * 1.5 ? 'instant' : 'smooth',
          block: 'center',
        });
      }
      // Wait for the scroll to settle (2 frames) before measuring, so
      // the spotlight ring doesn't land on a stale rect.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const fresh = el.getBoundingClientRect();
        setTargetRect(fresh);
        positionCard(fresh);
      }));
    };

    const positionCard = (r) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Measure actual card height if mounted; otherwise estimate
      const cardH = cardRef.current?.offsetHeight || 180;
      const cardW = Math.min(CARD_WIDTH, vw - VIEWPORT_PAD * 2);

      // Prefer below target unless there's more room above.
      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const placement = spaceBelow >= cardH + 16 || spaceBelow > spaceAbove ? 'below' : 'above';

      const top = placement === 'below'
        ? Math.min(r.bottom + ARROW_SIZE + 4, vh - cardH - VIEWPORT_PAD)
        : Math.max(r.top - cardH - ARROW_SIZE - 4, VIEWPORT_PAD);

      // Center horizontally on the target, clamped to viewport
      const idealLeft = r.left + r.width / 2 - cardW / 2;
      const left = Math.max(VIEWPORT_PAD, Math.min(idealLeft, vw - cardW - VIEWPORT_PAD));

      setCardPos({ top, left, placement });
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    // Also recompute when the target element itself changes size 
    // e.g. an accordion opening, a dynamic badge appearing, fonts
    // loading late on slow devices. Prevents spotlight drift.
    let ro = null;
    const observeTarget = () => {
      const el = document.querySelector(`[data-tour="${STEPS[step]?.key}"]`);
      if (el && typeof ResizeObserver !== 'undefined') {
        try {
          ro = new ResizeObserver(() => compute());
          ro.observe(el);
        } catch {}
      }
    };
    observeTarget();
    return () => {
      if (pollTimer) clearTimeout(pollTimer);
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
      try { ro?.disconnect(); } catch {}
    };
  }, [open, step]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === totalSteps - 1;

  // Target not in DOM yet (e.g. appears only after the user selects a
  // category on AddVehicle). Render nothing and let the user interact.
  // The poll loop above will re-compute as soon as the target mounts.
  if (!targetRect) return null;

  //  Swipe gesture handlers (RTL: left swipe = next, right swipe = prev) 
  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = Math.abs(end.clientY - start.y);
    const dt = Date.now() - start.at;
    // Thresholds: 60px horizontal min, vertical must stay under 40px
    // (otherwise it's a scroll intent we already blocked), and under
    // 600ms so slow drags don't trigger.
    if (Math.abs(dx) < 60 || dy > 40 || dt > 600) return;
    if (dx < 0) next();                 // swipe left → next
    else if (step > 0) prev();          // swipe right → previous
  };

  return createPortal(
    <div className="fixed inset-0 z-[9000]" dir="rtl" role="dialog" aria-modal="true"
      aria-labelledby="cr-tour-title"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{ animation: 'cr-tour-fade 180ms ease-out' }}>
      <style>{`@keyframes cr-tour-fade { from { opacity: 0 } to { opacity: 1 } }`}</style>
      {/* ARIA live. announces step transitions for screen readers */}
      <div role="status" aria-live="polite" className="sr-only">
        שלב {step + 1} מתוך {totalSteps}. {current.title}
      </div>
      {/* Dimmed backdrop. tapping it dismisses the whole tour. */}
      <div className="absolute inset-0 bg-black/60" onClick={skip} aria-hidden="true" />

      {/* Spotlight ring around target. Positioned absolutely. */}
      <div className="absolute pointer-events-none transition-all duration-200"
        style={{
          top: targetRect.top - 6,
          left: targetRect.left - 6,
          width: targetRect.width + 12,
          height: targetRect.height + 12,
          borderRadius: 16,
          boxShadow: `0 0 0 2px ${T.ring}, 0 0 0 6px ${T.ringGlow}, 0 0 0 9999px rgba(0,0,0,0.0)`,
          background: 'transparent',
        }}
      />

      {/* Arrow pointing at the target */}
      <div className="absolute pointer-events-none"
        style={{
          top: cardPos.placement === 'below'
            ? cardPos.top - ARROW_SIZE
            : cardPos.top + (cardRef.current?.offsetHeight || 180),
          left: Math.min(
            Math.max(targetRect.left + targetRect.width / 2 - ARROW_SIZE, cardPos.left + 16),
            cardPos.left + CARD_WIDTH - ARROW_SIZE - 16
          ),
          width: 0, height: 0,
          borderLeft: `${ARROW_SIZE}px solid transparent`,
          borderRight: `${ARROW_SIZE}px solid transparent`,
          ...(cardPos.placement === 'below'
            ? { borderBottom: `${ARROW_SIZE}px solid #FFFFFF` }
            : { borderTop: `${ARROW_SIZE}px solid #FFFFFF` }),
        }}
      />

      {/* Tooltip card */}
      <div ref={cardRef}
        className="absolute bg-white rounded-2xl p-4 transition-all duration-200"
        style={{
          top: cardPos.top,
          left: cardPos.left,
          width: Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_PAD * 2),
          boxShadow: '0 20px 40px -8px rgba(0,0,0,0.3), 0 8px 16px -4px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* Step badge */}
        <div className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{ background: T.badgeBg, color: T.badgeColor }}>
          {step + 1} מתוך {totalSteps}
        </div>

        <h3 id="cr-tour-title" className="text-[15px] font-bold mt-2" style={{ color: T.titleColor }}>
          {current.title}
        </h3>
        <p className="text-[13px] mt-1.5 leading-relaxed text-gray-600">
          {current.body}
        </p>

        {/* Footer: skip | back + dots (clickable) | next */}
        <div className="flex items-center justify-between mt-4 gap-2">
          <div className="flex items-center gap-1">
            <button onClick={skip}
              className="text-[12px] font-bold text-gray-400 hover:text-gray-600 transition-colors px-2 py-1"
              aria-label="דלג על הטור">
              דלג
            </button>
            {step > 0 && (
              <button onClick={prev}
                className="text-[12px] font-bold text-gray-500 hover:text-gray-800 transition-colors px-2 py-1"
                aria-label="חזור לשלב קודם">
                חזור
              </button>
            )}
          </div>

          {/* Clickable progress dots. tap to jump to step */}
          <div className="flex items-center gap-1.5" role="tablist" aria-label="שלבי הטור">
            {STEPS.map((_, i) => (
              <button key={i}
                onClick={() => goTo(i)}
                role="tab"
                aria-selected={i === step}
                aria-label={`עבור לשלב ${i + 1}`}
                className="rounded-full transition-all cursor-pointer"
                style={{
                  width: i === step ? 18 : 8,
                  height: 8,
                  background: i === step ? T.dotActive : '#D1D5DB',
                  padding: 0,
                  border: 'none',
                }}
              />
            ))}
          </div>

          <button ref={nextBtnRef} onClick={isLast ? finish : next}
            className="text-white font-bold text-[13px] px-4 transition-all active:translate-y-px flex items-center"
            style={{
              height: 38,
              borderRadius: 12,
              background: T.buttonGrad,
              boxShadow: `0 6px 16px -4px ${T.buttonShadow}`,
            }}>
            {isLast ? 'סיום' : 'הבא'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
