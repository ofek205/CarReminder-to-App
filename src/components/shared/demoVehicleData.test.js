/**
 * Pins the demo data against the failure that actually happened.
 *
 * The dates here used to be literals authored in early 2026. By 2026-09-11 the
 * Corolla's test was 41 days past and its oil change 10, so the demo dashboard
 * opened on a red "דרושה התייחסות מיידית" block with "פג לפני 1 חודש". That is
 * not a guest-mode detail: the marketing site renders this exact screen inside
 * its live preview, so the first thing a visitor saw of the product was an alarm
 * about a car that does not exist, and it got worse every single day.
 *
 * The dates are now computed from today. That fix is invisible: nothing errors,
 * no test fails, and it decays silently back into the same state the moment
 * someone pastes a literal date in. Hence this file.
 *
 * It deliberately asserts against the real clock rather than a frozen one. A
 * frozen clock would prove the arithmetic and miss the entire point, which is
 * that the data must be correct on whatever day it happens to run.
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_VEHICLE, DEMO_VESSEL, DEMO_VEHICLE_ID, DEMO_VESSEL_ID,
  DEMO_TREATMENTS, DEMO_REMINDERS, DEMO_DOCUMENTS, DEMO_VESSEL_TREATMENTS,
} from './demoVehicleData';

const today = () => new Date(new Date().toISOString().slice(0, 10));
const daysFromNow = (iso) => Math.round((new Date(iso) - today()) / 86400000);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('demo dates move with the calendar', () => {
  // The exact fields that drove the red alarm.
  it('never shows the demo car as overdue', () => {
    expect(daysFromNow(DEMO_VEHICLE.test_due_date)).toBeGreaterThan(0);
    expect(daysFromNow(DEMO_VEHICLE.insurance_due_date)).toBeGreaterThan(0);
  });

  it('never shows the demo vessel as overdue, including its safety equipment', () => {
    for (const field of [
      'test_due_date', 'insurance_due_date',
      'pyrotechnics_expiry_date', 'fire_extinguisher_expiry_date', 'life_raft_expiry_date',
    ]) {
      expect(daysFromNow(DEMO_VESSEL[field]), `${field} must be in the future`).toBeGreaterThan(0);
    }
  });

  it('keeps enough runway that the screen reads as calm, not merely valid', () => {
    // A date one day out is technically "not overdue" and still renders as an
    // urgent red reminder, which is the thing being prevented.
    expect(daysFromNow(DEMO_VEHICLE.test_due_date)).toBeGreaterThan(30);
    expect(daysFromNow(DEMO_VESSEL.test_due_date)).toBeGreaterThan(30);
  });

  it('keeps completed work in the past and upcoming work in the future', () => {
    for (const t of [...DEMO_TREATMENTS, ...DEMO_VESSEL_TREATMENTS]) {
      if (t.status === 'completed') expect(daysFromNow(t.date), `${t.title} is done`).toBeLessThan(0);
      if (t.status === 'upcoming') expect(daysFromNow(t.date), `${t.title} is upcoming`).toBeGreaterThan(0);
    }
  });

  it('keeps the last shipyard visit in the past', () => {
    expect(daysFromNow(DEMO_VESSEL.last_shipyard_date)).toBeLessThan(0);
  });
});

describe('the demo screen does not contradict itself', () => {
  // The dashboard shows the vehicle's own fields AND a reminders list built
  // separately. If those drift apart the screen argues with itself, which is
  // worse than either value being wrong.
  it('mirrors the vehicle dates in the reminders list', () => {
    const by = (type) => DEMO_REMINDERS.find((r) => r.type === type)?.date;
    expect(by('insurance')).toBe(DEMO_VEHICLE.insurance_due_date);
    expect(by('test')).toBe(DEMO_VEHICLE.test_due_date);
  });

  it('expires the insurance document with the cover it documents', () => {
    const policy = DEMO_DOCUMENTS.find((d) => d.document_type === 'ביטוח חובה');
    expect(policy.expiry_date).toBe(DEMO_VEHICLE.insurance_due_date);
  });
});

describe('what must NOT be relative', () => {
  it('leaves the first registration date fixed to the model year', () => {
    // This is a fact about a 2016 car, not a schedule. Making it relative would
    // have made the car's age contradict the year printed beside it.
    expect(DEMO_VEHICLE.first_registration_date).toBe('2016-03-15');
    expect(DEMO_VEHICLE.year).toBe(2016);
  });

  it('keeps the ids stable', () => {
    // demoScreens.js duplicates these two strings on purpose and its own test
    // pins the pair; this is the other half of that contract.
    expect(DEMO_VEHICLE_ID).toBe('demo_vehicle_001');
    expect(DEMO_VESSEL_ID).toBe('demo_vessel_001');
    expect(DEMO_VEHICLE.id).toBe(DEMO_VEHICLE_ID);
    expect(DEMO_VESSEL.id).toBe(DEMO_VESSEL_ID);
  });
});

describe('shape', () => {
  it('emits well-formed dates, never undefined', () => {
    const records = [DEMO_VEHICLE, DEMO_VESSEL, ...DEMO_TREATMENTS, ...DEMO_REMINDERS,
      ...DEMO_DOCUMENTS, ...DEMO_VESSEL_TREATMENTS];
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        if (!/date$/.test(key) || typeof value !== 'string') continue;
        if (value.includes('T')) continue; // created_date timestamps stay as-is
        expect(value, `${record.id || 'record'}.${key}`).toMatch(ISO_DATE);
      }
    }
  });

  it('still carries both demo vehicles with their demo flag', () => {
    // The flag is what the guest dashboard keys its "these are samples" notice
    // on. Losing it would silently turn demo data into apparent real data.
    expect(DEMO_VEHICLE._isDemo).toBe(true);
    expect(DEMO_VESSEL._isDemo).toBe(true);
  });
});
