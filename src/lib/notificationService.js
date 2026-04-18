/**
 * Notification Service — schedules local device notifications
 * from vehicle reminder data.
 *
 * Pattern: cancel-all → recalculate → schedule-new (idempotent)
 * Called whenever vehicles/documents/settings change.
 *
 * Design: the ReminderEngine is the single source of truth for what
 * appears in-app. We take its output verbatim (label/emoji/typeName)
 * and turn it into device notifications. If the engine changes what it
 * emits, push automatically follows — no template drift.
 */

import { calcReminders } from '@/components/shared/ReminderEngine';
import {
  scheduleLocalNotification,
  cancelAllLocalNotifications,
  requestNotificationPermission,
  createNotificationChannel,
  checkNotificationPermission,
} from './notificationChannels';
import { isNative } from './capacitor';

// ── Default reminder settings ──────────────────────────────────────────────
export const DEFAULT_REMINDER_SETTINGS = {
  remind_test_days_before: 14,
  remind_insurance_days_before: 14,
  remind_document_days_before: 14,
  remind_maintenance_days_before: 7,
  overdue_repeat_every_days: 3,
  daily_job_hour: 8,
  email_enabled: false,
  whatsapp_enabled: false,
};

// ── Limits ─────────────────────────────────────────────────────────────────
// Android AlarmManager comfortably handles months out, but scheduling too
// many pending alarms slows the system + our cancel-all loop. Cap sanely.
const MAX_SCHEDULE_HORIZON_DAYS = 90;
const MAX_OVERDUE_REPEATS       = 3;

// Persistent passive reminders (mileage/seasonal) carry a sentinel large
// daysLeft from the engine so they sort last. We detect them to give them
// a gentle "tomorrow morning" slot instead of scheduling years in advance.
const PASSIVE_DAYS_THRESHOLD = 365;

// ── Per-type "days before due" lookup ──────────────────────────────────────
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

// ── User's per-type on/off toggles ─────────────────────────────────────────
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

// ── Schedule time computation ──────────────────────────────────────────────
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

  // Passive reminders (mileage/seasonal) — always next morning.
  if (reminder.daysLeft >= PASSIVE_DAYS_THRESHOLD) {
    return [morningSlot(1)];
  }

  // Overdue — nudge once in ~1 hour, then repeat every N days (capped).
  if (reminder.daysLeft <= 0) {
    const repeatEvery = Math.max(1, Number(settings.overdue_repeat_every_days) || 3);
    const times = [new Date(now + 60 * 60 * 1000)]; // +1h
    for (let i = 1; i <= MAX_OVERDUE_REPEATS; i++) {
      times.push(morningSlot(i * repeatEvery));
    }
    return times;
  }

  // Upcoming — fire `daysBefore` days ahead of due date, at morning hour.
  const daysBefore = daysBeforeFor(reminder.type, settings);
  const triggerInDays = Math.max(0, reminder.daysLeft - daysBefore);

  // Out of horizon → skip; the next app open will reschedule.
  if (triggerInDays > MAX_SCHEDULE_HORIZON_DAYS) return [];

  // If trigger is already due today (daysLeft < daysBefore), fire tomorrow.
  const slot = triggerInDays === 0 ? morningSlot(1) : morningSlot(triggerInDays);
  return slot.getTime() > now ? [slot] : [morningSlot(1)];
}

// ── Title / body from engine output ────────────────────────────────────────
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
 * @returns {{ scheduled: number, permissionDenied?: boolean }}
 */
export async function scheduleAllReminders(vehicles, settings = DEFAULT_REMINDER_SETTINGS, documents = []) {
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

    const times = computeScheduleTimes(reminder, settings);
    if (times.length === 0) continue;

    const { title, body } = buildPayload(reminder);

    for (let i = 0; i < times.length; i++) {
      // Suffix the id per-firing so repeats don't collide.
      const firingId = i === 0 ? String(reminder.id) : `${reminder.id}-r${i}`;
      await scheduleLocalNotification({
        id: firingId,
        title,
        body,
        scheduleAt: times[i],
      });
      scheduled++;
    }
  }

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
  // don't re-prompt the user on every launch — Android shows a system
  // dialog, which would get annoying fast.
  const PROMPTED_KEY = 'cr_notif_prompted_v1';
  try {
    if (!localStorage.getItem(PROMPTED_KEY)) {
      const hasPermission = await checkNotificationPermission();
      if (!hasPermission) await requestNotificationPermission();
      localStorage.setItem(PROMPTED_KEY, '1');
    }
  } catch {}

  // Tap → open the Notifications page.
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    LocalNotifications.addListener('localNotificationActionPerformed', () => {
      window.location.href = '/Notifications';
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('Failed to set up notification listener:', e);
  }
}
