import { describe, it, expect } from 'vitest';
import { vehicleCapKind, isVehicleCapError } from './vehicleCapError';

// The shapes PostgREST actually produces. A raised message lands on
// `message`, and pieces sometimes get copied onto details / hint.
const asMessage = (code) => ({ message: code });
const asDetails = (code) => ({ message: 'error', details: code });
const asHint = (code) => ({ message: 'error', hint: code });

describe('vehicleCapKind', () => {
  it('recognises the plan cap on every field PostgREST may use', () => {
    for (const shape of [asMessage, asDetails, asHint]) {
      expect(vehicleCapKind(shape('vehicle_plan_cap_exceeded'))).toBe('plan');
    }
    expect(vehicleCapKind('vehicle_plan_cap_exceeded')).toBe('plan');
  });

  it('recognises the pre-monetization personal cap', () => {
    expect(vehicleCapKind(asMessage('personal_vehicle_cap_reached: 10 of 10 vehicles'))).toBe('personal');
  });

  // ── the distinction this function exists for ────────────────────────
  //
  // The personal cap's remedy is "open a business account". The plan cap's
  // is a paid PLAN, because ₪9 already includes the business interface.
  // Confusing them shows the wrong ceiling (accounts.vehicle_cap = 10 after
  // a refusal at a plan cap of 5) and offers a product the user may already
  // be entitled to.

  it('never reports the plan cap as personal', () => {
    expect(vehicleCapKind(asMessage('vehicle_plan_cap_exceeded'))).not.toBe('personal');
  });

  it('prefers the plan cap if a message somehow carries both', () => {
    // The plan cap's remedy is the correct one under the current product,
    // so it wins rather than sending someone to open a business account.
    const both = { message: 'personal_vehicle_cap_reached', details: 'vehicle_plan_cap_exceeded' };
    expect(vehicleCapKind(both)).toBe('plan');
  });

  it('is null for anything that is not a cap', () => {
    expect(vehicleCapKind(null)).toBeNull();
    expect(vehicleCapKind(undefined)).toBeNull();
    expect(vehicleCapKind({})).toBeNull();
    expect(vehicleCapKind(asMessage('duplicate key value violates unique constraint'))).toBeNull();
    expect(vehicleCapKind(asMessage('forbidden_not_owner'))).toBeNull();
  });

  it('does not match a partial or lookalike code', () => {
    expect(vehicleCapKind(asMessage('personal_vehicle_cap'))).toBeNull();
    expect(vehicleCapKind(asMessage('vehicle_plan_cap'))).toBeNull();
  });
});

describe('isVehicleCapError', () => {
  it('covers BOTH caps, so the three existing call sites light up', () => {
    // AddVehicle, VehicleScanWizard and VehicleCheck all branch on this
    // boolean. Before phase 4 it only knew the personal code, so the new
    // trigger would have fallen through to a generic failure.
    expect(isVehicleCapError(asMessage('personal_vehicle_cap_reached'))).toBe(true);
    expect(isVehicleCapError(asMessage('vehicle_plan_cap_exceeded'))).toBe(true);
  });

  it('stays false for unrelated errors', () => {
    expect(isVehicleCapError(asMessage('invalid_input'))).toBe(false);
    expect(isVehicleCapError(null)).toBe(false);
  });
});
