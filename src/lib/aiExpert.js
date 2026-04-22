/**
 * AI expert identity. two distinct agents:
 *   - ברוך המוסכניק (default): cars, motorcycles, trucks, anything land-based
 *   - יוסי מומחה כלי שייט: vessels only
 *
 * Single source of truth so every chat surface (AiAssistant, community
 * replies, community creation, onboarding copy) picks the same name
 * for the same context.
 */

import { isVessel } from '@/components/shared/DateStatusUtils';

const BARUCH = Object.freeze({
  firstName:     'ברוך',
  fullName:      'ברוך המוסכניק',
  communityName: '🔧 ברוך המוסכניק',
  emoji:         '🔧',
  role:          'מכונאי רכב ותיק עם 25 שנות ניסיון בישראל',
  shortRole:     'מכונאי רכב',
  domain:        'car',
});

const YOSSI = Object.freeze({
  firstName:     'יוסי',
  fullName:      'יוסי מומחה כלי שייט',
  communityName: '⚓ יוסי מומחה כלי שייט',
  emoji:         '⚓',
  role:          'טכנאי כלי שייט מומחה עם 25 שנות ניסיון בישראל',
  shortRole:     'טכנאי כלי שייט',
  domain:        'vessel',
});

/**
 * Pick the right AI expert for a vehicle object.
 * Returns the ברוך (car) persona for null / non-vessel vehicles.
 */
export function getAiExpert(vehicle) {
  if (vehicle && isVessel(vehicle.vehicle_type, vehicle.nickname)) return YOSSI;
  return BARUCH;
}

/**
 * Community code uses a "domain" string ('vessel' | anything else).
 */
export function getAiExpertForDomain(domain) {
  return domain === 'vessel' ? YOSSI : BARUCH;
}

/**
 * Convenience exports for places that always know the answer at build time.
 */
export const AI_EXPERT_CAR    = BARUCH;
export const AI_EXPERT_VESSEL = YOSSI;
