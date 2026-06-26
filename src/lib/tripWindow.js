/**
 * TripGuard — pure decision logic for the child-in-car safety reminder.
 *
 * These functions answer one question: given the user's config and a trip
 * (start time → disconnect time), should we fire the "check the car" alert?
 *
 * CANONICAL-NOTE: at runtime on Android this exact logic lives in Kotlin
 * (TripGuardReceiver), because the JS/WebView is dead when the car
 * disconnects. This module is the single source of truth for the *rules*,
 * used by the web mock and the unit tests, and MUST stay in sync with the
 * Kotlin port. Keep it PURE (no imports, no side effects) so it is trivially
 * testable from a plain `node` script.
 *
 * SAFETY-FIRST: when config is ambiguous or malformed, every function errs
 * toward "active / should alert" rather than silently going quiet. A false
 * alarm is annoying; a missed child is catastrophic.
 */

/** Parse "HH:mm" → minutes-since-midnight, or null if malformed. */
function parseHm(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `date`'s weekday within the configured active days?
 * - null/undefined activeDays → all days (default-on).
 * - non-array → fail open (all days).
 * - [] (explicit empty) → no active days. The UI must prevent/warn on this.
 */
export function isActiveDay(config, date) {
  const days = config ? config.activeDays : null;
  if (days == null) return true;
  if (!Array.isArray(days)) return true;
  if (days.length === 0) return false;
  return days.includes(date.getDay());
}

/**
 * Is `date`'s time-of-day within activeHours?
 * - null/missing → all day. Malformed or equal start/end → fail open (all day).
 * - Supports overnight windows (e.g. 22:00–06:00).
 * - End is exclusive (a 06:00–12:00 window does NOT include exactly 12:00).
 */
export function isActiveHour(config, date) {
  const hours = config ? config.activeHours : null;
  if (!hours || !hours.start || !hours.end) return true;
  const start = parseHm(hours.start);
  const end = parseHm(hours.end);
  if (start == null || end == null) return true;
  if (start === end) return true;
  const cur = date.getHours() * 60 + date.getMinutes();
  if (start < end) return cur >= start && cur < end;
  // Overnight window: active from `start` to end-of-day, and midnight to `end`.
  return cur >= start || cur < end;
}

/**
 * Is `date`'s month within the active season?
 * - null/missing → all year. Malformed month → fail open (all year).
 * - Months are 1-12. Supports wraparound (e.g. Nov(11)–Feb(2)).
 */
export function isActiveSeason(config, date) {
  const season = config ? config.activeSeason : null;
  if (!season || season.startMonth == null || season.endMonth == null) return true;
  const start = Number(season.startMonth);
  const end = Number(season.endMonth);
  const valid =
    Number.isInteger(start) && Number.isInteger(end) &&
    start >= 1 && start <= 12 && end >= 1 && end <= 12;
  if (!valid) return true;
  const month = date.getMonth() + 1;
  if (start <= end) return month >= start && month <= end;
  return month >= start || month <= end;
}

/** All three windows (day + hour + season) must be active. */
export function isWithinActiveWindow(config, date) {
  return isActiveDay(config, date) && isActiveHour(config, date) && isActiveSeason(config, date);
}

/**
 * Did the trip last at least `minTripMinutes`? Used to suppress false alarms
 * on brief connect/disconnect (walking past the car, a gas stop).
 *
 * SAFETY-FIRST: unknown times or a backwards clock jump → return true (allow
 * the alert) rather than risk suppressing a real trip. The Kotlin runtime
 * MUST use a monotonic clock (SystemClock.elapsedRealtime) so the backwards-
 * jump branch never actually fires in production.
 */
export function meetsMinDuration(tripStartMs, nowMs, minTripMinutes) {
  if (!Number.isFinite(tripStartMs) || !Number.isFinite(nowMs)) return true;
  const elapsedMs = nowMs - tripStartMs;
  if (elapsedMs < 0) return true;
  const min = Number.isFinite(minTripMinutes) ? Math.max(0, minTripMinutes) : 0;
  return elapsedMs >= min * 60 * 1000;
}

/**
 * The top-level decision: should the alert fire for this trip?
 * Note: device matching (was the disconnected device one of the user's cars?)
 * happens upstream in the native receiver — by the time we get here the trip
 * is already known to belong to a configured car.
 */
export function shouldAlert(config, tripStartMs, nowMs) {
  if (!config || !config.enabled) return false;
  // SAFETY-FIRST window semantics (product decision 2026-06-23): the active
  // window counts as satisfied if EITHER the trip start OR the trip end falls
  // inside it. This catches trips that cross a window boundary — e.g. picking
  // up a child at 17:55 with a 06:00–18:00 window but parking at 18:10. We
  // err toward alerting rather than miss a boundary trip.
  const endActive = isWithinActiveWindow(config, new Date(nowMs));
  const startActive = Number.isFinite(tripStartMs)
    ? isWithinActiveWindow(config, new Date(tripStartMs))
    : false;
  if (!endActive && !startActive) return false;
  if (!meetsMinDuration(tripStartMs, nowMs, config.minTripMinutes)) return false;
  return true;
}
