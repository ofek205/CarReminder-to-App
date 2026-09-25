/**
 * Each purchase reaches the function that asks ITS store, with the field
 * that function actually reads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a) => invoke(...a) } },
}));

const { verifyRequest, verifierFor, verificationResult } = await import('./verify');

const ARGS = { purchaseToken: '2000000987654321', productId: 'plan_p9', accountId: 'acc-uuid' };

beforeEach(() => invoke.mockReset());

describe('verifyRequest', () => {
  it('sends an Apple purchase to verify-apple-purchase as a transactionId', () => {
    expect(verifyRequest('apple', ARGS)).toEqual({
      fn: 'verify-apple-purchase',
      body: { transactionId: '2000000987654321', productId: 'plan_p9', accountId: 'acc-uuid' },
    });
  });

  it('keeps a Play purchase exactly as it was: verify-play-purchase with purchaseToken', () => {
    // The Play backend has no `store` field, so undefined must mean Play.
    expect(verifyRequest(undefined, ARGS)).toEqual({
      fn: 'verify-play-purchase',
      body: { purchaseToken: '2000000987654321', productId: 'plan_p9', accountId: 'acc-uuid' },
    });
  });

  it('never hands Apple a purchaseToken field, which it does not read', () => {
    expect(verifyRequest('apple', ARGS).body).not.toHaveProperty('purchaseToken');
  });
});

describe('verificationResult', () => {
  it('grants only on granted:true', () => {
    expect(verificationResult({ granted: true }, null)).toBe(true);
    expect(verificationResult({ granted: false, reason: 'not_active' }, null)).toBe(false);
    expect(verificationResult(null, new Error('network'))).toBe(false);
  });

  it('marks another account\'s purchase as not_yours, from either store', () => {
    for (const reason of ['held_by_other_account', 'account_token_mismatch', 'no_account_token', 'account_mismatch']) {
      expect(verificationResult({ granted: false, reason }, null), reason).toBe('not_yours');
    }
  });

  it('keeps every other refusal as false, which renders PENDING', () => {
    for (const reason of ['lookup_failed', 'grant_failed', 'product_mismatch', 'verification_error', undefined]) {
      expect(verificationResult({ granted: false, reason }, null), String(reason)).toBe(false);
    }
  });
});

describe('verifierFor', () => {
  it('is stable per store, because it sits in React callback dependencies', () => {
    expect(verifierFor('apple')).toBe(verifierFor('apple'));
    expect(verifierFor(undefined)).toBe(verifierFor(undefined));
    expect(verifierFor('apple')).not.toBe(verifierFor(undefined));
  });

  it('grants only on granted:true, and treats a transport error as not granted', async () => {
    invoke.mockResolvedValueOnce({ data: { granted: true }, error: null });
    await expect(verifierFor('apple')(ARGS)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('verify-apple-purchase', {
      body: { transactionId: ARGS.purchaseToken, productId: 'plan_p9', accountId: 'acc-uuid' },
    });

    invoke.mockResolvedValueOnce({ data: { granted: false, reason: 'not_active' }, error: null });
    await expect(verifierFor('apple')(ARGS)).resolves.toBe(false);

    invoke.mockResolvedValueOnce({ data: null, error: new Error('network') });
    await expect(verifierFor(undefined)(ARGS)).resolves.toBe(false);
  });
});
