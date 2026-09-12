import { describe, it, expect } from 'vitest';
import {
  REPAIR_TYPE,
  splitByType,
  buildIdentity,
  collectVehicleHistory,
} from './collectVehicleHistory';

const vehicle = {
  license_plate: '12-345-67',
  manufacturer:  'טויוטה',
  model:         'קורולה',
  year:          2019,
  current_km:    84000,
  nickname:      'האוטו של אמא',
};

const logs = [
  { type: 'טיפול גדול', title: 'טיפול 80,000',  date: '2026-03-15', cost: 1200, km_at_service: 80000, garage_name: 'מוסך רון' },
  { type: REPAIR_TYPE,  title: 'החלפת מצמד',    date: '2026-01-02', cost: 3400, km_at_service: 76000 },
  { type: 'טיפול קטן',  title: 'החלפת שמן',     date: '2026-06-01', cost: 450 },
];

describe('splitByType', () => {
  it('treats only תיקון as a repair, everything else is a service', () => {
    const { services, repairs } = splitByType(logs);
    expect(repairs).toHaveLength(1);
    expect(services).toHaveLength(2);
    expect(repairs[0].title).toBe('החלפת מצמד');
  });

  it('tolerates null, undefined and holes in the list', () => {
    expect(splitByType(null)).toEqual({ services: [], repairs: [] });
    expect(splitByType(undefined)).toEqual({ services: [], repairs: [] });
    expect(splitByType([null, undefined]).services).toHaveLength(0);
  });
});

describe('buildIdentity', () => {
  it('carries the fields a reader needs to know whose car this is', () => {
    const id = buildIdentity(vehicle, { now: new Date('2026-09-11T10:00:00Z') });
    expect(id.plate).toBe('12-345-67');
    expect(id.manufacturer).toBe('טויוטה');
    expect(id.year).toBe(2019);
    expect(id.currentKm).toBe(84000);
    expect(id.exportedAt).toBe('2026-09-11');
  });

  it('returns null for no vehicle rather than an object of empty strings', () => {
    expect(buildIdentity(null)).toBeNull();
  });

  it('does not turn a missing year into 0 or an empty string', () => {
    expect(buildIdentity({}).year).toBeNull();
    expect(buildIdentity({}).currentKm).toBeNull();
  });
});

describe('collectVehicleHistory', () => {
  it('sorts newest first within each section', () => {
    const out = collectVehicleHistory({ vehicle, logs });
    expect(out.services.map(s => s.date)).toEqual(['2026-06-01', '2026-03-15']);
  });

  it('keeps undated rows instead of dropping them, at the bottom', () => {
    // The regression this guards: an undated service silently vanishing from
    // a file the user is about to hand to a buyer. Invisible on both sides.
    const out = collectVehicleHistory({
      vehicle,
      logs: [{ type: 'טיפול קטן', title: 'ללא תאריך' }, ...logs],
    });
    expect(out.services).toHaveLength(3);
    expect(out.services.at(-1).title).toBe('ללא תאריך');
  });

  it('counts each section and reports emptiness across ALL of them', () => {
    const out = collectVehicleHistory({ vehicle, logs, accidents: [{ date: '2025-01-01' }] });
    expect(out.counts).toEqual({ services: 2, repairs: 1, accidents: 1 });
    expect(out.isEmpty).toBe(false);
  });

  it('is empty only when every section is empty', () => {
    expect(collectVehicleHistory({ vehicle }).isEmpty).toBe(true);
    expect(collectVehicleHistory({ vehicle, logs: [] , accidents: [] }).isEmpty).toBe(true);
    // One accident and nothing else is still a history worth sending.
    expect(collectVehicleHistory({ vehicle, accidents: [{ date: '2025-01-01' }] }).isEmpty).toBe(false);
  });

  it('never carries a third party’s phone number into an exported file', () => {
    const out = collectVehicleHistory({
      vehicle,
      accidents: [{ date: '2025-01-01', other_driver_name: 'דני', other_driver_phone: '050-1234567' }],
    });
    const serialised = JSON.stringify(out.accidents);
    expect(serialised).not.toContain('050-1234567');
    expect(serialised).not.toContain('phone');
    expect(out.accidents[0].otherName).toBe('דני');
  });

  it('does not mutate the caller’s arrays', () => {
    const input = logs.slice();
    collectVehicleHistory({ vehicle, logs: input });
    expect(input).toEqual(logs);
  });
});
