/**
 * sendEmail — thin wrapper around the `send-email` Supabase Edge Function.
 *
 * The Edge Function holds the Resend API key and does the actual HTTP call
 * to Resend. We only pass through the recipient/subject/body from the app.
 *
 * Usage:
 *   import { sendEmail } from '@/lib/sendEmail';
 *   await sendEmail({
 *     to: 'friend@example.com',
 *     subject: 'הוזמנת לצפות ברכבים של אופק',
 *     html: '<p>לחץ על הקישור: <a href="...">הצטרף</a></p>',
 *   });
 *
 * Returns the Resend message id on success, throws on failure.
 */
import { supabase } from './supabase';

export async function sendEmail({ to, subject, html, text, from, replyTo }) {
  if (!to) throw new Error('sendEmail: "to" is required');
  if (!subject) throw new Error('sendEmail: "subject" is required');
  if (!html && !text) throw new Error('sendEmail: "html" or "text" is required');

  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { to, subject, html, text, from, reply_to: replyTo },
  });

  if (error) {
    // Supabase wraps non-2xx responses in FunctionsHttpError; surface the
    // actual message from the Edge Function (if any) so the caller sees
    // something useful.
    let detail = error.message;
    try {
      if (error.context?.json) {
        const body = await error.context.json();
        detail = body?.error || detail;
      }
    } catch { /* keep generic message */ }
    throw new Error(detail || 'Email send failed');
  }

  return data; // { ok: true, id: 'resend-message-id' }
}
