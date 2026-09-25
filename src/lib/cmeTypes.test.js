import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import { CME_EXACT, getVehicleCategory } from '@/lib/designTokens';
import { CME_TYPES, isCme, usesHours, usesKm } from '@/components/shared/DateStatusUtils';

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
