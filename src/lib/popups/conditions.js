/**
 * Condition matcher. Given a popup's conditions + the current user context,
 * returns true if the popup is eligible to show for this user.
 *
 * Context shape:
 *   {
 *     user: { id, email, ...auth user },
 *     isAuthenticated: boolean,
 *     isGuest: boolean,
 *     vehicles: Vehicle[],
 *   }
 *
 * conditions shape (stored on popup):
 *   {
 *     segment?:     'all' | 'car' | 'motorcycle' | 'truck' | 'vessel' | 'offroad',
 *     user_type?:   'all' | 'authenticated' | 'guest',
 *     has_vehicle?: true | false | null,
 *   }
 *
 * All present conditions must match (AND-logic). Missing / null condition
 * = ignored.
 */

import { getVehicleCategory } from '@/lib/designTokens';

function vehicleMatchesSegment(v, segment) {
  if (!v) return false;
  const vt = (v.vehicle_type || '').trim();
  switch (segment) {
    case 'vessel':     return /שייט|סירה|יאכטה|אופנוע ים|ג׳ט|גט/.test(vt) || /שייט|סירה|יאכטה/.test(v.nickname || '');
    case 'motorcycle': return /אופנוע|קטנוע/.test(vt);
    case 'truck':      return /משאית/.test(vt);
    case 'offroad':    return /שטח|טרקטורון|באגי/.test(vt);
    case 'car':        return !/שייט|סירה|יאכטה|אופנוע|קטנוע|משאית|שטח|טרקטורון|באגי/.test(vt);
    default:           return true;
  }
}

export function matchesConditions(popup, ctx) {
  const c = popup?.conditions || {};
  const { user, isAuthenticated, isGuest, vehicles = [] } = ctx || {};

  // user_type
  if (c.user_type && c.user_type !== 'all') {
    if (c.user_type === 'authenticated' && !isAuthenticated) return false;
    if (c.user_type === 'guest' && !isGuest) return false;
  }

  // has_vehicle — strictly true/false; null/undefined means "don't care"
  if (c.has_vehicle === true && vehicles.length === 0) return false;
  if (c.has_vehicle === false && vehicles.length > 0) return false;

  // segment — "user owns at least one vehicle in this category"
  if (c.segment && c.segment !== 'all') {
    const any = vehicles.some(v => vehicleMatchesSegment(v, c.segment));
    if (!any) return false;
  }

  return true;
}

/**
 * Window gate — is NOW inside the popup's scheduled window?
 * starts_at / ends_at come from DB as ISO strings or null.
 */
export function withinWindow(popup, now = new Date()) {
  if (popup?.starts_at && new Date(popup.starts_at) > now) return false;
  if (popup?.ends_at   && new Date(popup.ends_at)   < now) return false;
  return true;
}

/**
 * Trigger match. Returns true if THIS firing event matches the popup's
 * trigger config.
 *
 * Firing event shape (emitted by the engine):
 *   { kind: 'login' | 'page_view', path?, elapsedMs? }
 */
export function matchesTrigger(popup, event) {
  const t = popup?.trigger || {};
  switch (t.kind) {
    case 'on_login':
      return event.kind === 'login';
    case 'on_page_view':
      return event.kind === 'page_view' && (!t.path || t.path === event.path);
    case 'after_delay': {
      // Engine fires a 'delay_tick' event periodically; popup matches when
      // elapsed >= configured delay AND we've seen any trigger since mount.
      const ms = (Number(t.delay_seconds) || 3) * 1000;
      return event.kind === 'delay_tick' && event.elapsedMs >= ms;
    }
    case 'manual':
      return event.kind === 'manual' && event.popupId === popup.id;
    default:
      return false;
  }
}
