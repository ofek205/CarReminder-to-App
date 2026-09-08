import { describe, it, expect } from 'vitest';
import {
  limitText, describeOverrides, exceptionUrgency, daysUntil, isOverCap, summarise, toWireOverride, endOfDayIso,
} from './planExceptions';

const DAY = 86_400_000;
const NOW = new Date('2026-09-08T12:00:00Z').getTime();

const row = (over = {}) => ({
  account_id: 'a1',
  account_name: 'חשבון',
  account_type: 'personal',
  base_plan: 'p9',
  effective_plan: 'p9',
  source: 'admin_grant',
  status: 'active',
  vehicle_count: 3,
  eff_max_vehicles: 10,
  ovr_max_vehicles: null,
  ovr_ai_daily_cap: null,
  ovr_ai_lifetime_teaser: null,
  ovr_plate_checks_per_month: null,
  ovr_max_shares: null,
  ovr_business_ui: null,
  ovr_note: 'פיילוט',
  ovr_expires_at: null,
  ...over,
});

const P9 = { plan: 'p9', max_vehicles: 10, ai_daily_cap: 50, ai_lifetime_teaser: null,
  plate_checks_per_month: null, max_shares: null, business_ui: true };

describe('limitText', () => {
  it('renders a plain number', () => {
    expect(limitText(15)).toBe('15');
    expect(limitText(0)).toBe('0');
  });

  // ── the two conventions that meet here ──────────────────────────────
  //
  // plan_limits: NULL = unlimited. Override columns: -1 = unlimited.
  // Both have to read as "unlimited" and neither may ever surface raw.

  it('reads NULL as unlimited (the plan_limits convention)', () => {
    expect(limitText(null)).toBe('ללא הגבלה');
    expect(limitText(undefined)).toBe('ללא הגבלה');
  });

  it('reads -1 as unlimited (the override convention)', () => {
    expect(limitText(-1)).toBe('ללא הגבלה');
  });

  it('never leaks the raw sentinel to a human', () => {
    expect(limitText(-1)).not.toBe('-1');
    expect(limitText(-1)).not.toContain('-1');
  });
});

describe('describeOverrides', () => {
  it('lists only what is actually overridden', () => {
    const out = describeOverrides(row({ ovr_max_vehicles: 15 }), P9);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: 'כלי תחבורה', now: '15', was: '10' });
  });

  it('shows an override to unlimited against a finite plan value', () => {
    const out = describeOverrides(row({ ovr_max_vehicles: -1 }), P9);
    expect(out[0].now).toBe('ללא הגבלה');
    expect(out[0].was).toBe('10');
  });

  // ── falsy overrides are real overrides ──────────────────────────────
  //
  // A truthiness test would drop both of these, and silently: the screen
  // would show no deviation for an account that has been capped at zero
  // vehicles or had the business UI switched off.

  it('treats 0 as a real override, not as absent', () => {
    const out = describeOverrides(row({ ovr_max_vehicles: 0 }), P9);
    expect(out).toHaveLength(1);
    expect(out[0].now).toBe('0');
  });

  it('treats false as a real override, not as absent', () => {
    const out = describeOverrides(row({ ovr_business_ui: false }), P9);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: 'ממשק עסקי', now: 'לא כלול', was: 'כלול' });
  });

  it('lists nothing when nothing is overridden', () => {
    expect(describeOverrides(row(), P9)).toEqual([]);
  });

  it('survives a missing base plan without inventing a "was"', () => {
    const out = describeOverrides(row({ ovr_max_vehicles: 15 }), null);
    expect(out[0].now).toBe('15');
    expect(out[0].was).toBeNull();
  });

  it('does not throw on a missing row', () => {
    expect(describeOverrides(null, P9)).toEqual([]);
  });
});

describe('exceptionUrgency', () => {
  it('flags no expiry as "never", the case that leaks', () => {
    expect(exceptionUrgency(row({ ovr_expires_at: null }), NOW)).toBe('never');
  });

  it('flags a passed window as expired', () => {
    expect(exceptionUrgency(row({ ovr_expires_at: '2026-09-01T00:00:00Z' }), NOW)).toBe('expired');
  });

  it('flags the next week as "soon"', () => {
    expect(exceptionUrgency(row({ ovr_expires_at: new Date(NOW + 3 * DAY).toISOString() }), NOW)).toBe('soon');
    expect(exceptionUrgency(row({ ovr_expires_at: new Date(NOW + 8 * DAY).toISOString() }), NOW)).toBe('active');
  });

  it('treats an unparseable date as "never" rather than in force', () => {
    // Safe direction: surface it as needing attention instead of quietly
    // claiming it is fine.
    expect(exceptionUrgency(row({ ovr_expires_at: 'garbage' }), NOW)).toBe('never');
  });
});

describe('daysUntil', () => {
  it('rounds up so a partial last day still counts', () => {
    expect(daysUntil(new Date(NOW + 2 * 3600_000).toISOString(), NOW)).toBe(1);
    expect(daysUntil(new Date(NOW + 30 * DAY).toISOString(), NOW)).toBe(30);
  });

  it('is null for a passed or missing date, never 0', () => {
    expect(daysUntil(new Date(NOW - DAY).toISOString(), NOW)).toBeNull();
    expect(daysUntil(null, NOW)).toBeNull();
  });
});

describe('isOverCap', () => {
  it('is true only when the count genuinely exceeds a real cap', () => {
    expect(isOverCap(row({ vehicle_count: 22, eff_max_vehicles: 15 }))).toBe(true);
    expect(isOverCap(row({ vehicle_count: 15, eff_max_vehicles: 15 }))).toBe(false);
  });

  it('is false for an unlimited cap', () => {
    // "Over unlimited" is not a state.
    expect(isOverCap(row({ vehicle_count: 900, eff_max_vehicles: null }))).toBe(false);
  });

  it('is false when the count is unusable', () => {
    expect(isOverCap(row({ vehicle_count: null, eff_max_vehicles: 5 }))).toBe(false);
  });
});

describe('summarise', () => {
  it('counts each urgency bucket and the over-cap accounts', () => {
    const s = summarise([
      row({ ovr_expires_at: null }),
      row({ ovr_expires_at: null }),
      row({ ovr_expires_at: '2026-09-01T00:00:00Z' }),
      row({ ovr_expires_at: new Date(NOW + 3 * DAY).toISOString(), vehicle_count: 22, eff_max_vehicles: 15 }),
    ]);
    expect(s.total).toBe(4);
    expect(s.never).toBe(2);
    expect(s.expired).toBe(1);
    expect(s.overCap).toBe(1);
  });

  it('returns zeroes for a missing list rather than throwing', () => {
    expect(summarise(null).total).toBe(0);
    expect(summarise(undefined).never).toBe(0);
  });
});

describe('toWireOverride', () => {
  it('sends -1 only for a deliberate unlimited choice', () => {
    expect(toWireOverride({ unlimited: true })).toBe(-1);
    expect(toWireOverride({ unlimited: true, value: '7' })).toBe(-1);
  });

  it('passes a plain count through', () => {
    expect(toWireOverride({ value: '15' })).toBe(15);
    expect(toWireOverride({ value: 15 })).toBe(15);
    expect(toWireOverride({ value: '0' })).toBe(0);   // a real limit of zero
  });

  it('returns null for an empty field, meaning inherit', () => {
    expect(toWireOverride({ value: '' })).toBeNull();
    expect(toWireOverride({})).toBeNull();
    expect(toWireOverride(null)).toBeNull();
  });

  // ── the sentinel must never be reachable by typing ──────────────────
  //
  // -1 exists because NULL means "unlimited" in plan_limits and "inherit"
  // in the override columns. Letting a human type it means a stray minus
  // silently converts a limit of 1 into no limit at all.

  it('refuses a typed negative rather than treating it as unlimited', () => {
    expect(() => toWireOverride({ value: '-1' })).toThrow();
    expect(() => toWireOverride({ value: -5 })).toThrow();
  });

  it('refuses a non-integer', () => {
    expect(() => toWireOverride({ value: '1.5' })).toThrow();
    expect(() => toWireOverride({ value: 'abc' })).toThrow();
  });
});

describe('endOfDayIso', () => {
  it('is null for an empty or invalid date', () => {
    expect(endOfDayIso('')).toBeNull();
    expect(endOfDayIso(null)).toBeNull();
    expect(endOfDayIso('not-a-date')).toBeNull();
  });

  // ── the off-by-one that would shorten every grant ───────────────────
  //
  // new Date('2026-12-31') is UTC midnight. In Israel (UTC+2/+3) that is
  // 02:00 or 03:00 ON the 31st, so an exception granted "until 31 December"
  // would lapse that morning. And picking TODAY would already be in the
  // past, which the RPC refuses outright.

  it('lands at the END of the chosen local day, not its start', () => {
    const iso = endOfDayIso('2026-12-31');
    const naiveStart = new Date('2026-12-31').getTime();
    expect(new Date(iso).getTime()).toBeGreaterThan(naiveStart);
  });

  it('keeps the chosen day in local time', () => {
    const d = new Date(endOfDayIso('2026-12-31'));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
    expect(d.getHours()).toBe(23);
  });

  it('makes today a usable expiry rather than an instant rejection', () => {
    const today = new Date();
    const ymd = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    expect(new Date(endOfDayIso(ymd)).getTime()).toBeGreaterThan(Date.now());
  });
});
