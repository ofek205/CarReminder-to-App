/**
 * Throttling and the web no-op for native store review.
 * Vitest runs in node, so storage is stubbed. No jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { native, requestReview } = vi.hoisted(() => ({
  native: { value: false },
  requestReview: vi.fn(() => Promise.resolve()),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.value,
  },
}));

vi.mock('@capacitor-community/in-app-review', () => ({
  InAppReview: {
    requestReview: (...args) => requestReview(...args),
  },
}));

const {
  STORE_REVIEW_STORAGE_KEY,
  MIN_DAYS_SINCE_FIRST_OPEN,
  MIN_POSITIVE_ACTIONS,
  MIN_DAYS_BETWEEN_REQUESTS,
  evaluateStoreReview,
  noteStoreReviewFirstOpen,
  maybeRequestStoreReview,
  feedbackPromptAllowed,
  claimReviewSurface,
  reviewSurfaceThisSession,
  readStoreReviewState,
} = await import('./storeReview');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 15);

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  native.value = false;
  requestReview.mockReset();
  requestReview.mockImplementation(() => Promise.resolve());
  globalThis.localStorage = memoryStorage();
  globalThis.sessionStorage = memoryStorage();
  vi.spyOn(Date, 'now').mockReturnValue(T0);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

function seedEligible() {
  native.value = true;
  Date.now.mockReturnValue(T0 - MIN_DAYS_SINCE_FIRST_OPEN * DAY);
  noteStoreReviewFirstOpen();
  Date.now.mockReturnValue(T0);
}

describe('evaluateStoreReview', () => {
  const open = T0 - MIN_DAYS_SINCE_FIRST_OPEN * DAY;

  it('refuses before 7 days, before 3 actions, and inside 120 days', () => {
    expect(evaluateStoreReview({ firstOpenAt: T0, positiveCount: 3 }, T0).reason).toBe('too_new');
    expect(evaluateStoreReview({
      firstOpenAt: T0 - (MIN_DAYS_SINCE_FIRST_OPEN * DAY - 1),
      positiveCount: MIN_POSITIVE_ACTIONS,
    }, T0).allow).toBe(false);
    expect(evaluateStoreReview({ firstOpenAt: open, positiveCount: 2 }, T0).reason).toBe('not_enough_actions');
    expect(evaluateStoreReview({
      firstOpenAt: open,
      positiveCount: MIN_POSITIVE_ACTIONS,
      lastRequestedAt: T0 - (MIN_DAYS_BETWEEN_REQUESTS * DAY - 1),
    }, T0).reason).toBe('throttled');
  });

  it('allows on the 7-day and 120-day boundaries once 3 actions are counted', () => {
    expect(evaluateStoreReview({
      firstOpenAt: open,
      positiveCount: MIN_POSITIVE_ACTIONS,
    }, T0)).toEqual({ allow: true, reason: 'ok' });
    expect(evaluateStoreReview({
      firstOpenAt: open,
      positiveCount: MIN_POSITIVE_ACTIONS,
      lastRequestedAt: T0 - MIN_DAYS_BETWEEN_REQUESTS * DAY,
    }, T0).allow).toBe(true);
  });
});

describe('maybeRequestStoreReview', () => {
  it('no-ops on web and never throws', async () => {
    expect(() => {
      maybeRequestStoreReview('vehicle_added_plate');
      maybeRequestStoreReview('vehicle_added_plate');
      maybeRequestStoreReview('vehicle_added_plate');
    }).not.toThrow();
    await vi.dynamicImportSettled();
    expect(requestReview).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORE_REVIEW_STORAGE_KEY)).toBeNull();
  });

  it('counts native actions and requests only on the third, after 7 days', async () => {
    seedEligible();
    maybeRequestStoreReview('vehicle_added_plate');
    maybeRequestStoreReview('treatment_done');
    expect(requestReview).not.toHaveBeenCalled();
    expect(readStoreReviewState().positiveCount).toBe(2);

    maybeRequestStoreReview('reminder_renewed');
    await vi.dynamicImportSettled();
    expect(requestReview).toHaveBeenCalledTimes(1);
    expect(readStoreReviewState().lastRequestedAt).toBe(T0);
    expect(reviewSurfaceThisSession()).toBe('native');
  });

  it('does not request again until 120 days have passed', async () => {
    seedEligible();
    maybeRequestStoreReview('a');
    maybeRequestStoreReview('b');
    maybeRequestStoreReview('c');
    await vi.dynamicImportSettled();
    requestReview.mockClear();

    Date.now.mockReturnValue(T0 + (MIN_DAYS_BETWEEN_REQUESTS * DAY - 1));
    maybeRequestStoreReview('d');
    await vi.dynamicImportSettled();
    expect(requestReview).not.toHaveBeenCalled();

    Date.now.mockReturnValue(T0 + MIN_DAYS_BETWEEN_REQUESTS * DAY);
    sessionStorage.clear();
    maybeRequestStoreReview('e');
    await vi.dynamicImportSettled();
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it('does not request when the feedback popup already owns the session', async () => {
    seedEligible();
    claimReviewSurface('feedback');
    maybeRequestStoreReview('vehicle_added_plate');
    maybeRequestStoreReview('treatment_done');
    maybeRequestStoreReview('reminder_renewed');
    await vi.dynamicImportSettled();
    expect(requestReview).not.toHaveBeenCalled();
    expect(readStoreReviewState().positiveCount).toBe(3);
    expect(readStoreReviewState().lastRequestedAt).toBeNull();
    expect(reviewSurfaceThisSession()).toBe('feedback');
  });

  it('keeps the feedback popup closed after a native request', () => {
    expect(feedbackPromptAllowed(true)).toBe(true);
    expect(reviewSurfaceThisSession()).toBe('feedback');
    sessionStorage.clear();
    claimReviewSurface('native');
    expect(feedbackPromptAllowed(true)).toBe(false);
    expect(feedbackPromptAllowed(false)).toBe(false);
  });

  it('does not throw when the plugin rejects, and does not burn the 120-day gate', async () => {
    seedEligible();
    requestReview.mockRejectedValue(new Error('plugin missing'));
    maybeRequestStoreReview('vehicle_added');
    maybeRequestStoreReview('treatment_done');
    expect(() => maybeRequestStoreReview('reminder_renewed')).not.toThrow();
    await vi.dynamicImportSettled();
    expect(readStoreReviewState().lastRequestedAt).toBeNull();
    expect(reviewSurfaceThisSession()).toBeNull();
  });

  it('does not throw when storage throws', () => {
    native.value = true;
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    expect(() => maybeRequestStoreReview('vehicle_added_plate')).not.toThrow();
    expect(() => noteStoreReviewFirstOpen()).not.toThrow();
  });

  it('records the first native open once and ignores web', () => {
    noteStoreReviewFirstOpen();
    expect(localStorage.getItem(STORE_REVIEW_STORAGE_KEY)).toBeNull();
    native.value = true;
    noteStoreReviewFirstOpen();
    const first = readStoreReviewState().firstOpenAt;
    Date.now.mockReturnValue(T0 + DAY);
    noteStoreReviewFirstOpen();
    expect(readStoreReviewState().firstOpenAt).toBe(first);
  });
});
