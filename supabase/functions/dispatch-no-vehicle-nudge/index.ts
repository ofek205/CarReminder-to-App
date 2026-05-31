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
  // Copy: "peace of mind", friendly/rich direction (approved 2026-05-31,
  // matching the reference the owner liked). Light surface, plate as hero,
  // icon feature-cards, one strong CTA. Emoji used as cross-client-safe
  // icons (Gmail strips inline SVG; emoji render everywhere). No dashes in
  // prose. The plate number keeps its dashes — that's plate formatting.
  return `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f0ea;font-family:Heebo,Arial,sans-serif">
<div style="max-width:524px;margin:20px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 6px 28px rgba(0,0,0,0.09)">
  <div style="height:4px;background:linear-gradient(90deg,#2D5233,#4B7A53,#F5D200)"></div>
  <div style="padding:32px 28px 28px">

    <!-- Header: friendly, name + wave -->
    <h1 style="color:#1C2E20;margin:0;font-size:23px;font-weight:800;text-align:center;line-height:1.35">
      ${name}, נשאר רק צעד אחד קטן <span style="white-space:nowrap">&#128075;</span>
    </h1>
    <p style="font-size:15px;color:#5c6b5f;line-height:1.7;text-align:center;margin:12px 0 26px">
      הוסף את מספר הרכב שלך, ואנחנו נזכיר לך בזמן על
      <b style="color:#2D7A3E">טסט</b>,
      <b style="color:#2D7A3E">ביטוח</b> ו<b style="color:#2D7A3E">טיפולים</b>.
    </p>

    <!-- Plate card (the hero) -->
    <div style="background:#f6f8f5;border:1px solid #e3ebe4;border-radius:16px;padding:20px 16px 22px;text-align:center;margin:0 0 22px">
      <p style="margin:0 0 14px;font-size:14px;font-weight:bold;color:#2D5233;line-height:1.5">
        מקלידים מספר רכב, וכל התזכורות מסתדרות לבד <span style="color:#4B7A53">&#8623;</span>
      </p>
      <table cellpadding="0" cellspacing="0" align="center" style="border-collapse:separate;border:3px solid #111;border-radius:10px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.22)">
        <tr>
          <td style="background:#0033A0;color:#fff;padding:12px 12px;font-size:13px;font-weight:bold;text-align:center;line-height:1.2;font-family:Arial,sans-serif">
            <span style="display:block;font-size:13px">&#127470;&#127473;</span>IL
          </td>
          <td style="background:#F5D200;padding:11px 24px;font-size:30px;font-weight:bold;color:#111;letter-spacing:3px;font-family:Arial,sans-serif" dir="ltr">12-345-67</td>
        </tr>
      </table>
    </div>

    <!-- 3 feature cards with icon + check -->
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px">
      <tr>
        <td width="33%" style="text-align:center;padding:0 5px">
          <div style="border:1px solid #e6ebe6;border-radius:14px;padding:14px 4px 12px">
            <div style="width:46px;height:46px;border-radius:50%;background:#eaf4ec;text-align:center;line-height:46px;font-size:22px;margin:0 auto 8px">&#128203;</div>
            <div style="font-size:13px;color:#1C2E20;font-weight:bold">&#10003; טסט</div>
          </div>
        </td>
        <td width="33%" style="text-align:center;padding:0 5px">
          <div style="border:1px solid #e6ebe6;border-radius:14px;padding:14px 4px 12px">
            <div style="width:46px;height:46px;border-radius:50%;background:#eaf4ec;text-align:center;line-height:46px;font-size:22px;margin:0 auto 8px">&#128737;</div>
            <div style="font-size:13px;color:#1C2E20;font-weight:bold">&#10003; ביטוח</div>
          </div>
        </td>
        <td width="33%" style="text-align:center;padding:0 5px">
          <div style="border:1px solid #e6ebe6;border-radius:14px;padding:14px 4px 12px">
            <div style="width:46px;height:46px;border-radius:50%;background:#eaf4ec;text-align:center;line-height:46px;font-size:22px;margin:0 auto 8px">&#128295;</div>
            <div style="font-size:13px;color:#1C2E20;font-weight:bold">&#10003; טיפולים</div>
          </div>
        </td>
      </tr>
    </table>

    <!-- Ease strip -->
    <div style="background:#eaf4ec;border-radius:12px;padding:13px 16px;text-align:center;margin:0 0 22px">
      <span style="font-size:18px;vertical-align:middle">&#9201;</span>
      <span style="font-size:14px;font-weight:bold;color:#2D5233;vertical-align:middle"> זה לוקח פחות מ-10 שניות</span>
      <div style="font-size:12px;color:#5c6b5f;margin-top:3px">מספר רכב אחד, וזהו.</div>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin:0 0 14px">
      <a href="${APP_URL}" style="display:inline-block;background:#2D5233;color:#fff;padding:15px 44px;border-radius:12px;text-decoration:none;font-weight:bold;font-size:16px;box-shadow:0 4px 14px rgba(45,82,51,0.35)">
        הוסף רכב עכשיו
      </a>
    </div>
    <p style="font-size:13px;color:#9aa39c;text-align:center;margin:0">
      צריך עזרה? פשוט השב למייל הזה ונענה לך.
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

      const subject = `${firstName ? `${firstName}, ` : ''}נשאר רק צעד אחד קטן`;
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
