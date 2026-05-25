// ═══════════════════════════════════════════════════════════════════════════
// backfill-welcome — Server-side welcome email sender.
//
// Two modes:
//   1. Backfill (manual):  POST { "dry_run": false }  → sends to ALL users
//      who never got a welcome email.
//   2. Cron (automatic):   POST { "since_hours": 1 }  → sends only to users
//      who signed up in the last N hours and haven't got a welcome yet.
//      pg_cron calls this every 10 minutes with since_hours=1.
//
// Auth: X-Dispatch-Secret (same as daily digest — NOT JWT).
// Deploy: Dashboard → Edge Functions → backfill-welcome → Verify JWT: OFF.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY');

const FROM = 'CarReminder <no-reply@car-reminder.app>';
const APP_URL = 'https://car-reminder.app';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Inline best-effort error reporter — see notes in send-daily-digest.
async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'backfill-welcome';
  const err = error as { message?: string; stack?: string } | null;
  const message = (err?.message || String(error) || 'unknown').slice(0, 500);
  const stack = (err?.stack || '').slice(0, 2000) || null;
  try {
    console.error(JSON.stringify({ _: 'edge_error', fn: FN, action, message, ts: new Date().toISOString() }));
  } catch {}
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await sb.from('app_errors').insert({
      type: 'edge', message, stack,
      url: `edge:/${FN}`, route: `edge:/${FN}`,
      action, severity: 'error', visible: false,
      app_version: 'edge', user_agent: 'edge-function',
      extra: { fn: FN, ...(extra || {}) },
      created_at: new Date().toISOString(),
    });
  } catch {}
}

function buildWelcomeHtml(firstName: string): string {
  const name = firstName || 'אורח/ת';
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Heebo,Arial,sans-serif">
<div style="max-width:520px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#4B7A53,#2D5233);padding:32px 24px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:24px">ברוך/ה הבא/ה ל-CarReminder</h1>
    <p style="color:#c8e6c9;margin:8px 0 0;font-size:14px">${name}, שמחים שהצטרפת!</p>
  </div>
  <div style="padding:24px">
    <p style="font-size:15px;color:#333;line-height:1.7">
      עכשיו אפשר לנהל את כל כלי התחבורה שלך במקום אחד:
      ביטוחים, טסטים, מסמכים, תחזוקה ותזכורות — הכל מסודר ובשליטה.
    </p>
    <div style="text-align:center;margin:24px 0">
      <a href="${APP_URL}" style="display:inline-block;background:#4B7A53;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
        כניסה לאפליקציה
      </a>
    </div>
    <p style="font-size:13px;color:#888;text-align:center">
      שאלות? פשוט השיבו למייל הזה.
    </p>
  </div>
</div>
</body>
</html>`;
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const secret = req.headers.get('x-dispatch-secret');
    if (!secret) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: valid, error: authErr } = await supabase.rpc('verify_dispatch_secret', {
      p_secret: secret,
    });

    if (authErr || !valid) {
      return json({ error: 'Unauthorized', detail: authErr?.message }, 401);
    }

    if (!RESEND_API_KEY) {
      return json({ error: 'RESEND_API_KEY not configured' }, 500);
    }

    let dryRun = false;
    let sinceHours: number | null = null;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
      if (typeof body?.since_hours === 'number' && body.since_hours > 0) {
        sinceHours = body.since_hours;
      }
    } catch { /* defaults */ }

    const { data: users, error: queryErr } = await supabase.rpc(
      'admin_welcome_backfill_list',
      sinceHours ? { p_since_hours: sinceHours } : {}
    );

    if (queryErr) {
      await reportEdgeError('list_users_rpc', queryErr);
      return json({ error: `RPC error: ${queryErr.message}` }, 500);
    }

    if (!users || users.length === 0) {
      return json({ ok: true, message: 'No users need welcome email', sent: 0 });
    }

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        count: users.length,
        users: users.map((u: any) => ({
          email: u.email,
          full_name: u.full_name,
          provider: u.provider,
          signed_up_at: u.signed_up_at,
        })),
      });
    }

    const results: { email: string; status: string; error?: string }[] = [];
    let sent = 0;
    let failed = 0;

    for (const u of users) {
      const firstName = (u.full_name || '').trim().split(/\s+/)[0] || '';
      const subject = `ברוכים הבאים ל-CarReminder${firstName ? `, ${firstName}` : ''}`;
      const html = buildWelcomeHtml(firstName);

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM,
            to: [u.email],
            subject,
            html,
          }),
        });

        let data: any = {};
        try { data = await res.json(); } catch { /* non-JSON response */ }

        if (res.ok) {
          sent++;
          results.push({ email: u.email, status: 'sent' });

          const { error: logErr } = await supabase.from('email_send_log').insert({
            user_id: u.user_id,
            notification_key: 'welcome',
            recipient_email: u.email,
            status: 'sent',
            message_id: data?.id || null,
          });
          if (logErr) console.error('Log insert error:', logErr.message);
        } else {
          failed++;
          results.push({ email: u.email, status: 'failed', error: data?.message || `HTTP ${res.status}` });
        }
      } catch (err: any) {
        failed++;
        results.push({ email: u.email, status: 'failed', error: err?.message || 'Unknown error' });
        await reportEdgeError('send_welcome_email', err, { recipient: u.email });
      }

      await new Promise(r => setTimeout(r, 500));
    }

    return json({ ok: true, total: users.length, sent, failed, results });
  } catch (err: any) {
    await reportEdgeError('backfill_main', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
});
