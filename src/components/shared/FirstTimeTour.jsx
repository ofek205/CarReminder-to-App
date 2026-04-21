import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useFirstTimeTour from '@/hooks/useFirstTimeTour';

/**
 * FirstTimeTour — 4-step contextual tooltip tour for first-time users.
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
    title: 'הוסף את הרכב הראשון',
    body: 'כאן תוסיף רכב חדש. אפשר לסרוק רישיון, לצלם אותו, או לקבל את הפרטים אוטומטית ממשרד התחבורה עם מספר הרישוי.',
  },
  {
    key: 'notif-bell',
    title: 'התראות חכמות',
    body: 'תזכורות לטסט, ביטוח, טיפולים וצמיגים יופיעו כאן, מתוזמנות לזמן הנכון.',
  },
  {
    key: 'ai-tab',
    title: 'מומחה AI 24/7',
    body: 'ברוך המוסכניק ויוסי טכנאי כלי שייט עונים לכל שאלה על הרכב שלך.',
  },
  {
    key: 'menu',
    title: 'תפריט מלא',
    body: 'ההגדרות, שיתוף חשבון, מוסכים ועוד. תמיד נגיש מהכפתור הזה.',
  },
];

const VIEWPORT_PAD = 12;
const CARD_WIDTH = 300;
const ARROW_SIZE = 10;

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
}) {
  const STEPS = steps;
  const { open, step, next, skip, finish, totalSteps } = useFirstTimeTour({
    enabled,
    totalSteps: STEPS.length,
    storageKey,
    persistSeen,
  });

  const [targetRect, setTargetRect] = useState(null);
  const [cardPos, setCardPos] = useState({ top: 0, left: 0, placement: 'below' });
  const cardRef = useRef(null);

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
        // Keep polling — target may appear after the user interacts with
        // the page (selecting a category, expanding a section, etc.).
        pollTimer = setTimeout(compute, 400);
        return;
      }
      // If target is offscreen, snap it into view instantly — smooth scroll
      // races with our measurement and leaves the spotlight ring at an
      // intermediate position.
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.top < 80 || r.bottom > vh - 80) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
      // Measure after the (possibly just-completed) scroll.
      requestAnimationFrame(() => {
        const fresh = el.getBoundingClientRect();
        setTargetRect(fresh);
        positionCard(fresh);
      });
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
    return () => {
      if (pollTimer) clearTimeout(pollTimer);
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
    };
  }, [open, step]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === totalSteps - 1;

  // Target not in DOM yet (e.g. appears only after the user selects a
  // category on AddVehicle). Render nothing and let the user interact.
  // The poll loop above will re-compute as soon as the target mounts.
  if (!targetRect) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9000]" dir="rtl" role="dialog" aria-modal="true">
      {/* Dimmed backdrop — tapping it dismisses the whole tour. */}
      <div className="absolute inset-0 bg-black/60" onClick={skip} aria-hidden="true" />

      {/* Spotlight ring around target. Positioned absolutely. */}
      <div className="absolute pointer-events-none transition-all duration-200"
        style={{
          top: targetRect.top - 6,
          left: targetRect.left - 6,
          width: targetRect.width + 12,
          height: targetRect.height + 12,
          borderRadius: 16,
          boxShadow: '0 0 0 2px #FFBF00, 0 0 0 6px rgba(255,191,0,0.25), 0 0 0 9999px rgba(0,0,0,0.0)',
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
          style={{ background: '#E8F2EA', color: '#2D5233' }}>
          {step + 1} מתוך {totalSteps}
        </div>

        <h3 className="text-[15px] font-black mt-2" style={{ color: '#1C3620' }}>
          {current.title}
        </h3>
        <p className="text-[13px] mt-1.5 leading-relaxed text-gray-600">
          {current.body}
        </p>

        {/* Footer: skip + dots + next */}
        <div className="flex items-center justify-between mt-4 gap-2">
          <button onClick={skip}
            className="text-[12px] font-bold text-gray-400 hover:text-gray-600 transition-colors px-2 py-1">
            דלג
          </button>

          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? 18 : 6,
                  height: 6,
                  background: i === step ? '#2D5233' : '#D1D5DB',
                }}
              />
            ))}
          </div>

          <button onClick={isLast ? finish : next}
            className="text-white font-extrabold text-[13px] px-4 transition-all active:translate-y-px flex items-center"
            style={{
              height: 38,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
              boxShadow: '0 6px 16px -4px rgba(45,82,51,0.35)',
            }}>
            {isLast ? 'סיום' : 'הבא'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
