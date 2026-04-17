import { useEffect, useState, useRef } from 'react';

/**
 * Pull-to-refresh on mobile. Call onRefresh when user pulls down from top.
 * Returns { pulling, progress } for visual indicator.
 */
export default function usePullToRefresh(onRefresh, { threshold = 80, enabled = true } = {}) {
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState(0);
  const startY = useRef(0);
  const currentY = useRef(0);
  const refreshing = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e) => {
      if (refreshing.current) return;
      if (window.scrollY > 5) return; // only from top
      startY.current = e.touches[0].clientY;
      currentY.current = startY.current;
    };

    const handleTouchMove = (e) => {
      if (refreshing.current || startY.current === 0) return;
      currentY.current = e.touches[0].clientY;
      const delta = currentY.current - startY.current;
      if (delta > 0 && window.scrollY <= 5) {
        setPulling(true);
        setProgress(Math.min(delta / threshold, 1));
      }
    };

    const handleTouchEnd = async () => {
      if (refreshing.current) return;
      const delta = currentY.current - startY.current;
      if (delta >= threshold && onRefresh) {
        refreshing.current = true;
        setProgress(1);
        try { await onRefresh(); } catch {}
        refreshing.current = false;
      }
      setPulling(false);
      setProgress(0);
      startY.current = 0;
      currentY.current = 0;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onRefresh, threshold, enabled]);

  return { pulling, progress };
}
