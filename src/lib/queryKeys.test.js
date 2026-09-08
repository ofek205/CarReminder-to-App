/**
 * The prefetch in usePrefetchOfflineEssentials is only useful if it writes the
 * key the Documents page reads. Get that wrong and it fails SILENTLY: data is
 * fetched, cached under a key nothing looks at, and offline still shows an
 * empty list. Nothing errors. So the contract is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { documentsListKey } from './queryKeys';

describe('documentsListKey', () => {
  it('produces the page\'s default unfiltered key from accountId alone', () => {
    // What the prefetch passes: just the account. It must equal what the page
    // builds on a first visit with no vehicle filter and a non-driver user.
    expect(documentsListKey({ accountId: 'acc1' }))
      .toEqual(documentsListKey({
        accountId: 'acc1',
        vehicleId: null,
        restrictToDriverAssignments: false,
        driverAssignedVehicleIds: null,
      }));
  });

  it('hashes identically to the page\'s key, which is what React Query compares', () => {
    // React Query keys by JSON.stringify, so this is the comparison that
    // actually decides whether the prefetch is used.
    const prefetch = JSON.stringify(documentsListKey({ accountId: 'acc1' }));
    const page = JSON.stringify(documentsListKey({
      accountId: 'acc1', vehicleId: null, restrictToDriverAssignments: false, driverAssignedVehicleIds: null,
    }));
    expect(prefetch).toBe(page);
  });

  it('keeps a vehicle filter distinct from the unfiltered list', () => {
    // Otherwise a filtered view would read the full list, or vice versa.
    expect(documentsListKey({ accountId: 'acc1', vehicleId: 'v1' }))
      .not.toEqual(documentsListKey({ accountId: 'acc1' }));
  });

  it('keeps a restricted driver distinct, which is why they are not prefetched', () => {
    const driver = documentsListKey({
      accountId: 'acc1', restrictToDriverAssignments: true, driverAssignedVehicleIds: ['v1', 'v2'],
    });
    expect(driver).not.toEqual(documentsListKey({ accountId: 'acc1' }));
    expect(driver[4]).toBe('v1,v2');
  });

  it('separates accounts, so a workspace switch cannot read the wrong documents', () => {
    expect(documentsListKey({ accountId: 'acc1' })).not.toEqual(documentsListKey({ accountId: 'acc2' }));
  });

  it('starts with the "documents" prefix the invalidations rely on', () => {
    // Documents.jsx invalidates by the bare ['documents'] prefix in three
    // places; a renamed first element would silently stop matching.
    expect(documentsListKey({ accountId: 'acc1' })[0]).toBe('documents');
  });
});
