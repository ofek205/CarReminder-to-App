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
import { isViewAs } from '@/lib/viewAsState';

export default function useNotificationScheduler(vehicles = [], accountId = null) {
  const { user, isGuest } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  // Fingerprint of the data we last scheduled with, so we only re-run
  // when something material changed (not on every render).
  const lastFingerprint = useRef('');

  useEffect(() => {
    if (isGuest || !user?.id) return;
    // During admin view-as, the loaded vehicles belong to the TARGET account
    // but the device + reminder settings are the ADMIN's. Scheduling here would
    // put the target's reminders on the admin's phone and pollute non-user-keyed
    // localStorage markers. Hard-skip — never schedule while viewing-as.
    if (isViewAs()) return;
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

        // Load active snoozes so snoozed reminders don't fire push.
        // Uses the same "vehicleId:reminderType" key format as
        // useReminderSnooze, but we don't call the hook — this is a
        // plain async function, not a React component.
        const snoozedKeys = new Set();
        try {
          const snoozeRows = await db.reminder_snoozes.filter(
            { user_id: user.id },
            { select: 'vehicle_id,reminder_type,snoozed_until' }
          );
          const now = new Date();
          for (const r of snoozeRows) {
            if (new Date(r.snoozed_until) > now) {
              snoozedKeys.add(`${r.vehicle_id}:${r.reminder_type}`);
            }
          }
        } catch {
          // Table missing or RLS issue — proceed without snooze filtering
        }

        if (cancelled) return;
        await scheduleAllReminders(vehicles, settings, documents, { snoozedKeys });
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[useNotificationScheduler] Error:', e);
      }
    }

    schedule();
    return () => { cancelled = true; };
  }, [vehicles, user?.id, isGuest, accountId]);

  // Unread-count poll: shared module-level singleton so multiple mounts
  // (StrictMode double-mount, or the hook being added to a second screen
  // by accident) don't multiply the request rate. The actual `setInterval`
  // fires at most once across the whole app; every subscriber receives
  // the latest count via the snapshot ref + setState.
  useEffect(() => {
    if (isGuest || !user?.id) return;
    // Don't poll/show the admin's own unread count on the target's dashboard.
    if (isViewAs()) return;

    const cleanup = subscribeUnreadCount(user.id, setUnreadCount);
    return cleanup;
  }, [user?.id, isGuest]);

  return { unreadCount };
}

// ─── Module-level unread-count poll (singleton) ─────────────────────────
// Replaces the per-hook setInterval. Tracks the latest value + every
// subscriber. The poll only runs while at least one subscriber is alive.
const POLL_INTERVAL_MS = 90 * 1000; // every 90s — backed by realtime invalidation
const _unreadSubscribers = new Map(); // userId → Set<setter>
let _unreadPollTimer = null;
let _unreadLatest = 0;

async function _pollUnread(userId) {
  try {
    const count = await getUnreadCount(userId);
    _unreadLatest = count;
    const subs = _unreadSubscribers.get(userId);
    if (subs) for (const setter of subs) setter(count);
  } catch {
    // Table might not exist yet — silent retry on next tick.
  }
}

function subscribeUnreadCount(userId, setter) {
  if (!_unreadSubscribers.has(userId)) _unreadSubscribers.set(userId, new Set());
  _unreadSubscribers.get(userId).add(setter);
  // Push the last known value immediately so the new subscriber doesn't
  // wait a full poll cycle to render.
  setter(_unreadLatest);
  // Kick off (or piggy-back on) the shared poll.
  _pollUnread(userId);
  if (!_unreadPollTimer) {
    _unreadPollTimer = setInterval(() => {
      // Poll for every distinct user that has subscribers.
      for (const uid of _unreadSubscribers.keys()) _pollUnread(uid);
    }, POLL_INTERVAL_MS);
  }
  return () => {
    const subs = _unreadSubscribers.get(userId);
    if (subs) {
      subs.delete(setter);
      if (subs.size === 0) _unreadSubscribers.delete(userId);
    }
    // If no one is listening, stop polling. Resumes the moment a new
    // hook mounts (e.g. user comes back to the app).
    if (_unreadSubscribers.size === 0 && _unreadPollTimer) {
      clearInterval(_unreadPollTimer);
      _unreadPollTimer = null;
    }
  };
}
