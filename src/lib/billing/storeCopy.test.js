/**
 * The store sentences. Two properties matter more than any wording:
 * Android's strings did not move when iOS arrived, and nothing an iPhone
 * can render names Google or Android (Guideline 2.3.10).
 */

import { describe, it, expect } from 'vitest';
import { storeCopy, ELSEWHERE, STORE } from './storeCopy';

const KEYS = [
  'name', 'catalogueFailed', 'sheetOpen', 'owned', 'failed', 'renewal', 'deferred',
  'manageButton', 'currentNote', 'toFreeNote', 'toPaidNote',
];

describe('storeCopy', () => {
  it('keeps every Google string exactly as it shipped before the App Store', () => {
    const g = storeCopy(STORE.GOOGLE);
    expect(g.catalogueFailed).toBe('לא הצלחנו לטעון את המסלולים מ-Google Play. אפשר לנסות שוב בעוד רגע, וכל מה שיש לך בחשבון ממשיך לעבוד כרגיל.');
    expect(g.sheetOpen).toBe('ממתין ל-Google Play');
    expect(g.owned).toBe('כבר יש לך מנוי פעיל בחשבון Google הזה. נשחזר אותו לחשבון שלך באפליקציה, בלי חיוב נוסף.');
    expect(g.failed).toBe('התשלום לא הושלם ולא חויבת. אפשר לנסות שוב או לבחור אמצעי תשלום אחר ב-Google Play.');
    expect(g.renewal).toBe('החיוב מתחדש אוטומטית. ניתן לבטל בכל עת דרך Google Play.');
    expect(g.manageButton).toBe('ניהול המנוי ב-Google Play');
    expect(g.currentNote).toBe('זה המסלול שלך. ביטול ושינוי אמצעי תשלום נעשים ב-Google Play.');
    expect(g.toFreeNote).toBe('כדי לחזור לחינם מבטלים את המנוי ב-Google Play. המסלול הנוכחי נשאר פעיל עד סוף התקופה ששולמה.');
    expect(g.toPaidNote).toBe('עדיין אי אפשר לעבור מסלול מתוך האפליקציה. מבטלים ב-Google Play, ובסוף התקופה ששולמה בוחרים כאן את המסלול החדש.');
  });

  it('treats a missing store as Google, which every older caller meant', () => {
    expect(storeCopy(undefined)).toBe(storeCopy(STORE.GOOGLE));
    expect(storeCopy(null)).toBe(storeCopy(STORE.GOOGLE));
  });

  it('gives both stores every sentence, so no screen can fall back to the wrong one', () => {
    for (const store of [STORE.GOOGLE, STORE.APPLE]) {
      for (const k of KEYS) expect(storeCopy(store)[k], `${store}.${k}`).toBeTruthy();
    }
  });

  it('never names Google or Android in an App Store sentence', () => {
    const a = storeCopy(STORE.APPLE);
    for (const k of KEYS) {
      expect(a[k], k).not.toMatch(/google|play|android|גוגל|אנדרואיד/i);
    }
    for (const s of Object.values(ELSEWHERE)) {
      expect(s).not.toMatch(/google|play|android|app store|apple|גוגל|אנדרואיד|אפל/i);
    }
  });

  it('promises a plan switch only where the store has one', () => {
    // Apple's subscriptions page switches plans in a group; Play's cannot.
    expect(storeCopy(STORE.APPLE).toPaidNote).toMatch(/שדרוג מתחיל מיד/);
    expect(storeCopy(STORE.GOOGLE).toPaidNote).toMatch(/עדיין אי אפשר/);
    // Apple's page has no payment method; Apple's current note must not
    // send people there for one.
    expect(storeCopy(STORE.APPLE).currentNote).not.toMatch(/אמצעי תשלום/);
  });

  it('carries Apple\'s 24-hour cancellation rule in the renewal disclosure', () => {
    expect(storeCopy(STORE.APPLE).renewal).toMatch(/24 שעות/);
  });

  it('says a deferred purchase was NOT charged, in both stores', () => {
    for (const store of [STORE.GOOGLE, STORE.APPLE]) {
      expect(storeCopy(store).deferred, store).toMatch(/לא חויבת/);
      expect(storeCopy(store).deferred, store).not.toMatch(/נקלט/);
    }
  });

  it('has no dash separators', () => {
    const all = [STORE.GOOGLE, STORE.APPLE].flatMap((st) => KEYS.map((k) => storeCopy(st)[k]))
      .concat(Object.values(ELSEWHERE));
    for (const s of all) {
      // The ב- / מ- / ל- joiner before a Latin store name is the one allowed hyphen.
      expect(s.replace(/[במל]-(?=[A-Za-z])/g, ''), s).not.toMatch(/[—–-]/);
    }
  });
});
