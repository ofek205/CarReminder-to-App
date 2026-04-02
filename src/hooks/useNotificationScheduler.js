/**
 * Hook that schedules device notifications when the app opens.
 * Runs on Dashboard mount for authenticated users.
 *
 * Usage:
 *   const { unreadCount } = useNotificationScheduler(vehicles, accountId);
 */
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/components/shared/GuestContext';
import { isNative } from '@/lib/capacitor';
import { scheduleAllReminders, DEFAULT_REMINDER_SETTINGS } from '@/lib/notificationService';
import { getUnreadCount } from '@/lib/notificationChannels';
import { db } from '@/lib/supabaseEntities';

export default function useNotificationScheduler(vehicles = [], accountId = null) {
  const { user, isGuest } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const scheduledRef = useRef(false);

  // Schedule notifications when vehicles change
  useEffect(() => {
    if (isGuest || !user?.id || !vehicles.length) return;
    if (scheduledRef.current) return; // Only schedule once per app session

    async function schedule() {
      try {
        // Load user's reminder settings
        let settings = DEFAULT_REMINDER_SETTINGS;
        try {
          const rows = await db.reminder_settings.filter({ user_id: user.id });
          if (rows.length > 0) {
            settings = { ...DEFAULT_REMINDER_SETTINGS, ...rows[0] };
          }
        } catch {
          // Table might not exist yet — use defaults
        }

        // Schedule device notifications
        await scheduleAllReminders(vehicles, settings);
        scheduledRef.current = true;
      } catch (e) {
        console.warn('[useNotificationScheduler] Error:', e);
      }
    }

    schedule();
  }, [vehicles.length, user?.id, isGuest]);

  // Fetch unread count
  useEffect(() => {
    if (isGuest || !user?.id) return;

    async function fetchUnread() {
      try {
        const count = await getUnreadCount(user.id);
        setUnreadCount(count);
      } catch {
        // Table might not exist yet
      }
    }

    fetchUnread();
    // Refresh every 60 seconds
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [user?.id, isGuest]);

  return { unreadCount };
}
