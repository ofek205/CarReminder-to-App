/**
 * The plate quota gate's contract. Two properties matter most and neither is
 * visible to lint, types, or the build:
 *
 *   1. A failed read ALLOWS. This gate sits on a public dataset; refusing on
 *      a blip would tell a paying user their plate check is broken.
 *   2. A bulk batch is checked as N, not as 1. A 200-row import that reports
 *      as one check would let a 3-a-month account consume 200 and stay
 *      nominally within its cap, which is the exact hole phase 3's p_delta
 *      was added to close on the counting side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();

// The platform decision, mocked so the anti-steering rule can be asserted
// on all three surfaces without a real Capacitor environment. A getter for
// the same reason as the supabase mock below.
let wall = { cta: 'plan', mayMentionPlans: true };
vi.mock('@/lib/billingGate', () => ({
  capWallAction: () => wall,
}));

vi.mock('@/lib/supabase', () => ({
  // A getter, so the mock is read at call time and no module reset is
  // needed. vi.resetModules() clears the whole worker registry and made an
  // earlier version of this suite pass alone and fail in a full run.
  get supabase() { return { rpc }; },
}));

// withTimeout wraps a PostgrestBuilder in production. Here it must be a
// pass-through, or every test would be testing the wrapper.
vi.mock('@/lib/supabaseQuery', () => ({
  withTimeout: (p) => p,
}));

const { checkPlateQuota, isPlateQuotaRefusal, plateQuotaCopy } = await import('./plateQuotaGate');

const ok = (data) => { rpc.mockResolvedValue({ data, error: null }); };

beforeEach(() => { rpc.mockReset(); });

describe('checkPlateQuota — failure allows', () => {
  it('allows when the RPC returns an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const v = await checkPlateQuota();
    expect(v.allowed).toBe(true);
    expect(v.known).toBe(false);
  });

  it('allows when the RPC throws, which is the pre-migration case', async () => {
    // Before phase 5c is applied the function does not exist and PostgREST
    // answers PGRST202. The user must not notice.
    rpc.mockRejectedValue(Object.assign(new Error('not found'), { code: 'PGRST202' }));
    const v = await checkPlateQuota();
    expect(v.allowed).toBe(true);
    expect(v.known).toBe(false);
  });

  it('allows on a payload it cannot read', async () => {
    ok('nonsense');
    expect((await checkPlateQuota()).allowed).toBe(true);
    ok(null);
    expect((await checkPlateQuota()).allowed).toBe(true);
  });

  it('reports known:false on every failure, so no screen prints a number', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    const v = await checkPlateQuota();
    expect(v.known).toBe(false);
    expect(v.used).toBeNull();
    expect(v.remaining).toBeNull();
    expect(v.limit).toBeNull();
  });
});

describe('checkPlateQuota — the allowed cases', () => {
  it('allows when the flag is off', async () => {
    ok({ allowed: true, reason: null, enforced: false });
    const v = await checkPlateQuota();
    expect(v.allowed).toBe(true);
    expect(v.reason).toBeNull();
  });

  it('allows an unlimited plan and reports the limit as null, not as 0', async () => {
    // A 0 here would read as "no checks allowed", the exact inversion of
    // what a NULL limit means everywhere in plan_limits.
    ok({ allowed: true, reason: null, limit: null, account_id: 'a1' });
    const v = await checkPlateQuota();
    expect(v.allowed).toBe(true);
    expect(v.limit).toBeNull();
    expect(v.known).toBe(true);
  });

  it('passes through the numbers when there is room', async () => {
    ok({ allowed: true, reason: null, limit: 3, used: 1, remaining: 2 });
    const v = await checkPlateQuota();
    expect(v).toMatchObject({ allowed: true, limit: 3, used: 1, remaining: 2, known: true });
  });
});

describe('checkPlateQuota — refusals', () => {
  it('refuses when the server says the month is spent', async () => {
    ok({ allowed: false, reason: 'plate_quota_reached', limit: 3, used: 3, remaining: 0 });
    const v = await checkPlateQuota();
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('plate_quota_reached');
    expect(isPlateQuotaRefusal(v)).toBe(true);
  });

  it('names the refusal even if the server sent no reason', async () => {
    // allowed:false is authoritative. A blank reason must not become an
    // unlabelled refusal that no screen has copy for.
    ok({ allowed: false, limit: 3, used: 3 });
    expect((await checkPlateQuota()).reason).toBe('plate_quota_reached');
  });

  // ── the bulk case ───────────────────────────────────────────────────
  //
  // The server answers "may you do ONE more". Only the caller knows it is
  // about to do 200.

  it('refuses a batch larger than the remainder, though one would pass', async () => {
    ok({ allowed: true, reason: null, limit: 3, used: 1, remaining: 2 });
    expect((await checkPlateQuota(1)).allowed).toBe(true);
    expect((await checkPlateQuota(2)).allowed).toBe(true);
    const v = await checkPlateQuota(3);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('plate_quota_reached');
    // The numbers survive the refusal so the wall can say 2 of 3 left.
    expect(v).toMatchObject({ limit: 3, used: 1, remaining: 2 });
  });

  it('does not cap a batch on an unlimited plan', async () => {
    ok({ allowed: true, reason: null, limit: null });
    expect((await checkPlateQuota(500)).allowed).toBe(true);
  });

  it('does not refuse a batch when the read failed', async () => {
    // Property 1 must beat property 2: unknown never blocks.
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect((await checkPlateQuota(500)).allowed).toBe(true);
  });
});

describe('isPlateQuotaRefusal', () => {
  it('is false for anything that is not this refusal', () => {
    expect(isPlateQuotaRefusal(null)).toBe(false);
    expect(isPlateQuotaRefusal(undefined)).toBe(false);
    expect(isPlateQuotaRefusal({ allowed: true, reason: null })).toBe(false);
    expect(isPlateQuotaRefusal({ allowed: false, reason: 'something_else' })).toBe(false);
  });
});

// ── the anti-steering rule ────────────────────────────────────────────
//
// This is the highest-consequence thing in the file: getting it wrong on
// iOS is an App Store rejection, and Guideline 3.1.1(a) covers PROSE, not
// only buttons. Four surfaces render this copy, which is exactly why the
// decision lives in one tested function instead of in each of them.

describe('plateQuotaCopy — platform rules', () => {
  const SPENT = { allowed: false, reason: 'plate_quota_reached', limit: 3, used: 3, remaining: 0 };

  it('web may name a paid plan and gets the link', () => {
    wall = { cta: 'plan', mayMentionPlans: true };
    const c = plateQuotaCopy(SPENT);
    expect(c.cta).toBe('plan');
    expect(c.body).toContain('במסלול בתשלום');
  });

  it('ANDROID may say a paid plan exists but gets NO link', () => {
    // Play's consumption-only exemption: mentioning is allowed, linking out
    // is not.
    wall = { cta: null, mayMentionPlans: true };
    const c = plateQuotaCopy(SPENT);
    expect(c.cta).toBeNull();
    expect(c.body).toContain('במסלול בתשלום');
  });

  it('iOS says NOTHING about a paid plan, and gets no link', () => {
    wall = { cta: null, mayMentionPlans: false };
    const c = plateQuotaCopy(SPENT);
    expect(c.cta).toBeNull();
    expect(c.body).not.toContain('מסלול');
    expect(c.body).not.toContain('בתשלום');
    expect(c.body).not.toContain('₪');
    // It must still be a usable message, not an empty one.
    expect(c.title).toBeTruthy();
    expect(c.body.length).toBeGreaterThan(10);
  });

  it('states the user OWN limit on every platform, iOS included', () => {
    // A fact about the account they already have is not steering, and
    // suppressing it would leave an iOS user with no idea why they were
    // refused or when it resets.
    for (const w of [
      { cta: 'plan', mayMentionPlans: true },
      { cta: null, mayMentionPlans: true },
      { cta: null, mayMentionPlans: false },
    ]) {
      wall = w;
      const c = plateQuotaCopy(SPENT);
      expect(c.body, JSON.stringify(w)).toContain('3');
      expect(c.body, JSON.stringify(w)).toContain('מתאפסת');
    }
  });

  it('omits the numbers rather than printing zeros when the read failed', () => {
    wall = { cta: 'plan', mayMentionPlans: true };
    const c = plateQuotaCopy({ allowed: false, reason: 'plate_quota_reached', limit: null, used: null, known: false });
    expect(c.body).not.toContain('0');
    expect(c.body).toContain('נוצלו');
  });

  it('survives a missing verdict without throwing', () => {
    // Defensive: a screen could render the wall before the verdict lands.
    wall = { cta: 'plan', mayMentionPlans: true };
    expect(() => plateQuotaCopy(null)).not.toThrow();
    expect(() => plateQuotaCopy(undefined)).not.toThrow();
    expect(plateQuotaCopy(null).title).toBeTruthy();
  });
});
