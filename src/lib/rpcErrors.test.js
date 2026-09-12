import { describe, it, expect } from 'vitest';
import { rpcErrorCode, freezeMessageFor } from './rpcErrors';

describe('rpcErrorCode', () => {
  it('pulls the raised name out of a Supabase error', () => {
    expect(rpcErrorCode({ message: 'transfer_expired' })).toBe('transfer_expired');
  });

  it('survives an error with no message at all', () => {
    // Every call site does `catch (e)` and hands whatever it caught straight
    // here, and not everything thrown in a browser is an Error.
    expect(rpcErrorCode(null)).toBe('');
    expect(rpcErrorCode(undefined)).toBe('');
    expect(rpcErrorCode({})).toBe('');
  });
});

describe('freezeMessageFor', () => {
  it('explains an open offer, and says where the way out is', () => {
    const msg = freezeMessageFor({ message: 'vehicle_history_frozen' });
    expect(msg).toContain('הצעת העברה');
    // The remedy has to be in the copy. The refusal comes from a trigger the
    // user never invoked, so without it they have no way to learn the offer
    // exists, let alone cancel it.
    expect(msg).toContain('לבטל');
  });

  it('does not offer a remedy for an archived vehicle, because there is none', () => {
    const msg = freezeMessageFor({ message: 'vehicle_archived' });
    expect(msg).toContain('לקריאה בלבד');
    expect(msg).not.toContain('לבטל');
  });

  it('returns null for anything else, so callers keep their own copy', () => {
    expect(freezeMessageFor({ message: 'some_other_error' })).toBeNull();
    expect(freezeMessageFor(new Error('network'))).toBeNull();
    expect(freezeMessageFor(null)).toBeNull();
  });

  it('never answers with a bare error code', () => {
    // The whole reason this module exists: the previous behaviour was either a
    // raw code or "try again" on a save that can never succeed.
    for (const code of ['vehicle_history_frozen', 'vehicle_archived']) {
      const msg = freezeMessageFor({ message: code });
      expect(msg).not.toContain(code);
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});
