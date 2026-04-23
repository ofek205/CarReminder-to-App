/**
 * useReviewPromptSchedule
 *
 * Decides when to surface the in-app review popup. Mirrors the classic
 * "ask-once, nudge-later, then leave alone" pattern used by App Store
 * Review prompts — we want feedback without harassing users.
 *
 * Schedule (from account creation):
 *   - Day 10 from signup: first prompt (age-gated).
 *   - 20 days after the first prompt: second prompt — roughly day 30
 *     from signup for a user who sees the first prompt on time.
 *   - Every 90 days after the previous prompt: quarterly nudge.
 *   - If the user submits a review once → never prompt again.
 *
 * Critically, the 2nd-prompt and quarterly gates key off sinceLast
 * (time since last prompt), NOT signup age. That way a user who signed
 * up 6 months ago and only now sees their first prompt still gets a
 * real 20-day breather before the second — we don't jump them straight
 * to prompt #2 just because their account is old.
 *
 * Storage
 *   Key: localStorage['cr_review_schedule_v1']
 *   Value: { lastPromptedAt: ISO string, hasSubmitted: boolean, promptCount: number }
 *
 *   This lives in localStorage, not on the server, intentionally — the
 *   "please rate us" nag is device-local. If the user clears storage,
 *   they'll see the prompt again, which is acceptable.
 *
 * Usage
 *   const { shouldPrompt, markPrompted, markSubmitted } = useReviewPromptSchedule(user);
 *   <ReviewPopup open={shouldPrompt} onClose={markPrompted} ... />
 */

import { useEffect, useMemo, useState, useCallback } from 'react';

const STORAGE_KEY = 'cr_review_schedule_v1';
const FIRST_PROMPT_DAY     = 10;   // days after signup — when prompt #1 becomes eligible
const SECOND_PROMPT_WAIT   = 20;   // days after prompt #1 before prompt #2 (≈ day-30 of signup for on-time users)
const FOLLOWUP_INTERVAL    = 90;   // days between subsequent prompts (after #2)

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lastPromptedAt: null, hasSubmitted: false, promptCount: 0 };
    const parsed = JSON.parse(raw);
    return {
      lastPromptedAt: parsed.lastPromptedAt || null,
      hasSubmitted:   !!parsed.hasSubmitted,
      promptCount:    Number(parsed.promptCount) || 0,
    };
  } catch {
    return { lastPromptedAt: null, hasSubmitted: false, promptCount: 0 };
  }
}

function writeState(patch) {
  try {
    const current = readState();
    const next = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

/**
 * @param {{ id?: string, created_at?: string }|null|undefined} user
 * @returns {{ shouldPrompt: boolean, markPrompted: (result?: 'submitted'|any) => void, markSubmitted: () => void }}
 */
export default function useReviewPromptSchedule(user) {
  const [tick, setTick] = useState(0);

  // Evaluate once per mount + whenever tick bumps (after marking). Using
  // a `useMemo` keeps the decision pure and easy to reason about.
  const shouldPrompt = useMemo(() => {
    if (!user?.id || !user?.created_at) return false;
    const state = readState();
    if (state.hasSubmitted) return false;

    const now = new Date();
    const signup = new Date(user.created_at);
    if (isNaN(signup.getTime())) return false;

    const ageDays = daysBetween(signup, now);
    if (ageDays === null || ageDays < FIRST_PROMPT_DAY) return false;

    // First prompt — eligible the moment account is 10+ days old.
    if (state.promptCount === 0) return true;

    // Past prompts exist → the cooldown is based on time-since-last, never
    // on signup age. This prevents a "double pop" right after the user
    // clicks "לא עכשיו" on the first prompt: even for an old account, we
    // always wait the full SECOND_PROMPT_WAIT / FOLLOWUP_INTERVAL window.
    const last = state.lastPromptedAt ? new Date(state.lastPromptedAt) : null;
    const sinceLast = daysBetween(last, now);
    if (sinceLast === null) return true; // missing timestamp → safe default: allow

    if (state.promptCount === 1) return sinceLast >= SECOND_PROMPT_WAIT;
    return sinceLast >= FOLLOWUP_INTERVAL;
  }, [user?.id, user?.created_at, tick]);

  // Called when the user dismisses the popup (with or without submitting).
  // If they submitted, mark permanent. Otherwise bump the count + date so
  // the scheduler advances to the next slot.
  const markPrompted = useCallback((result) => {
    if (result === 'submitted') {
      writeState({ hasSubmitted: true, lastPromptedAt: new Date().toISOString() });
    } else {
      const current = readState();
      writeState({
        lastPromptedAt: new Date().toISOString(),
        promptCount: current.promptCount + 1,
      });
    }
    setTick(t => t + 1);
  }, []);

  const markSubmitted = useCallback(() => {
    writeState({ hasSubmitted: true, lastPromptedAt: new Date().toISOString() });
    setTick(t => t + 1);
  }, []);

  // One-time dev helper. Lets you reset the state from the browser console
  // when QA-ing the timing: `window.__resetReviewSchedule()`.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__resetReviewSchedule = () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      setTick(t => t + 1);
    };
  }, []);

  return { shouldPrompt, markPrompted, markSubmitted };
}
