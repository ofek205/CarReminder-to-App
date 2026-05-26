import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useFirstTimeTour from '@/hooks/useFirstTimeTour';
import { SYSTEM_POPUP_IDS, logSystemPopupEvent } from '@/lib/popups/systemPopups';
import { C } from '@/lib/designTokens';

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

// 2026-05-17 copywriter pass: tone shifted from "marketing-y onboarding"
// to "quiet personal advisor". Each step now a single short sentence that
// promises an outcome rather than naming a feature. No em-dashes anywhere
// (project-wide convention to keep Hebrew text rendering clean).
const DEFAULT_STEPS = [
  {
    key: 'add-vehicle',
    title: 'מוסיפים רכב כאן',
    body: 'מקלידים מספר רישוי, אנחנו מביאים את שאר הפרטים.',
  },
  {
    key: 'notif-bell',
    title: 'תזכורות בזמן',
    body: 'טסט, ביטוח, טיפולים. נזכיר לפני התאריך, לא אחריו.',
  },
  {
    key: 'ai-tab',
    title: 'יש לך שאלה על הרכב',
    body: 'ברוך ויוסי, מומחים שכל הזמן זמינים. שואלים בעברית, מקבלים תשובה ברורה.',
  },
  {
    key: 'menu',
    title: 'כל מה שצריך, בתפריט',
    body: 'הגדרות, שיתוף משפחה, רשימת מוסכים והעדפות אישיות.',
  },
];

const VIEWPORT_PAD = 12;
const CARD_WIDTH = 300;
const ARROW_SIZE = 12;

// Color palettes. 'default' is the land-vehicle green theme that the
// dashboard tour uses; 'vessel' swaps to the marine teal/cyan used
// across vessel-detail pages for visual consistency.
//
// 2026-05-17 designer pass: ring colour switched from orange (#F97316,
// originally chosen to pop against the dark backdrop) back to the
// app's primary green. The dark backdrop is gone, so we no longer
// need a warning-style accent to fight it. The new green ring + soft
// green halo reads as "here, quietly" instead of "warning, look".
// `accent` is the soft green used for the card side-bar and the
// connector arrow so they tie back to the same family.
const THEMES = {
  default: {
    badgeBg:      C.light,
    badgeColor:   C.primary,
    dotActive:    C.primary,
    buttonGrad:   `linear-gradient(135deg, ${C.primary} 0%, #4A8C5C 100%)`,
    buttonShadow: 'rgba(45,82,51,0.35)',
    ring:         C.primary,
    haloOuter:    'rgba(74, 140, 92, 0.08)',
    haloPulse:    'rgba(74, 140, 92, 0.15)',
    accent:       '#4A8C5C',
    titleColor:   '#1C3620',
  },
  vessel: {
    badgeBg:      '#CFFAFE',
    badgeColor:   '#0E7490',
    dotActive:    '#0C7B93',
    buttonGrad:   'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
    buttonShadow: 'rgba(12,123,147,0.35)',
    ring:         '#0C7B93',
    haloOuter:    'rgba(0, 188, 212, 0.08)',
    haloPulse:    'rgba(0, 188, 212, 0.15)',
    accent:       '#0C7B93',
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

  //  Click-anywhere-outside-card → mark tour as completed (not skipped).
  //
  // 2026-05-17 product decision: the tour is no longer modal. Users can
  // freely scroll the page and click any element they want while the
  // tour is open; the moment they show interest in something other than
  // the tour controls themselves, the tour gracefully steps aside and
  // marks itself complete. Previously the tour added wheel + touchmove
  // preventDefault handlers at the window level (and an absolute-inset
  // click-trap div that called skip()), which together produced a hard
  // modal lock. The new feel: a coachmark, not a gate.
  //
  // Implementation: capture-phase click listener on document. If the
  // click target is inside the tour card itself (back/next/skip/dots)
  // we ignore — those are tour controls. Otherwise we call `finish()`,
  // which marks the tour as seen via the same code path "completed"
  // takes. We DON'T preventDefault and DON'T stopPropagation, so the
  // click continues to its real handler — pressing the highlighted
  // "Add vehicle" button actually opens the Add Vehicle flow, exactly
  // as the user expects.
  useEffect(() => {
    if (!open) return;
    const onAnyClick = (e) => {
      if (cardRef.current && cardRef.current.contains(e.target)) return;
      // scrollToTop: false because the user just initiated an action on
      // some other element (a button, a link, an icon). Yanking the page
      // back to the top would interrupt that intent. The "סיימתי" button
      // on the last step still calls finish() with default opts, so the
      // normal complete-and-return-to-top behaviour is preserved there.
      finish({ scrollToTop: false });
    };
    document.addEventListener('click', onAnyClick, true);
    return () => document.removeEventListener('click', onAnyClick, true);
  }, [open, finish]);

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
  //
  // 2026-05-17 follow-up: also reject zero-sized targets. The
  // BottomNav uses `lg:hidden` (and returns null while roleLoading),
  // so its data-tour="ai-tab" element exists in the DOM but renders
  // with width/height 0 in those states. Without this check the
  // halo + bubble would anchor to (0,0) and the user would see a
  // green dot in the top-left corner pointing at nothing. If the
  // target stays unreachable for ~2s we auto-advance past the step
  // instead of trapping the user on a phantom highlight.
  useLayoutEffect(() => {
    if (!open) return;
    const currentKey = STEPS[step]?.key;
    if (!currentKey) return;

    let pollTimer = null;
    let autoAdvanceTimer = null;

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

    const compute = () => {
      const el = document.querySelector(`[data-tour="${currentKey}"]`);
      const elRect = el ? el.getBoundingClientRect() : null;
      const isVisible = elRect && elRect.width > 0 && elRect.height > 0;

      if (!isVisible) {
        setTargetRect(null);
        // Keep polling. target may appear after the user interacts with
        // the page (selecting a category, expanding a section, etc.)
        // or after a deferred render flushes (role check finishing,
        // viewport rotation, etc.).
        pollTimer = setTimeout(compute, 400);
        // Safety net: if the target never materialises for this step
        // (e.g. it's a layout-conditional element that doesn't exist
        // on the current viewport breakpoint), auto-advance instead
        // of leaving the user stuck on an invisible step.
        if (!autoAdvanceTimer) {
          autoAdvanceTimer = setTimeout(() => {
            if (step + 1 < totalSteps) next();
            else finish({ scrollToTop: false });
          }, 2000);
        }
        return;
      }
      // Target became visible — cancel any pending auto-advance.
      if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
      }
      // Always pull the target toward the center of the viewport so the
      // card has room above AND below. Use smooth scroll when the target
      // is only a little off; instant when it's far away to keep the
      // spotlight from chasing the page. scrollIntoView is imperative,
      // so it bypasses any user-gesture listeners.
      const r = elRect;
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
        // Defensive: if the target became hidden between scheduling
        // the frame and now (e.g. a re-render unmounted it), bail.
        if (!fresh.width || !fresh.height) {
          setTargetRect(null);
          return;
        }
        setTargetRect(fresh);
        positionCard(fresh);
      }));
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
      if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
      try { ro?.disconnect(); } catch {}
    };
  }, [open, step, totalSteps, next, finish]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === totalSteps - 1;

  // Target not in DOM yet (e.g. appears only after the user selects a
  // category on AddVehicle). Render nothing and let the user interact.
  // The poll loop above will re-compute as soon as the target mounts.
  //
  // 2026-05-17 render-time belt-and-suspenders: even if some upstream
  // path managed to set targetRect to a zero-sized rect (stale cache
  // serving older compute() logic, an asynchronous race between
  // setTargetRect and the next render, etc.), render nothing. This
  // is the second line of defence on top of the compute() guard so a
  // user never sees a green halo dot anchored to (0,0).
  if (!targetRect || !targetRect.width || !targetRect.height) return null;

  // Swipe-to-navigate gesture handlers were removed in the 2026-05-17
  // coachmark redesign. The wrapper is now pointer-events: none so
  // touch events never reach it anyway, and forcing horizontal swipe
  // to mean "next step" conflicted with the user's freedom to scroll
  // and pan the page beneath. Step navigation is now keyboard arrows
  // and the explicit "הבא" / "חזור" buttons in the card.

  return createPortal(
    // 2026-05-17 coachmark redesign:
    //   - role="region" with aria-label (sets a named landmark for AT)
    //   - no aria-modal (it's not a dialog, doesn't block interaction)
    //   - pointer-events: none so clicks/scroll pass through to the
    //     real page; the card re-enables pointer-events for its own
    //     buttons
    //   - entry animation runs 240ms on the same ease-out-quint curve
    //     the rest of the design system uses, paired with a card-level
    //     scale-in so the bubble has presence rather than ghosting in
    <div className="fixed inset-0 z-[9000]" dir="rtl" role="region"
      aria-label={`סיור היכרות, צעד ${step + 1} מתוך ${totalSteps}`}
      style={{ animation: 'cr-tour-fade 240ms cubic-bezier(0.16, 1, 0.3, 1)', pointerEvents: 'none' }}>
      <style>{`
        @keyframes cr-tour-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cr-tour-card-in {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes cr-tour-halo-pulse {
          0%, 100% { box-shadow: 0 0 0 1px ${T.ring}, 0 0 0 18px ${T.haloOuter}; }
          50%      { box-shadow: 0 0 0 1px ${T.ring}, 0 0 0 22px ${T.haloPulse}; }
        }
        .cr-tour-halo { animation: cr-tour-halo-pulse 1700ms ease-in-out infinite; }
        html.a11y-no-animations .cr-tour-halo { animation: none; }
        html.a11y-no-animations .cr-tour-card { animation: none !important; }
      `}</style>
      {/* ARIA live. announces step transitions for screen readers */}
      <div role="status" aria-live="polite" className="sr-only">
        צעד {step + 1} מתוך {totalSteps}. {current.title}
      </div>

      {/* Halo around target.
          2026-05-17 redesign: the previous version used a triple
          box-shadow with a 9999px outer shadow at black/68 to dim the
          rest of the screen. That created a modal feel ("everything
          else is unavailable") which conflicted with the new
          non-blocking behaviour. The new halo is a 1px green ring +
          an 18px wide soft green glow that pulses gently. It catches
          the eye without darkening the surrounding context, so the
          user understands they can still click anywhere else.
          The pulse animation lives in the <style> block above and
          targets the .cr-tour-halo class so a11y can disable it. */}
      <div className="absolute pointer-events-none cr-tour-halo transition-all duration-200"
        style={{
          top: targetRect.top - 4,
          left: targetRect.left - 4,
          width: targetRect.width + 8,
          height: targetRect.height + 8,
          borderRadius: 16,
          boxShadow: `0 0 0 1px ${T.ring}, 0 0 0 18px ${T.haloOuter}`,
          background: 'transparent',
        }}
      />

      {/* Arrow pointing at the target.
          2026-05-17: colour switched from white to the theme accent
          green. The previous white tip merged into the white card
          and effectively vanished. A soft green tip reads as a
          connector between the highlighted target and the bubble
          without competing with either for attention. */}
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
            ? { borderBottom: `${ARROW_SIZE}px solid ${T.accent}` }
            : { borderTop: `${ARROW_SIZE}px solid ${T.accent}` }),
        }}
      />

      {/* Tooltip card.
          pointerEvents: 'auto' re-enables interaction inside the card
          since the outer wrapper opts out via pointer-events: none.
          Without this the back / next / skip buttons would be
          unclickable. stopPropagation prevents the document-level
          "click-anywhere-completes" listener above from firing when
          the user interacts with tour controls.
          2026-05-17 visual refresh:
            - radius 20px (was 16px) for a softer, less pop-up feel
            - padding 20px (was 16px) for breathing room
            - single soft green shadow (was double black shadow) so
              the card sits on the page rather than punching out of it
            - 3px accent-colour bar on the inline-end edge as the
              card's only signature mark, ties it to the green halo
            - card-level scale-in animation so the bubble feels
              composed when it lands. */}
      <div ref={cardRef}
        className="absolute bg-white cr-tour-card transition-all duration-200"
        style={{
          top: cardPos.top,
          left: cardPos.left,
          width: Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_PAD * 2),
          borderRadius: 20,
          padding: 20,
          boxShadow: '0 12px 32px -8px rgba(45,82,51,0.18), 0 4px 12px -4px rgba(45,82,51,0.10)',
          borderInlineEnd: `3px solid ${T.accent}`,
          pointerEvents: 'auto',
          animation: 'cr-tour-card-in 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}>

        {/* Step badge.
            2026-05-17 copywriter: copy changed from "X מתוך 4" to
            "צעד X מתוך 4" so the counter reads as natural Hebrew
            instead of bare math. Slightly larger text + tabular
            numerals via system-ui font for clean alignment. */}
        <div className="inline-block text-xs font-bold rounded-full"
          style={{
            background: T.badgeBg,
            color: T.badgeColor,
            padding: '4px 10px',
            fontFeatureSettings: '"tnum"',
          }}>
          צעד {step + 1} מתוך {totalSteps}
        </div>

        <h3 id="cr-tour-title" className="font-bold mt-2"
          style={{ color: T.titleColor, fontSize: 17, lineHeight: 1.3 }}>
          {current.title}
        </h3>
        <p className="mt-2 leading-relaxed text-gray-700"
          style={{ fontSize: 14 }}>
          {current.body}
        </p>

        {/* Footer: skip | back + dots (clickable) | next.
            2026-05-17 visual refresh:
              - primary button height 48px (was 38px), pill radius,
                meets 44px touch-target minimum
              - back button matched to 48px height, text-only on white
              - skip stays small + tertiary, not competing for attention
              - dots scale 8→10 inactive, 18→20 active for legibility */}
        <div className="flex items-center justify-between mt-5 gap-2">
          <div className="flex items-center gap-1">
            <button onClick={skip}
              className="font-semibold transition-colors"
              style={{ padding: '8px 12px', color: C.gray400, fontSize: 12 }}
              aria-label="דלג על הסיור">
              דלג
            </button>
            {step > 0 && (
              <button onClick={prev}
                className="font-semibold transition-colors flex items-center justify-center"
                style={{ height: 48, padding: '0 14px', color: T.titleColor, fontSize: 14 }}
                aria-label="חזור לשלב קודם">
                חזור
              </button>
            )}
          </div>

          {/* Clickable progress dots. tap to jump to step */}
          <div className="flex items-center gap-1.5" role="tablist" aria-label="שלבי הסיור">
            {STEPS.map((_, i) => (
              <button key={i}
                onClick={() => goTo(i)}
                role="tab"
                aria-selected={i === step}
                aria-label={`עבור לצעד ${i + 1}`}
                className="rounded-full transition-all cursor-pointer"
                style={{
                  width: i === step ? 20 : 10,
                  height: 10,
                  background: i === step ? T.dotActive : C.gray300,
                  padding: 0,
                  border: 'none',
                }}
              />
            ))}
          </div>

          <button ref={nextBtnRef} onClick={isLast ? () => finish() : next}
            className="text-white font-bold transition-all active:translate-y-px flex items-center justify-center"
            style={{
              height: 48,
              minWidth: 80,
              padding: '0 22px',
              fontSize: 14,
              borderRadius: 999,
              background: T.buttonGrad,
              boxShadow: `0 6px 16px -6px ${T.buttonShadow}`,
            }}>
            {isLast ? 'סיימתי' : 'הבא'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
