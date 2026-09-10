import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const slides = ['land-cruiser', 'ktm', 'r1', 'harley', 'pickup', 'jet-ski', 'loader', 'roller'];

export default function MarketingHeroBackground() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const layer = useRef(null);
  const loaded = useRef(new Set());

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setReduced(media.matches);
    const syncVisibility = () => setVisible(!document.hidden);
    syncMotion();
    syncVisibility();
    media.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(layer.current);
    return () => {
      media.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (paused || reduced || !visible || !inView) return;
    const timer = setInterval(() => {
      setActive(current => {
        // Keep the current image until another has finished loading.
        for (let offset = 1; offset < slides.length; offset++) {
          const next = (current + offset) % slides.length;
          if (loaded.current.has(next)) return next;
        }
        return current;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [paused, reduced, visible, inView]);

  return <>
    <div ref={layer} className="cm-hero-background" aria-hidden="true">
      {slides.map((slide, index) => (
        // LOWERCASE fetchpriority IS DELIBERATE, AND THE LINTER DISAGREES.
        // React 19 accepts camelCase `fetchPriority`, and eslint-plugin-react
        // has been updated to expect that spelling, but this project is on
        // React 18.3.1, which does not recognise it and logs a console error
        // on every single render. Both spellings do reach the DOM (checked
        // with renderToStaticMarkup on 18.3.1, and HTML attribute names are
        // case-insensitive anyway), so the only thing camelCase buys here is
        // noise in the console, on the one surface where a clean console is
        // itself a test: scripts/qa-marketing.mjs collects console errors.
        // Revert this to `fetchPriority` and delete the disable when the app
        // moves to React 19.
        // eslint-disable-next-line react/no-unknown-property
        <img key={slide} src={`/marketing/hero-${slide}.webp`} alt="" width="1672" height="941" decoding="async" fetchpriority={index === 0 ? 'high' : 'low'} className={index === active ? 'is-active' : ''} onLoad={() => loaded.current.add(index)} />
      ))}
    </div>
    {!reduced && <button type="button" className="cm-hero-motion" onClick={() => setPaused(value => !value)} aria-label={paused ? 'הפעלת החלפת תמונות הרקע' : 'עצירת החלפת תמונות הרקע'}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}
  </>;
}
