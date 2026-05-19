#!/usr/bin/env node
/**
 * One-off welcome-email backfill for the launch-day cohort.
 *
 * Companion to scripts/welcome-backfill-2026-05-19.sql. The SQL file is
 * the "who" (recipient list); this file is the "how" (actually sending).
 *
 * Why a separate Node script and not pg_net from SQL:
 *   send-email Edge Function requires a Bearer JWT — it rejects
 *   service_role and x-dispatch-secret on purpose (it's user-callable
 *   only; see supabase/functions/send-email/index.ts:47-50). We use
 *   Ofek's admin JWT to satisfy that gate while reusing the production
 *   pipeline (rate limit, kill switch, email_send_log).
 *
 * Runbook for tomorrow morning (2026-05-20 ~09:00 IL):
 *   1. In Supabase Dashboard → SQL Editor, run the Step-1 PREVIEW from
 *      scripts/welcome-backfill-2026-05-19.sql. Verify the count and
 *      that no internal accounts slipped through.
 *   2. Use the "Download as JSON" button (or copy-paste results) and
 *      save the array as scripts/welcome-recipients.json. Expected
 *      shape: [{ user_id, recipient_email, full_name, provider, ... }].
 *   3. In the app (logged in as admin), open DevTools → Application →
 *      Local Storage → find the key starting with `sb-...-auth-token`,
 *      copy the `access_token` field. Set it as ADMIN_JWT below.
 *   4. Set the other env vars (SUPABASE_URL + SUPABASE_ANON_KEY are in
 *      .env at the repo root — read them from there).
 *   5. Run:
 *        node scripts/backfill-welcome-2026-05-19.cjs --dry-run
 *      to print the planned sends without firing anything.
 *   6. When happy:
 *        node scripts/backfill-welcome-2026-05-19.cjs
 *      Runs at ~5/min (Resend rate limit on send-email per user JWT
 *      is 5/min/admin — the script paces to 12s between calls to stay
 *      inside that ceiling). 45 users → roughly 9-10 minutes.
 *
 * Safety:
 *   • Idempotency: send-email writes to email_send_log. If you re-run,
 *     the next-day's SELECT will exclude already-sent users.
 *   • Per-send failures are caught and reported; the script continues
 *     to the next recipient rather than aborting on one bad email.
 *   • Dry-run mode lists what WOULD be sent without calling the Edge
 *     Function. Use it first.
 */

const fs   = require('fs');
const path = require('path');

const DRY_RUN     = process.argv.includes('--dry-run');
const RECIPIENTS  = path.join(__dirname, 'welcome-recipients.json');
const APP_URL     = 'https://car-reminder.app';
const PER_SEND_MS = 12_000; // 5/min ceiling on send-email per JWT → ~12s gap

const SUPABASE_URL      = process.env.SUPABASE_URL      || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const ADMIN_JWT         = process.env.ADMIN_JWT;

function die(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL)      die('SUPABASE_URL env var missing (or VITE_SUPABASE_URL in .env)');
if (!SUPABASE_ANON_KEY) die('SUPABASE_ANON_KEY env var missing');
if (!ADMIN_JWT && !DRY_RUN) die('ADMIN_JWT env var missing — paste your access_token (see header comment)');

if (!fs.existsSync(RECIPIENTS)) {
  die(`Recipient file not found at ${RECIPIENTS}. Run the SQL preview first and save the JSON output here.`);
}

const recipients = JSON.parse(fs.readFileSync(RECIPIENTS, 'utf8'));
if (!Array.isArray(recipients) || recipients.length === 0) {
  die('Recipient file is empty or not an array.');
}
console.log(`▶ Loaded ${recipients.length} recipients from ${path.basename(RECIPIENTS)}`);
if (DRY_RUN) console.log('▶ DRY RUN — no emails will be sent.');

// Minimal welcome HTML / text — kept inline rather than importing from
// src/lib/emailTemplates.js because that module is ESM + Vite-flavoured
// and would need extra plumbing to run from a CommonJS script. The copy
// matches what the going-forward AuthPage / GuestContext dispatchers send.
function buildHtml(firstName) {
  const greeting = firstName ? `שלום ${firstName},` : 'שלום,';
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8"><title>ברוכים הבאים ל-CarReminder</title></head>
<body style="margin:0;background:#F7FAF7;font-family:system-ui,-apple-system,sans-serif;color:#1C2E20;">
<div style="max-width:560px;margin:24px auto;background:#FFFFFF;border-radius:16px;padding:24px;border:1px solid #D8E5D9;">
  <div style="font-size:20px;font-weight:700;color:#2D5233;margin-bottom:12px;">ברוכים הבאים ל-CarReminder!</div>
  <div style="font-size:15px;line-height:1.7;">
    <p>${greeting}</p>
    <p>שמחים שהצטרפת. CarReminder עוזרת לנהל את הרכבים שלך — טסט, ביטוח, טיפולים והוצאות — במקום אחד, עם תזכורות חכמות שיגיעו בזמן.</p>
    <p>קח דקה להוסיף את הרכב הראשון שלך כדי להתחיל לקבל את התזכורות:</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${APP_URL}/AddVehicle" style="display:inline-block;padding:12px 24px;background:#2D5233;color:#FFFFFF;text-decoration:none;border-radius:10px;font-weight:600;">פתח את האפליקציה</a>
    </p>
    <p style="font-size:13px;color:#7A8A7C;">צריך עזרה? פשוט תענה למייל הזה ונחזור אליך.</p>
  </div>
</div>
<div style="text-align:center;font-size:11px;color:#9CA3AF;padding:12px;">© CarReminder · car-reminder.app</div>
</body></html>`;
}

function buildText(firstName) {
  const greeting = firstName ? `שלום ${firstName},` : 'שלום,';
  return [
    'ברוכים הבאים ל-CarReminder!',
    '',
    greeting,
    'שמחים שהצטרפת. CarReminder עוזרת לנהל את הרכבים שלך — טסט, ביטוח, טיפולים והוצאות — במקום אחד, עם תזכורות חכמות.',
    '',
    'התחל כאן: ' + APP_URL + '/AddVehicle',
    '',
    '© CarReminder · car-reminder.app',
  ].join('\n');
}

async function sendOne(rec) {
  const firstName = (rec.full_name || '').trim().split(/\s+/)[0] || '';
  const subject = `ברוך/ה הבא/ה ל-CarReminder${firstName ? `, ${firstName}` : ''}`;
  const body = {
    to:               rec.recipient_email,
    subject,
    html:             buildHtml(firstName),
    text:             buildText(firstName),
    notification_key: 'welcome',
  };

  if (DRY_RUN) {
    console.log(`  [dry] would send to ${rec.recipient_email} (${firstName || '—'})`);
    return { ok: true, dryRun: true };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ADMIN_JWT}`,
      'apikey':        SUPABASE_ANON_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });
  let json;
  try { json = await res.json(); } catch { json = {}; }
  return { ok: res.ok, status: res.status, json };
}

(async () => {
  let sent = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < recipients.length; i++) {
    const rec = recipients[i];
    process.stdout.write(`(${i + 1}/${recipients.length}) → ${rec.recipient_email} … `);
    try {
      const out = await sendOne(rec);
      if (out.ok) {
        sent++;
        console.log(out.dryRun ? 'dry' : `ok (id=${out.json?.id || '?'})`);
      } else {
        failed++;
        failures.push({ email: rec.recipient_email, status: out.status, error: out.json?.error });
        console.log(`✘ ${out.status}: ${out.json?.error || 'unknown'}`);
      }
    } catch (err) {
      failed++;
      failures.push({ email: rec.recipient_email, error: err.message });
      console.log(`✘ threw: ${err.message}`);
    }

    if (!DRY_RUN && i < recipients.length - 1) {
      await new Promise(r => setTimeout(r, PER_SEND_MS));
    }
  }

  console.log('');
  console.log(`══ Summary: ${sent} sent, ${failed} failed of ${recipients.length} ══`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach(f => console.log(`  ${f.email}: ${f.status || ''} ${f.error || ''}`));
    process.exit(1);
  }
})();
