import { describe, it, expect } from 'vitest';
import { getTestPolicy } from '@/components/shared/DateStatusUtils';

/**
 * תקנה 273ב and תקנה 273ד, added 2026-09-10 after verifying both against
 * the regulations.
 *
 *   273ב  brakes at an authorised garage every SIX months, two certificates
 *         at licence renewal. Buses, taxis, tour vehicles and טיולית at ANY
 *         weight, plus commercial vehicles from 16,000 kg.
 *   273ד  winter inspection, cannot drive 1 Nov – 31 Mar without it.
 *         Commercial over 10,000 kg, minibuses and other buses.
 *
 * The trap these tests exist for: the two rules use DIFFERENT weight
 * thresholds (10t vs 16t), and neither is weight-gated for a bus. Reading
 * one and assuming the other follows is the natural mistake, and the app
 * had exactly that shape before — winter inspection was gated to 'משאית'
 * alone, so buses were silently exempt from a rule that covers them.
 */

const truck = (kg) => getTestPolicy({ vehicle_type: 'משאית', total_weight: `${kg} ק"ג`, year: 2020 });
const bus   = (extra = {}) => getTestPolicy({ vehicle_type: 'אוטובוס', year: 2020, ...extra });

describe('תקנה 273ד — winter inspection', () => {
  it('covers a bus at any weight, including none recorded', () => {
    // The regression this fixes: the flag used to require type 'משאית'.
    expect(bus().winterInspection).toBe(true);
    expect(bus({ total_weight: '4000 ק"ג' }).winterInspection).toBe(true);
  });

  it('covers a truck only above 10 tonnes', () => {
    expect(truck(9000).winterInspection).toBe(false);
    expect(truck(10000).winterInspection).toBe(false); // "עולה על", strictly above
    expect(truck(12000).winterInspection).toBe(true);
  });
});

describe('תקנה 273ב — brakes every six months', () => {
  it('covers a bus at any weight', () => {
    expect(bus().brakeInspection6m).toBe(true);
    expect(bus({ total_weight: '4000 ק"ג' }).brakeInspection6m).toBe(true);
  });

  it('covers a truck only from 16 tonnes, not from 10', () => {
    // The whole point of keeping the thresholds apart.
    expect(truck(12000).brakeInspection6m).toBe(false);
    expect(truck(15999).brakeInspection6m).toBe(false);
    expect(truck(16000).brakeInspection6m).toBe(true);
    expect(truck(24000).brakeInspection6m).toBe(true);
  });

  it('leaves a 12-tonner owing winter but NOT the brake rule', () => {
    // A truck between the two thresholds is the case most likely to be got
    // wrong, in either direction.
    const p = truck(12000);
    expect(p.winterInspection).toBe(true);
    expect(p.brakeInspection6m).toBe(false);
  });

  it('does not reach private cars or motorcycles', () => {
    for (const t of ['רכב', 'אופנוע כביש', 'קטנוע', 'נגרר', 'רכב אספנות']) {
      expect(getTestPolicy({ vehicle_type: t, year: 2005 }).brakeInspection6m).toBeFalsy();
    }
  });
});

describe('required documents follow the flags', () => {
  it('lists both certificates for a 16-tonner', () => {
    const docs = truck(16000).requiredDocs.join(' | ');
    expect(docs).toContain('בדיקת חורף');
    expect(docs).toContain('בלמים');
  });

  it('lists winter but not brakes for a 12-tonner', () => {
    const docs = truck(12000).requiredDocs.join(' | ');
    expect(docs).toContain('בדיקת חורף');
    expect(docs).not.toContain('בלמים');
  });

  it('lists neither for a light truck', () => {
    const docs = truck(8000).requiredDocs.join(' | ');
    expect(docs).not.toContain('בדיקת חורף');
    expect(docs).not.toContain('בלמים');
  });

  it('lists both for a bus, plus its licence test', () => {
    const docs = bus().requiredDocs.join(' | ');
    expect(docs).toContain('בדיקת רישוי');
    expect(docs).toContain('בלמים');
    expect(docs).toContain('בדיקת חורף');
  });
});

describe('the bus aging rule was already correct', () => {
  it('tests twice a year from 15 years, not 19', () => {
    // Checked rather than assumed: the aging gate excludes buses because
    // this branch already handles them, not because they were forgotten.
    const y = new Date().getFullYear();
    expect(bus({ year: y - 14 }).frequencyMonths).toBe(12);
    expect(bus({ year: y - 15 }).frequencyMonths).toBe(6);
  });
});
