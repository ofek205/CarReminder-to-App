/**
 * The postMessage channel between the marketing page and the framed preview.
 *
 * Both documents are same-origin, so the parent could reach into
 * `iframe.contentWindow` directly and skip all of this. It does not, for two
 * reasons. Reading the frame's location tells you where it is but never that
 * it moved, so the reverse direction would need polling. And a direct handle
 * invites reaching for anything inside the frame, where a message with a
 * closed vocabulary cannot.
 *
 * Both sides check `event.origin` against their own. Same-origin makes that
 * cheap and it is still worth doing: without it, any framed or framing
 * document could drive the app, and the frame carries whatever session the
 * visitor happens to have on this origin.
 *
 * The vocabulary is two messages and nothing else:
 *   parent -> frame  { type: 'cr-demo:goto',   screen: <id from DEMO_SCREENS> }
 *   frame  -> parent { type: 'cr-demo:screen', screen: <id> | null }
 *
 * `goto` carries an ID, never a path. See lib/demoScreens.js for why.
 */

export const DEMO_MSG_GOTO = 'cr-demo:goto';
export const DEMO_MSG_SCREEN = 'cr-demo:screen';

function sameOrigin(event) {
  if (typeof window === 'undefined') return false;
  // 'null' arrives from sandboxed opaque origins; never trust it.
  return event.origin === window.location.origin;
}

/** Parent side: ask the frame to show a screen. */
export function sendGoto(frameWindow, screenId) {
  if (!frameWindow || !screenId) return;
  try {
    frameWindow.postMessage(
      { type: DEMO_MSG_GOTO, screen: screenId },
      window.location.origin,
    );
  } catch { /* frame torn down mid-flight */ }
}

/** Frame side: report where the app now is. `null` means off the list. */
export function sendScreen(screenId) {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage(
      { type: DEMO_MSG_SCREEN, screen: screenId ?? null },
      window.location.origin,
    );
  } catch { /* no parent, or it went away */ }
}

/**
 * Subscribe to one message type. Returns an unsubscribe function.
 *
 * The handler only ever receives `data.screen`, so a malformed or hostile
 * message cannot smuggle anything else through: every other field on the
 * event is dropped here rather than at each call site.
 */
export function onDemoMessage(type, handler) {
  if (typeof window === 'undefined') return () => {};
  const listener = event => {
    if (!sameOrigin(event)) return;
    const data = event.data;
    if (!data || data.type !== type) return;
    const screen = typeof data.screen === 'string' ? data.screen : null;
    handler(screen, event);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
