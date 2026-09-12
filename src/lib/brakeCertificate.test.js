import { describe, it, expect } from 'vitest';
import {
  requiresBrakeCertificate,
  BRAKE_CERT_AGE_YEARS,
} from '@/components/shared/DateStatusUtils';

/**
 * תקנה 273(ה), verified against the regulation 2026-09-10:
 *
 *   "המבקש חידוש רשיון לרכב מנועי בתום 15 שנה לאחר שנת ייצורו יציג לפני
 *    הבדיקה תעודה מאת מוסך מורשה, המאשרת כי מערכת הבלמים ... נבדקה או
 *    תוקנה ונמצאה במצב תקין תוך שלושה חדשים לפני מועד הבדיקה."
 *
 * The reminder used to be gated on "not a vessel" alone, so a 15-year-old
 * trailer was told to buy a certificate. A trailer has no engine, so it is
 * not a רכב מנועי and the obligation does not reach it. Sending an owner to
 * spend a few hundred shekels on a certificate they do not need is real
 * harm, and neither lint, types nor the build can see it: the old condition
 * was perfectly valid JavaScript.
 */

const YEAR = new Date().getFullYear();
const aged = (years) => YEAR - years;

describe('requiresBrakeCertificate — the regression', () => {
  it('does not fire for a trailer, whatever its age', () => {
    // The whole bug in one assertion. "רכב מנועי" excludes anything towed.
    expect(requiresBrakeCertificate('נגרר', aged(20))).toBe(false);
    expect(requiresBrakeCertificate('נגרר', aged(15))).toBe(false);
    // gov.il's detected type maps trailers to 'גרור', not 'נגרר'.
    expect(requiresBrakeCertificate('גרור', aged(30))).toBe(false);
  });

  it('does not fire for other towed or non-road equipment', () => {
    for (const type of ['מחרשה', 'קרוואן', 'גנרטור', 'רחפן', 'מטוס פרטי']) {
      expect(requiresBrakeCertificate(type, aged(25))).toBe(false);
    }
  });

  it('does not fire for vessels', () => {
    for (const type of ['מפרשית', 'סירה מנועית', 'אופנוע ים', 'סירת גומי']) {
      expect(requiresBrakeCertificate(type, aged(25))).toBe(false);
    }
  });

  it('does not fire for the צמ"ה regime or for collector vehicles', () => {
    // Engine-driven, but under their own cycles rather than תקנה 273(ה).
    // Listed explicitly so a future change is a decision, not an accident.
    for (const type of ['מלגזה', 'רכב צמ"ה', 'טרקטור', 'רכב אספנות']) {
      expect(requiresBrakeCertificate(type, aged(25))).toBe(false);
    }
  });
});

describe('requiresBrakeCertificate — what must still fire', () => {
  it('fires for motor vehicles that go through מבחן רישוי', () => {
    // Narrowing the gate must not silence the cars the rule is about.
    for (const type of ['רכב', 'רכב מסחרי', 'אופנוע כביש', 'קטנוע', 'משאית', 'אוטובוס', 'רכב תפעולי']) {
      expect(requiresBrakeCertificate(type, aged(15))).toBe(true);
    }
  });

  it('includes motorcycles, which ARE motor vehicles', () => {
    // The opposite of the trailer case, and easy to get wrong in the same
    // sweep: a motorcycle has an engine, so the obligation does reach it.
    expect(requiresBrakeCertificate('אופנוע כביש', aged(16))).toBe(true);
    expect(requiresBrakeCertificate('קטנוע', aged(16))).toBe(true);
  });
});

describe('requiresBrakeCertificate — the age boundary', () => {
  it('starts exactly at 15 years', () => {
    expect(BRAKE_CERT_AGE_YEARS).toBe(15);
    expect(requiresBrakeCertificate('רכב', aged(14))).toBe(false);
    expect(requiresBrakeCertificate('רכב', aged(15))).toBe(true);
    expect(requiresBrakeCertificate('רכב', aged(16))).toBe(true);
  });

  it('counts whole years, because the regulation does', () => {
    // "בתום 15 שנה לאחר שנת ייצורו" is year-granular in the law itself, so
    // a car made any time in (YEAR-15) qualifies for the whole of this year.
    // A date-precise calculation would be the WRONG one here.
    expect(requiresBrakeCertificate('רכב', String(aged(15)))).toBe(true);
  });

  it('stays silent when the year is missing or junk', () => {
    // No year means no age, and guessing would produce a false alarm.
    expect(requiresBrakeCertificate('רכב', null)).toBe(false);
    expect(requiresBrakeCertificate('רכב', undefined)).toBe(false);
    expect(requiresBrakeCertificate('רכב', '')).toBe(false);
  });

  it('stays silent for an unknown vehicle type', () => {
    // Allow-list, not deny-list: an unclassified type must not produce a
    // "go spend money" reminder just because it is old.
    expect(requiresBrakeCertificate('משהו חדש שלא מיפינו', aged(30))).toBe(false);
    expect(requiresBrakeCertificate(undefined, aged(30))).toBe(false);
  });
});
