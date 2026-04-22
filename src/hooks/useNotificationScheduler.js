/**
 * Hook that schedules device notifications when vehicles/documents change.
 * Runs on Dashboard mount for authenticated users.
 *
 * Usage:
 *   const { unreadCount } = useNotificationScheduler(vehicles, accountId);
 *
 * Documents are loaded internally (by accountId) so the Dashboard doesn't
 * need to fetch them just for notifications.
 */
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/components/shared/GuestContext';
import { scheduleAllReminders, DEFAULT_REMINDER_SETTINGS } from '@/lib/notificationService';
import { getUnreadCount } from '@/lib/notificationChannels';
import { db } from '@/lib/supabaseEntities';

export default function useNotificationScheduler(vehicles = [], accountId = null) {
  const { user, isGuest } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  // Fingerprint of the data we last scheduled with, so we only re-run
  // when something material changed (not on every render).
  const lastFingerprint = useRef('');

  useEffect(() => {
    if (isGuest || !user?.id) return;
    if (!vehicles.length) return;

    // Stable fingerprint of vehicles. id + every date/odometer field that
    // feeds the engine. If none of these change, scheduling would be a no-op.
    const fp = vehicles
      .map(v => [
        v.id,
        v.test_due_date, v.insurance_due_date,
        v.pyrotechnics_expiry_date, v.fire_extinguisher_expiry_date, v.life_raft_expiry_date,
        v.current_km, v.current_engine_hours,
        v.km_baseline, v.last_tire_change_date, v.km_since_tire_change,
        v.last_shipyard_date, v.km_update_date, v.engine_hours_update_date,
      ].join('|'))
      .join('~');

    if (fp === lastFingerprint.current) return;
    lastFingerprint.current = fp;

    let cancelled = false;
    async function schedule() {
      try {
        // Load user's reminder settings
        let settings = DEFAULT_REMINDER_SETTINGS;
        try {
          const rows = await db.reminder_settings.filter({ user_id: user.id });
          if (rows.length > 0) settings = { ...DEFAULT_REMINDER_SETTINGS, ...rows[0] };
        } catch {
          // Table missing. use defaults
        }

        // Load documents so the engine can emit document reminders too.
        let documents = [];
        if (accountId) {
          try {
            documents = await db.documents.filter({ account_id: accountId });
          } catch {
            // Table missing or RLS blocked. engine just won't emit document items
          }
        }

        if (cancelled) return;
        await scheduleAllReminders(vehicles, settings, documents);
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[useNotificationScheduler] Error:', e);
      }
    }

    schedule();
    return () => { cancelled = true; };
  }, [vehicles, user?.id, isGuest, accountId]);

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
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [user?.id, isGuest]);

  return { unreadCount };
}
