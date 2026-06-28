/**
 * Global single source of truth for admin "view-as" mode (in-memory).
 *
 * Why module scope: the view-as flag must be readable SYNCHRONOUSLY by
 * non-React services (e.g. vehicleQuickCheck, notification scheduler) and by
 * code that sits ABOVE WorkspaceContext in the provider tree (GuestContext),
 * where a React hook can't reach. A module singleton sidesteps provider
 * nesting entirely.
 *
 * Authority: the SERVER (admin_view_sessions, read via admin_current_view) is
 * the ultimate source of truth. This module is the in-memory cache that the
 * UI reads; it is hydrated on boot and updated on enter/exit. Security is NOT
 * enforced here — RLS (is_viewing) enforces access server-side. This flag only
 * drives UX and client-side guards.
 *
 * State shape (or null when not active):
 *   {
 *     targetAccountId: string,
 *     targetUserId:    string | null,
 *     targetName:      string,
 *     targetType:      'personal' | 'business',
 *     ownerEmail?:     string,
 *     expiresAt:       string (ISO),
 *   }
 */

let _state = null;
const _subscribers = new Set();

/** Current view-as state, or null when not active. */
export function getViewAs() {
  return _state;
}

/** True while the admin is viewing another account. */
export function isViewAs() {
  return _state !== null;
}

/** Replace the state and notify subscribers. Pass null/undefined to clear. */
export function setViewAs(next) {
  _state = next || null;
  for (const fn of _subscribers) {
    try { fn(); } catch { /* a bad subscriber must not break the rest */ }
  }
}

/** Clear view-as mode. */
export function clearViewAs() {
  setViewAs(null);
}

/**
 * Subscribe to changes. Returns an unsubscribe function.
 * Subscriber is called with no args (it should re-read via getViewAs()).
 * Shaped for React's useSyncExternalStore.
 */
export function subscribeViewAs(fn) {
  _subscribers.add(fn);
  return () => { _subscribers.delete(fn); };
}
