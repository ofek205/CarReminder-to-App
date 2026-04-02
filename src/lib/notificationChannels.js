/**
 * Notification Channels — abstract interface for sending notifications.
 *
 * Current channels:
 *   - local: Android device notifications via @capacitor/local-notifications
 *   - inApp: Persisted in notification_log table (Supabase)
 *
 * Future channels (not implemented, architecture ready):
 *   - email: Supabase Edge Function + Resend/SendGrid
 *   - whatsapp: WhatsApp Business API
 */

import { isNative } from './capacitor';
import { db } from './supabaseEntities';

// ── Stable numeric ID from string (Capacitor requires numeric IDs) ─────────
function hashStringToInt(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7FFFFFFF;
  }
  return hash;
}

// ── Local Notifications (Android device) ───────────────────────────────────
export async function scheduleLocalNotification({ id, title, body, scheduleAt }) {
  if (!isNative) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    const numericId = typeof id === 'number' ? id : hashStringToInt(String(id));

    await LocalNotifications.schedule({
      notifications: [{
        id: numericId,
        title,
        body,
        schedule: { at: new Date(scheduleAt) },
        channelId: 'car-reminders',
        smallIcon: 'ic_notification',
        largeIcon: 'ic_notification',
        sound: 'default',
        extra: { reminderId: String(id) },
      }],
    });
    return numericId;
  } catch (e) {
    console.warn('Failed to schedule local notification:', e);
    return null;
  }
}

export async function cancelAllLocalNotifications() {
  if (!isNative) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel(pending);
    }
  } catch (e) {
    console.warn('Failed to cancel notifications:', e);
  }
}

export async function requestNotificationPermission() {
  if (!isNative) return true; // Web doesn't need permission for in-app
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
  } catch (e) {
    console.warn('Failed to request notification permission:', e);
    return false;
  }
}

export async function checkNotificationPermission() {
  if (!isNative) return true;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const result = await LocalNotifications.checkPermissions();
    return result.display === 'granted';
  } catch (e) {
    return false;
  }
}

// ── Create notification channel (Android) ──────────────────────────────────
export async function createNotificationChannel() {
  if (!isNative) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel({
      id: 'car-reminders',
      name: 'תזכורות רכב',
      description: 'התראות על טסט, ביטוח וטיפולים',
      importance: 4, // HIGH
      visibility: 1, // PUBLIC
      sound: 'default',
      vibration: true,
    });
  } catch (e) {
    console.warn('Failed to create notification channel:', e);
  }
}

// ── In-App Notifications (Supabase notification_log) ───────────────────────
export async function sendInAppNotification({ userId, vehicleId, type, title, body }) {
  try {
    await db.notification_log.create({
      user_id: userId,
      vehicle_id: vehicleId || null,
      type,
      title,
      body: body || '',
      is_read: false,
      sent_via: 'app',
    });
  } catch (e) {
    console.warn('Failed to log in-app notification:', e);
  }
}

export async function markNotificationRead(notificationId) {
  try {
    await db.notification_log.update(notificationId, { is_read: true });
  } catch (e) {
    console.warn('Failed to mark notification read:', e);
  }
}

export async function getUnreadCount(userId) {
  try {
    const unread = await db.notification_log.filter({ user_id: userId, is_read: false });
    return unread.length;
  } catch (e) {
    return 0;
  }
}

// ── Future: Email Channel ──────────────────────────────────────────────────
// export async function sendEmailNotification({ to, subject, body }) {
//   // Supabase Edge Function + Resend/SendGrid
//   // await supabase.functions.invoke('send-email', { body: { to, subject, body } });
// }

// ── Future: WhatsApp Channel ───────────────────────────────────────────────
// export async function sendWhatsAppNotification({ phone, template, params }) {
//   // WhatsApp Business API
//   // await fetch('https://graph.facebook.com/v18.0/...', { ... });
// }
