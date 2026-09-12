/**
 * The pure helpers behind the admin plan rollup.
 *
 * The one that carries consequences is `planFor`. An account with no
 * subscription row is NOT an account without a plan: account_plan() resolves
 * it through `coalesce(..., 'free')`, so the row's absence means free. Get
 * that wrong and the CRM shows a blank for accounts that are perfectly
 * normal, and the distribution under-reports free by exactly the number of
 * accounts nobody has written a row for yet.
 */
import { describe, it, expect, vi } from 'vitest';

// The hook module pulls in the Supabase client. The helpers under test touch
// none of it.
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }));
vi.mock('@/hooks/useIsAdmin', () => ({ default: () => false }));

const { planFor, countByPlan } = await import('./useAccountPlanRollup');

describe('planFor', () => {
  const byAccount = new Map([['acc-paid', 'p9'], ['acc-free', 'free']]);

  it('returns the plan an account actually has', () => {
    expect(planFor(byAccount, 'acc-paid')).toBe('p9');
    expect(planFor(byAccount, 'acc-free')).toBe('free');
  });

  it('treats a missing row as free, not as unknown', () => {
    // ⚠️ The whole reason this helper exists instead of raw map access.
    expect(planFor(byAccount, 'acc-with-no-row')).toBe('free');
  });

  it('returns null only when there is no account at all', () => {
    // A user with no primary_account_id has nothing to resolve. That is
    // distinct from an account whose row is missing, and the CRM renders it
    // as a dash rather than claiming the user is on the free plan.
    expect(planFor(byAccount, null)).toBeNull();
    expect(planFor(byAccount, undefined)).toBeNull();
  });

  it('does not throw when the map itself is missing', () => {
    // The map is empty on the first render, before the query resolves.
    expect(() => planFor(undefined, 'acc-free')).not.toThrow();
    expect(planFor(undefined, 'acc-free')).toBe('free');
  });
});

describe('countByPlan', () => {
  const rows = [
    { account_id: 'a', plan: 'free' },
    { account_id: 'b', plan: 'p9' },
    { account_id: 'c', plan: 'p9' },
  ];

  it('counts rows by plan code', () => {
    expect(countByPlan(rows)).toEqual({ free: 1, p9: 2 });
  });

  it('counts a row with a null plan as free', () => {
    expect(countByPlan([{ account_id: 'a', plan: null }])).toEqual({ free: 1 });
  });

  it('folds accounts with no row into free when the caller supplies the list', () => {
    // Without this the free number is a floor rather than a total, which is
    // exactly what the copy on the screen says when the list is not supplied.
    expect(countByPlan(rows, ['a', 'b', 'c', 'd', 'e'])).toEqual({ free: 3, p9: 2 });
  });

  it('never double-counts an account that does have a row', () => {
    expect(countByPlan(rows, ['a', 'b', 'c'])).toEqual({ free: 1, p9: 2 });
  });

  it('survives empty and malformed input', () => {
    expect(countByPlan([])).toEqual({});
    expect(countByPlan(null)).toEqual({});
    expect(countByPlan([{ plan: 'p9' }])).toEqual({});  // no account_id, skipped
  });
});
