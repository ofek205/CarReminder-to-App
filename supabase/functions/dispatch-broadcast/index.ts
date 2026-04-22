// ═══════════════════════════════════════════════════════════════════════════
// dispatch-broadcast — sends a marketing/announcement email to every
// user who's opted-in to that notification type. Admin-invoked.
//
// Pipeline per invocation:
//   1. Check global kill switch.
//   2. Verify the notification is admin-enabled.
//   3. Fetch the published template.
//   4. Query recipients via email_broadcast_recipients(key).
//   5. For each recipient (rate-limited):
//      - Render template with per-user vars (firstName).
//      - email_log_attempt() idempotency lock (reference_date = today).
//      - POST to Resend.
//      - Update send_log status + message_id.
//
// Body: { notificationKey: string, dryRun?: boolean }
//
// Deploy:
//   Dashboard → Edge Functions → Deploy new function →
//   name = `dispatch-broadcast` → paste this file → Verify JWT: OFF
//   → Deploy.
//   Requires secrets: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY  = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL    = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET');
const ALLOWED_ORIGIN  = Deno.env.get('APP_ORIGIN') || 'https://car-reminder.app';

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allow  = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dispatch-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary':                         'Origin',
  };
}

async function authorizeCaller(req: Request, supabaseAdmin: any): Promise<{ ok: boolean; reason?: string }> {
  const headerSecret = req.headers.get('x-dispatch-secret');
  if (DISPATCH_SECRET && headerSecret && headerSecret === DISPATCH_SECRET) return { ok: true };
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, reason: 'missing authorization' };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { ok: false, reason: 'invalid token' };
  if ((user.user_metadata as any)?.role !== 'admin') return { ok: false, reason: 'not an admin' };
  return { ok: true };
}

const SEND_DELAY_MS = 120; // ~8 emails/sec

function json(body: unknown, status = 200, req?: Request) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(req ? buildCors(req) : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

// ── Template rendering helpers ─────────────────────────────────────────────
// Copied from dispatch-reminder-emails so the two functions are self-
// contained. If you change the shell, update both.

function renderPlaceholders(text: string, vars: Record<string, unknown>): string {
  if (!text) return '';
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => {
    const v = vars[name];
    return v === undefined || v === null ? `{{${name}}}` : String(v);
  });
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildShell(opts: { preheader: string; title: string; subtitle: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F7F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1F2937;direction:rtl">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">
    ${escapeHtml(opts.preheader)}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F4F7F3;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:24px;box-shadow:0 6px 28px rgba(17,34,22,0.06);overflow:hidden">
        <tr><td align="center" style="padding:36px 28px 8px">
          <img src="https://car-reminder.app/icons/email-logo.png" alt="CarReminder" width="72" height="72" style="display:block;width:72px;height:72px;border-radius:22px;margin:0 auto;box-shadow:0 6px 18px rgba(45,82,51,0.18)">
          <h1 style="font-size:24px;font-weight:900;color:#1C3620;margin:20px 0 6px">${escapeHtml(opts.title)}</h1>
          <p style="font-size:14px;color:#6B7280;margin:0">${escapeHtml(opts.subtitle)}</p>
        </td></tr>
        <tr><td style="padding:24px 28px 8px;font-size:15px;line-height:1.75;color:#1F2937;direction:rtl;text-align:right">${opts.body}</td></tr>
        <tr><td style="padding:8px 28px 32px">
          <hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0">
          ${opts.footer ? `<p style="font-size:12px;color:#9CA3AF;text-align:center;margin:0 0 12px;line-height:1.7">${opts.footer}</p>` : ''}
          <p style="font-size:11px;color:#9CA3AF;text-align:center;margin:0;line-height:1.7">
            CarReminder &middot; ניהול חכם של כלי רכב<br>
            <a href="mailto:support@car-reminder.app" style="color:#6B7280;text-decoration:underline">support@car-reminder.app</a>
            &nbsp;&middot;&nbsp;
            <a href="https://car-reminder.app" style="color:#6B7280;text-decoration:underline">car-reminder.app</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderTemplate(template: any, rawVars: Record<string, unknown>) {
  const htmlVars: Record<string, string> = {};
  const txtVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVars)) {
    const str = v === undefined || v === null ? '' : String(v);
    htmlVars[k] = escapeHtml(str);
    txtVars[k]  = str;
  }

  const subject    = renderPlaceholders(template.subject || '',     txtVars);
  const preheader  = renderPlaceholders(template.preheader || '',   txtVars);
  const title      = renderPlaceholders(template.title || '',       txtVars);
  const bodyHtml   = renderPlaceholders(template.body_html || '',   htmlVars);
  const ctaLabel   = renderPlaceholders(template.cta_label || '',   htmlVars);
  const ctaUrl     = renderPlaceholders(template.cta_url || '',     htmlVars);
  const footerNote = renderPlaceholders(template.footer_note || '', htmlVars);

  const ctaBlock = (ctaLabel && ctaUrl)
    ? `<div style="margin:24px 0 16px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto"><tr><td align="center" bgcolor="#2D5233" style="border-radius:14px;background:linear-gradient(135deg,#2D5233 0%,#3A6B42 100%);padding:16px 40px;mso-padding-alt:16px 40px;box-shadow:0 8px 20px rgba(45,82,51,0.25)"><a href="${ctaUrl}" target="_blank" style="color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;line-height:1.2">${ctaLabel}&nbsp;&#8592;</a></td></tr></table></div><p style="font-size:12px;color:#9CA3AF;text-align:center;margin:22px 0 4px">או העתק/י את הקישור לדפדפן:</p><p style="font-size:12px;word-break:break-all;text-align:center;margin:0 0 8px;color:#6B7280"><a href="${ctaUrl}" style="color:#2D5233;text-decoration:underline">${ctaUrl}</a></p>`
    : '';

  const html = buildShell({
    preheader,
    title,
    subtitle: 'ניהול חכם של כלי רכב',
    body: bodyHtml + ctaBlock,
    footer: footerNote,
  });

  return {
    subject,
    html,
    fromName:  template.from_name || 'CarReminder',
    fromEmail: template.from_email || 'no-reply@car-reminder.app',
    replyTo:   template.reply_to || null,
  };
}

// ── Entry ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, req, 200, req);
  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'Missing RESEND_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500, req, 200, req);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const auth = await authorizeCaller(req, supabase);
  if (!auth.ok) return json({ error: 'unauthorized', reason: auth.reason }, 401, req, 200, req);

  let body: { notificationKey?: string; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* empty is invalid here */ }
  if (!body.notificationKey) return json({ error: 'notificationKey is required' }, 400, req, 200, req);
  const dryRun = !!body.dryRun;

  // 1. Kill switch.
  const { data: settings } = await supabase
    .from('email_settings').select('emails_paused, pause_reason').eq('id', 1).maybeSingle();
  if (settings?.emails_paused) {
    return json({ ok: false, paused: true, reason: settings.pause_reason || null }, 200, req);
  }

  // 2. Template.
  const { data: tplRows, error: tplErr } = await supabase
    .rpc('get_email_template', { p_key: body.notificationKey });
  if (tplErr || !tplRows?.length) return json({ error: `Template missing: ${tplErr?.message || body.notificationKey}` }, 400, 200, req);
  const template = tplRows[0];
  if (template.enabled === false) return json({ ok: false, disabled: true }, 200, req);

  // 3. Recipients.
  const { data: recipients, error: recErr } = await supabase
    .rpc('email_broadcast_recipients', { p_notification_key: body.notificationKey });
  if (recErr) return json({ error: `Recipients query: ${recErr.message}` }, 500, 200, req);

  const stats = { matched: recipients?.length || 0, sent: 0, skipped: 0, errors: 0, errorDetails: [] as string[] };
  const refDate = new Date().toISOString().slice(0, 10);   // today, for idempotency

  // 4. Loop.
  for (const r of recipients || []) {
    try {
      const vars = { firstName: r.first_name || '' };

      if (!dryRun) {
        const { data: claimed, error: claimErr } = await supabase.rpc('email_log_attempt', {
          p_user_id:        r.user_id,
          p_notification:   body.notificationKey,
          p_recipient:      r.recipient_email,
          p_reference_date: refDate,
          p_status:         'queued',
          p_message_id:     null,
          p_metadata:       { vars, kind: 'broadcast' },
        });
        if (claimErr) { stats.errors++; stats.errorDetails.push(claimErr.message); continue; }
        if (claimed === false) { stats.skipped++; continue; }   // already sent today
      }

      const rendered = renderTemplate(template, vars);

      if (dryRun) { stats.sent++; continue; }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:     `${rendered.fromName} <${rendered.fromEmail}>`,
          to:       [r.recipient_email],
          subject:  rendered.subject,
          html:     rendered.html,
          reply_to: rendered.replyTo || undefined,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        stats.errors++;
        stats.errorDetails.push(`resend ${res.status}: ${txt.slice(0, 200)}`);
        await supabase
          .from('email_send_log')
          .update({ status: 'failed', error: txt.slice(0, 500) })
          .match({ user_id: r.user_id, notification_key: body.notificationKey, reference_date: refDate });
      } else {
        const resendBody = await res.json();
        await supabase
          .from('email_send_log')
          .update({ status: 'sent', message_id: resendBody?.id || null })
          .match({ user_id: r.user_id, notification_key: body.notificationKey, reference_date: refDate });
        stats.sent++;
      }

      await new Promise(r => setTimeout(r, SEND_DELAY_MS));
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push((e as Error).message);
    }
  }

  // 5. Stamp trigger-style stats on the notification (for UI).
  if (!dryRun) {
    await supabase
      .from('email_notifications')
      .update({ updated_at: new Date().toISOString() })
      .eq('key', body.notificationKey);
  }

  return json({ ok: true, dryRun, notificationKey: body.notificationKey, totals: stats }, 200, req);
});
