/**
 * useReminderSnooze — manage per-vehicle reminder snooze state.
 *
 * Reads active snoozes from DB on mount, provides snooze/unsnooze
 * mutations, and exposes an `isSnoozed(reminderId)` check that the
 * Notifications page and scheduler can use to filter muted reminders.
 *
 * The snooze key in DB is (user_id, vehicle_id, reminder_type).
 * Client-side reminder IDs follow the pattern `<prefix>-<vehicleId>`
 * from ReminderEngine. This hook maps between the two.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';

// ── Reminder ID → DB key mapping ────────────────────────────────

const PREFIX_TO_TYPE = {
  'test':      'test',
  'ins':       'insurance',
  'inspect':   'inspection',
  'tires':     'maintenance',
  'service':   'maintenance',
  'shipyard':  'maintenance',
  'brakes':    'safety',
  'mileage':   'mileage',
  'doc':       'document',
};

/**
 * Parse a ReminderEngine id like "test-<uuid>" into { vehicleId, reminderType }.
 * Safety items use multi-part prefixes like "fire_ext_living_quarters-<uuid>".
 * The vehicle ID is always a UUID at the end (36 chars with dashes).
 */
function parseReminderId(id) {
  if (!id || typeof id !== 'string') return null;

  // UUID is 36 chars: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  // Try to extract it from the end of the id
  const uuidRx = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const match = id.match(uuidRx);
  if (!match) return null;

  const vehicleId = match[0];
  const prefix = id.slice(0, id.length - vehicleId.length - 1); // strip trailing "-<uuid>"

  // Check known prefixes first
  if (PREFIX_TO_TYPE[prefix]) {
    return { vehicleId, reminderType: PREFIX_TO_TYPE[prefix] };
  }

  // Safety items: fire_ext_*, brakes, etc.
  if (prefix.startsWith('fire_ext') || prefix.startsWith('brakes')) {
    return { vehicleId, reminderType: 'safety' };
  }

  return null;
}

// ── Snooze duration options ─────────────────────────────────────

export const SNOOZE_OPTIONS = [
  { key: '1d',   label: 'יום אחד',   days: 1 },
  { key: '3d',   label: '3 ימים',    days: 3 },
  { key: '7d',   label: 'שבוע',      days: 7 },
  { key: 'until', label: 'עד שיעבור', days: null }, // computed from due date
];

// ── Hook ────────────────────────────────────────────────────────

export default function useReminderSnooze(userId) {
  // Map: "vehicleId:reminderType" → snoozed_until Date
  const [snoozeMap, setSnoozeMap] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch active snoozes on mount
  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const rows = await db.reminder_snoozes.filter(
          { user_id: userId },
          { select: 'vehicle_id,reminder_type,snoozed_until' }
        );
        if (cancelled) return;
        const map = {};
        const now = new Date();
        for (const r of rows) {
          const until = new Date(r.snoozed_until);
          if (until > now) {
            map[`${r.vehicle_id}:${r.reminder_type}`] = until;
          }
        }
        setSnoozeMap(map);
      } catch (err) {
        console.warn('[useReminderSnooze] fetch failed:', err?.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  /**
   * Check if a specific reminder (by ReminderEngine id) is currently snoozed.
   * Also accepts the enriched notification object { vehicleId, reminderType }.
   */
  const isSnoozed = useCallback((reminderIdOrObj) => {
    if (!reminderIdOrObj) return false;

    let vehicleId, reminderType;
    if (typeof reminderIdOrObj === 'string') {
      const parsed = parseReminderId(reminderIdOrObj);
      if (!parsed) return false;
      ({ vehicleId, reminderType } = parsed);
    } else {
      ({ vehicleId, reminderType } = reminderIdOrObj);
      if (!vehicleId || !reminderType) return false;
    }

    const key = `${vehicleId}:${reminderType}`;
    const until = snoozeMap[key];
    return until ? until > new Date() : false;
  }, [snoozeMap]);

  /**
   * Get the snoozed_until date for a reminder, or null.
   */
  const snoozedUntil = useCallback((reminderIdOrObj) => {
    if (!reminderIdOrObj) return null;

    let vehicleId, reminderType;
    if (typeof reminderIdOrObj === 'string') {
      const parsed = parseReminderId(reminderIdOrObj);
      if (!parsed) return null;
      ({ vehicleId, reminderType } = parsed);
    } else {
      ({ vehicleId, reminderType } = reminderIdOrObj);
      if (!vehicleId || !reminderType) return null;
    }

    const key = `${vehicleId}:${reminderType}`;
    const until = snoozeMap[key];
    return until && until > new Date() ? until : null;
  }, [snoozeMap]);

  /**
   * Snooze a reminder for a given duration.
   * @param {string} vehicleId
   * @param {string} reminderType - 'test', 'insurance', etc.
   * @param {number} days - number of days to snooze, or pass dueDate for "until expiry"
   * @param {string|null} dueDate - ISO date string for "until expiry" option
   */
  const snooze = useCallback(async (vehicleId, reminderType, days, dueDate = null) => {
    if (!userId || !vehicleId || !reminderType) return;

    let until;
    if (days) {
      until = new Date();
      until.setDate(until.getDate() + days);
    } else if (dueDate) {
      // "Until expiry" — snooze until the day after the due date
      until = new Date(dueDate);
      until.setDate(until.getDate() + 1);
    } else {
      // Fallback: 30 days (per PM spec for missing due date)
      until = new Date();
      until.setDate(until.getDate() + 30);
    }

    const key = `${vehicleId}:${reminderType}`;

    // Optimistic update
    setSnoozeMap(prev => ({ ...prev, [key]: until }));

    try {
      // Upsert via raw supabase (entity layer doesn't support ON CONFLICT)
      const { error } = await supabase
        .from('reminder_snoozes')
        .upsert(
          {
            user_id: userId,
            vehicle_id: vehicleId,
            reminder_type: reminderType,
            snoozed_until: until.toISOString(),
          },
          { onConflict: 'user_id,vehicle_id,reminder_type' }
        );
      if (error) throw error;
    } catch (err) {
      // Rollback optimistic update
      setSnoozeMap(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      throw err;
    }
  }, [userId]);

  /**
   * Un-snooze a reminder (remove the snooze).
   */
  const unsnooze = useCallback(async (vehicleId, reminderType) => {
    if (!userId || !vehicleId || !reminderType) return;

    const key = `${vehicleId}:${reminderType}`;
    const prev = snoozeMap[key];

    // Optimistic removal
    setSnoozeMap(p => {
      const next = { ...p };
      delete next[key];
      return next;
    });

    try {
      // Delete matching row. RLS ensures only own rows.
      const { data: rows } = await db.reminder_snoozes.filter({
        user_id: userId,
        vehicle_id: vehicleId,
        reminder_type: reminderType,
      });
      for (const row of rows) {
        await db.reminder_snoozes.delete(row.id);
      }
    } catch (err) {
      // Rollback
      if (prev) setSnoozeMap(p => ({ ...p, [key]: prev }));
      throw err;
    }
  }, [userId, snoozeMap]);

  /**
   * Count of active snoozes.
   */
  const activeCount = useMemo(() => {
    const now = new Date();
    return Object.values(snoozeMap).filter(until => until > now).length;
  }, [snoozeMap]);

  return { snoozeMap, loading, isSnoozed, snoozedUntil, snooze, unsnooze, activeCount, parseReminderId };
}
