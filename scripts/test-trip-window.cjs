#!/usr/bin/env node
/**
 * Smoke tests for src/lib/tripWindow.js — the pure TripGuard decision logic.
 *
 * No test framework (matches the scripts/test-startup-logic.cjs convention).
 * Run with: `node scripts/test-trip-window.cjs`  (or `npm run test:trip-window`)
 * Exits 0 on pass, 1 on fail. Suitable for a CI / pre-push step.
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); passed++; }
  else { console.error('  ✗', msg); failed++; }
}
function section(label) { console.log('\n▸', label); }

(async () => {
  // tripWindow.js is pure ESM with no imports, so we can load it directly.
  const modUrl = pathToFileURL(path.resolve(__dirname, '..', 'src', 'lib', 'tripWindow.js')).href;
  const {
    isActiveDay,
    isActiveHour,
    isActiveSeason,
    isWithinActiveWindow,
    meetsMinDuration,
    shouldAlert,
  } = await import(modUrl);

  // A fixed reference date — Tue 2026-06-23, 10:00 local. We read its own
  // getDay() so the test is independent of the runner's timezone.
  const ref = new Date(2026, 5, 23, 10, 0);
  const refDow = ref.getDay();
  const noon = new Date(2026, 5, 23, 12, 0);

  section('isActiveDay');
  assert(isActiveDay({ activeDays: [refDow] }, ref) === true, 'active when weekday included');
  assert(isActiveDay({ activeDays: [(refDow + 1) % 7] }, ref) === false, 'inactive when weekday excluded');
  assert(isActiveDay({ activeDays: null }, ref) === true, 'null days → all days (default-on)');
  assert(isActiveDay({ activeDays: [] }, ref) === false, 'empty array → no active days');
  assert(isActiveDay({}, ref) === true, 'missing days → fail open (all days)');

  section('isActiveHour');
  assert(isActiveHour({ activeHours: null }, noon) === true, 'null hours → all day');
  assert(isActiveHour({ activeHours: { start: '08:00', end: '18:00' } }, noon) === true, 'within range');
  assert(isActiveHour({ activeHours: { start: '13:00', end: '18:00' } }, noon) === false, 'before range start');
  assert(isActiveHour({ activeHours: { start: '06:00', end: '12:00' } }, noon) === false, 'end is exclusive (12:00 not in 06–12)');
  assert(isActiveHour({ activeHours: { start: '22:00', end: '06:00' } }, new Date(2026, 5, 23, 23, 30)) === true, 'overnight: 23:30 inside 22–06');
  assert(isActiveHour({ activeHours: { start: '22:00', end: '06:00' } }, new Date(2026, 5, 23, 5, 0)) === true, 'overnight: 05:00 inside 22–06');
  assert(isActiveHour({ activeHours: { start: '22:00', end: '06:00' } }, noon) === false, 'overnight: midday excluded');
  assert(isActiveHour({ activeHours: { start: '09:00', end: '09:00' } }, noon) === true, 'equal start/end → all day (safety)');
  assert(isActiveHour({ activeHours: { start: 'bad', end: '09:00' } }, noon) === true, 'malformed start → fail open');
  // G1 — start boundary inclusivity (false-negative risk at the edge):
  assert(isActiveHour({ activeHours: { start: '12:00', end: '18:00' } }, noon) === true, 'start boundary inclusive (12:00 in 12–18)');
  assert(isActiveHour({ activeHours: { start: '22:00', end: '06:00' } }, new Date(2026, 5, 23, 22, 0)) === true, 'overnight start boundary inclusive (22:00)');
  assert(isActiveHour({ activeHours: { start: '22:00', end: '06:00' } }, new Date(2026, 5, 23, 6, 0)) === false, 'overnight end boundary exclusive (06:00)');
  assert(isActiveHour({ activeHours: { start: '08:00', end: 'bad' } }, noon) === true, 'malformed end → fail open');
  assert(isActiveHour({ activeHours: { start: '', end: '18:00' } }, noon) === true, 'empty start string → all day');

  section('isActiveSeason');
  const june = new Date(2026, 5, 15);
  const january = new Date(2026, 0, 15);
  assert(isActiveSeason({ activeSeason: null }, june) === true, 'null season → all year');
  assert(isActiveSeason({ activeSeason: { startMonth: 5, endMonth: 9 } }, june) === true, 'June within May–Sep');
  assert(isActiveSeason({ activeSeason: { startMonth: 7, endMonth: 9 } }, june) === false, 'June before Jul–Sep');
  assert(isActiveSeason({ activeSeason: { startMonth: 11, endMonth: 2 } }, january) === true, 'wraparound Nov–Feb includes Jan');
  assert(isActiveSeason({ activeSeason: { startMonth: 11, endMonth: 2 } }, june) === false, 'wraparound Nov–Feb excludes Jun');
  assert(isActiveSeason({ activeSeason: { startMonth: 0, endMonth: 13 } }, june) === true, 'malformed months → fail open');
  // G5 — single-month season + partial config:
  assert(isActiveSeason({ activeSeason: { startMonth: 6, endMonth: 6 } }, june) === true, 'single-month season includes that month');
  assert(isActiveSeason({ activeSeason: { startMonth: 7, endMonth: 7 } }, june) === false, 'single-month season excludes other months');
  assert(isActiveSeason({ activeSeason: { startMonth: 6, endMonth: null } }, june) === true, 'partial season (missing end) → all year');

  section('meetsMinDuration');
  const t0 = 1_700_000_000_000;
  assert(meetsMinDuration(t0, t0 + 3 * 60000, 2) === true, '3 min ≥ 2 min threshold');
  assert(meetsMinDuration(t0, t0 + 60000, 2) === false, '1 min < 2 min threshold');
  assert(meetsMinDuration(t0, t0 + 2 * 60000, 2) === true, 'exactly 2 min meets threshold');
  assert(meetsMinDuration(t0, t0 - 5000, 2) === true, 'backwards clock → alert (safety)');
  assert(meetsMinDuration(NaN, t0, 2) === true, 'unknown start → alert (safety)');
  assert(meetsMinDuration(t0, t0, 0) === true, 'zero threshold always meets');

  section('shouldAlert');
  const base = {
    enabled: true,
    carDeviceIds: ['x'],
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    activeHours: null,
    activeSeason: null,
    minTripMinutes: 2,
  };
  const start = new Date(2026, 5, 23, 10, 0).getTime();
  const end = new Date(2026, 5, 23, 10, 5).getTime();
  assert(shouldAlert(base, start, end) === true, 'happy path → alert');
  assert(shouldAlert({ ...base, enabled: false }, start, end) === false, 'disabled → no alert');
  assert(shouldAlert({ ...base, minTripMinutes: 10 }, start, end) === false, 'under threshold → no alert');
  const endDow = new Date(end).getDay();
  assert(shouldAlert({ ...base, activeDays: [(endDow + 1) % 7] }, start, end) === false, 'outside active day → no alert');
  assert(shouldAlert(null, start, end) === false, 'null config → no alert');
  // G2 — enabled must be explicit (a lost/undefined flag must NOT alert):
  assert(shouldAlert({ ...base, enabled: undefined }, start, end) === false, 'enabled undefined → no alert');
  // G4 — each window dimension blocks independently:
  assert(shouldAlert({ ...base, activeHours: { start: '00:00', end: '09:00' } }, start, end) === false, 'outside active hour → no alert');
  assert(shouldAlert({ ...base, activeSeason: { startMonth: 1, endMonth: 3 } }, start, end) === false, 'outside active season → no alert');
  // Window semantics (product decision 2026-06-23): alert if EITHER the trip
  // start OR the trip end is inside the active window — safety-first for
  // boundary-crossing trips.
  const win = { start: '06:00', end: '18:00' };
  // starts in-window (17:55), ends out (18:10) → ALERT.
  assert(
    shouldAlert({ ...base, activeHours: win }, new Date(2026, 5, 23, 17, 55).getTime(), new Date(2026, 5, 23, 18, 10).getTime()) === true,
    'starts in-window, ends out → alert (either-endpoint)'
  );
  // starts out (05:55), ends in-window (06:30) → ALERT.
  assert(
    shouldAlert({ ...base, activeHours: win }, new Date(2026, 5, 23, 5, 55).getTime(), new Date(2026, 5, 23, 6, 30).getTime()) === true,
    'starts out, ends in-window → alert (either-endpoint)'
  );
  // both endpoints out-of-window (04:00→05:00, before a 06:00 window) → no alert.
  assert(
    shouldAlert({ ...base, activeHours: win }, new Date(2026, 5, 23, 4, 0).getTime(), new Date(2026, 5, 23, 5, 0).getTime()) === false,
    'both endpoints out-of-window → no alert'
  );

  // ── PARITY fixtures: the SAME file the Java unit test reads
  // (android/app/src/test/resources/tripwindow-fixtures.json). This locks
  // src/lib/tripWindow.js and TripGuardWindow.java to identical behaviour. ──
  const fixturesPath = path.resolve(
    __dirname, '..', 'android', 'app', 'src', 'test', 'resources', 'tripwindow-fixtures.json'
  );
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

  section('PARITY fixtures — window (shared with TripGuardWindowTest.java)');
  for (const f of fixtures.window) {
    const date = new Date(f.y, f.mo - 1, f.d, f.h, f.mi);
    assert(isWithinActiveWindow(f.config, date) === f.expected, `window: ${f.name}`);
  }

  section('PARITY fixtures — duration (shared with TripGuardWindowTest.java)');
  for (const f of fixtures.duration) {
    assert(meetsMinDuration(f.startElapsed, f.nowElapsed, f.minMinutes) === f.expected, `duration: ${f.name}`);
  }

  console.log(`\n${failed ? '✗' : '✓'} tripWindow: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
