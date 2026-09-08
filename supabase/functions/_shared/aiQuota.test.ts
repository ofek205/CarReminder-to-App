import { describe, it, expect } from 'vitest';
import { countsTowardAiQuota, EXEMPT_SCAN_SURFACES } from './aiQuota';

// The 11 values ai-proxy's ALLOWED_SURFACES accepts (index.ts:186-198).
// Anything else is sanitised to null before this function sees it.
const ALLOWED = [
  'chat_assistant',
  'community_reply',
  'vehicle_scan',
  'vessel_scan',
  'vehicle_inline_scan',
  'driver_license_scan',
  'expense_personal_scan',
  'expense_business_scan',
  'document_scan',
  'maintenance_log_scan',
  'plate_scan',
];

describe('countsTowardAiQuota', () => {
  it('exempts every document scan and the plate OCR', () => {
    for (const s of EXEMPT_SCAN_SURFACES) {
      expect(countsTowardAiQuota(s), s).toBe(false);
    }
  });

  it('counts exactly the two advisor surfaces out of the allowed set', () => {
    // ALLOWED_SURFACES minus the exemptions must be precisely the advisor
    // surfaces. If a new scan surface is added to ai-proxy and not to the
    // exemption list, this fails and names it.
    const counted = ALLOWED.filter((s) => countsTowardAiQuota(s));
    expect(counted.sort()).toEqual(['chat_assistant', 'community_reply']);
  });

  it('covers every allowed surface, so none is unclassified', () => {
    const exempt = ALLOWED.filter((s) => !countsTowardAiQuota(s));
    expect(exempt.length + 2).toBe(ALLOWED.length);
  });

  // ── the inversion that closes the hole ──────────────────────────────
  //
  // ai-proxy answers a request with an unrecognised surface and logs it as
  // NULL rather than refusing it. A quota built as "is this a chat
  // surface?" would therefore be bypassed by any nonsense value. Built as
  // "is it exempt?", the nonsense COUNTS and the bypass is worth nothing.

  it('counts a forged surface, so DevTools cannot buy a free call', () => {
    expect(countsTowardAiQuota('x')).toBe(true);
    expect(countsTowardAiQuota('not_a_real_surface')).toBe(true);
    expect(countsTowardAiQuota('')).toBe(true);
  });

  it('counts a missing surface, which is what the untagged paths send', () => {
    // PostCreateDialog's first expert reply and getVesselAdvice send no
    // feature and no surface. They must be charged without anyone
    // remembering to tag them.
    expect(countsTowardAiQuota(null)).toBe(true);
    expect(countsTowardAiQuota(undefined)).toBe(true);
  });

  it('counts a non-string, so a typed payload cannot slip through', () => {
    expect(countsTowardAiQuota(0)).toBe(true);
    expect(countsTowardAiQuota(false)).toBe(true);
    expect(countsTowardAiQuota({})).toBe(true);
    expect(countsTowardAiQuota(['vehicle_scan'])).toBe(true);
  });

  it('exempts only on an exact match', () => {
    // A near miss must count, never be free: a typo at a call site should
    // over-charge, not under-charge.
    expect(countsTowardAiQuota('vehicle_scanx')).toBe(true);
    expect(countsTowardAiQuota('Vehicle_Scan')).toBe(true);
    expect(countsTowardAiQuota(' vehicle_scan')).toBe(true);
    expect(countsTowardAiQuota('vehicle_scan ')).toBe(true);
  });

  it('keeps the list frozen so it cannot be widened at runtime', () => {
    expect(Object.isFrozen(EXEMPT_SCAN_SURFACES)).toBe(true);
  });
});
