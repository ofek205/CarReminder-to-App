import { useCallback, useEffect, useState } from 'react';
import { getCurrentPosition } from '@/lib/capacitor';

const TEL_AVIV = { lat: 32.0853, lng: 34.7818 };

// Detect a permission denial from either the browser GeolocationPositionError
// (code === 1) or the Capacitor native plugin (Error whose message contains
// "denied" / "not authorized").
function isPermissionDenied(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return err?.code === 1 || msg.includes('denied') || msg.includes('not authorized');
}

/**
 * Single source of truth for user GPS state across map screens.
 *
 *   const { location, loading, denied, error, retry, setLocation } =
 *     useUserLocation();
 *
 * - `location`        : { lat, lng } — defaults to Tel Aviv on denial / failure.
 * - `loading`         : true until the first position attempt resolves.
 * - `denied`          : true if the OS / browser refused permission.
 * - `error`           : transient string for retry failures (auto-clears 4s).
 * - `retry()`         : re-request GPS; resolves with the new {lat,lng} or null.
 * - `setLocation()`   : manual override (city chip, search result, etc.).
 *
 * Caller decides what to do with the data — this hook does NOT touch the map
 * directly. After a successful retry the caller can imperatively recenter
 * the map via its own ref.
 */
export function useUserLocation({ fallback = TEL_AVIV } = {}) {
  const [location, setLocationState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pos = await getCurrentPosition();
        if (cancelled) return;
        setLocationState({ lat: pos.latitude, lng: pos.longitude });
        setDenied(false);
      } catch (err) {
        if (cancelled) return;
        setDenied(isPermissionDenied(err));
        setLocationState(fallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // fallback is captured once on mount; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = useCallback(async () => {
    setError(null);
    try {
      const pos = await getCurrentPosition();
      const next = { lat: pos.latitude, lng: pos.longitude };
      setLocationState(next);
      setDenied(false);
      return next;
    } catch (err) {
      const isDenied = isPermissionDenied(err);
      setDenied(isDenied);
      setError(
        isDenied
          ? 'הרשאת מיקום נדחתה. אפשר לאפשר בהגדרות האפליקציה.'
          : 'לא הצלחנו לזהות מיקום'
      );
      setTimeout(() => setError(null), 4000);
      return null;
    }
  }, []);

  // Manual override — used by city chips / city search.
  const setLocation = useCallback((loc) => {
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
    setLocationState(loc);
    setDenied(false);
  }, []);

  return { location, loading, denied, error, retry, setLocation };
}

export { TEL_AVIV };
