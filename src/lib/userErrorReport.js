/**
 * userErrorReport — a wrapper around `sonner`'s `toast.error()` that
 * ALSO logs every user-visible error to the `app_errors` table.
 *
 * Why this exists: before Phase 1 of the observability upgrade, calls
 * to `toast.error('לא הצלחנו לשמור')` showed the user a toast and
 * vanished — Ofek had no way to know how many users saw it, where, or
 * what they were trying to do. The toast is exactly the moment we
 * KNOW the user experienced a problem; capturing it is the highest-
 * ROI signal in the whole error system.
 *
 * Usage:
 *   import { toastError } from '@/lib/userErrorReport';
 *   toastError('לא הצלחנו לעדכן את הרכב', { action: 'save_vehicle', err });
 *
 * Drop-in replacement for `toast.error(msg)` — the second arg adds
 * structured context (action label + the actual Error if you have one).
 *
 * Migration strategy: existing `toast.error()` callers keep working.
 * As we touch each file we swap them to `toastError()`. New code uses
 * `toastError()` from day one.
 */

import { toast } from 'sonner';
import { reportVisibleError } from './crashReporter';
import { crumb } from './breadcrumbs';

/**
 * Show a user-visible error toast AND log it to app_errors.
 *
 * @param {string} message — the exact Hebrew text shown to the user
 * @param {object} [opts]
 * @param {string} [opts.action]      — short label of what they were trying to do
 * @param {Error}  [opts.err]         — original Error object (stack captured)
 * @param {string} [opts.severity]    — 'error' (default) | 'warning' | 'critical'
 * @param {object} [opts.toastOpts]   — passed through to sonner's toast.error
 * @param {object} [opts.context]     — free-form extra (vehicleId, formData, etc.)
 */
export function toastError(message, opts = {}) {
  const { action, err, severity, toastOpts, context } = opts;

  // Show the toast — same UX as before.
  try {
    toast.error(message, toastOpts);
  } catch {
    // sonner not mounted (test environment, error during boot) — ignore.
  }

  // Drop a breadcrumb so the next error includes "user saw error toast: X".
  try { crumb.toast(`error: ${message}`, action ? { action } : undefined); } catch {}

  // Log to app_errors. If we got a real Error object, prefer its stack —
  // otherwise the message-only entry still captures the human-visible text.
  try {
    if (err && (err.stack || err.message)) {
      // Prefer the real error so we get the stack, but force the message
      // shown to the user (which the admin needs to see in the table).
      reportVisibleError(message, {
        action,
        severity: severity || 'error',
        original_error: String(err.message || err),
        stack: (err.stack || '').slice(0, 2000),
        ...context,
      });
    } else {
      reportVisibleError(message, {
        action,
        severity: severity || 'error',
        ...context,
      });
    }
  } catch {
    // crashReporter is fire-and-forget; if its localStorage write fails
    // we still showed the toast — that's the priority.
  }
}

/**
 * Convenience for success toasts — does NOT log to app_errors but DOES
 * drop a breadcrumb (so a later error can show "user just succeeded at
 * uploading a doc → then crashed").
 */
export function toastSuccess(message, opts = {}) {
  try { toast.success(message, opts.toastOpts); } catch {}
  try { crumb.toast(`success: ${message}`); } catch {}
}

/**
 * Re-export the raw toast for cases that genuinely don't need logging
 * (info messages, neutral notifications). Most callers should use the
 * helpers above.
 */
export { toast };
