// ═══════════════════════════════════════════════════════════════════════════
// send-email — Supabase Edge Function that sends transactional emails via
// Resend. Callers provide { to, subject, html, text?, from? } and we forward
// to https://api.resend.com/emails with the RESEND_API_KEY secret.
//
// Deploy:
//   • Dashboard: supabase.com/dashboard → Edge Functions → Deploy new function
//                → paste this file's contents → Deploy
//   • CLI:       `supabase functions deploy send-email`
//
// Invoke from client:
//   const { data, error } = await supabase.functions.invoke('send-email', {
//     body: { to: 'x@y.com', subject: 'Hi', html: '<b>Hello</b>' }
//   });
//
// Secret required: RESEND_API_KEY (set in Edge Functions → Secrets)
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logSecurityEvent } from '../_shared/securityLog.ts';
import { reportEdgeError } from '../_shared/reportEdgeError.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';
import {
  DEFAULT_FROM,
  RECENT_INVITE_WINDOW_MS,
  normalizeRecipients,
  isSingleAddress,
  isOwnDomainAddress,
  sanitizeFrom,
  userNotificationKey,
  recipientRelated,
  resolvePolicyMode,
  ilikeExact,
  type RecipientEvidence,
} from '../_shared/emailPolicy.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Recipient policy for NON-admin callers (audit F2, 2026-09-25). Rolls out in
// two steps so no legitimate email can silently stop:
//   monitor (default) — every send a non-admin makes to an address none of
//                       the five legitimate flows explains is recorded in
//                       app_errors, and still sent.
//   enforce           — the same sends are refused with 403.
// Set the SEND_EMAIL_RECIPIENT_POLICY secret to `enforce` only after the
// monitor period shows no false positives from real flows. Anything other than
// the exact word `enforce` stays in monitor (see resolvePolicyMode).
const RECIPIENT_POLICY = resolvePolicyMode(Deno.env.get('SEND_EMAIL_RECIPIENT_POLICY'));
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Per-user rate limit. Resend free tier is 100/day; an authenticated
// attacker without this gate could empty the quota in under a minute by
// looping invoke() calls. 5 sends/min/user is generous for the legitimate
// flows (invite emails, password resets piggy-backing on supabase auth,
// admin test sends) and tight enough to block runaway loops.
// See audit finding C-2 (2026-05-12).
const RATE_LIMIT_PER_MIN = 5;

const supabaseAdmin = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// Default sender (DEFAULT_FROM) now lives in _shared/emailPolicy.ts so the
// policy and the send use one value. Admins may still override `from`;
// non-admins are held to the car-reminder.app domain by sanitizeFrom().

// Answers "which legitimate flow explains this non-admin send?". Each lookup
// mirrors a row the client's own RPC wrote moments before sending the email
// (verified against the live schema and the live RPC bodies on 2026-09-25):
//   vehicle_shares     owner_user_id = caller, shared_with_email, pending|accepted
//   vehicle_transfers  from_user_id  = caller, to_email, pending
//   account_members    invited_by    = caller, status 'ממתין', just now   (unbound)
//   invites            invited_by_user_id = caller, status 'פעיל', just now (unbound)
// The two invite checks cannot be tied to the exact address: `invites` has no
// email column at all, and binding a pending member would need an auth.users
// lookup. They only require the caller to have created an invite moments ago,
// which any account owner can do on purpose. See RECENT_INVITE_WINDOW_MS for
// what closes that gap. Shares and transfers ARE matched to the exact address.
async function gatherRecipientEvidence(
  uid: string,
  userEmail: string | undefined,
  recipient: string,
): Promise<{ evidence: RecipientEvidence; error: string | null }> {
  const r = recipient.trim().toLowerCase();
  const evidence: RecipientEvidence = {
    isSelf: false, share: false, transfer: false, pendingMember: false, recentInvite: false,
  };
  if (userEmail && userEmail.trim().toLowerCase() === r) {
    evidence.isSelf = true;
    return { evidence, error: null };
  }

  // Case-insensitive but exact: older share rows may predate lowercasing.
  const pattern = ilikeExact(r);
  const since = new Date(Date.now() - RECENT_INVITE_WINDOW_MS).toISOString();

  let shareQ = supabaseAdmin!.from('vehicle_shares').select('id')
    .eq('owner_user_id', uid).in('status', ['pending', 'accepted']);
  shareQ = pattern === null ? shareQ.eq('shared_with_email', r) : shareQ.ilike('shared_with_email', pattern);

  let transferQ = supabaseAdmin!.from('vehicle_transfers').select('id')
    .eq('from_user_id', uid).eq('status', 'pending');
  transferQ = pattern === null ? transferQ.eq('to_email', r) : transferQ.ilike('to_email', pattern);

  const memberQ = supabaseAdmin!.from('account_members').select('id')
    .eq('invited_by', uid).eq('status', 'ממתין').gte('joined_at', since);

  const inviteQ = supabaseAdmin!.from('invites').select('id')
    .eq('invited_by_user_id', uid).eq('status', 'פעיל').gte('created_at', since);

  const [share, transfer, member, invite] = await Promise.all([
    shareQ.limit(1), transferQ.limit(1), memberQ.limit(1), inviteQ.limit(1),
  ]);

  evidence.share = (share.data?.length ?? 0) > 0;
  evidence.transfer = (transfer.data?.length ?? 0) > 0;
  evidence.pendingMember = (member.data?.length ?? 0) > 0;
  evidence.recentInvite = (invite.data?.length ?? 0) > 0;

  const firstErr = [share, transfer, member, invite].find((q) => q.error)?.error;
  return { evidence, error: firstErr ? firstErr.message : null };
}

// CORS — whitelist explicit origins instead of `*`. The JWT gate already
// blocks unauthenticated callers, but a wildcard origin means any page on
// the internet with a stolen token can trigger sends. Allow-list logic
// lives in _shared/cors.ts; this function only declares its accepted
// headers (no x-dispatch-secret because send-email is user-callable, not
// cron-callable).
const SEND_EMAIL_ALLOWED_HEADERS =
  'authorization, x-client-info, x-client-ip, apikey, content-type';

function buildCors(req: Request): HeadersInit {
  return buildCorsHeaders(req, { allowedHeaders: SEND_EMAIL_ALLOWED_HEADERS });
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? buildCors(req) : {}), 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  if (!RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY secret not configured' }, 500, req);
  }

  // ── Auth + per-user rate limit ────────────────────────────────────────
  // Verify JWT is ON for this function at the Supabase gateway, so the
  // token is already cryptographically valid by the time we run. We still
  // need to extract user.id here to key the rate-limit bucket. Without
  // this gate, any authenticated user could empty the Resend quota.
  if (!supabaseAdmin) {
    return json({ error: 'Server misconfigured (missing supabase env)' }, 500, req);
  }
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    logSecurityEvent('send-email', 'auth_failed', { reason: 'missing_authorization' });
    return json({ error: 'missing authorization' }, 401, req);
  }
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) {
    logSecurityEvent('send-email', 'auth_failed', { reason: authErr?.message || 'invalid_token' });
    return json({ error: 'invalid token' }, 401, req);
  }

  const { data: allowed, error: rlErr } = await supabaseAdmin.rpc('rate_limit_check', {
    kind:        `send-email:${user.id}`,
    max_per_min: RATE_LIMIT_PER_MIN,
  });
  // Fail-closed on RPC error: a misconfigured rate_limit_counters table
  // shouldn't open the floodgates. Return 503 so the client retries.
  if (rlErr) {
    logSecurityEvent('send-email', 'rate_limit_error', { user_id: user.id, error: rlErr.message });
    return json({ error: 'rate limit system unavailable' }, 503, req);
  }
  if (allowed === false) {
    logSecurityEvent('send-email', 'rate_limit_hit', { user_id: user.id, limit: RATE_LIMIT_PER_MIN });
    return json({ error: `Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min)` }, 429, req);
  }

  let payload: {
    to?: string | string[];
    subject?: string;
    html?: string;
    text?: string;
    from?: string;
    reply_to?: string;
    // 2026-05-17: optional notification_key so every send is logged
    // to email_send_log. Without it the admin stats strip in
    // EmailCenter shows 0 for ad-hoc/invite/welcome emails because
    // only the reminder dispatcher writes to that table. Default
    // 'system_alert' covers any call site that hasn't been updated
    // — it's a valid notification key in the seed, and tagging
    // strays as system_alert is more accurate than dropping them.
    notification_key?: string;
    recipient_user_id?: string;
    // Raw admin input for the in-app notification body when this is an
    // admin_direct send. The client (AdminUserDrawer) wraps the message
    // in branded email HTML before sending; without this raw text we
    // would have to strip tags from the rendered email and the
    // notification would end up containing the header, tagline, and
    // footer along with the body — exactly the bug reported in the
    // bell popup on 2026-05-24.
    plain_body?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }

  const { to, subject, html, text, from, reply_to, notification_key, recipient_user_id, plain_body } = payload;

  // Validation — at minimum need a recipient, a subject, and either html or text
  if (!to || (Array.isArray(to) && to.length === 0)) {
    return json({ error: '`to` is required (string or string[])' }, 400, req);
  }
  if (!subject || typeof subject !== 'string') {
    return json({ error: '`subject` is required' }, 400, req);
  }
  if (!html && !text) {
    return json({ error: 'Either `html` or `text` is required' }, 400, req);
  }

  // Defensive caps to stop a runaway client/script from blowing through the
  // Resend free tier by flooding with huge payloads.
  if (subject.length > 250) return json({ error: 'subject too long' }, 400, req);
  if (html && html.length > 200_000) return json({ error: 'html too long' }, 400, req);
  if (text && text.length > 100_000) return json({ error: 'text too long' }, 400, req);

  // SECURITY: admin_direct sends create in-app notifications that appear to
  // come from the admin. A non-admin must NOT be allowed to trigger this —
  // block the ENTIRE request (not just the notification insertion), otherwise
  // a non-admin could still send emails that look like admin messages.
  // Audit finding C-1 (2026-05-27): the original code logged the block but
  // continued to send the email — missing `return`.
  //
  // Admin status is resolved once here and reused by the recipient policy
  // below. If it cannot be resolved the caller is treated as NON-admin, which
  // is the restrictive side; admin_direct still fails closed exactly as before.
  let isAdmin = false;
  let adminCheckError: string | null = null;
  try {
    const { data: isAdminFlag, error: adminErr } = await supabaseAdmin!.rpc('is_admin', { uid: user.id });
    if (adminErr) adminCheckError = adminErr.message;
    else isAdmin = !!isAdminFlag;
  } catch (adminCheckErr) {
    adminCheckError = (adminCheckErr as Error)?.message || 'is_admin threw';
  }

  if (notification_key === 'admin_direct') {
    if (adminCheckError) {
      // Fail closed — if we can't verify admin status, block the send.
      logSecurityEvent('send-email', 'admin_check_failed', { user_id: user.id, error: adminCheckError });
      return json({ error: 'admin verification failed' }, 500, req);
    }
    if (!isAdmin) {
      logSecurityEvent('send-email', 'admin_direct_blocked', { user_id: user.id, recipient_user_id });
      return json({ error: 'admin_direct requires admin privileges' }, 403, req);
    }
  }

  // ── Non-admin send policy (audit F2) ──────────────────────────────────
  // Admins are exempt and keep today's behaviour exactly: their own `from`,
  // any recipients, any notification key.
  let sendTo: string[] = (Array.isArray(to) ? to : [to]) as string[];
  let sendFrom = from || DEFAULT_FROM;
  let sendReplyTo = reply_to;
  let logKey = notification_key && typeof notification_key === 'string' ? notification_key : 'system_alert';

  if (!isAdmin) {
    // ENFORCED NOW. Every legitimate non-admin flow sends to exactly one
    // address, so this cannot affect a real email. It caps a relay attempt
    // at one victim per request instead of fifty.
    const recipients = normalizeRecipients(to);
    if (!recipients || recipients.length !== 1 || !isSingleAddress(recipients[0])) {
      logSecurityEvent('send-email', 'payload_rejected', {
        user_id: user.id,
        reason: 'recipient_shape',
        count: recipients ? recipients.length : null,
      });
      return json({ error: 'exactly one valid recipient is required' }, 400, req);
    }
    sendTo = recipients;

    // ENFORCED NOW. No real non-admin flow passes a sender outside our domain
    // (hand-built emails pass none, templates default to no-reply@).
    sendFrom = sanitizeFrom(from);
    logKey = userNotificationKey(notification_key);

    // MONITOR → ENFORCE. Is this recipient explained by a legitimate flow?
    const { evidence, error: evidenceError } = await gatherRecipientEvidence(user.id, user.email, recipients[0]);
    const related = !evidenceError && recipientRelated(evidence);
    const foreignReplyTo = !!reply_to && !isOwnDomainAddress(reply_to);

    if (evidenceError || !related || foreignReplyTo) {
      const reason = evidenceError ? 'lookup_error' : !related ? 'unrelated_recipient' : 'foreign_reply_to';
      const recipientDomain = recipients[0].slice(recipients[0].lastIndexOf('@') + 1).toLowerCase();

      if (RECIPIENT_POLICY === 'enforce') {
        logSecurityEvent('send-email', 'recipient_policy_blocked', { user_id: user.id, reason, recipient_domain: recipientDomain });
        if (evidenceError) {
          // Same fail-closed stance as the rate limiter above.
          return json({ error: 'recipient check unavailable' }, 503, req);
        }
        if (!related) {
          return json({ error: 'recipient not allowed' }, 403, req);
        }
        // A foreign reply-to on an otherwise related send is dropped, not blocked.
        sendReplyTo = undefined;
      } else {
        logSecurityEvent('send-email', 'recipient_policy_monitor', { user_id: user.id, reason, recipient_domain: recipientDomain });
        // One stable message per reason, so five of the same within five
        // minutes groups into a single error_storm admin alert.
        await reportEdgeError({
          fn: 'send-email',
          action: 'recipient_policy_monitor',
          error: new Error(`recipient_policy would block: ${reason}`),
          severity: 'warning',
          userId: user.id,
          extra: {
            mode: RECIPIENT_POLICY,
            reason,
            notification_key: notification_key ?? null,
            subject: subject.slice(0, 80),
            recipient_domain: recipientDomain,
            evidence,
            evidence_error: evidenceError,
            admin_check_error: adminCheckError,
          },
        });
      }
    }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: sendFrom,
        to: sendTo,
        subject,
        html,
        text,
        reply_to: sendReplyTo,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      // Resend errors look like { name, message, statusCode }
      return json({ error: data.message || 'Resend error', details: data }, res.status, req);
    }

    // Admin direct messages also create an in-app notification so the
    // recipient sees it in the bell + gets a push notification via the
    // existing AFTER INSERT trigger on app_notifications.
    // NOTE: admin check already ran above (pre-send gate). If we reached
    // here with notification_key='admin_direct', the caller IS admin.
    if (notification_key === 'admin_direct') {
      try {
        // Resolve recipient: explicit user_id takes priority, otherwise
        // look up by the `to` email so replies from AdminAlerts (which
        // only have the contact email) also land in the user's bell.
        // Uses the GoTrue admin endpoint which supports email filter.
        let resolvedUserId = recipient_user_id;
        if (!resolvedUserId && to && !Array.isArray(to)) {
          const gotrue = `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(to as string)}&per_page=1`;
          try {
            const luRes = await fetch(gotrue, {
              headers: { Authorization: `Bearer ${SERVICE_ROLE}`, apikey: SERVICE_ROLE },
            });
            if (luRes.ok) {
              const luData = await luRes.json();
              const match = (luData.users || []).find(
                (u: { email?: string }) => u.email?.toLowerCase() === (to as string).toLowerCase()
              );
              resolvedUserId = match?.id;
            }
          } catch { /* lookup failed — notification won't be created, email still sent */ }
        }
        if (resolvedUserId) {
          // Prefer the explicit raw admin input. Falls back to the
          // legacy strip-HTML path only when the client didn't send
          // plain_body — that path concatenates the email title,
          // tagline, and footer into the notification body, which
          // produced the corrupted notifications reported in the
          // bell popup. The fallback stays for legacy callers that
          // haven't been updated yet (broadcast/dispatch flows).
          const stripped = (text || (html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&#8203;/g, '')
            .replace(/&nbsp;/g, ' ');
          const plainBody = (typeof plain_body === 'string' && plain_body.trim().length > 0
            ? plain_body
            : stripped
          ).slice(0, 500);
          await supabaseAdmin!
            .from('app_notifications')
            .insert({
              user_id: resolvedUserId,
              type:    'admin_message',
              title:   subject,
              body:    plainBody,
              data:    { from_admin: true, subject, body: plainBody },
            });
        }
      } catch (notifErr) {
        console.warn('app_notifications insert failed:', (notifErr as Error)?.message);
      }
    }

    // 2026-05-17: Audit-log every successful send to email_send_log so
    // the EmailCenter admin "sent" stat reflects reality. Without this
    // only the reminder dispatcher writes to the table — invite,
    // welcome, and admin test sends all disappear from the dashboard.
    //
    // Fire-and-forget. A logging failure must NOT roll back a send
    // that already went out on Resend's side — the email is in the
    // user's inbox either way. ON CONFLICT DO NOTHING absorbs the
    // (user_id, key, date) UNIQUE collision when the same notification
    // is queued twice in one day.
    try {
      // logKey is the caller's key for admins, and the allow-listed key for
      // everyone else (see the non-admin policy above).
      const rows = sendTo.map(r => ({
        notification_key: logKey,
        recipient_email: String(r),
        status:          'sent',
        message_id:      data.id || null,
      }));
      // ignoreDuplicates so the UNIQUE constraint on (user_id,
      // notification_key, reference_date) doesn't blow up the response.
      await supabaseAdmin
        .from('email_send_log')
        .upsert(rows, { onConflict: 'user_id,notification_key,reference_date', ignoreDuplicates: true });
    } catch (logErr) {
      // Surface for engineers but don't fail the request.
      console.warn('email_send_log write failed:', (logErr as Error)?.message);
    }

    return json({ ok: true, id: data.id }, 200, req);
  } catch (e) {
    // Persist to app_errors so the admin can see "send-email failed
    // 3 times yesterday" beyond the 24h Function Logs window.
    await reportEdgeError({
      fn: 'send-email',
      action: 'send',
      error: e,
      severity: 'error',
    });
    return json({ error: (e as Error).message || 'Unknown error' }, 500, req);
  }
});
