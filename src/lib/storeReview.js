/**
 * Native store review (SKStoreReviewController / Play In-App Review).
 *
 * The in-app feedback popup (useReviewPromptSchedule + ReviewPopup) is a
 * separate surface that saves a review to Supabase. This module never
 * replaces it. The two must not appear in the same browser session.
 *
 * Policy: no "do you like the app?" step and no star pre-prompt. The OS
 * dialog is requested directly, and only after local gates pass.
 *
 * Gates (localStorage, device-local):
 *   - at least 7 days since the first native app open
 *   - at least 3 successful positive actions
 *   - at most one request per 120 days
 *
 * Web is a no-op. Nothing here throws.
 */

import { Capacitor } from '@capacitor/core';

export const STORE_REVIEW_STORAGE_KEY = 'cr_store_review_v1';
export const REVIEW_SURFACE_SESSION_KEY = 'cr_review_surface_v1';

export const MIN_DAYS_SINCE_FIRST_OPEN = 7;
export const MIN_POSITIVE_ACTIONS = 3;
export const MIN_DAYS_BETWEEN_REQUESTS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_STATE = { firstOpenAt: null, positiveCount: 0, lastRequestedAt: null };

function normalizeState(raw) {
  const firstOpenAt = Number(raw?.firstOpenAt);
  const positiveCount = Number(raw?.positiveCount);
  const lastRequestedAt = Number(raw?.lastRequestedAt);
  return {
    firstOpenAt: Number.isFinite(firstOpenAt) && firstOpenAt > 0 ? firstOpenAt : null,
    positiveCount: Number.isFinite(positiveCount) && positiveCount > 0 ? Math.floor(positiveCount) : 0,
    lastRequestedAt: Number.isFinite(lastRequestedAt) && lastRequestedAt > 0 ? lastRequestedAt : null,
  };
}

export function readStoreReviewState() {
  try {
    const raw = localStorage.getItem(STORE_REVIEW_STORAGE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeStoreReviewState(state) {
  localStorage.setItem(STORE_REVIEW_STORAGE_KEY, JSON.stringify(normalizeState(state)));
}

/**
 * Whether the gates allow a request for this state at `now`.
 * Does not read or write storage.
 */
export function evaluateStoreReview(state, now) {
  const s = normalizeState(state);
  if (!s.firstOpenAt) return { allow: false, reason: 'no_first_open' };
  if (now - s.firstOpenAt < MIN_DAYS_SINCE_FIRST_OPEN * DAY_MS) return { allow: false, reason: 'too_new' };
  if (s.positiveCount < MIN_POSITIVE_ACTIONS) return { allow: false, reason: 'not_enough_actions' };
  if (s.lastRequestedAt != null && now - s.lastRequestedAt < MIN_DAYS_BETWEEN_REQUESTS * DAY_MS) {
    return { allow: false, reason: 'throttled' };
  }
  return { allow: true, reason: 'ok' };
}

/** First native open starts the 7-day clock. Later calls keep the original timestamp. */
export function noteStoreReviewFirstOpen() {
  try {
    if (!Capacitor.isNativePlatform()) return;
    const prev = readStoreReviewState();
    if (prev.firstOpenAt) return;
    writeStoreReviewState({ ...prev, firstOpenAt: Date.now() });
  } catch {
    // never throw
  }
}

export function reviewSurfaceThisSession() {
  try {
    const value = sessionStorage.getItem(REVIEW_SURFACE_SESSION_KEY);
    return value === 'feedback' || value === 'native' ? value : null;
  } catch {
    return null;
  }
}

/** First claim wins. The same kind may claim again. A conflicting kind returns false. */
export function claimReviewSurface(kind) {
  if (kind !== 'feedback' && kind !== 'native') return false;
  try {
    const existing = reviewSurfaceThisSession();
    if (existing && existing !== kind) return false;
    if (!existing) sessionStorage.setItem(REVIEW_SURFACE_SESSION_KEY, kind);
    return true;
  } catch {
    return false;
  }
}

/**
 * The scheduled feedback popup calls this while deciding `open`.
 * A native request already made this session keeps the popup closed.
 * Storage failures still allow the popup: it is the existing surface.
 */
export function feedbackPromptAllowed(shouldPrompt) {
  if (!shouldPrompt) return false;
  if (reviewSurfaceThisSession() === 'native') return false;
  claimReviewSurface('feedback');
  return true;
}

function clearNativeAttempt(requestedAt) {
  try {
    const cur = readStoreReviewState();
    if (cur.lastRequestedAt === requestedAt) {
      writeStoreReviewState({ ...cur, lastRequestedAt: null });
    }
  } catch {
    // ignore
  }
  try {
    if (sessionStorage.getItem(REVIEW_SURFACE_SESSION_KEY) === 'native') {
      sessionStorage.removeItem(REVIEW_SURFACE_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

function launchNativeReview(requestedAt) {
  import('@capacitor-community/in-app-review')
    .then((mod) => mod.InAppReview.requestReview())
    .catch(() => { clearNativeAttempt(requestedAt); });
}

/**
 * Count one successful positive action and maybe ask the OS for a review.
 * Synchronous and non-throwing. Callers must not await it.
 *
 * @param {string} trigger short label of the success point, for call-site clarity
 */
export function maybeRequestStoreReview(trigger) {
  try {
    if (typeof trigger !== 'string' || trigger.length === 0) return;
    if (!Capacitor.isNativePlatform()) return;

    const now = Date.now();
    const prev = readStoreReviewState();
    const next = {
      ...prev,
      firstOpenAt: prev.firstOpenAt || now,
      positiveCount: prev.positiveCount + 1,
    };
    const decision = evaluateStoreReview(next, now);
    if (!decision.allow) {
      writeStoreReviewState(next);
      return;
    }
    if (!claimReviewSurface('native')) {
      writeStoreReviewState(next);
      return;
    }
    writeStoreReviewState({ ...next, lastRequestedAt: now });
    launchNativeReview(now);
  } catch {
    // never throw
  }
}
