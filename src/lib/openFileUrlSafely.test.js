/**
 * openFileUrlSafely — the `data:` branch.
 *
 * WHY THIS FILE EXISTS: this is the single door every document open and
 * download in the app goes through, and until now nothing covered it. A QA
 * pass flagged that directly: the suite was green while the one function
 * that decides whether ANY document opens had no test at all.
 *
 * What is pinned here is the bug fixed on 2026-09-19. The `data:` branch
 * used to CLOSE the tab reserved during the click and then call
 * window.open() after awaiting a dynamic import — by which point the
 * click's transient activation is gone and the browser swallows the
 * window. The http(s) branch three lines below had always reused the
 * reserved tab; the data: branch threw it away for no reason.
 *
 * These are deliberately not DOM tests. The project runs vitest in node
 * with no jsdom, and the decision worth pinning is control flow, not
 * rendering: given a live reserved tab, does the blob get navigated INTO
 * it instead of into a fresh window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openFileUrlSafely } from './securityUtils';

// A 1x1 transparent PNG. Small enough to inline, real enough to decode.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A stand-in for the tab reserveFileTab() hands over. */
function makeTab() {
  return {
    closed: false,
    opener: {},
    close() { this.closed = true; },
    location: {
      replaced: null,
      replace(url) { this.replaced = url; },
    },
  };
}

let openCalls;

beforeEach(() => {
  openCalls = [];
  vi.stubGlobal('window', {
    open: (url) => { openCalls.push(url); return null; },  // popup blocked
  });
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:test/abc',
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('openFileUrlSafely, data: URLs', () => {
  it('navigates the reserved tab instead of opening a new window', async () => {
    const tab = makeTab();

    const opened = await openFileUrlSafely(PNG_DATA_URL, tab, 'רישיון רכב');

    expect(opened).toBe(true);
    expect(tab.location.replaced).toBe('blob:test/abc');
    expect(tab.closed).toBe(false);
    // The regression this pins: not a single window.open after the await.
    expect(openCalls).toEqual([]);
  });

  it('drops the opener before navigating, like the http(s) branch', async () => {
    const tab = makeTab();
    await openFileUrlSafely(PNG_DATA_URL, tab, 'doc');
    expect(tab.opener).toBeNull();
  });

  it('falls back to window.open when no tab was reserved', async () => {
    const opened = await openFileUrlSafely(PNG_DATA_URL, null, 'doc');
    // window.open is stubbed to return null (blocked), so this reports the
    // failure rather than claiming success — the behaviour a caller relies
    // on to show "לא ניתן לפתוח את הקובץ".
    expect(opened).toBe(false);
    expect(openCalls).toEqual(['blob:test/abc']);
  });

  it('closes the reserved tab rather than leaving it blank on a bad URL', async () => {
    const tab = makeTab();
    const opened = await openFileUrlSafely('data:image/png;base64,', tab, 'doc');
    expect(opened).toBe(false);
    expect(tab.closed).toBe(true);
  });

  it('refuses a MIME type outside the allowlist', async () => {
    const tab = makeTab();
    // image/gif is deliberately absent from ALLOWED_DATA_URL_MIMES. A guest
    // was able to attach one before validation was added on the same day,
    // which produced a document that could never be opened.
    const opened = await openFileUrlSafely('data:image/gif;base64,R0lGOD', tab, 'doc');
    expect(opened).toBe(false);
    expect(tab.location.replaced).toBeNull();
  });
});
