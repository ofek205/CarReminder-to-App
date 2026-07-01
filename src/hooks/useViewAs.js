/**
 * Reactive accessor for admin "view-as" mode.
 *
 * Returns the current view-as state object (or null when not active) and
 * re-renders the consuming component whenever it changes. Backed by the
 * module singleton in src/lib/viewAsState.js via useSyncExternalStore.
 *
 *   const viewAs = useViewAs();
 *   if (viewAs) { ... viewAs.targetName ... }
 */
import { useSyncExternalStore } from 'react';
import { getViewAs, subscribeViewAs } from '@/lib/viewAsState';

export default function useViewAs() {
  return useSyncExternalStore(subscribeViewAs, getViewAs, getViewAs);
}
