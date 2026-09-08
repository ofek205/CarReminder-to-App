/**
 * Typed errors the Data Access seam produces itself, as opposed to passing one
 * up from Supabase.
 */

/**
 * A write was refused because the device has no connection.
 *
 * The `message` is deliberately clean Hebrew and safe to show as-is: several
 * call sites interpolate `err.message` straight into a toast
 * (e.g. ReminderSettingsPage, RepairsSection, Expenses), so a technical string
 * here would surface verbatim to the user.
 *
 * `queueable` records whether the command COULD have been queued had an outbox
 * existed. It drives the wording today ("try again when you reconnect" versus
 * "this action needs a connection") and is the flag Phase 3 will branch on to
 * enqueue instead of refuse.
 */
export class OfflineError extends Error {
  constructor(message, { queueable = false } = {}) {
    super(message);
    this.name = 'OfflineError';
    // Duck-typed marker so callers can recognise it without importing the
    // class — cheaper than instanceof across chunk boundaries.
    this.isOffline = true;
    this.queueable = queueable;
  }
}

/** True for an OfflineError, however it reached the caller. */
export function isOfflineError(err) {
  return !!err?.isOffline;
}

// Offline-capable work: it would have been queued if the outbox existed, so the
// wording invites a retry rather than declaring the action impossible.
export const OFFLINE_QUEUEABLE_MESSAGE =
  'אין חיבור לאינטרנט. השינוי לא נשמר, נסה שוב כשתחזור לרשת.';

// Online-required work (sharing, membership, admin, anything touching another
// party). These can never be replayed later, so the wording is a flat refusal.
export const OFFLINE_REQUIRED_MESSAGE =
  'הפעולה הזו דורשת חיבור לאינטרנט.';
