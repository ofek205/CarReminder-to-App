/**
 * TripGuard — Capacitor plugin registration.
 *
 * `registerPlugin` wires the JS proxy to the native implementation by name
 * ("TripGuard"). The native Android (Kotlin) and iOS (Swift) classes are
 * added later under android/.../tripguard and ios/App/App. Until then — and
 * always on web — the mock in ./web.js backs the same contract so the whole
 * React layer can be built and previewed with zero native dependency.
 *
 * App code should NOT import this directly — import the friendly wrapper from
 * '@/lib/tripGuard' (index.js), which adds platform guards and safe fallbacks.
 */
import { registerPlugin } from '@capacitor/core';

export const TripGuardPlugin = registerPlugin('TripGuard', {
  web: () => import('./web.js').then((m) => new m.TripGuardWeb()),
});
