/**
 * The pure helpers behind /Plans.
 *
 * Two of these carry consequences that no other check can see:
 *
 *   personalNote is what stops the screen contradicting the app for the 21
 *   grandfathered accounts. Their plan advertises 5 while their account
 *   allows the 17 they hold, and a wrong answer here is a screen that lies
 *   to exactly the users most likely to read it carefully.
 *
 *   unavailableCopy is anti-steering. Guideline 3.1.1(a) covers PROSE, so an
 *   iOS string that hints a purchase exists elsewhere is a review rejection,
 *   and nothing in the build or the linter can see a sentence.
 */
import { describe, it, expect, vi } from 'vitest';

// The page pulls in the Supabase client through usePlanCatalog. The helpers
// under test touch none of it, so the client is stubbed rather than built.
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }));

const {
  capLabel, monthlyLabel, advisorLabel, includedLabel,
  personalNote, unavailableCopy,
} = await import('./Plans');

describe('capLabel', () => {
  it('renders a number as a ceiling', () => {
    expect(capLabel(5)).toBe('עד 5');
    expect(capLabel(30)).toBe('עד 30');
  });

  it('renders NULL as unlimited, never as zero', () => {
    // NULL means unlimited everywhere in plan_limits. Coercing it to 0 would
    // flip the meaning to "none allowed", which is the opposite.
    expect(capLabel(null)).toBe('ללא הגבלה');
    expect(capLabel(undefined)).toBe('ללא הגבלה');
  });

  it('keeps a real zero distinct from unlimited', () => {
    // 0 is a legitimate value meaning none, and it must not read as ∞.
    expect(capLabel(0)).toBe('עד 0');
  });
});

describe('monthlyLabel', () => {
  it('carries the period, since the number alone is ambiguous', () => {
    expect(monthlyLabel(3)).toBe('3 בחודש');
  });

  it('renders NULL as unlimited', () => {
    expect(monthlyLabel(null)).toBe('ללא הגבלה');
  });
});

describe('advisorLabel', () => {
  it('says "להתרשמות", because the free allowance is a lifetime one', () => {
    // ⚠️ "שאלה אחת" alone reads as a MONTHLY quota. The free plan grants one
    // question for the life of the account, and this word is what carries
    // "one off" without a sentence of explanation.
    expect(advisorLabel({ aiLifetimeTeaser: 1 })).toBe('שאלה אחת להתרשמות');
  });

  it('pluralises if the teaser is ever raised', () => {
    expect(advisorLabel({ aiLifetimeTeaser: 3 })).toBe('3 שאלות להתרשמות');
  });

  it('is open when there is no lifetime teaser', () => {
    // Paid plans bound the advisor by a daily fair-use ceiling instead, which
    // is not a product promise and does not belong on this screen.
    expect(advisorLabel({ aiLifetimeTeaser: null, aiDailyCap: 50 })).toBe('פתוח');
  });

  it('does not throw on a missing plan', () => {
    expect(() => advisorLabel(null)).not.toThrow();
    expect(advisorLabel(null)).toBe('פתוח');
  });
});

describe('includedLabel', () => {
  it('uses words, never a cross', () => {
    // The design forbids marking the free column as broken. "לא כלול" is a
    // fact; a red ✗ is a verdict.
    expect(includedLabel(true)).toBe('כלול');
    expect(includedLabel(false)).toBe('לא כלול');
  });
});

// ── the note that stops the screen lying ────────────────────────────────

describe('personalNote', () => {
  it('is silent when the account matches its plan', () => {
    // The overwhelming majority. A note on every row would be noise.
    expect(personalNote(5, 5)).toBeNull();
    expect(personalNote(null, null)).toBeNull();
  });

  it('names the real ceiling AND why, for a grandfathered account', () => {
    // The live case: a business account frozen at 17 sitting on a plan that
    // advertises 5. Without the reason clause, a user reading both numbers
    // concludes one of them is a bug.
    expect(personalNote(17, 5)).toBe('אצלך עד 17, נשמר מהמצב הקודם');
    expect(personalNote(8, 5)).toBe('אצלך עד 8, נשמר מהמצב הקודם');
  });

  it('handles an unlimited override against a bounded plan', () => {
    expect(personalNote(null, 5)).toBe('אצלך ללא הגבלה');
  });

  it('handles a bounded override against an unlimited plan', () => {
    expect(personalNote(10, null)).toBe('אצלך עד 10');
  });

  it('treats undefined as null, so a missing field is not a phantom note', () => {
    expect(personalNote(undefined, null)).toBeNull();
    expect(personalNote(null, undefined)).toBeNull();
  });
});

// ── anti-steering ───────────────────────────────────────────────────────
//
// The highest-consequence strings in the file. Getting the iOS one wrong is
// an App Store rejection, and it cannot be caught by any other check.

describe('unavailableCopy', () => {
  it('says nothing about a website on iOS', () => {
    const s = unavailableCopy('iap');
    expect(s).not.toContain('אתר');
    expect(s).not.toContain('http');
    expect(s).toBeTruthy();
  });

  it('may name the website on Android, which permits mentioning', () => {
    // Play's consumption-only exemption allows telling the user a
    // subscription exists elsewhere. Linking to it is what is forbidden, and
    // this is a sentence, not a link.
    expect(unavailableCopy('none')).toContain('אתר');
  });

  it('is plain on the web, where no store rule applies', () => {
    expect(unavailableCopy('web')).toBeTruthy();
  });

  it('never promises a date', () => {
    // "בקרוב" is a commitment nobody has made, and it costs more when it is
    // missed than it buys now.
    for (const surface of ['iap', 'none', 'web']) {
      expect(unavailableCopy(surface), surface).not.toContain('בקרוב');
    }
  });

  it('falls back to the safest wording for an unknown surface', () => {
    // billingSurface only returns three values, but a fallback that leaked
    // the website string onto an unrecognised native platform would be the
    // expensive direction to be wrong in.
    expect(unavailableCopy('something-else')).not.toContain('אתר');
  });
});
