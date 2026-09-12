/**
 * Reactive online/offline state.
 *
 * Reads React Query's `onlineManager` rather than `navigator.onLine` directly,
 * for one important reason: onlineManager is the SAME signal React Query itself
 * uses to decide whether to pause a query. Driving the UI from it guarantees
 * the banner and the data layer can never disagree ("you're online" while every
 * query sits paused, or the reverse).
 *
 * It also gives us one place to improve. On native, `navigator.onLine` and the
 * browser online/offline events are unreliable inside WKWebView and the Android
 * WebView, so Phase 2 feeds the OS-level signal in via
 * `onlineManager.setOnline(...)` from @capacitor/network. Everything reading
 * this hook then gets the better signal for free.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

const subscribe = (cb) => onlineManager.subscribe(cb);
const getSnapshot = () => onlineManager.isOnline();
// Server/prerender: assume online so nothing renders an offline state during SSR.
const getServerSnapshot = () => true;

/** Raw, un-debounced connectivity. Use this for logic, not for UI. */
export default function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** How long connectivity must stay down before the UI reacts. */
const OFFLINE_SETTLE_MS = 600;

/**
 * Connectivity for anything that VISIBLY changes the page.
 *
 * Debounced asymmetrically on purpose:
 *   - going offline waits ~600ms, so a brief blip (a tunnel, a cell-to-wifi
 *     handoff) doesn't flash a banner and shove the whole page down and back.
 *   - coming back online applies IMMEDIATELY. Good news is always safe to show
 *     at once, and delaying it would leave a false "offline" claim on screen.
 */
export function useSettledOnlineStatus() {
  const online = useOnlineStatus();
  const [settled, setSettled] = useState(online);

  useEffect(() => {
    if (online) {
      setSettled(true);          // reconnect: no delay
      return undefined;
    }
    const t = setTimeout(() => setSettled(false), OFFLINE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [online]);

  return settled;
}
