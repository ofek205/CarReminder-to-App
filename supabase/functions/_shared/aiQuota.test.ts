import { describe, it, expect } from 'vitest';
import {
  countsTowardAiQuota,
  EXEMPT_SCAN_SURFACES,
  aiQuotaFeature,
  NON_TEASER_SURFACES,
  FEATURE_ADVISOR,
  FEATURE_FORUM,
} from './aiQuota';

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

  it('counts a missing surface, which is what the untagged path sends', () => {
    // getVesselAdvice sends no feature and no surface. It must be charged
    // without anyone remembering to tag it.
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

describe('aiQuotaFeature', () => {
  it('routes the forum reply away from the teaser bucket', () => {
    // The whole point of the split: a forum reply the user never asked for
    // must not spend the free plan's single lifetime advisor question.
    expect(aiQuotaFeature('community_reply')).toBe(FEATURE_FORUM);
  });

  it('routes the real advisor to the teaser bucket', () => {
    expect(aiQuotaFeature('chat_assistant')).toBe(FEATURE_ADVISOR);
  });

  it('routes an untagged call to the teaser bucket', () => {
    // getVesselAdvice sends nothing, and it IS a user-requested advisor
    // question, so the strict default is also the correct answer here.
    expect(aiQuotaFeature(null)).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature(undefined)).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature('')).toBe(FEATURE_ADVISOR);
  });

  // ── the direction of the default is the security property ────────────
  //
  // If an unknown surface fell into FEATURE_FORUM, sending
  // `surface: 'anything'` from DevTools would exempt every call from the
  // lifetime teaser and hand out unlimited free advisor questions. The
  // default must be the bucket the teaser MEASURES.

  it('sends a forged surface to the teaser bucket, not the exempt one', () => {
    expect(aiQuotaFeature('x')).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature('ai_forum')).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature('community_reply ')).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature('Community_Reply')).toBe(FEATURE_ADVISOR);
  });

  it('sends a non-string to the teaser bucket', () => {
    expect(aiQuotaFeature(0)).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature({})).toBe(FEATURE_ADVISOR);
    expect(aiQuotaFeature(['community_reply'])).toBe(FEATURE_ADVISOR);
  });

  it('never routes an exempt scan anywhere, because it has no bucket', () => {
    // Guards the contract stated in the docblock: the two lists must not
    // overlap, or a scan would be both exempt from the quota AND assigned a
    // counter bucket, and the two answers would disagree.
    for (const s of NON_TEASER_SURFACES) {
      expect(countsTowardAiQuota(s), s).toBe(true);
    }
  });

  it('keeps the non-teaser list frozen', () => {
    expect(Object.isFrozen(NON_TEASER_SURFACES)).toBe(true);
  });
});
