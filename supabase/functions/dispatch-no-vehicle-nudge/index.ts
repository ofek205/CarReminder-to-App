// ═══════════════════════════════════════════════════════════════════════════
// dispatch-no-vehicle-nudge — lifecycle email for users with ZERO vehicles.
//
// Two modes (same RPC, different min_age_days):
//   1. One-time blast (manual):  POST { "min_age_days": 0 }  → every
//      confirmed user with zero vehicles, regardless of signup age.
//   2. Cron (automatic):         POST { "min_age_days": 4 }  → users who
//      signed up >= 4 days ago and still have zero vehicles. pg_cron calls
//      this daily at 06:00 UTC. Once-only per user (email_send_log dedup).
//
// Add "dry_run": true to either to get the recipient count + sample WITHOUT
// sending — always do a dry-run first before a live blast.
//
// Auth: X-Dispatch-Secret (same as backfill-welcome — NOT JWT).
// Deploy: Dashboard → Edge Functions → dispatch-no-vehicle-nudge → Verify JWT: OFF.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY');

const FROM = 'CarReminder <no-reply@car-reminder.app>';
const APP_URL = 'https://car-reminder.app';
const NOTIFICATION_KEY = 'reminder_no_vehicles';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Inline best-effort error reporter — mirrors backfill-welcome.
async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'dispatch-no-vehicle-nudge';
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

function buildNudgeHtml(firstName: string): string {
  const name = firstName || 'שלום';
  // Visible copy is pure Hebrew; "CarReminder" is the product name, kept in
  // the header lockup exactly as the welcome email does.
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f5f5f0;font-family:Heebo,Arial,sans-serif">
<div style="max-width:520px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#4B7A53,#2D5233);padding:32px 24px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:23px">${name}, נשאר רק צעד אחד</h1>
    <p style="color:#c8e6c9;margin:8px 0 0;font-size:14px">הוסיפו את כלי התחבורה הראשון שלכם</p>
  </div>
  <div style="padding:24px">
    <p style="font-size:15px;color:#333;line-height:1.7">
      נרשמתם — אבל עדיין לא הוספתם רכב, ובלי זה אי אפשר להתחיל.
      ברגע שמוסיפים רכב, אנחנו דואגים לכל השאר: תזכורת לפני טסט,
      לפני חידוש ביטוח, מעקב טיפולים, וכל המסמכים במקום אחד.
    </p>
    <p style="font-size:15px;color:#333;line-height:1.7">
      ההוספה לוקחת פחות מדקה — מספיק מספר רישוי, והפרטים נמשכים אוטומטית.
    </p>
    <div style="text-align:center;margin:28px 0">
      <a href="${APP_URL}" style="display:inline-block;background:#4B7A53;color:#fff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">
        הוספת הרכב שלי
      </a>
    </div>
    <p style="font-size:13px;color:#888;text-align:center">
      שאלה או צריכים עזרה? פשוט השיבו למייל הזה.
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
    if (!secret) return json({ error: 'Unauthorized' }, 401);

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

    // Parse body. min_age_days defaults to 4 (the cron/automation audience);
    // the one-time blast passes 0 explicitly.
    let dryRun = false;
    let minAgeDays = 4;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
      if (typeof body?.min_age_days === 'number' && body.min_age_days >= 0) {
        minAgeDays = Math.floor(body.min_age_days);
      }
    } catch { /* defaults */ }

    // Honour the global kill-switch (best-effort — if the table/row is
    // missing we proceed, same posture as the rest of the email system).
    let paused = false;
    try {
      const { data: settings } = await supabase
        .from('email_settings').select('emails_paused').eq('id', 1).maybeSingle();
      paused = settings?.emails_paused === true;
    } catch { /* table optional */ }
    if (paused && !dryRun) {
      return json({ ok: true, message: 'emails_paused — global kill-switch on', sent: 0 });
    }

    const { data: users, error: queryErr } = await supabase.rpc(
      'admin_no_vehicle_nudge_list',
      { p_min_age_days: minAgeDays }
    );
    if (queryErr) {
      await reportEdgeError('list_users_rpc', queryErr, { minAgeDays });
      return json({ error: `RPC error: ${queryErr.message}` }, 500);
    }

    if (!users || users.length === 0) {
      return json({ ok: true, message: 'No users need the no-vehicle nudge', sent: 0 });
    }

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        min_age_days: minAgeDays,
        count: users.length,
        users: users.slice(0, 50).map((u: any) => ({
          email: u.email,
          full_name: u.full_name,
          days_since_signup: u.days_since_signup,
        })),
      });
    }

    const results: { email: string; status: string; error?: string }[] = [];
    let sent = 0;
    let failed = 0;

    for (const u of users) {
      const firstName = (u.full_name || '').trim().split(/\s+/)[0] || '';

      // Bell notification (+ native push via the app_notifications AFTER
      // INSERT trigger). Best-effort and once-ever per user (the RPC +
      // unique partial index dedup), independent of the email outcome so
      // a Resend failure doesn't cost the user their in-app nudge.
      try {
        await supabase.rpc('notify_no_vehicle', {
          p_user_id: u.user_id,
          p_first_name: firstName || null,
        });
      } catch (notifErr) {
        await reportEdgeError('notify_no_vehicle_rpc', notifErr, { recipient: u.email });
      }

      const subject = `${firstName ? `${firstName}, ` : ''}עוד לא הוספת רכב ל-CarReminder`;
      const html = buildNudgeHtml(firstName);

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: FROM, to: [u.email], subject, html }),
        });

        let data: any = {};
        try { data = await res.json(); } catch { /* non-JSON response */ }

        if (res.ok) {
          sent++;
          results.push({ email: u.email, status: 'sent' });
          // Log AFTER a confirmed send → guarantees once-only via the
          // NOT EXISTS check in admin_no_vehicle_nudge_list.
          const { error: logErr } = await supabase.from('email_send_log').insert({
            user_id: u.user_id,
            notification_key: NOTIFICATION_KEY,
            recipient_email: u.email,
            status: 'sent',
            message_id: data?.id || null,
            metadata: { days_since_signup: u.days_since_signup, min_age_days: minAgeDays },
          });
          if (logErr) console.error('Log insert error:', logErr.message);
        } else {
          failed++;
          results.push({ email: u.email, status: 'failed', error: data?.message || `HTTP ${res.status}` });
        }
      } catch (err: any) {
        failed++;
        results.push({ email: u.email, status: 'failed', error: err?.message || 'Unknown error' });
        await reportEdgeError('send_nudge_email', err, { recipient: u.email });
      }

      // Gentle pacing — same 500ms spacing as backfill-welcome.
      await new Promise(r => setTimeout(r, 500));
    }

    return json({ ok: true, total: users.length, sent, failed, min_age_days: minAgeDays, results });
  } catch (err: any) {
    await reportEdgeError('nudge_main', err);
    return json({ error: err?.message || 'Unknown error' }, 500);
  }
});
