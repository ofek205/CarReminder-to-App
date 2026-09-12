/**
 * The app half of the preview's two-way sync. Renders nothing.
 *
 * Mounted only under demo mode, so nothing here runs in a real app tab.
 *
 * Reporting is driven by `useLocation` rather than by the click that caused
 * the navigation, which matters for the direction that is easy to get wrong:
 * the frame must report every move, including the ones the marketing page did
 * not ask for. A visitor tapping "מסמכים" in the app's own nav has to update
 * the selector exactly like a click on the selector would, and a bounce back
 * from a blocked write screen has to report the bounce.
 */
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { screenIdFor, pathForScreen } from '@/lib/demoScreens';
import { sendScreen, onDemoMessage, DEMO_MSG_GOTO } from '@/lib/demoBridge';

export default function MarketingDemoBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  // Report on every location change, and once on mount so the selector is
  // correct from the first paint rather than only after the first move.
  useEffect(() => {
    sendScreen(screenIdFor(location.pathname, location.search));
  }, [location.pathname, location.search]);

  useEffect(() => onDemoMessage(DEMO_MSG_GOTO, screenId => {
    const path = pathForScreen(screenId);
    // Unknown ID: drop it. This is the point where a path-carrying message
    // would have let anything steer the app, and an ID cannot.
    if (!path) return;
    // `replace` so the frame does not build a history stack the visitor has
    // no back button for: the preview has no browser chrome.
    navigate(path, { replace: true });
    // ALWAYS answer, even though the effect above already reports on every
    // location change. Navigating to the path you are already on is not a
    // location change, so React Router fires nothing, so that effect stays
    // silent and the marketing page waits for a confirmation that will never
    // come: it showed "pending" on the current screen forever. Answering
    // every request unconditionally makes the protocol self-healing rather
    // than fixing this one case.
    sendScreen(screenIdFor(path.split('?')[0], path.split('?')[1] || ''));
  }), [navigate]);

  return null;
}
