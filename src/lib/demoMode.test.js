/**
 * Pins the two route guards the preview relies on.
 *
 * `isForbiddenDemoRoute` exists because a visitor reported landing on the
 * sign-in screen from the preview's own back button: inside an iframe
 * `history.length` counts the JOINT session history (measured at 29), so
 * MobileBackButton's `length > 1` guard passed and navigate(-1) walked out of
 * the preview entirely, into a screen with nothing to use and no way to leave.
 * That is fixed at source, and this guard is the belt for any other route in.
 */
import { describe, it, expect } from 'vitest';
import { isForbiddenDemoRoute, isWriteOnlyRoute } from './demoMode';

describe('isForbiddenDemoRoute', () => {
  it('blocks the sign-in screen, in every casing and with a trailing slash', () => {
    for (const p of ['/Auth', '/auth', '/AUTH', '/Auth/', '/auth//']) {
      expect(isForbiddenDemoRoute(p)).toBe(true);
    }
  });

  it('lets every screen the preview is meant to show through', () => {
    for (const p of ['/Dashboard', '/Vehicles', '/VehicleDetail', '/Documents', '/Accidents', '/Settings']) {
      expect(isForbiddenDemoRoute(p)).toBe(false);
    }
  });

  it('does not match a route that merely starts with the same letters', () => {
    expect(isForbiddenDemoRoute('/AuthorTools')).toBe(false);
    expect(isForbiddenDemoRoute('/Authorize')).toBe(false);
  });

  it('survives empty and missing input', () => {
    expect(isForbiddenDemoRoute('')).toBe(false);
    expect(isForbiddenDemoRoute(undefined)).toBe(false);
    expect(isForbiddenDemoRoute(null)).toBe(false);
  });
});

describe('isWriteOnlyRoute', () => {
  it('stops the screens whose only purpose is to write', () => {
    for (const p of ['/AddVehicle', '/addvehicle', '/AddAccident', '/EditVehicle', '/BulkAddVehicles', '/CreateRoute']) {
      expect(isWriteOnlyRoute(p)).toBe(true);
    }
  });

  it('leaves read screens alone, since browsing IS the preview', () => {
    for (const p of ['/Dashboard', '/Vehicles', '/VehicleDetail', '/Documents']) {
      expect(isWriteOnlyRoute(p)).toBe(false);
    }
  });

  it('matches a nested path under a write-only route but not a lookalike', () => {
    expect(isWriteOnlyRoute('/AddVehicle/step2')).toBe(true);
    expect(isWriteOnlyRoute('/AddVehicleHistory')).toBe(false);
  });
});
