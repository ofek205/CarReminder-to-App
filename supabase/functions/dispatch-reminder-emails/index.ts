// ═══════════════════════════════════════════════════════════════════════════
// dispatch-reminder-emails — Supabase Edge Function that runs the reminder
// email pipeline. Invoked hourly by pg_cron (see supabase-email-dispatcher.sql)
// or manually from the admin EmailCenter UI.
//
// Pipeline per invocation:
//
//   1. Check the global kill switch (email_settings.emails_paused).
//   2. For each enabled reminder trigger (email_triggers):
//      a. Call RPC email_dispatch_candidates(notification_key) — returns
//         the list of users whose vehicles cross the trigger window today.
//      b. For each candidate:
//         - Render the template via get_email_template() RPC + simple
//           {{placeholder}} substitution.
//         - Call email_log_attempt() — this is the idempotency lock. If
//           INSERT fails (duplicate), skip the send.
//         - POST to Resend API.
//         - Update the log row with the resend message id.
//      c. Record per-trigger stats via email_trigger_record_run().
//
// Deploy:
//   Dashboard → Edge Functions → Deploy new function → paste this file
//   → name it `dispatch-reminder-emails` → Deploy.
//   Secrets required: RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//   Verify JWT: OFF (it's called by pg_cron / admin UI with a service key).
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// Shared secret for cron/admin invocations. Generated once; set both here
// and in the pg_cron job that calls us. Without it, every caller must be
// an authenticated admin (checked via JWT below).
const DISPATCH_SECRET = Deno.env.get('DISPATCH_SECRET');
// Allowed origin for browser-initiated calls (admin EmailCenter UI).
const ALLOWED_ORIGIN  = Deno.env.get('APP_ORIGIN') || 'https://car-reminder.app';

// Local web dev/preview origins. Mirrored across all browser-callable
// Edge Functions — keep in sync with ai-proxy / dispatch-broadcast /
// send-email when adjusting.
const LOCAL_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

// Vercel branch-preview URLs of THIS project. Vercel generates dynamic
// per-branch hostnames `{project}-git-{branch}-{teamslug}.vercel.app`
// that can't be enumerated in ALLOWED_ORIGIN. Requiring the literal
// `-git-` segment after the project prefix means an attacker can't just
// register a Vercel project starting with `car-reminder-to-app-` and
// inherit our CORS allow-list — they'd need ownership of a project named
// exactly `car-reminder-to-app` (already ours) or `car-manage-hub`.
function isTrustedVercelPreview(origin: string): boolean {
  if (!origin) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:') return false;
    if (!hostname.endsWith('.vercel.app')) return false;
    return (
      hostname.startsWith('car-reminder-to-app-git-') ||
      hostname.startsWith('car-manage-hub-git-')
    );
  } catch {
    return false;
  }
}

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  // Fail-closed: non-matching origin → 'null' so browser blocks the
  // response. Previously echoed ALLOWED_ORIGIN for every request, which
  // defeated CORS entirely.
  const allowList = [
    ...ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean),
    ...LOCAL_WEB_ORIGINS,
  ];
  const allow = (allowList.includes(origin) || isTrustedVercelPreview(origin)) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, x-client-ip, apikey, content-type, x-dispatch-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary':                         'Origin',
  };
}

/** Returns true if the caller is allowed to invoke this function. */
async function authorizeCaller(req: Request, supabaseAdmin: any): Promise<{ ok: boolean; reason?: string }> {
  // Path A: shared secret header — used by pg_cron and trusted integrations.
  const headerSecret = req.headers.get('x-dispatch-secret');
  if (DISPATCH_SECRET && headerSecret && headerSecret === DISPATCH_SECRET) {
    return { ok: true };
  }
  // Path B: authenticated admin JWT from the browser.
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, reason: 'missing authorization' };
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { ok: false, reason: 'invalid token' };
  const role = (user.user_metadata as any)?.role;
  if (role !== 'admin') return { ok: false, reason: 'not an admin' };
  return { ok: true };
}

function json(body: unknown, status = 200, req?: Request) {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(req ? buildCors(req) : {}),
  };
  return new Response(JSON.stringify(body), { status, headers });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Simple {{placeholder}} substitution — matches src/lib/emailValidate.js.
// Deliberately NOT a full template engine — the admin-authored content
// is already HTML, the only thing we need to inject are scalar values.
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

// The brand shell — mirrors src/lib/emailTemplates.js buildEmailHtml but
// lives in Deno because the Edge Function can't import the React/Vite
// source. Keep in sync manually if we ever change the shell.
function buildShell(opts: {
  preheader: string; title: string; subtitle: string; body: string; footer: string;
}): string {
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
  // Escape variable values before they reach the HTML body.
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

// ── Core dispatch ──────────────────────────────────────────────────────────

async function processTrigger(
  supabase: any,
  notificationKey: string,
  dryRun: boolean
): Promise<{ key: string; matched: number; sent: number; skipped: number; errors: number; errorDetails: string[] }> {
  const stats = { key: notificationKey, matched: 0, sent: 0, skipped: 0, errors: 0, errorDetails: [] as string[] };

  // 1. Fetch template once per trigger (all users share it).
  const { data: templateRows, error: tplErr } = await supabase.rpc('get_email_template', {
    p_key: notificationKey,
  });
  if (tplErr || !templateRows?.length || templateRows[0].enabled === false) {
    stats.errorDetails.push(tplErr?.message || 'Template missing or disabled');
    stats.errors = 1;
    return stats;
  }
  const template = templateRows[0];

  // 2. Fetch candidate users.
  const { data: candidates, error: candErr } = await supabase.rpc('email_dispatch_candidates', {
    p_notification_key: notificationKey,
  });
  if (candErr) {
    stats.errorDetails.push(`candidates query: ${candErr.message}`);
    stats.errors = 1;
    return stats;
  }

  stats.matched = candidates?.length || 0;

  // 3. Loop.
  for (const c of candidates || []) {
    try {
      const vars = {
        vehicleName:  c.vehicle_name || 'רכב',
        licensePlate: c.license_plate || '',
        daysLeft:     String(c.days_left ?? ''),
        expiryDate:   c.reference_date ? new Date(c.reference_date).toLocaleDateString('he-IL') : '',
        vehicleId:    c.vehicle_id || '',
      };

      // Idempotency lock — try to claim the "(user, key, ref_date)" slot.
      // In dry-run we just count matches without touching the log.
      if (!dryRun) {
        const { data: claimed, error: claimErr } = await supabase.rpc('email_log_attempt', {
          p_user_id:        c.user_id,
          p_notification:   notificationKey,
          p_recipient:      c.recipient_email,
          p_reference_date: c.reference_date,
          p_status:         'queued',
          p_message_id:     null,
          p_metadata:       { vars, days_before: c.days_left },
        });
        if (claimErr) { stats.errors++; stats.errorDetails.push(claimErr.message); continue; }
        if (claimed === false) { stats.skipped++; continue; }   // duplicate
      }

      const rendered = renderTemplate(template, vars);

      if (dryRun) { stats.sent++; continue; }

      // 4. Fire via Resend.
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    `${rendered.fromName} <${rendered.fromEmail}>`,
          to:      [c.recipient_email],
          subject: rendered.subject,
          html:    rendered.html,
          reply_to: rendered.replyTo || undefined,
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        stats.errors++;
        stats.errorDetails.push(`resend ${res.status}: ${txt.slice(0, 200)}`);
        // Mark the claimed log row as failed so it can be retried on next run.
        await supabase
          .from('email_send_log')
          .update({ status: 'failed', error: txt.slice(0, 500) })
          .match({ user_id: c.user_id, notification_key: notificationKey, reference_date: c.reference_date });
        continue;
      }

      const resendBody = await res.json();
      await supabase
        .from('email_send_log')
        .update({ status: 'sent', message_id: resendBody?.id || null })
        .match({ user_id: c.user_id, notification_key: notificationKey, reference_date: c.reference_date });

      stats.sent++;
    } catch (e) {
      stats.errors++;
      stats.errorDetails.push((e as Error).message);
    }
  }

  // 5. Record trigger run.
  if (!dryRun) {
    await supabase.rpc('email_trigger_record_run', {
      p_notification_key: notificationKey,
      p_stats: { matched: stats.matched, sent: stats.sent, skipped: stats.skipped, errors: stats.errors, at: new Date().toISOString() },
    });
  }

  return stats;
}

// ── Entry point ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });

  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'Missing secrets: RESEND_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' }, 500, req);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authorization gate: either the shared cron secret OR an admin JWT.
  const auth = await authorizeCaller(req, supabase);
  if (!auth.ok) {
    return json({ error: 'unauthorized', reason: auth.reason }, 401, req);
  }

  // Parse optional body: { keys?: string[], dryRun?: bool }
  let body: { keys?: string[]; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const dryRun = !!body.dryRun;

  // 1. Kill switch gate.
  const { data: settings } = await supabase
    .from('email_settings')
    .select('emails_paused, pause_reason')
    .eq('id', 1)
    .maybeSingle();
  if (settings?.emails_paused) {
    return json({ ok: false, paused: true, reason: settings.pause_reason || null, skipped: true }, 200, req);
  }

  // 2. Which triggers to run?
  let triggerKeys: string[];
  if (body.keys && body.keys.length) {
    triggerKeys = body.keys;
  } else {
    const { data: triggers, error } = await supabase
      .from('email_triggers')
      .select('notification_key')
      .eq('enabled', true);
    if (error) return json({ error: error.message }, 500, req);
    triggerKeys = (triggers || []).map(t => t.notification_key);
  }

  if (triggerKeys.length === 0) {
    return json({ ok: true, message: 'No enabled triggers', runs: [] }, 200, req);
  }

  // 3. Process each trigger sequentially (Resend rate limit-friendly).
  const runs = [];
  for (const key of triggerKeys) {
    runs.push(await processTrigger(supabase, key, dryRun));
  }

  const totals = runs.reduce(
    (a, r) => ({
      matched: a.matched + r.matched,
      sent:    a.sent    + r.sent,
      skipped: a.skipped + r.skipped,
      errors:  a.errors  + r.errors,
    }),
    { matched: 0, sent: 0, skipped: 0, errors: 0 },
  );

  return json({ ok: true, dryRun, totals, runs }, 200, req);
});
