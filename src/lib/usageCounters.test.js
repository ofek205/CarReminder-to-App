import { describe, it, expect } from 'vitest';
import { plateLookupCounts, PLATE_LOOKUP_SITES } from './usageCounters';

describe('plateLookupCounts', () => {
  it('charges every user-initiated lookup', () => {
    expect(plateLookupCounts('vehicle_check')).toBe(true);
    // The biggest hole if missed: an explicit search returning the full
    // spec, reachable by opening /AddVehicle without ever saving.
    expect(plateLookupCounts('add_vehicle_search')).toBe(true);
    expect(plateLookupCounts('add_accident')).toBe(true);
    expect(plateLookupCounts('bulk_add')).toBe(true);
  });

  it('does not charge lookups the user did not ask for', () => {
    expect(plateLookupCounts('auto_enrich')).toBe(false);
    expect(plateLookupCounts('save_enrich')).toBe(false);
    expect(plateLookupCounts('cron')).toBe(false);
  });

  it('charges an unregistered call site rather than making it free', () => {
    // A lookup added later without a decision must show up in the numbers,
    // not silently distort them downward.
    expect(plateLookupCounts('some_new_screen')).toBe(true);
    expect(plateLookupCounts(undefined)).toBe(true);
  });

  it('gives every registered site a written reason', () => {
    for (const [site, entry] of Object.entries(PLATE_LOOKUP_SITES)) {
      expect(typeof entry.counted, site).toBe('boolean');
      expect(entry.why, site).toBeTruthy();
    }
  });
});
