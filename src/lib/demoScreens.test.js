/**
 * Pins the two invariants that nothing else can catch.
 *
 * 1. The demo vehicle IDs are DUPLICATED between demoScreens.js and
 *    demoVehicleData.js, on purpose: the marketing bundle should not pull a
 *    whole dataset in for two strings. Duplication needs a guard, and neither
 *    lint nor types can see that two string literals are meant to match. If
 *    they drift, `/VehicleDetail?id=...` silently points at a vehicle that
 *    does not exist and the preview shows an empty card.
 *
 * 2. Every screen in the closed list round-trips: its own path must resolve
 *    back to its own ID. `/Vehicles` and `/Vehicles?category=vessel` share a
 *    pathname, so a careless reverse lookup would mark the wrong item, which
 *    is precisely the quiet mismatch the two-way sync exists to remove.
 */
import { describe, it, expect } from 'vitest';
import {
  DEMO_SCREENS, DEMO_HOME_ID, DEMO_VEHICLE_ROUTE_ID, DEMO_VESSEL_ROUTE_ID,
  pathForScreen, screenIdFor,
} from './demoScreens';
import { DEMO_VEHICLE_ID, DEMO_VESSEL_ID } from '@/components/shared/demoVehicleData';

describe('demoScreens', () => {
  it('keeps the duplicated demo vehicle IDs in step with demoVehicleData', () => {
    expect(DEMO_VEHICLE_ROUTE_ID).toBe(DEMO_VEHICLE_ID);
    expect(DEMO_VESSEL_ROUTE_ID).toBe(DEMO_VESSEL_ID);
  });

  it('round-trips every screen from its own path back to its own id', () => {
    for (const screen of DEMO_SCREENS) {
      const [pathname, search = ''] = screen.path.split('?');
      expect(screenIdFor(pathname, search)).toBe(screen.id);
    }
  });

  it('tells the vehicle list apart from the vessel list on a shared pathname', () => {
    expect(screenIdFor('/Vehicles', '')).toBe('vehicles');
    expect(screenIdFor('/Vehicles', 'category=vessel')).toBe('vessels');
  });

  it('returns null for anything off the list rather than guessing', () => {
    for (const path of ['/FindGarage', '/AiAssistant', '/Accidents', '/Settings', '/Auth', '', '/']) {
      expect(screenIdFor(path, '')).toBeNull();
    }
  });

  it('opens on a screen that is actually in the list', () => {
    expect(pathForScreen(DEMO_HOME_ID)).toBeTruthy();
    expect(DEMO_SCREENS.some(s => s.id === DEMO_HOME_ID)).toBe(true);
  });

  it('refuses an unknown id, which is what stops a message steering the app', () => {
    expect(pathForScreen('../../etc/passwd')).toBeNull();
    expect(pathForScreen('Auth')).toBeNull();
    expect(pathForScreen(undefined)).toBeNull();
  });

  it('has unique ids', () => {
    const ids = DEMO_SCREENS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
