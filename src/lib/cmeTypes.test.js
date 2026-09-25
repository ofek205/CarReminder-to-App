import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import { CME_EXACT, getVehicleCategory } from '@/lib/designTokens';
import {
  CME_TYPES, CME_LICENCE_WORD, isCme, usesHours, usesKm, getVehicleLabels,
} from '@/components/shared/DateStatusUtils';
import { calcAllReminders } from '@/components/shared/ReminderEngine';

/**
 * Which vehicle types are צמ"ה used to be written out three times in the app
 * (designTokens.js, Vehicles.jsx, DateStatusUtils.jsx), and once more on the
 * server. On 2026-09-24 a fleet query found 9 vehicles whose type none of the
 * app's copies knew: 'כלי צמ"ה' (the category name itself, saved as the
 * type) and two roller labels that never came from the type picker. They
 * showed as ordinary cars, measured in km.
 *
 * The server had already been taught them the same day, for the ministry
 * sync, so the app and the server disagreed about the same vehicles. The app
 * now has one list, and this file fails if the app and the server drift.
 */

const FOUND_ON_REAL_VEHICLES = ['כלי צמ"ה', 'מכבש גלילי ממונע', 'מכבש גליל ידני'];

describe('the three labels found on real vehicles', () => {
  it.each(FOUND_ON_REAL_VEHICLES)('%s is צמ"ה everywhere in the app', (type) => {
    expect(getVehicleCategory(type)).toBe('cme');  // tab, icon, colours
    expect(isCme(type)).toBe(true);                 // labels, form mode
    expect(usesHours(type)).toBe(true);             // engine hours, not km
    expect(usesKm(type)).toBe(false);
  });
});

describe('one list, not three', () => {
  it('CME_TYPES is CME_EXACT plus tractors, and nothing else', () => {
    expect(CME_TYPES).toEqual(new Set([...CME_EXACT, 'טרקטור', 'מחרשה']));
  });

  it('tractors still count as צמ"ה for labels but stay on the special tab', () => {
    expect(isCme('טרקטור')).toBe(true);
    expect(getVehicleCategory('טרקטור')).toBe('special');
  });

  it('an ordinary car is untouched', () => {
    expect(getVehicleCategory('רכב')).toBe('car');
    expect(isCme('רכב')).toBe(false);
    expect(usesKm('רכב')).toBe(true);
  });
});

describe('the server agrees with the app', () => {
  // The Edge Function and the SQL can't import from src/, so they carry their
  // own copies. Read them as text and compare.
  const read = (p) => fs.readFileSync(path.resolve(cwd(), p), 'utf8');
  const quoted = (block) => new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));

  it('gov-sync-vehicles routes exactly these types to the צמ"ה registry', () => {
    const src = read('supabase/functions/gov-sync-vehicles/index.ts');
    const block = /const CME_VEHICLE_TYPES = new Set\(\[([\s\S]*?)\]\);/.exec(src);
    expect(block).not.toBeNull();
    expect(quoted(block[1])).toEqual(CME_TYPES);
  });

  it('record_gov_sync_update says "תוקף הרישוי" for exactly these types', () => {
    const sql = read('supabase-gov-sync-cme-2026-09-24.sql');
    const block = /any \(array\[([\s\S]*?)\]::text\[\]\)/.exec(sql);
    expect(block).not.toBeNull();
    expect(quoted(block[1])).toEqual(CME_TYPES);
  });
});

/**
 * צמ"ה has an annual licence, not a test. From 2026-09-25 (Ofek's call) a
 * צמ"ה vehicle says "תוקף רישוי" wherever a car says "טסט", matching the
 * ministry-sync push, which already said "תוקף הרישוי". These pin the text
 * the owner actually reads, from the reminder engine itself.
 */
describe('a צמ"ה vehicle says "תוקף רישוי", not "טסט"', () => {
  const inDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const testReminder = (vehicle_type, days) =>
    calcAllReminders({ vehicles: [{ id: 'v1', vehicle_type, nickname: 'x', test_due_date: inDays(days) }] })
      .find((i) => i.id === 'test-v1');

  it('the label word', () => {
    expect(CME_LICENCE_WORD).toBe('תוקף רישוי');
    expect(getVehicleLabels('מלגזה').testWord).toBe('תוקף רישוי');
    expect(getVehicleLabels('כלי צמ"ה').testWord).toBe('תוקף רישוי');
  });

  it('an upcoming reminder', () => {
    const item = testReminder('מלגזה', 5);
    expect(item.type).toBe('test');           // still a test reminder underneath
    expect(item.typeName).toBe('תוקף רישוי');
    expect(item.label.startsWith('תוקף רישוי ')).toBe(true);
  });

  it('an overdue reminder reads "תוקף רישוי פג ..."', () => {
    expect(testReminder('טליהנדלר', -3).label.startsWith('תוקף רישוי פג')).toBe(true);
  });

  it('a car and a boat keep their words', () => {
    expect(getVehicleLabels('רכב').testWord).toBe('טסט');
    expect(testReminder('רכב', 5).typeName).toBe('טסט');
    expect(getVehicleLabels('סירה מנועית').testWord).toBe('כושר שייט');
  });
});
