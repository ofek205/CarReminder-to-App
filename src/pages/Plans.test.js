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
  personalNote, unavailableCopy, rowOrder, rowValue, higherTiers,
  labelStatesPrice,
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

// ── the card layout ─────────────────────────────────────────────────────

describe('rowOrder', () => {
  it('keeps the business row last for a personal account', () => {
    expect(rowOrder(false)[0]).toBe('vehicles');
    expect(rowOrder(false)[4]).toBe('business');
  });

  it('lifts the business row to the top for a business account', () => {
    // For a business account sitting on free, "ממשק עסקי: לא כלול" is the
    // single most consequential line on the screen. As row five it is the
    // last thing read.
    expect(rowOrder(true)[0]).toBe('business');
  });

  it('never drops or invents a row', () => {
    // The two orders must be permutations of each other. A typo in one
    // branch would silently delete a whole dimension from the card for one
    // class of account, and nothing else would catch it.
    expect([...rowOrder(true)].sort()).toEqual([...rowOrder(false)].sort());
    expect(rowOrder(false)).toHaveLength(5);
    expect(new Set(rowOrder(true)).size).toBe(5);
  });
});

describe('rowValue', () => {
  const plan = {
    maxVehicles: 15, aiLifetimeTeaser: null, plateChecksPerMonth: null,
    maxShares: null, businessUi: true,
  };

  it('routes each dimension through its own helper', () => {
    expect(rowValue('vehicles', plan)).toBe('עד 15');
    expect(rowValue('ai', plan)).toBe('פתוח');
    expect(rowValue('plate', plan)).toBe('ללא הגבלה');
    expect(rowValue('shares', plan)).toBe('ללא הגבלה');
    expect(rowValue('business', plan)).toBe('כלול');
  });

  it('preserves NULL as unlimited rather than zero', () => {
    const freeish = { maxVehicles: null, maxShares: 2, plateChecksPerMonth: 3, aiLifetimeTeaser: 1, businessUi: false };
    expect(rowValue('vehicles', freeish)).toBe('ללא הגבלה');
    expect(rowValue('shares', freeish)).toBe('עד 2');
    expect(rowValue('plate', freeish)).toBe('3 בחודש');
    expect(rowValue('ai', freeish)).toBe('שאלה אחת להתרשמות');
    expect(rowValue('business', freeish)).toBe('לא כלול');
  });

  it('renders nothing rather than throwing on missing data', () => {
    // A card must never crash the screen because one field is absent.
    expect(rowValue('vehicles', null)).toBe('');
    expect(rowValue('nope', plan)).toBe('');
  });
});

describe('labelStatesPrice', () => {
  it('is true for the seeded paid labels, which already carry the price', () => {
    // ⚠️ THE REGRESSION THIS EXISTS FOR. label_he is seeded as "₪9 לחודש",
    // so a card printing the label plus a price built from price_ils_month
    // rendered "₪9 לחודש" twice, one line under the other. Caught in the
    // preview, not by reading the code.
    expect(labelStatesPrice({ labelHe: '₪9 לחודש',  priceIlsMonth: 9 })).toBe(true);
    expect(labelStatesPrice({ labelHe: '₪19 לחודש', priceIlsMonth: 19 })).toBe(true);
    expect(labelStatesPrice({ labelHe: '₪49 לחודש', priceIlsMonth: 49 })).toBe(true);
  });

  it('is true for free, because "חינם" states the price in words', () => {
    expect(labelStatesPrice({ labelHe: 'חינם', priceIlsMonth: 0 })).toBe(true);
  });

  it('is false when a rename drops the price, so the price line returns', () => {
    // The failure to avoid is the opposite one: a plan renamed in the
    // database to a word with no number, leaving the screen with no price
    // anywhere. This is what makes the check dynamic instead of hardcoded.
    expect(labelStatesPrice({ labelHe: 'בסיסי',   priceIlsMonth: 9 })).toBe(false);
    expect(labelStatesPrice({ labelHe: '',        priceIlsMonth: 9 })).toBe(false);
    expect(labelStatesPrice({ labelHe: null,      priceIlsMonth: 9 })).toBe(false);
  });

  it('does not throw on a missing plan', () => {
    expect(() => labelStatesPrice(null)).not.toThrow();
    expect(labelStatesPrice(null)).toBe(false);
  });
});

describe('higherTiers', () => {
  const P9  = { code: 'p9',  maxVehicles: 15 };
  const P19 = { code: 'p19', maxVehicles: 30 };
  const P49 = { code: 'p49', maxVehicles: null };  // unlimited
  const ALL = [P9, P19, P49];

  it('offers only what is strictly above the featured tier', () => {
    expect(higherTiers(ALL, P9).map((p) => p.code)).toEqual(['p19', 'p49']);
    expect(higherTiers(ALL, P19).map((p) => p.code)).toEqual(['p49']);
  });

  it('offers nothing above the unlimited tier, with no special case', () => {
    // ⚠️ This is what makes the top-tier account work. NULL is unlimited, so
    // nothing outranks it, the group renders empty, and the "more vehicles"
    // heading disappears on its own instead of needing a separate branch.
    expect(higherTiers(ALL, P49)).toEqual([]);
  });

  it('never offers a downgrade', () => {
    // A screen with no purchase button offering a smaller plan is pure noise.
    // NULL is unlimited, so it outranks every number and nothing outranks it.
    const outranks = (a, b) => {
      if (a.maxVehicles === null) return b.maxVehicles !== null;
      if (b.maxVehicles === null) return false;
      return a.maxVehicles > b.maxVehicles;
    };

    let checked = 0;
    for (const featured of ALL) {
      for (const p of higherTiers(ALL, featured)) {
        expect(outranks(p, featured), `${p.code} vs ${featured.code}`).toBe(true);
        checked++;
      }
    }
    // Positive control. Without it this test passes just as happily if
    // higherTiers returns an empty array for every input, which is the one
    // bug that would make the loop above prove nothing.
    expect(checked).toBe(3);
  });

  it('excludes the featured plan itself', () => {
    expect(higherTiers(ALL, P9).some((p) => p.code === 'p9')).toBe(false);
  });

  it('survives an empty or missing catalogue', () => {
    expect(higherTiers([], P9)).toEqual([]);
    expect(higherTiers(ALL, null)).toEqual([]);
    expect(higherTiers(undefined, P9)).toEqual([]);
  });
});
