/**
 * useTickEverySecond — forces a re-render every N ms.
 *
 * Used to keep relative timestamps fresh ("לפני דקה" → "לפני 2 דק׳")
 * without a manual refresh. Default 30s = once per minute floor edge,
 * which is the granularity of the "lפני N דק׳" string anyway.
 *
 * Cheap: each tick is a single setState. The parent component does the
 * actual relative-time formatting on each render via fmtTimeShort.
 */
import { useEffect, useState } from 'react';

export default function useTickEverySecond(intervalMs = 30000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
