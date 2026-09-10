/**
 * The marketing side of the read-only preview.
 *
 * Four states, and the important one is `failed`: if the frame does not come
 * up, this falls back to the static screenshot that shipped before the
 * preview existed and says nothing about it. The visitor did not do anything
 * wrong and does not need an apology, and a marketing page must never look
 * broken because an app deploy went sideways.
 *
 * It starts itself, with no tap: the preview should simply be running by the
 * time you reach the section. The frame is still kept out of the DOM until
 * the section is close, so the app bundle stays off the page's critical path.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import MarketingPhone from '@/components/MarketingPhone';
import { marketingEvent } from '@/lib/marketingEvents';
import { sendGoto } from '@/lib/demoBridge';

const DEMO_URL = '/demo';

/**
 * Did the frame actually render our page, or did the browser refuse it?
 *
 * `onLoad` is NOT proof of success. A frame blocked by X-Frame-Options or by
 * frame-ancestors still fires load, for an opaque error page. Measured on
 * the staging deployment: load fired while contentDocument was unreachable
 * and reading contentWindow.innerWidth threw a cross-origin error, on a URL
 * from our own origin.
 *
 * That is the likeliest real failure here: the /demo header rule missing or
 * mistyped in production, or `vite preview` locally, which does not apply
 * vercel.json at all. Trusting onLoad would leave a blank white rectangle
 * in the marketing page instead of the static screenshot the spec requires.
 *
 * Same-origin, so contentDocument is reachable whenever the frame really
 * loaded; a throw or a null document means it did not.
 */
function didFrameRender(iframe) {
  try {
    return !!iframe?.contentDocument?.body;
  } catch {
    return false;
  }
}
/**
 * There is no boot timeout, and that is deliberate.
 *
 * The frame is only mounted once the section is close, so there is no window
 * in which a deadline could mark a healthy preview as failed for not having
 * been scrolled to yet. A timeout is also unnecessary: the
 * static screenshot covers the frame for the whole of `loading`, so a boot
 * that never finishes simply leaves the section looking exactly like the
 * fallback it would have fallen back to.
 */

export default function MarketingDemoEmbed({ src, alt, screenName, onEnlarge, gotoScreen, onStatusChange }) {
  const [state, setState] = useState('resting');
  const [dismissed, setDismissed] = useState(false);
  const hostRef = useRef(null);
  const frameRef = useRef(null);

  // The parent owns which screen is showing; this component owns whether the
  // frame can show one at all. It needs the full status and not just a
  // boolean: `loading` is the state where a click has to be remembered and
  // shown as pending, while `failed` and `dismissed` are the states where the
  // selector must go back to swapping screenshots instead of waiting forever.
  useEffect(() => {
    onStatusChange?.(dismissed ? 'dismissed' : state);
  }, [state, dismissed, onStatusChange]);

  // A screen requested before the frame was ready is applied the moment it
  // goes live, which is the "pending" state the selector shows meanwhile.
  useEffect(() => {
    if (state !== 'live' || !gotoScreen) return;
    sendGoto(frameRef.current?.contentWindow, gotoScreen);
  }, [state, gotoScreen]);

  const start = useCallback(() => {
    // Offline: the frame cannot boot, so do not try. The static screenshot is
    // already what is on screen, and it stays.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    setState(current => (current === 'resting' ? 'loading' : current));
    marketingEvent('demo_open', 'home');
  }, []);

  // `dismissed` is sticky on purpose. Closing the preview must not hand it
  // back on the next scroll past the section, which is what auto-start plus
  // a resettable flag would do.
  const stop = useCallback(() => {
    setDismissed(true);
    setState('resting');
  }, []);

  /**
   * Mounts the frame once the section is close to the viewport. No tap.
   *
   * A plain scroll listener, and it earned the place. `loading="lazy"` was
   * tried first and does not defer here at all: measured on the production
   * build, the frame was fetched 46ms after load while the section was still
   * 2115px away, because Chrome's lazy distance threshold is very generous on
   * a fast connection. An IntersectionObserver was tried before that and
   * never called back from inside this component, while an identical observer
   * created by hand on the very same element reported ratio 0.99.
   *
   * So this is the version whose behaviour is actually verifiable: rect maths
   * on scroll, rAF-throttled, detaching itself the moment it fires. It reads
   * as the least clever of the three and it is the only one that works.
   *
   * Why defer at all when the product decision is "just have it running":
   * the frame pulls the whole app bundle, ~690KB for the main chunk alone
   * plus the vendor chunks. Paying that on load would spend the marketing
   * page's LCP budget on a section far below the fold, for every visitor,
   * including everyone who never scrolls to it.
   */
  useEffect(() => {
    if (dismissed || state !== 'resting') return undefined;
    let raf = 0;
    let fired = false;

    const check = () => {
      raf = 0;
      if (fired) return;
      const el = hostRef.current;
      if (!el) return;
      // One extra viewport of lead time, so the boot overlaps the tail of the
      // scroll rather than starting once the section has already arrived.
      if (el.getBoundingClientRect().top > window.innerHeight * 2) return;
      fired = true;
      start();
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };

    // The FIRST check waits for `load`, and that wait is the whole fix. Run
    // during hydration it measured the section 2115px down as being in range
    // and started the frame at the top of the page, because the images and
    // fonts above had not laid out yet, so the document was still short and
    // everything below sat far higher than its final position.
    let onLoadCheck = null;
    if (document.readyState === 'complete') {
      onScroll();
    } else {
      onLoadCheck = () => onScroll();
      window.addEventListener('load', onLoadCheck, { once: true });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (onLoadCheck) window.removeEventListener('load', onLoadCheck);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [start, dismissed, state]);

  const frame = (
    <>
      {/* .cm-demo-live carries the ratio and the container-type; .cm-demo-stage
          is a FIXED 402x900 that scales to fit it. Separating them is the whole
          fix: the app inside always gets a real 390x844 phone viewport, instead
          of whatever width happened to be free, which on a phone was 260px. */}
      <div className="cm-demo-live">
        <div className="cm-demo-stage">
          <div className="cm-demo-bar">
        {/* Close sits OUTSIDE the iframe. Inside it, a visitor who wandered
            deep into the app would have no way out, and keyboard users would
            have no way back past the frame's focus trap. */}
        <button type="button" onClick={stop} aria-label="סגירת ההדגמה"><X size={18} /></button>
        <span>תצוגת הדגמה</span>
      </div>
      <div className="cm-demo-viewport">
        {/* The static screenshot stays on top until the frame is genuinely
            live, so the section never shows a bare skeleton to someone
            scrolling past, and never shows a blank frame if the boot fails. */}
        {state !== 'live' && (
          <div className="cm-demo-cover" aria-hidden="true">
            <img src={src} alt="" width="645" height="1398" />
          </div>
        )}
        {state === 'loading' && (
          <div className="cm-demo-skeleton" role="status" aria-live="polite">
            {/* Shaped like the app's home screen, not a spinner: the project
                has a history of spinners that never resolved, and a skeleton
                that matches what arrives makes the swap unnoticeable. */}
            <span className="cm-sk cm-sk-bar" />
            <span className="cm-sk cm-sk-card" />
            <span className="cm-sk cm-sk-row" />
            <span className="cm-sk cm-sk-row" />
            <span className="cm-demo-loading-text">טוענים את ההדגמה…</span>
          </div>
        )}
        <iframe
          ref={frameRef}
          src={DEMO_URL}
          title="הדגמה אינטראקטיבית של האפליקציה"
          onLoad={event => { setState(didFrameRender(event.currentTarget) ? 'live' : 'failed'); }}
          onError={() => setState('failed')}
          sandbox="allow-scripts allow-same-origin allow-top-navigation-by-user-activation"
          /* eager, deliberately: by the time this element exists the scroll
             listener above has already decided the section is close, so the
             browser must not add a second, unpredictable delay on top. */
          loading="eager"
        />
          </div>
        </div>
      </div>
      {/* Outside the device box on purpose. Inside, it would be inside the
          scaled stage and would shrink with it, and it is a caption about the
          demo rather than part of the phone. */}
      <small>הנתונים להמחשה בלבד</small>
    </>
  );

  // 'failed' deliberately renders the resting view: silent fallback to the
  // screenshot that shipped before the preview existed.
  const showFrame = !dismissed && state !== 'failed';

  return (
    <div ref={hostRef} className="cm-product-screen cm-unified-screen cm-demo-host">
      {showFrame ? frame : (
        <>
          <div className="cm-demo-resting">
            <button type="button" onClick={onEnlarge} aria-label={`הגדלת מסך ${screenName}`}>
              <MarketingPhone src={src} alt={alt} />
            </button>
          </div>
          <small>{dismissed ? 'מסך מהאפליקציה · לחצו להגדלה' : 'ההדגמה נטענת כשמגיעים לכאן · אפשר לגעת ולנווט'}</small>
        </>
      )}
    </div>
  );
}
