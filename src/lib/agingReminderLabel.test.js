import { describe, it, expect } from 'vitest';
import { calcAllReminders } from '@/components/shared/ReminderEngine';

/**
 * End-to-end cover for the 2026-09-10 user report. The tests in
 * agingVehicleDocs.test.js pin the policy layer; this one pins the text
 * the user actually sees, because the report was about the wording and a
 * correct policy behind a misleading sentence would not have helped.
 */

const YEAR = new Date().getFullYear();
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const vehicleAged = (age) => ({
  id: `v-${age}`,
  vehicle_type: 'רכב',
  nickname: 'הרכב שלי',
  year: YEAR - age,
  test_due_date: inDays(30),
});

const brakeItem = (age) =>
  calcAllReminders({ vehicles: [vehicleAged(age)] }).find(i => i.id === `brakes-v-${age}`);

describe('the reminder a 23-year-old car actually shows', () => {
  const item = brakeItem(23);

  it('still fires — the user was wrong that it should not', () => {
    expect(item).toBeTruthy();
  });

  it('says there are TWO certificates', () => {
    // The single missing fact behind the whole report.
    expect(item.label).toContain('שני אישורים');
  });

  it('names both of them', () => {
    expect(item.label).toContain('בלמים');
    expect(item.label).toContain('רכב מיושן');
  });

  it('front-loads the count so it survives one-line truncation', () => {
    // NotificationBell renders this with `truncate`. If the count ever
    // drifts past the first ~40 characters it is invisible where most
    // people see it.
    expect(item.label.indexOf('שני אישורים')).toBeLessThan(40);
  });

  it('no longer calls a 23-year-old car merely "ותיק"', () => {
    expect(item.label).toContain('מיושן');
  });
});

describe('a 16-year-old car is unchanged', () => {
  const item = brakeItem(16);

  it('still asks for the brake certificate only', () => {
    expect(item).toBeTruthy();
    expect(item.label).toContain('אישור בלמים');
    expect(item.label).not.toContain('שני אישורים');
    expect(item.typeName).toBe('בלמים');
  });
});
