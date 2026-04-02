/**
 * Notification Service — schedules local device notifications
 * from vehicle reminder data.
 *
 * Pattern: cancel-all → recalculate → schedule-new (idempotent)
 * Called on every app open and when vehicles/settings change.
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

// ── Hebrew notification templates ──────────────────────────────────────────
const NOTIFICATION_TEMPLATES = {
  test: {
    title: (vehicleName) => `טסט ${vehicleName} מתקרב`,
    body: (daysLeft) => daysLeft <= 0
      ? `הטסט פג תוקף! יש לחדש בהקדם`
      : `נותרו ${daysLeft} ימים לחידוש הטסט`,
  },
  insurance: {
    title: (vehicleName) => `ביטוח ${vehicleName}`,
    body: (daysLeft) => daysLeft <= 0
      ? `הביטוח פג תוקף! חדש עכשיו`
      : `נותרו ${daysLeft} ימים לחידוש הביטוח`,
  },
  safety: {
    title: (vehicleName) => `ציוד בטיחות — ${vehicleName}`,
    body: (daysLeft) => daysLeft <= 0
      ? `ציוד הבטיחות פג תוקף!`
      : `נותרו ${daysLeft} ימים לחידוש ציוד הבטיחות`,
  },
  document: {
    title: () => `מסמך פג תוקף`,
    body: (daysLeft) => daysLeft <= 0
      ? `יש מסמך שפג תוקפו`
      : `נותרו ${daysLeft} ימים לחידוש המסמך`,
  },
  maintenance: {
    title: (vehicleName) => `טיפול תקופתי — ${vehicleName}`,
    body: (daysLeft) => daysLeft <= 0
      ? `הגיע הזמן לטיפול!`
      : `נותרו ${daysLeft} ימים לטיפול הבא`,
  },
};

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

/**
 * Schedule all vehicle reminders as local device notifications.
 * Cancels all existing notifications first (idempotent).
 *
 * @param {Array} vehicles - Array of vehicle objects
 * @param {Object} settings - Reminder settings
 * @param {Array} documents - Array of document objects (optional)
 */
export async function scheduleAllReminders(vehicles, settings = DEFAULT_REMINDER_SETTINGS, documents = []) {
  if (!isNative) return { scheduled: 0 };

  // Check permission
  const hasPermission = await checkNotificationPermission();
  if (!hasPermission) {
    const granted = await requestNotificationPermission();
    if (!granted) return { scheduled: 0, permissionDenied: true };
  }

  // Ensure channel exists
  await createNotificationChannel();

  // Cancel all existing
  await cancelAllLocalNotifications();

  // Calculate reminders using existing engine
  const reminders = calcReminders({ vehicles, documents, settings });

  // Schedule notifications for the next 30 days
  let scheduled = 0;
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  for (const reminder of reminders) {
    if (reminder.daysLeft === null) continue;

    // Respect user's notification type preferences
    const typeToggles = {
      test: settings.notify_test,
      insurance: settings.notify_insurance,
      maintenance: settings.notify_maintenance,
      document: settings.notify_document,
      safety: settings.notify_safety,
    };
    if (typeToggles[reminder.type] === false) continue;

    // Calculate schedule time
    let scheduleAt;
    if (reminder.daysLeft <= 0) {
      // Overdue — notify in 1 hour (don't spam immediately)
      scheduleAt = new Date(now + 60 * 60 * 1000);
    } else if (reminder.daysLeft <= 30) {
      // Within 30 days — schedule for the morning of (days_before) the due date
      const dueDate = new Date(reminder.dueDate);
      scheduleAt = new Date(dueDate);
      scheduleAt.setHours(settings.daily_job_hour || 8, 0, 0, 0);

      // If the schedule time is in the past, notify tomorrow morning
      if (scheduleAt.getTime() < now) {
        scheduleAt = new Date(now);
        scheduleAt.setDate(scheduleAt.getDate() + 1);
        scheduleAt.setHours(settings.daily_job_hour || 8, 0, 0, 0);
      }
    } else {
      // More than 30 days away — skip (will be scheduled on next app open)
      continue;
    }

    // Only schedule if within 30-day window
    if (scheduleAt.getTime() - now > thirtyDays) continue;

    // Get template
    const template = NOTIFICATION_TEMPLATES[reminder.type] || NOTIFICATION_TEMPLATES.maintenance;
    const vehicleName = reminder.name || 'הרכב שלך';

    await scheduleLocalNotification({
      id: `${reminder.type}-${reminder.id}`,
      title: template.title(vehicleName),
      body: template.body(reminder.daysLeft),
      scheduleAt,
    });

    scheduled++;
  }

  console.log(`[NotificationService] Scheduled ${scheduled} notifications`);
  return { scheduled };
}

/**
 * Initialize notification system on app startup.
 */
export async function initNotifications() {
  if (!isNative) return;

  await createNotificationChannel();

  // Set up click listener
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      // When user taps a notification, navigate to Notifications page
      window.location.href = '/Notifications';
    });
  } catch (e) {
    console.warn('Failed to set up notification listener:', e);
  }
}
