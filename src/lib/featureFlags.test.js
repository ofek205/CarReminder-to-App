import { describe, it, expect, vi, beforeEach } from 'vitest';

// The per-user allowlist (supabase-feature-flag-allowlist-2026-09-27.sql).
// What must hold: a listed user sees a flag that is off for everyone, only
// that flag, only while they are the one signed in, and every failure hides
// rather than shows.

const rpc = vi.fn();
const flagRow = vi.fn();
let sessionUid = 'u1';

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => flagRow() }) }) }),
    auth: {
      getSession: async () => ({
        data: { session: sessionUid ? { user: { id: sessionUid } } : null },
      }),
    },
  },
}));
vi.mock('./supabaseQuery', () => ({ withTimeout: (p) => p }));
vi.mock('@/hooks/useIsAdmin', () => ({ default: () => false }));
vi.mock('@/components/shared/GuestContext', () => ({ useAuth: () => ({ user: null, isGuest: true }) }));

const KEY = 'apple_billing_enabled';

function db({ admin = false, flag = false, listed = [], listedFails = null } = {}) {
  rpc.mockImplementation(async (name) => {
    if (name === 'is_admin') return { data: admin, error: null };
    if (name === 'my_allowlisted_flags') {
      if (listedFails === 'throw') throw new Error('supabase query timeout: my_allowlisted_flags');
      if (listedFails) return { data: null, error: listedFails };
      return { data: listed, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  flagRow.mockResolvedValue({ data: { value: flag }, error: null });
}

const allowlistCalls = () => rpc.mock.calls.filter(([name]) => name === 'my_allowlisted_flags').length;

// The module caches per user for 60 s, so every test starts from a fresh copy.
async function load() {
  vi.resetModules();
  return import('./featureFlags');
}

beforeEach(() => {
  rpc.mockReset();
  flagRow.mockReset();
  sessionUid = 'u1';
});

describe('feature flag allowlist', () => {
  it('shows a flag that is off for everyone to a listed user', async () => {
    db({ listed: [KEY] });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(true);
  });

  it('keeps it hidden from everyone else', async () => {
    db({ listed: [] });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(false);
  });

  it('switches on only the flags listed, not every flag', async () => {
    db({ listed: ['monetization_ui_enabled'] });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled('monetization_ui_enabled')).toBe(true);
    expect(await isFeatureEnabled(KEY)).toBe(false);
  });

  it('hides the feature when the RPC does not exist yet (client shipped before the SQL)', async () => {
    db({ listedFails: { code: 'PGRST202', message: 'Could not find the function' } });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(false);
  });

  it('hides the feature when the RPC times out', async () => {
    db({ listedFails: 'throw' });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(false);
  });

  it('does not ask at all without a session', async () => {
    sessionUid = null;
    db({ listed: [KEY] });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(false);
    expect(allowlistCalls()).toBe(0);
  });

  it("does not hand one account's list to the next account on the same phone", async () => {
    db({ listed: [KEY] });
    const { isFeatureEnabled } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(true);

    sessionUid = 'u2';
    db({ listed: [] });
    expect(await isFeatureEnabled(KEY)).toBe(false);
    expect(allowlistCalls()).toBe(2);
  });

  it('asks once for every flag, not once per flag', async () => {
    db({ listed: [KEY] });
    const { isFeatureEnabled } = await load();
    await isFeatureEnabled(KEY);
    await isFeatureEnabled('monetization_ui_enabled');
    await isFeatureEnabled('play_billing_enabled');
    expect(allowlistCalls()).toBe(1);
  });

  it('re-reads the list on a full cache bust, so a row just added takes effect', async () => {
    db({ listed: [] });
    const { isFeatureEnabled, invalidateFeatureFlagCache } = await load();
    expect(await isFeatureEnabled(KEY)).toBe(false);

    db({ listed: [KEY] });
    invalidateFeatureFlagCache();
    expect(await isFeatureEnabled(KEY)).toBe(true);
  });

  it('leaves the existing rules as they were: flag on for all, admin bypass', async () => {
    db({ flag: true });
    let mod = await load();
    expect(await mod.isFeatureEnabled(KEY)).toBe(true);

    db({ admin: true });
    mod = await load();
    expect(await mod.isFeatureEnabled(KEY)).toBe(true);
  });

  it('ignoreAdmin: the admin bypass stays off, but a listed user is enrolled', async () => {
    db({ admin: true, listed: [] });
    let mod = await load();
    expect(await mod.isFeatureEnabled(KEY, { ignoreAdmin: true })).toBe(false);

    db({ admin: false, listed: [KEY] });
    mod = await load();
    expect(await mod.isFeatureEnabled(KEY, { ignoreAdmin: true })).toBe(true);
  });
});
