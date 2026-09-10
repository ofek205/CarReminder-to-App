import { describe, it, expect } from 'vitest';
import { getTestPolicy } from '@/components/shared/DateStatusUtils';

/**
 * Reported by a real user 2026-09-10, about a 23-year-old car:
 *
 *   "באפליקציה שהבן שלך פיתח מופיע לרכב מעל 20 שנה להמציא אישור בלמים.
 *    רכב מעל 20 שנה דורש אישור רכב מיושן. כדאי שיתקנו את הבאג הזה."
 *
 * The reminder was NOT wrong. Verified against the regulations the same
 * day: "ברכב שגילו מעל 15 שנה, חובה להביא אישור בלמים ממוסך מורשה" and
 * "ברכב שגילו מעל 20 שנה, חובה להציג אישור בלמים + אישור רכב מיושן". The
 * two are cumulative, and they cover different systems: the brake
 * certificate covers the brake system, the מיושן certificate covers
 * service brakes, auxiliary brakes AND steering.
 *
 * What WAS wrong is that the app named one of the two and stayed silent
 * about the other, and its own copy read 'אישור רכב מיושן (בלמים והיגוי)',
 * whose parenthetical made the מיושן certificate look like it already
 * included the brakes. That is the reasoning the user followed, and it is
 * the reasoning the app taught them. An owner who brings one of the two
 * is turned away at the test, so the incomplete wording had a real cost.
 */

const YEAR = new Date().getFullYear();
const car = (age) => getTestPolicy({ vehicle_type: 'רכב', year: YEAR - age });

describe('an aged vehicle owes BOTH certificates', () => {
  it('lists two documents, not one', () => {
    const docs = car(23).requiredDocs;
    expect(docs).toHaveLength(2);
  });

  it('names the brake certificate', () => {
    expect(car(23).requiredDocs.join(' | ')).toContain('בלמים');
  });

  it('names the מיושן certificate and what it actually covers', () => {
    const docs = car(23).requiredDocs.join(' | ');
    expect(docs).toContain('רכב מיושן');
    expect(docs).toContain('היגוי');
  });

  it('no longer implies the מיושן certificate covers the brakes', () => {
    // The exact old string, which is what caused the report. If it ever
    // comes back, this fails.
    const docs = car(23).requiredDocs.join(' | ');
    expect(docs).not.toContain('אישור רכב מיושן (בלמים והיגוי)');
  });

  it('still tests twice a year', () => {
    expect(car(23).frequencyMonths).toBe(6);
    expect(car(23).category).toBe('aging');
  });
});

describe('the boundary between the two regimes', () => {
  it('a 15-to-18 year old car owes the brake certificate and is not yet מיושן', () => {
    expect(car(16).category).not.toBe('aging');
    expect(car(16).frequencyMonths).toBe(12);
  });

  it('מיושן starts at 19, not at 20', () => {
    // Consumer guides round to "20". The regulation says nineteen, and the
    // app follows the regulation.
    expect(car(18).category).not.toBe('aging');
    expect(car(19).category).toBe('aging');
  });
});
