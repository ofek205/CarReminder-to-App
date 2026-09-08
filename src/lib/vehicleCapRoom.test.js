/**
 * The one property that must not regress: this check FAILS OPEN.
 *
 * The authoritative cap is a trigger on public.vehicles. This read only
 * spares the user a wasted journey, so a failure here must let them through
 * to the trigger's own (already mapped) refusal. Failing closed would block
 * accounts the database would have accepted, which is worse than the dead
 * end this file exists to prevent.
 *
 * Contrast plateQuotaGate, whose verdict IS the enforcement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  get supabase() { return { rpc }; },
}));
vi.mock('@/lib/supabaseQuery', () => ({
  withTimeout: (p) => p,
}));

const { checkVehicleCapRoom, isCapRefusal } = await import('./vehicleCapRoom');

const ok = (data) => { rpc.mockResolvedValue({ data, error: null }); };

beforeEach(() => { rpc.mockReset(); });

describe('checkVehicleCapRoom — fails open', () => {
  it('fits when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await checkVehicleCapRoom('a1');
    expect(r.fits).toBe(true);
    expect(r.known).toBe(false);
  });

  it('fits when the function does not exist yet', async () => {
    // Pre-migration. The cap is not enforced anywhere either, so allowing
    // is not merely safe here, it is correct.
    rpc.mockRejectedValue(Object.assign(new Error('nope'), { code: 'PGRST202' }));
    expect((await checkVehicleCapRoom('a1')).fits).toBe(true);
  });

  it('fits with no accountId, without calling the server', async () => {
    const r = await checkVehicleCapRoom(null);
    expect(r.fits).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fits on an unreadable payload', async () => {
    ok('nonsense');
    expect((await checkVehicleCapRoom('a1')).fits).toBe(true);
    ok(null);
    expect((await checkVehicleCapRoom('a1')).fits).toBe(true);
  });

  it('treats a MISSING fits as fits, not as a refusal', async () => {
    // Only an explicit false refuses. Otherwise a shape change in the RPC
    // would silently start blocking users the database would accept.
    ok({ cap: 5, used: 9 });
    const r = await checkVehicleCapRoom('a1');
    expect(r.fits).toBe(true);
    expect(isCapRefusal(r)).toBe(false);
  });
});

describe('checkVehicleCapRoom — the server decides', () => {
  it('refuses only on an explicit false', async () => {
    ok({ fits: false, cap: 5, used: 5, adding: 1, in_grace: false });
    const r = await checkVehicleCapRoom('a1');
    expect(r.fits).toBe(false);
    expect(isCapRefusal(r)).toBe(true);
    expect(r).toMatchObject({ cap: 5, used: 5, adding: 1, inGrace: false });
  });

  it('accepts the server verdict even when the numbers look refusable', async () => {
    // used 9 over a cap of 5 but fits:true, which is what grace looks like.
    // The client must NOT recompute the rule: vehicle_cap_room mirrors the
    // trigger, including grace and NULL caps, and a second copy here could
    // refuse what the database allows.
    ok({ fits: true, cap: 5, used: 9, adding: 1, in_grace: true });
    const r = await checkVehicleCapRoom('a1');
    expect(r.fits).toBe(true);
    expect(r.inGrace).toBe(true);
    expect(isCapRefusal(r)).toBe(false);
  });

  it('passes the batch size to the server rather than assuming 1', async () => {
    ok({ fits: false, cap: 5, used: 0, adding: 200 });
    await checkVehicleCapRoom('a1', 200);
    expect(rpc).toHaveBeenCalledWith('vehicle_cap_room', {
      p_account_id: 'a1', p_adding: 200,
    });
  });

  it('reports an unlimited cap as null, not 0', async () => {
    ok({ fits: true, cap: null, used: 40, adding: 1 });
    const r = await checkVehicleCapRoom('a1');
    expect(r.cap).toBeNull();
    expect(r.used).toBe(40);
  });
});

describe('isCapRefusal', () => {
  it('is false for anything unknown or permissive', () => {
    expect(isCapRefusal(null)).toBe(false);
    expect(isCapRefusal(undefined)).toBe(false);
    expect(isCapRefusal({ fits: true, known: true })).toBe(false);
    // Unknown must never read as a refusal, or fail-open becomes
    // fail-closed at the call site.
    expect(isCapRefusal({ fits: false, known: false })).toBe(false);
  });
});
