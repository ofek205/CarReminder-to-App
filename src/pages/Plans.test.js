/**
 * The pure helpers behind /Plans.
 *
 * Four of these carry consequences no other check can see:
 *
 *   actionKind is the double-purchase guard. Our plugin has no replacement
 *   mode, so a subscriber handed "בחר מסלול" on another plan opens a SECOND
 *   Play subscription and pays twice.
 *
 *   recommendPlan puts a badge on a payment screen. A wrong answer is a
 *   recommendation the data cannot back, at the one moment trust matters.
 *
 *   personalNote stops the screen contradicting the app for the
 *   grandfathered accounts.
 *
 *   unavailableCopy is anti-steering. Guideline 3.1.1(a) covers PROSE, and
 *   nothing in the build or the linter can see a sentence.
 */
import { describe, it, expect, vi } from 'vitest';

// The page pulls in the Supabase client through its hooks. The helpers under
// test touch none of it, so the client is stubbed rather than built.
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }));

const {
  capLabel, advisorLabel, personalNote, unavailableCopy, labelStatesPrice,
  catalogPriceAllowed, COLUMNS, cellValue, detailValue, deltaNote, extrasLine,
  NEAR_FULL, usageMeter, recommendPlan, defaultOpenCode, actionKind,
  manageNote, currentNote, isStoreManaged, noteVoice,
} = await import('./Plans');

// The live catalogue as of 2026-09-25, after supabase-plans-redesign.
const FREE = {
  code: 'free', labelHe: 'חינם', priceIlsMonth: 0, maxVehicles: 5, maxDocuments: 5,
  aiDailyCap: null, aiLifetimeTeaser: 1, plateChecksPerMonth: 3, maxShares: 2, businessUi: false,
};
const P9 = {
  code: 'p9', labelHe: 'מורחב', priceIlsMonth: 9, maxVehicles: 15, maxDocuments: 15,
  aiDailyCap: 50, aiLifetimeTeaser: null, plateChecksPerMonth: null, maxShares: null, businessUi: true,
};
const P19 = { ...P9, code: 'p19', labelHe: 'מקצועי', priceIlsMonth: 19, maxVehicles: 30, maxDocuments: 40, aiDailyCap: 200 };
const P49 = { ...P9, code: 'p49', labelHe: 'ללא הגבלה', priceIlsMonth: 49, maxVehicles: null, maxDocuments: null, aiDailyCap: 500 };
const ALL = [FREE, P9, P19, P49];

/**
 * ⚠️ OFEK'S RULE: THE SCREEN MAY NEVER SAY THE PLANS ARE THE SAME.
 * "אותם פיצ׳רים בדיוק" was live copy and was both false (documents and AI
 * differ) and a reason not to upgrade.
 */
const FORBIDDEN = ['אותם', 'אותו', 'זהים', 'זהה', 'בדיוק'];

describe('capLabel', () => {
  it('renders a number as a ceiling', () => {
    expect(capLabel(5)).toBe('עד 5');
  });

  it('renders NULL as unlimited, never as zero', () => {
    expect(capLabel(null)).toBe('ללא הגבלה');
    expect(capLabel(undefined)).toBe('ללא הגבלה');
  });

  it('keeps a real zero distinct from unlimited', () => {
    expect(capLabel(0)).toBe('עד 0');
  });
});

describe('advisorLabel', () => {
  it('says "להתרשמות", because the free allowance is a lifetime one', () => {
    // ⚠️ "שאלה אחת" alone reads as a MONTHLY quota.
    expect(advisorLabel(FREE)).toBe('שאלה אחת להתרשמות');
    expect(advisorLabel({ aiLifetimeTeaser: 3 })).toBe('3 שאלות להתרשמות');
  });

  it('shows the daily cap on paid plans, where it used to say "פתוח"', () => {
    // ⚠️ THE REGRESSION THIS EXISTS FOR. "פתוח" hid 50 against 500, one of
    // only three things that separate the paid plans at all.
    expect(advisorLabel(P9)).toBe('50 שאלות ביום');
    expect(advisorLabel(P19)).toBe('200 שאלות ביום');
    expect(advisorLabel(P49)).toBe('500 שאלות ביום');
  });

  it('is unlimited only when neither bound exists, and never throws', () => {
    expect(advisorLabel({ aiLifetimeTeaser: null, aiDailyCap: null })).toBe('ללא הגבלה');
    expect(() => advisorLabel(null)).not.toThrow();
  });
});

// ── the note that stops the screen lying ────────────────────────────────

describe('personalNote', () => {
  it('is silent when the account matches its plan', () => {
    expect(personalNote(5, 5)).toBeNull();
    expect(personalNote(null, null)).toBeNull();
  });

  it('names the real ceiling AND why, for a grandfathered account', () => {
    expect(personalNote(17, 5)).toBe('אצלך עד 17, נשמר מהמצב הקודם');
  });

  it('handles unlimited on either side', () => {
    expect(personalNote(null, 5)).toBe('אצלך ללא הגבלה');
    expect(personalNote(10, null)).toBe('אצלך עד 10');
  });

  it('treats undefined as null, so a missing field is not a phantom note', () => {
    expect(personalNote(undefined, null)).toBeNull();
    expect(personalNote(null, undefined)).toBeNull();
  });
});

// ── anti-steering ───────────────────────────────────────────────────────

describe('unavailableCopy', () => {
  it('names no website on ANY surface, because Android ships Play Billing', () => {
    for (const surface of ['iap', 'none', 'web', 'something-else']) {
      expect(unavailableCopy(surface), surface).not.toContain('אתר');
      expect(unavailableCopy(surface), surface).not.toContain('http');
      expect(unavailableCopy(surface), surface).toBeTruthy();
    }
  });

  it('never promises a date', () => {
    for (const surface of ['iap', 'none', 'web']) {
      expect(unavailableCopy(surface), surface).not.toContain('בקרוב');
    }
  });
});

describe('catalogPriceAllowed', () => {
  it('lets only the web print a price from plan_limits', () => {
    // ⚠️ On iOS no price may appear at all (3.1.1(a)), and on Android the
    // price must be Play's. Our number there is a policy violation.
    expect(catalogPriceAllowed('web')).toBe(true);
    expect(catalogPriceAllowed('iap')).toBe(false);
    expect(catalogPriceAllowed('none')).toBe(false);
    expect(catalogPriceAllowed(undefined)).toBe(false);
  });
});

describe('labelStatesPrice', () => {
  it('is true for the old seeded labels, which ARE the price', () => {
    expect(labelStatesPrice({ labelHe: '₪9 לחודש', priceIlsMonth: 9 })).toBe(true);
  });

  it('is false once a plan has a name, so the price line returns', () => {
    expect(labelStatesPrice(P9)).toBe(false);
    expect(labelStatesPrice({ labelHe: null, priceIlsMonth: 9 })).toBe(false);
  });

  it('is true for free, which says its price in words', () => {
    expect(labelStatesPrice(FREE)).toBe(true);
    expect(labelStatesPrice(null)).toBe(false);
  });
});

// ── the closed rows are the comparison ──────────────────────────────────

describe('cellValue', () => {
  it('prints the three columns that actually differ, in legend order', () => {
    expect(COLUMNS).toEqual(['vehicles', 'documents', 'ai']);
    expect(ALL.map((p) => cellValue('vehicles', p))).toEqual(['5', '15', '30', 'ללא']);
    expect(ALL.map((p) => cellValue('documents', p))).toEqual(['5', '15', '40', 'ללא']);
  });

  it('writes the AI unit in every cell, because free and paid use different units', () => {
    // ⚠️ A shared "ליום" in the legend would print the free teaser as one
    // question a day.
    expect(ALL.map((p) => cellValue('ai', p))).toEqual(['1 בסה״כ', '50 ביום', '200 ביום', '500 ביום']);
  });

  it('renders nothing rather than throwing on missing data', () => {
    expect(cellValue('vehicles', null)).toBe('');
    expect(cellValue('nope', P9)).toBe('');
  });
});

describe('detailValue', () => {
  it('writes the open row in full', () => {
    expect(detailValue('vehicles', P49)).toBe('ללא הגבלה');
    expect(detailValue('documents', P9)).toBe('עד 15');
    expect(detailValue('ai', FREE)).toBe('שאלה אחת להתרשמות');
  });
});

describe('deltaNote', () => {
  it('states what the account has today beside each value that changes', () => {
    expect(deltaNote('vehicles', P9, FREE)).toBe('(במקום 5)');
    expect(deltaNote('documents', P19, P9)).toBe('(במקום 15)');
    expect(deltaNote('ai', P9, FREE)).toBe('(במקום שאלה אחת)');
    expect(deltaNote('ai', P19, P9)).toBe('(במקום 50 ביום)');
  });

  it('works downward too, so a subscriber reads what a smaller plan takes away', () => {
    expect(deltaNote('vehicles', P9, P49)).toBe('(במקום ללא הגבלה)');
  });

  it('is silent on the plan itself, without a reference, and on a value that does not change', () => {
    expect(deltaNote('vehicles', P9, P9)).toBeNull();
    expect(deltaNote('vehicles', P9, null)).toBeNull();
    expect(deltaNote('vehicles', { ...P19, maxVehicles: 15 }, P9)).toBeNull();
  });
});

describe('extrasLine', () => {
  it('says the three shared features once, on one line', () => {
    expect(extrasLine(P9)).toBe('בנוסף: בדיקות רכב ושיתופים ללא הגבלה, וממשק עסקי.');
    expect(extrasLine(FREE)).toBe('3 בדיקות רכב בחודש, 2 שיתופי רכב, בלי ממשק עסקי.');
  });

  it('leads with the business interface for a business account', () => {
    // ⚠️ For a business account on free, "בלי ממשק עסקי" is the most
    // consequential phrase on the screen. Last in the line is read last.
    expect(extrasLine(FREE, true).startsWith('בלי ממשק עסקי')).toBe(true);
    expect(extrasLine(P9, true).startsWith('בנוסף: ממשק עסקי')).toBe(true);
  });

  it('reads every number from the plan rather than assuming today\'s values', () => {
    expect(extrasLine({ ...P9, plateChecksPerMonth: 20 })).toBe('בנוסף: 20 בדיקות רכב בחודש, שיתופים ללא הגבלה, וממשק עסקי.');
    expect(extrasLine(null)).toBe('');
  });
});

// ── usage, and the badge it earns ───────────────────────────────────────

describe('usageMeter', () => {
  it('turns amber at 80% and not before', () => {
    expect(NEAR_FULL).toBe(0.8);
    expect(usageMeter(4, 5)).toEqual({ used: 4, limit: 5, pct: 80, near: true });
    expect(usageMeter(3, 5).near).toBe(false);
  });

  it('draws no bar against an unlimited cap', () => {
    expect(usageMeter(11, null)).toEqual({ used: 11, limit: null, pct: 0, near: false });
  });

  it('is null when the count is not known, so no meter is invented', () => {
    // ⚠️ Before my_document_usage() exists the documents count is null, and
    // "0 מתוך 5" would be a fabricated number.
    expect(usageMeter(null, 5)).toBeNull();
    expect(usageMeter(undefined, 5)).toBeNull();
  });

  it('caps the bar at 100% for a grandfathered account above its plan', () => {
    expect(usageMeter(17, 5).pct).toBe(100);
  });
});

describe('recommendPlan', () => {
  const rec = (vehicles, documents = null, current = FREE) =>
    recommendPlan(ALL, current, { vehicles, documents });

  it('follows the table in the UX doc, §2.5', () => {
    expect(rec(3)).toBeNull();        // 60%: under the threshold, no badge
    expect(rec(4)).toBe('p9');        // 4 of 15 on ₪9 is roomy
    expect(rec(12)).toBe('p19');      // 12 of 15 is already 80%, so ₪19
    expect(rec(35)).toBe('p49');      // only the unlimited plan fits
  });

  it('applies the headroom rule to the target, which was the first bug', () => {
    // "The cheapest plan whose cap exceeds usage" would say ₪9 for 12
    // vehicles, and then tell the same person to upgrade again a week later.
    expect(rec(12)).not.toBe('p9');
  });

  it('is driven by documents as well as vehicles', () => {
    expect(rec(1, 4)).toBe('p9');
    // 13 documents is 87% of ₪9's 15, so ₪9 is not roomy enough.
    expect(rec(1, 13)).toBe('p19');
  });

  it('treats an unknown document count as neither full nor blocking', () => {
    expect(rec(4, null)).toBe('p9');
    expect(rec(1, null)).toBeNull();
  });

  it('recommends upward only, and nothing to the top plan', () => {
    expect(rec(28, null, P19)).toBe('p49');
    expect(rec(1000, 1000, P49)).toBeNull();
  });

  it('says nothing without an account or a catalogue', () => {
    expect(recommendPlan(ALL, null, { vehicles: 5 })).toBeNull();
    expect(recommendPlan(undefined, FREE, { vehicles: 5 })).toBeNull();
    expect(recommendPlan(ALL, { ...FREE, code: 'retired' }, { vehicles: 5 })).toBeNull();
  });
});

describe('defaultOpenCode', () => {
  it('opens the recommendation when there is one', () => {
    expect(defaultOpenCode(ALL, 'free', 'p19')).toBe('p19');
  });

  it('otherwise opens the next step up', () => {
    expect(defaultOpenCode(ALL, 'free', null)).toBe('p9');
    expect(defaultOpenCode(ALL, 'p9', null)).toBe('p19');
  });

  it('opens its own row on the top plan, and the entry plan for a guest', () => {
    expect(defaultOpenCode(ALL, 'p49', null)).toBe('p49');
    expect(defaultOpenCode(ALL, null, null)).toBe('p9');
  });

  it('ignores a recommendation that is not in the catalogue', () => {
    expect(defaultOpenCode(ALL, 'free', 'p99')).toBe('p9');
    expect(defaultOpenCode([], 'free', null)).toBeNull();
  });
});

// ── the double-purchase guard ───────────────────────────────────────────

describe('actionKind', () => {
  const base = { isCurrent: false, isGuest: false, offering: true, storeManaged: false, isActive: false };

  it('NEVER offers a purchase to a subscriber on another plan', () => {
    // ⚠️ No replacement mode in our plugin: a second purchase is a second
    // live subscription and a second charge.
    let checked = 0;
    for (const plan of ALL) {
      for (const offering of [true, false]) {
        const kind = actionKind({ ...base, plan, offering, storeManaged: true });
        expect(kind, `${plan.code} offering=${offering}`).not.toBe('purchase');
        checked++;
      }
    }
    // Positive control: the loop really ran over every plan.
    expect(checked).toBe(8);
    // And the same inputs without a subscription do reach a purchase, so the
    // loop above is not passing on a function that never returns one.
    expect(actionKind({ ...base, plan: P19 })).toBe('purchase');
  });

  it('keeps the row being bought on PurchaseAction, even once it becomes current', () => {
    // ⚠️ Otherwise the success state is replaced mid-sentence the moment the
    // grant lands.
    expect(actionKind({ ...base, plan: P9, isCurrent: true, isActive: true })).toBe('purchase');
  });

  it('offers nothing to buy with purchase off, and nothing on the free plan', () => {
    expect(actionKind({ ...base, plan: P9, offering: false })).toBe('none');
    expect(actionKind({ ...base, plan: FREE })).toBe('none');
  });

  it('routes a guest to signing up and the account\'s own row to its note', () => {
    expect(actionKind({ ...base, plan: P9, isGuest: true })).toBe('guest');
    expect(actionKind({ ...base, plan: FREE, isCurrent: true })).toBe('current');
  });
});

describe('isStoreManaged', () => {
  const google = { source: 'iap_google' };

  it('is true for a live Google subscription', () => {
    expect(isStoreManaged(google, P9)).toBe(true);
  });

  it('is false once the subscription has lapsed, so the person can buy again', () => {
    // ⚠️ The row keeps source 'iap_google' after the period ends, while
    // account_plan() drops the account to free. Keyed on source alone, an
    // expired subscriber would be refused a purchase for ever.
    expect(isStoreManaged(google, FREE)).toBe(false);
  });

  it('is false for an admin grant or a grandfathered account on a paid plan', () => {
    expect(isStoreManaged({ source: 'admin_grant' }, P19)).toBe(false);
    expect(isStoreManaged({ source: 'grandfather' }, P9)).toBe(false);
    expect(isStoreManaged(null, P9)).toBe(false);
    expect(isStoreManaged(google, null)).toBe(false);
  });
});

describe('manageNote and currentNote', () => {
  it('never promises a switch that Play does not allow', () => {
    // ⚠️ Two earlier strings said plans could be switched in Google Play.
    // Play's subscription centre cannot move between products.
    for (const s of [manageNote(P19), manageNote(FREE), currentNote(P9, true)]) {
      expect(s).not.toContain('לעבור למסלול אחר');
      expect(s).not.toContain('מחושב ההפרש');
    }
    expect(manageNote(P19)).toContain('עדיין אי אפשר');
  });

  it('tells a subscriber going back to free that nothing ends early', () => {
    expect(manageNote(FREE)).toContain('עד סוף התקופה ששולמה');
  });

  it('mentions Google Play on the account\'s own row only for a store subscription', () => {
    expect(currentNote(P9, true)).toContain('Google Play');
    expect(currentNote(P9, false)).not.toContain('Google Play');
    expect(currentNote(FREE, true)).not.toContain('Google Play');
  });
});

describe('Ofek\'s rule: no copy says two plans are the same', () => {
  it('holds for every string the helpers can produce', () => {
    const strings = [
      ...ALL.flatMap((p) => [extrasLine(p), extrasLine(p, true), manageNote(p), currentNote(p, true), currentNote(p, false)]),
      ...ALL.flatMap((p) => COLUMNS.flatMap((k) => [cellValue(k, p), detailValue(k, p), deltaNote(k, p, FREE) || ''])),
      unavailableCopy('iap'), unavailableCopy('none'), unavailableCopy('web'),
    ];
    // Positive control: the list is not empty, so the loop proves something.
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings) {
      for (const word of FORBIDDEN) expect(s, s).not.toContain(word);
    }
  });
});

describe('the App Store, and the other phone', () => {
  const apple = { source: 'iap_apple' };

  it('treats a live Apple subscription as store-managed, so no second purchase is offered', () => {
    // The double-charge guard: keyed on Google alone, an Apple subscriber
    // opening the app on Android was handed Play's sheet on every row.
    expect(isStoreManaged(apple, P9)).toBe(true);
    expect(isStoreManaged(apple, FREE)).toBe(false);
  });

  it('names the store on its own phone and in a browser, and nothing on the other phone', () => {
    expect(noteVoice('apple', 'ios')).toBe('store');
    expect(noteVoice('google', 'android')).toBe('store');
    expect(noteVoice('apple', 'web')).toBe('store');
    expect(noteVoice('google', 'ios')).toBe('elsewhere');
    expect(noteVoice('apple', 'android')).toBe('elsewhere');
    expect(noteVoice('google', 'other')).toBe('elsewhere');
    expect(noteVoice(null, 'ios')).toBe('store');
  });

  it('tells an Apple subscriber that switching happens in the App Store', () => {
    expect(manageNote(P19, 'apple')).toMatch(/App Store/);
    expect(manageNote(P19, 'apple')).toMatch(/שדרוג מתחיל מיד/);
    expect(manageNote(FREE, 'apple')).toMatch(/עד סוף התקופה ששולמה/);
    expect(currentNote(P9, true, 'apple')).toMatch(/App Store/);
  });

  it('never names Google or Android in a note an iPhone can render (Guideline 2.3.10)', () => {
    for (const heldBy of ['google', 'apple']) {
      const voice = noteVoice(heldBy, 'ios');
      for (const p of ALL) {
        for (const text of [manageNote(p, heldBy, voice), currentNote(p, true, heldBy, voice)]) {
          expect(text, heldBy + '/' + p.code).not.toMatch(/google|play|android|גוגל|אנדרואיד/i);
        }
      }
    }
  });

  it('keeps every Android sentence byte-identical to before', () => {
    for (const p of ALL) {
      expect(manageNote(p, 'google', 'store')).toBe(manageNote(p));
      expect(currentNote(p, true, 'google', 'store')).toBe(currentNote(p, true));
    }
  });
});
