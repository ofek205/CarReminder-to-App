/**
 * sendEmail / sendTemplatedEmail — the two front doors to the outbound
 * email pipeline.
 *
 * sendEmail({ to, subject, html, text, from, replyTo })
 *   The low-level dispatch. Used by any caller that already has the HTML
 *   built (e.g. the current invite flow when the DB-templates feature
 *   flag is off). Respects the global kill switch.
 *
 * sendTemplatedEmail(notificationKey, { to, vars, rawVars? })
 *   The high-level dispatch. Pulls the template from the DB, renders it,
 *   and hands off to sendEmail. Used by call sites migrating to the
 *   admin-managed template system. Falls back to the caller's own
 *   builder via a thrown sentinel when VITE_USE_DB_TEMPLATES !== 'true'.
 *
 * Both routes go through the `send-email` Supabase Edge Function, which
 * holds the Resend API key. Client code never sees the key.
 */

import { supabase } from './supabase';
import { getKillSwitchState, renderEmail } from './emailRender';

// ── Kill switch error — distinct so callers can render a clearer UI ────────
export class EmailsPausedError extends Error {
  constructor(reason) {
    super(reason ? `שליחת מיילים מושעתת: ${reason}` : 'שליחת מיילים מושעתת על ידי אדמין');
    this.name = 'EmailsPausedError';
    this.paused = true;
  }
}

// ── Low-level dispatch ─────────────────────────────────────────────────────

export async function sendEmail({ to, subject, html, text, from, replyTo }) {
  if (!to) throw new Error('sendEmail: "to" is required');
  if (!subject) throw new Error('sendEmail: "subject" is required');
  if (!html && !text) throw new Error('sendEmail: "html" or "text" is required');

  // Kill switch — checked client-side. Non-admin users can't read the
  // email_settings table (RLS blocks), so getKillSwitchState returns
  // { paused: false } for them and the Edge Function is the real gate.
  // When Phase 2 adds server-side enforcement in the Edge Function,
  // this client-side check becomes a UX optimisation (fail fast).
  const state = await getKillSwitchState();
  if (state.paused) {
    throw new EmailsPausedError(state.reason);
  }

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { to, subject, html, text, from, reply_to: replyTo },
  });

  if (error) {
    // Supabase wraps non-2xx responses in FunctionsHttpError. Try to pull
    // the real message out of the response body so the caller sees the
    // root cause (invalid recipient, Resend outage, whatever).
    let detail = error.message;
    try {
      if (error.context?.json) {
        const body = await error.context.json();
        detail = body?.error || detail;
      }
    } catch { /* keep generic */ }
    throw new Error(detail || 'Email send failed');
  }

  return data; // { ok: true, id: 'resend-message-id' }
}

// ── High-level dispatch (DB templates) ─────────────────────────────────────

/**
 * Send an email using a DB-managed template.
 *
 * @param {string} notificationKey — e.g. 'invite', 'welcome', 'reminder_insurance'
 * @param {object} args
 *   - to:      recipient address (or array)
 *   - vars:    map of {{placeholder}} values (will be HTML-escaped)
 *   - rawVars: keys in this map are NOT escaped — use only for trusted HTML
 *   - replyTo: override template's reply_to
 *
 * Behaviour:
 *   - Feature flag OFF  → throws `DB_TEMPLATES_DISABLED` so the caller
 *     can catch it and fall back to their own builder.
 *   - Template missing  → throws descriptive error.
 *   - Kill switch ON    → throws EmailsPausedError.
 */
export async function sendTemplatedEmail(notificationKey, { to, vars = {}, rawVars, replyTo } = {}) {
  if (!notificationKey) throw new Error('sendTemplatedEmail: notificationKey is required');
  if (!to) throw new Error('sendTemplatedEmail: "to" is required');

  const rendered = await renderEmail(notificationKey, vars, { rawVars });

  return sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: `${rendered.fromName} <${rendered.fromEmail}>`,
    replyTo: replyTo || rendered.replyTo || undefined,
  });
}
