/**
 * Notification Service. schedules local device notifications
 * from vehicle reminder data.
 *
 * Pattern: cancel-all → recalculate → schedule-new (idempotent)
 * Called whenever vehicles/documents/settings change.
 *
 * Design: the ReminderEngine is the single source of truth for what
 * appears in-app. We take its output verbatim (label/emoji/typeName)
 * and turn it into device notifications. If the engine changes what it
 * emits, push automatically follows. no template drift.
 */

import { calcReminders } from '@/components/shared/ReminderEngine';
import { isVessel } from '@/components/shared/DateStatusUtils';
import {
  scheduleLocalNotification,
  cancelAllLocalNotifications,
  requestNotificationPermission,
  createNotificationChannel,
  checkNotificationPermission,
} from './notificationChannels';
import { isNative } from './capacitor';

// Deep-link targets when the user taps an "expired" notification.
// Test / כושר שייט → send straight to the gov.il renewal flow. Other types
// (insurance, documents, maintenance) go to the vehicle's detail page.
const GOV_RENEWAL = {
  car:    'https://www.gov.il/he/service/car_licence_renewal',
  vessel: 'https://www.gov.il/he/service/renewing_vessel_license',
};

//  Default reminder settings 
export const DEFAULT_REMINDER_SETTINGS = {
  remind_test_days_before: 14,
  remind_insurance_days_before: 14,
  remind_document_days_before: 14,
  remind_maintenance_days_before: 7,
  overdue_repeat_every_days: 3,
  daily_job_hour: 8,
  // email_enabled default: TRUE. Reminder emails are operational (the
  // user signed up to get reminders; this is the channel they reach
  // through), not marketing. Marketing opt-in lives in a separate table
  // (user_notification_preferences per notification_key) so true here
  // does not subscribe anyone to marketing. Mirror change is in
  // src/pages/ReminderSettingsPage.jsx DEFAULT_FORM.
  email_enabled: true,
  whatsapp_enabled: false,
};

//  Limits
// Android AlarmManager comfortably handles months out, but scheduling too
// many pending alarms slows the system + our cancel-all loop. Cap sanely.
const MAX_SCHEDULE_HORIZON_DAYS = 90;
const MAX_OVERDUE_REPEATS       = 3;

// Persistent passive reminders (mileage/seasonal) carry a sentinel large
// daysLeft from the engine so they sort last. We detect them to give them
// a gentle "tomorrow morning" slot instead of scheduling years in advance.
const PASSIVE_DAYS_THRESHOLD = 365;

// Cool-down (ms) for "passive" nudges (daysLeft ≥ PASSIVE_DAYS_THRESHOLD).
// Without this every recalc — and recalc runs on every app open, every
// vehicle save, every reminder-settings change — re-plants a "tomorrow
// 08:00" alarm. A user who opens the app daily would see the same nudge
// every morning until they update their km or dismiss the seasonal banner.
//
// Originally scoped to type='mileage' (commit c0b2610) but the same
// daily-spam pathology applies to the winter-prep and sailing-season
// reminders during their active month — the engine's `*_dismissed_<year>`
// localStorage flag only fires when the user explicitly dismisses from
// the bell UI, NOT when the scheduler plants a new alarm. So during
// November / April a user got "הכן את הרכב לחורף" every single morning
// until they manually dismissed.
//
// Now applies to ALL reminders with daysLeft ≥ PASSIVE_DAYS_THRESHOLD —
// they all share the "I'm a soft nudge, not a real deadline" semantics
// and benefit from the same cadence cap.
const PASSIVE_NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PASSIVE_LAST_FIRED_PREFIX = 'cr_passive_nudge_last_';

// Anti-spam dedup for the "immediate" alarm slot (overdue +1h and upcoming
// morning-of-trigger). Without this, every recalc — which runs on every
// Dashboard mount + every vehicle save — cancels and re-plants the same
// +1h alarm. The result, reported by users (2026-05-28): a flood of push
// notifications about overdue items fires roughly one hour after EVERY
// app open. The marker stores the timestamp at which the immediate alarm
// is expected to fire. Three states:
//   - marker > now  → alarm planted, not yet fired. Re-plant at same time.
//   - marker > 0 && now-marker < cooldown → already fired recently. Skip.
//   - else → no prior fire OR cooldown expired → plant new immediate.
//
// SEPARATE MARKERS PER PHASE (revision 2026-05-28b, PM critique):
// Using a single key for both upcoming and overdue meant a reminder
// transitioning upcoming→overdue would inherit the upcoming cooldown
// and silently suppress the critical "you just became overdue" +1h
// nudge for up to 3 days. Now we track upcoming and overdue phases
// independently — phase transition always allows a fresh immediate
// nudge because the overdue marker is unset when entering overdue
// for the first time.
//
// Cooldowns:
//   - overdue: respects user's overdue_repeat_every_days setting (3d default).
//   - upcoming: 24h. The reminder reappears in-app via the bell; we don't
//     need to push daily about a deadline that hasn't passed yet.
const OVERDUE_FIRE_AT_PREFIX  = 'cr_reminder_overdue_at_';

// Upcoming reminders fire on DISCRETE milestones, each at most ONCE — never
// on a daily cooldown (the old 24h scheme re-notified roughly every day a
// user opened the app while a reminder sat in its window). The marker stores
// the planned fire time per (reminder, milestone); see the upcoming branch.
const MILESTONE_FIRE_AT_PREFIX = 'cr_reminder_ms_at_';
// A near-due "final nudge" that complements the configured `daysBefore`
// heads-up, so even a long lead time still gets one gentle reminder close to
// the deadline. Only added when it is genuinely closer than `daysBefore`.
const FINAL_REMINDER_DAYS = 3;

// Global "app opened recently" suppression. When the user opens the app,
// they're actively engaged — they've already seen the reminders in the
// bell. Pushing a fresh notification ~1h later is the worst kind of
// spam: redundant AND poorly timed. We record the open time and refuse
// to plant ANY +1h immediate slot within this window.
//
// Why 6 hours and not 24: a user who opens at 8am and runs errands all
// day deserves a 4pm reminder if their test expired at noon. 6h is the
// "I just used the app, don't bug me about what I just saw" boundary
// without blocking legitimately fresh nudges in the same day.
const APP_OPEN_TS_KEY = 'cr_app_last_opened_ts';
const APP_OPEN_SUPPRESS_MS = 6 * 60 * 60 * 1000;

function getMarker(prefix, reminderId) {
  try {
    const v = Number(localStorage.getItem(prefix + reminderId) || '0');
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

function setMarker(prefix, reminderId, ts) {
  try {
    localStorage.setItem(prefix + reminderId, String(ts));
  } catch { /* storage unavailable — degrade to old behaviour */ }
}

function recordAppOpen() {
  try {
    localStorage.setItem(APP_OPEN_TS_KEY, String(Date.now()));
  } catch {}
}

function appOpenedRecently() {
  try {
    const ts = Number(localStorage.getItem(APP_OPEN_TS_KEY) || '0');
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return (Date.now() - ts) < APP_OPEN_SUPPRESS_MS;
  } catch { return false; }
}

//  Per-type "days before due" lookup 
function daysBeforeFor(type, settings) {
  switch (type) {
    case 'test':        return settings.remind_test_days_before        ?? 14;
    case 'insurance':   return settings.remind_insurance_days_before   ?? 14;
    case 'document':    return settings.remind_document_days_before    ?? 14;
    case 'safety':      return settings.remind_safety_days_before      ?? settings.remind_document_days_before ?? 14;
    case 'maintenance': return settings.remind_maintenance_days_before ?? 7;
    default:            return 7;
  }
}

//  User's per-type on/off toggles 
// Absent key (mileage/seasonal/brakes→safety) means "not overridden" → send.
function isTypeMuted(type, settings) {
  const map = {
    test:        settings.notify_test,
    insurance:   settings.notify_insurance,
    maintenance: settings.notify_maintenance,
    document:    settings.notify_document,
    safety:      settings.notify_safety,
  };
  return map[type] === false;
}

//  Schedule time computation 
/**
 * Decide when to fire this reminder as a push.
 * Returns an array of Date objects (one per firing, possibly multiple for
 * overdue repeats).
 */
function computeScheduleTimes(reminder, settings) {
  const now = Date.now();
  const hour = settings.daily_job_hour ?? 8;

  // Build the morning slot `daysOffset` days from now.
  const morningSlot = (daysOffset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  // Passive reminders (mileage/seasonal). always next morning.
  if (reminder.daysLeft >= PASSIVE_DAYS_THRESHOLD) {
    return [morningSlot(1)];
  }

  // Overdue. nudge once in ~1 hour, then repeat every N days (capped).
  if (reminder.daysLeft <= 0) {
    // km-based "urgent" items (tires, periodic service, shipyard) have
    // no real dueDate — the engine sets daysLeft=0 as a severity marker,
    // not as a calendar overdue. Escalating those through the full
    // +1h → +Nd → +2Nd → +3Nd loop spams a user about a wear item
    // that doesn't change in 24h. One gentle morning push is enough;
    // the engine will re-emit the reminder daily until the underlying
    // condition (km baseline, shipyard date) resolves, and the next
    // recalc after dismissal will see no item and cancel cleanly.
    if (reminder.dueDate == null) {
      return [morningSlot(1)];
    }

    // Real overdue — a date-bound deadline has passed (test, insurance,
    // license, document, etc.). Escalate to nudge the user firmly:
    // first within the hour, then a morning repeat every N days up to
    // MAX_OVERDUE_REPEATS times.
    //
    // Clamp to [1, 30]. A user typing 0, NaN, or negative would otherwise
    // round up to 1 via Math.max and flood the device with a push every
    // morning, forever. 30 is an upper bound — longer intervals suggest
    // the feature is effectively off.
    const parsed = Number(settings.overdue_repeat_every_days);
    const repeatEvery = Number.isFinite(parsed) && parsed >= 1
      ? Math.min(30, Math.floor(parsed))
      : 3;

    // Anti-spam dedup: track when the +1h immediate was last planted.
    // Without this, every recalc (= every Dashboard mount) plants a new
    // +1h alarm, which fires ~1h after every app open. Users with
    // multiple overdue items were getting a flood of push notifications
    // every time they entered the app (reported 2026-05-28).
    //
    // OVERDUE-SPECIFIC marker (rev 2026-05-28b): separate from upcoming
    // so a reminder freshly transitioning from upcoming→overdue gets a
    // proper "you just missed it" +1h push — even if the upcoming
    // cooldown was still active.
    const cooldownMs = repeatEvery * 24 * 60 * 60 * 1000;
    const prevImmediateAt = getMarker(OVERDUE_FIRE_AT_PREFIX, reminder.id);
    const futureTimes = [];
    for (let i = 1; i <= MAX_OVERDUE_REPEATS; i++) {
      futureTimes.push(morningSlot(i * repeatEvery));
    }

    if (prevImmediateAt > now) {
      // Previous +1h alarm hasn't fired yet — cancel-all just removed it.
      // Re-plant at the same time so the user still gets that nudge.
      return [new Date(prevImmediateAt), ...futureTimes];
    }
    if (prevImmediateAt > 0 && (now - prevImmediateAt) < cooldownMs) {
      // Already nudged recently — skip the immediate, plant only the
      // future morning repeats. The next overdue push will be the
      // soonest morningSlot (which respects repeatEvery).
      return futureTimes;
    }

    // Global "user just opened the app" suppression. They're actively
    // engaged — pushing a +1h about an item they already saw in the
    // bell is exactly the spam users complained about. Plant only the
    // future morning repeats; they'll catch the user a few days later
    // when they're not actively in the app.
    if (appOpenedRecently()) {
      return futureTimes;
    }

    // First overdue OR cooldown expired — plant a fresh +1h immediate
    // and remember its fire time so the next recalc respects it.
    const immediateAt = now + 60 * 60 * 1000;
    setMarker(OVERDUE_FIRE_AT_PREFIX, reminder.id, immediateAt);
    return [new Date(immediateAt), ...futureTimes];
  }

  // ── Upcoming (daysLeft > 0): discrete one-shot milestones ────────────
  // A reminder fires AT MOST ONCE per threshold it crosses — NOT once a day,
  // and NOT on every app open. The previous scheme used a 24h cooldown, so a
  // reminder sitting in its "X days before" window re-notified ~daily as the
  // user opened the app (reported: "the notification pops every time I enter
  // the app"). Now each milestone owns a marker holding its planned fire
  // time:
  //   marker > now → alarm planted, not yet fired → re-plant at the SAME
  //                  time (cancel-all just erased it; do not shift it).
  //   marker > 0   → already fired (its time passed — possibly while the app
  //                  was closed) → milestone DONE, never re-fire.
  //   marker == 0  → not yet scheduled → plant it once and record its time.
  // Net effect: one push at `daysBefore` (e.g. 14d), one at
  // FINAL_REMINDER_DAYS (e.g. 3d), then the overdue branch takes over.
  // Completely silent between thresholds, regardless of how often the app
  // is opened.
  const daysBefore = Math.max(1, Math.floor(Number(daysBeforeFor(reminder.type, settings))) || 14);
  const milestones = (daysBefore > FINAL_REMINDER_DAYS
    ? [daysBefore, FINAL_REMINDER_DAYS]
    : [daysBefore]
  ).sort((a, b) => b - a);                       // descending, e.g. [14, 3]

  const msKey = (m) => `${reminder.id}_${m}`;

  // First-pass guard: if MORE THAN ONE milestone is already behind us with
  // no marker (e.g. a vehicle added when its test is 2 days out — both the
  // 14d and 3d milestones are in the past), fire only the most urgent and
  // silently mark the rest done. Without this we'd plant a "tomorrow 8am"
  // alarm for every crossed milestone at once → a burst of duplicates.
  const unfiredPast = milestones.filter(
    (m) => getMarker(MILESTONE_FIRE_AT_PREFIX, msKey(m)) === 0 && (reminder.daysLeft - m) <= 0,
  );
  if (unfiredPast.length > 1) {
    const keep = Math.min(...unfiredPast);       // smallest = closest to due = most urgent
    for (const m of unfiredPast) {
      if (m !== keep) setMarker(MILESTONE_FIRE_AT_PREFIX, msKey(m), 1); // 1 = "done long ago"
    }
  }

  const slots = [];
  for (const m of milestones) {
    const planned = getMarker(MILESTONE_FIRE_AT_PREFIX, msKey(m));
    if (planned > now) { slots.push(new Date(planned)); continue; }     // pending → re-plant
    if (planned > 0) continue;                                          // already fired → done
    const triggerInDays = reminder.daysLeft - m;
    if (triggerInDays > MAX_SCHEDULE_HORIZON_DAYS) continue;            // too far; a closer pass plants it
    // Future milestone → its own trigger morning. Just-crossed (≤0) → tomorrow.
    const slot = triggerInDays > 0 ? morningSlot(triggerInDays) : morningSlot(1);
    setMarker(MILESTONE_FIRE_AT_PREFIX, msKey(m), slot.getTime());
    slots.push(slot);
  }
  return slots;
}

//  Title / body from engine output 
// Uses `label` (already Hebrew, context-aware) as the body, and builds a
// concise title from emoji + vehicle/topic name.
function buildPayload(reminder) {
  const emoji = reminder.emoji || '🔔';
  const title = reminder.vehicleId && reminder.name
    ? `${emoji} ${reminder.name}`
    : `${emoji} ${reminder.label || reminder.typeName || 'תזכורת'}`;
  const body = reminder.label
    || (reminder.typeName ? `${reminder.typeName}: ${reminder.name || ''}` : 'יש תזכורת חדשה');
  return { title, body };
}

/**
 * Schedule all vehicle reminders as local device notifications.
 * Cancels all existing notifications first (idempotent).
 *
 * @param {Array} vehicles   - Vehicle objects
 * @param {Object} settings  - Reminder settings (falls back to defaults)
 * @param {Array} documents  - Document objects (optional)
 * @param {Object} [opts]    - Extra options
 * @param {Set<string>} [opts.snoozedKeys] - Set of "vehicleId:reminderType" keys to skip
 * @returns {{ scheduled: number, permissionDenied?: boolean }}
 */
export async function scheduleAllReminders(vehicles, settings = DEFAULT_REMINDER_SETTINGS, documents = [], { snoozedKeys } = {}) {
  if (!isNative) return { scheduled: 0 };

  const hasPermission = await checkNotificationPermission();
  if (!hasPermission) {
    const granted = await requestNotificationPermission();
    if (!granted) return { scheduled: 0, permissionDenied: true };
  }

  await createNotificationChannel();
  await cancelAllLocalNotifications();

  // Engine = single source of truth for what to notify about.
  const reminders = calcReminders({ vehicles, documents, settings });

  let scheduled = 0;
  for (const reminder of reminders) {
    if (reminder.daysLeft === null || reminder.daysLeft === undefined) continue;
    if (isTypeMuted(reminder.type, settings)) continue;

    // Skip snoozed reminders — user explicitly asked to silence this
    // (vehicleId, reminderType) pair for a while. The snoozeMap is
    // fetched by useNotificationScheduler before calling us.
    if (snoozedKeys && reminder.vehicleId && reminder.type) {
      const snoozeKey = `${reminder.vehicleId}:${reminder.type}`;
      if (snoozedKeys.has(snoozeKey)) continue;
    }

    // Passive-reminder cool-down: any reminder with daysLeft above the
    // passive threshold (mileage nudge / winter-prep / sailing-season /
    // any future "soft nudge" type) skips if we already fired it within
    // the last 7 days. Real-deadline reminders (test, insurance, docs,
    // …) keep their original "fire N days before due date" cadence —
    // the cool-down here is only for items that lack a real countdown
    // and would otherwise re-plant a new alarm on every app open.
    //
    // Wrapped in try/catch so a localStorage outage (private browsing,
    // full quota, disabled storage on Capacitor) degrades gracefully —
    // the user gets the old "schedule like before" behavior instead of
    // a broken notification loop.
    if (Number(reminder.daysLeft) >= PASSIVE_DAYS_THRESHOLD) {
      try {
        const key = PASSIVE_LAST_FIRED_PREFIX + reminder.id;
        const lastFiredRaw = localStorage.getItem(key);
        const lastFired = lastFiredRaw ? Number(lastFiredRaw) : 0;
        if (Number.isFinite(lastFired) && lastFired > 0
            && (Date.now() - lastFired) < PASSIVE_NUDGE_COOLDOWN_MS) {
          continue;
        }
        localStorage.setItem(key, String(Date.now()));
      } catch { /* storage unavailable — fall through to schedule */ }
    }

    const times = computeScheduleTimes(reminder, settings);
    if (times.length === 0) continue;

    const { title, body } = buildPayload(reminder);

    // Carry reminder metadata so the tap handler in initNotifications()
    // can route the user to the right screen or external URL.
    const vehicle = reminder.vehicleId ? vehicles.find(v => v.id === reminder.vehicleId) : null;
    const extra = {
      type: reminder.type,
      vehicleId: reminder.vehicleId || null,
      isVessel: vehicle ? !!isVessel(vehicle.vehicle_type, vehicle.nickname) : false,
      daysLeft: reminder.daysLeft,
    };

    for (let i = 0; i < times.length; i++) {
      // Suffix the id per-firing so repeats don't collide.
      const firingId = i === 0 ? String(reminder.id) : `${reminder.id}-r${i}`;
      await scheduleLocalNotification({
        id: firingId,
        title,
        body,
        scheduleAt: times[i],
        extra,
      });
      scheduled++;
    }
  }

  // Record this scheduling pass as the user's most recent "app open"
  // event AFTER the loop completes. This timestamp is read by the
  // appOpenedRecently() guard in computeScheduleTimes() on the NEXT
  // invocation (e.g., when the user navigates back to Dashboard within
  // a few hours). It deliberately does NOT affect THIS run — otherwise
  // the very first call would suppress its own +1h slots.
  recordAppOpen();

  if (import.meta.env.DEV) console.log(`[NotificationService] Scheduled ${scheduled} notifications`);
  return { scheduled };
}

/**
 * Fire a single test notification ~5 seconds from now. Used by the
 * settings page to let users confirm push is working end-to-end.
 */
export async function sendTestNotification() {
  if (!isNative) return { ok: false, reason: 'not_native' };

  const hasPermission = await checkNotificationPermission();
  if (!hasPermission) {
    const granted = await requestNotificationPermission();
    if (!granted) return { ok: false, reason: 'permission_denied' };
  }
  await createNotificationChannel();

  await scheduleLocalNotification({
    id: 'test-notification',
    title: '🔔 בדיקת התראות',
    body: 'אם אתה רואה את זה, הכל עובד! תזכורות יופיעו כך.',
    scheduleAt: new Date(Date.now() + 5 * 1000),
  });
  return { ok: true };
}

/**
 * Initialize notification system on app startup.
 * Creates the channel, asks for permission (once), wires the tap listener.
 */
export async function initNotifications() {
  if (!isNative) return;

  await createNotificationChannel();

  // Ask for permission once per install. We remember the outcome so we
  // don't re-prompt the user on every launch. Android shows a system
  // dialog, which would get annoying fast.
  const PROMPTED_KEY = 'cr_notif_prompted_v1';
  try {
    if (!localStorage.getItem(PROMPTED_KEY)) {
      const hasPermission = await checkNotificationPermission();
      if (!hasPermission) await requestNotificationPermission();
      localStorage.setItem(PROMPTED_KEY, '1');
    }
  } catch {}

  // Tap handler: route per reminder type.
  //   test / כושר שייט that's EXPIRED → open the gov.il renewal site directly
  //                                     in the in-app browser (Capacitor Browser).
  //   anything else, if we know the vehicle → open the vehicle's detail page.
  //   fallback → Notifications list.
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    LocalNotifications.addListener('localNotificationActionPerformed', async (evt) => {
      const extra = evt?.notification?.extra || {};
      const { type, vehicleId, isVessel: flaggedVessel, daysLeft, kind, serviceType } = extra;

      // Maintenance "next-service" reminder. Open the vehicle and ask
      // MaintenanceSection to pop the add-maintenance dialog pre-filled
      // with the same service kind ("טיפול קטן" / "טיפול גדול" / etc).
      // The user can adjust the date + km + cost, save, and a new log
      // is created. Matches the user-stated flow: "the reminder taps
      // through to a maintenance form with the type already known but
      // editable."
      if (kind === 'maintenance_next' && vehicleId) {
        const params = new URLSearchParams({ id: vehicleId, openMaintenance: '1' });
        if (serviceType) params.set('prefillType', serviceType);
        window.location.href = `/VehicleDetail?${params.toString()}`;
        return;
      }

      // Test-expiry → gov.il. Send overdue OR nearly-overdue (<= 7 days) to
      // save users the extra tap into VehicleDetail.
      if (type === 'test' && typeof daysLeft === 'number' && daysLeft <= 7) {
        const url = flaggedVessel ? GOV_RENEWAL.vessel : GOV_RENEWAL.car;
        try {
          const { Browser } = await import('@capacitor/browser');
          await Browser.open({ url });
        } catch {
          window.location.href = url; // fallback to external browser
        }
        return;
      }

      if (vehicleId) {
        window.location.href = `/VehicleDetail?id=${vehicleId}`;
        return;
      }

      window.location.href = '/Notifications';
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('Failed to set up notification listener:', e);
  }
}
