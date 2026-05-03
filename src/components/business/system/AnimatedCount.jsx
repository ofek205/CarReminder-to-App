/**
 * AnimatedCount — counts a number from 0 → target with ease-out-expo
 * easing on mount. Drop-in replacement for any inline number that
 * deserves "this just loaded" energy on the dashboard.
 *
 * Usage:
 *   <AnimatedCount value={9} />                            // 0 → 9 over 1100ms
 *   <AnimatedCount value={3491} format={fmtMoney} />        // currency
 *   <AnimatedCount value={42} duration={800} />             // faster
 *
 * Implementation note: uses requestAnimationFrame, NOT setInterval, so
 * the timing is frame-aligned and pauses correctly when the tab is
 * backgrounded. fromRef captures the previous value so a target change
 * mid-animation tweens from current to new (no jitter).
 */
import React, { useEffect, useRef, useState } from 'react';

const defaultFormat = (n) => new Intl.NumberFormat('he-IL').format(n || 0);

export function useAnimatedNumber(target, duration = 1100) {
  const [value, setValue] = useState(0);
  const startRef = useRef(null);
  const fromRef  = useRef(0);
  const rafRef   = useRef(null);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;

    const tick = (ts) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // ease-out-expo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const next = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}

export default function AnimatedCount({ value, format = defaultFormat, duration = 1100 }) {
  const animated = useAnimatedNumber(Number(value) || 0, duration);
  return <>{format(animated)}</>;
}
