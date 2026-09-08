/**
 * Feed the OS-level connectivity signal into React Query's onlineManager on
 * native (Capacitor iOS + Android).
 *
 * Why this exists: `navigator.onLine` and the browser online/offline events are
 * unreliable inside WKWebView and the Android WebView. They report "interface
 * up", not "internet reachable", and WKWebView in particular often fails to
 * fire `offline` at all when connectivity drops. onlineManager subscribes to
 * exactly those events by default, so on native it can believe it is online
 * while nothing can reach the network — the state where queries fire and hang,
 * and where the whole offline story silently stops working.
 *
 * @capacitor/network reads the platform APIs (ConnectivityManager on Android,
 * NWPathMonitor on iOS) and reports real transitions. Pushing that into
 * onlineManager means every consumer improves at once: the offline banner, the
 * pause/resume of reads, and the seam's offline write guard all read one source
 * of truth.
 *
 * The web is deliberately left alone: browser events are reliable there, and
 * query-client.js already seeds the initial value from navigator.onLine.
 *
 * The plugin is imported EAGERLY, for the same reason SplashScreen is in
 * capacitor.js: iOS 26 WKWebView can freeze the dynamic-import loader for the
 * first chunk after a cold launch. A dynamic import here would simply never
 * resolve in that case, silently leaving connectivity on the unreliable
 * navigator value on the one platform this module exists to fix. Bundle cost is
 * ~2 KB, and the plugin has a web implementation so importing it off-native is
 * harmless.
 *
 * Every call is still guarded: the plugin is only registered in a native build
 * that has been through `npx cap sync`, and an unregistered plugin rejects or
 * throws. Failure falls back to the navigator-based value rather than breaking
 * boot — main.jsx has a documented history of splash-forever bugs, so nothing
 * in this path may block or reject.
 */
import { onlineManager } from '@tanstack/react-query';
import { Network } from '@capacitor/network';
import { isNative } from './capacitor';

let started = false;

export function initNativeConnectivity() {
  if (started || !isNative) return;
  started = true;

  try {
    // Seed once with the real current state. Without this the app starts on
    // whatever navigator.onLine claimed.
    Network.getStatus()
      .then((status) => onlineManager.setOnline(!!status?.connected))
      .catch(() => { /* unregistered plugin: keep the navigator value */ });

    // Then track transitions for the life of the app. No teardown on purpose:
    // this is process-wide state that should outlive any individual screen.
    Network.addListener('networkStatusChange', (status) => {
      onlineManager.setOnline(!!status?.connected);
    });
  } catch {
    // Plugin missing entirely (native project not synced). Degrade to the
    // browser signal rather than taking the app down.
  }
}
