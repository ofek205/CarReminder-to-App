// ═══════════════════════════════════════════════════════════════════════════
// check-ai-quota — hourly cron that watches AI provider daily quotas
// and fires Telegram alerts when thresholds are crossed.
//
// Auth:
//   Verify JWT: OFF. The function is invoked by pg_cron (no JWT in
//   that context). We gate on the X-Dispatch-Secret header instead —
//   same pattern as send-daily-digest.
//
// Behaviour:
//   1. Read today's request count per provider from ai_usage_logs.
//   2. For each provider, check whether we crossed 70% or 90% of its
//      published free-tier RPD cap.
//   3. For each crossed threshold, insert a row into ai_quota_alerts
//      with ON CONFLICT DO NOTHING (dedup ledger — only the first
//      crossing per day actually inserts).
//   4. If the insert affected a row (the alert is "new today"),
//      forward the message to dispatch-admin-alert which writes to
//      Telegram.
//
// Failure modes:
//   • DB read failure  → return 500. Cron will try again in an hour.
//   • Telegram failure → ledger row already inserted, so we won't
//     retry the same alert today. Logged for triage.
//   • Function deployed but secret missing → 500 with clear message.
//
// Secrets required:
//   SUPABASE_URL              already set
//   SUPABASE_SERVICE_ROLE_KEY already set
//   DISPATCH_SECRET           already set (shared with send-daily-digest)
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET  = Deno.env.get('DISPATCH_SECRET');

// Per-provider daily request caps from each vendor's published free
// tier. Update these when we either upgrade to a paid plan or one of
// the vendors changes their limits. Anything not in this map is
// ignored — Claude / Grok don't have free-tier RPD caps we track yet.
const DAILY_REQUEST_CAPS: Record<string, number> = {
  gemini: 1500,   // Gemini 2.5 Flash free tier — 1500 RPD
  groq:   1000,   // Llama 3.3 70B on Groq free tier — 1000 RPD
};

// Threshold percentages we alert on. Order matters — we check higher
// thresholds first so that a single jump (e.g. 0% → 95%) sends the
// 90% alert (more urgent), not the 70% one.
const THRESHOLDS = [90, 70];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CheckResult {
  provider:        string;
  requests_today:  number;
  cap:             number;
  pct:             number;
  crossed:         number | null;  // 70 / 90 / null
  alert_sent:      boolean;
  dedup_skipped:   boolean;
}

async function sendTelegram(
  title: string,
  message: string,
): Promise<{ ok: boolean; status?: number }> {
  // Reuse the existing dispatch-admin-alert function. Keeps the
  // Telegram credentials in ONE place.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dispatch-admin-alert`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ title, message }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error('[check-ai-quota] sendTelegram failed:', (err as Error)?.message);
    return { ok: false };
  }
}

function formatAlertMessage(
  provider:       string,
  requestsToday:  number,
  cap:            number,
  pct:            number,
  threshold:      number,
): { title: string; body: string } {
  const isUrgent = threshold === 90;
  const title    = isUrgent
    ? `🔴 ${provider} — מכסה כמעט מלאה`
    : `🟡 ${provider} — מתקרבים לתקרה`;

  const lines = [
    `הספק ${provider} עבר ${pct}% מהמכסה היומית`,
    `בקשות היום: ${requestsToday} מתוך ${cap}`,
    `מצב: ${pct >= 90 ? 'דחוף — נשארות פחות מ-10% במכסה' : 'מעקב — לעקוב אחר השעות הקרובות'}`,
    '',
    'פעולות מומלצות:',
    pct >= 90
      ? '• להעביר את yossi_chat ל-Groq עד הלילה (אם Gemini)\n• או להעלות לתכנית בתשלום\n• או להשבית סריקת מסמכים זמנית במסך "שימוש ב-AI"'
      : '• לעקוב אחר השעות הבאות במסך "שימוש ב-AI"\n• להחליט אם להעביר ספק לפני שמגיעים ל-90%',
  ];

  return { title, body: lines.join('\n') };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  // Auth — X-Dispatch-Secret must match the configured secret.
  if (!DISPATCH_SECRET) {
    console.error('[check-ai-quota] DISPATCH_SECRET not configured');
    return json({ error: 'server misconfigured' }, 500);
  }
  const provided = req.headers.get('x-dispatch-secret');
  if (provided !== DISPATCH_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Today's UTC midnight as the start of the window. The vendors
  // measure RPD on UTC days, so we do too.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sinceIso = today.toISOString();
  const sentDate = today.toISOString().slice(0, 10);

  // Pull per-provider request counts in one query.
  const { data: rows, error: rowsErr } = await sb
    .from('ai_usage_logs')
    .select('provider')
    .gte('created_at', sinceIso);

  if (rowsErr) {
    console.error('[check-ai-quota] read failed:', rowsErr.message);
    return json({ error: 'read_failed', detail: rowsErr.message }, 500);
  }

  const countsByProvider: Record<string, number> = {};
  for (const r of (rows || [])) {
    const p = (r as { provider?: string }).provider || 'unknown';
    countsByProvider[p] = (countsByProvider[p] || 0) + 1;
  }

  const results: CheckResult[] = [];

  for (const [provider, cap] of Object.entries(DAILY_REQUEST_CAPS)) {
    const requestsToday = countsByProvider[provider] || 0;
    const pct = Math.round((100 * requestsToday) / cap);
    const crossed = THRESHOLDS.find((t) => pct >= t) || null;

    const result: CheckResult = {
      provider,
      requests_today: requestsToday,
      cap,
      pct,
      crossed,
      alert_sent: false,
      dedup_skipped: false,
    };

    if (crossed !== null) {
      // Attempt to insert dedup ledger row. UNIQUE constraint on
      // (provider, threshold, sent_date) means a second insert today
      // for the same combination returns "violates unique constraint",
      // which we treat as "already alerted, skip silently".
      const message = formatAlertMessage(provider, requestsToday, cap, pct, crossed);
      const { data: inserted, error: insErr } = await sb
        .from('ai_quota_alerts')
        .insert({
          provider,
          threshold: crossed,
          sent_date: sentDate,
          requests_at_send: requestsToday,
          message: `${message.title}\n\n${message.body}`.slice(0, 4000),
        })
        .select('id')
        .maybeSingle();

      if (insErr) {
        // 23505 = unique_violation = already alerted today.
        if (insErr.code === '23505') {
          result.dedup_skipped = true;
        } else {
          console.warn('[check-ai-quota] insert failed:', insErr.message);
        }
      } else if (inserted) {
        // Fresh ledger row — send the actual alert.
        const sendRes = await sendTelegram(message.title, message.body);
        result.alert_sent = sendRes.ok;
        if (!sendRes.ok) {
          console.warn(`[check-ai-quota] telegram failed for ${provider} ${crossed}%`);
        }
      }
    }

    results.push(result);
  }

  return json({ checked_at: new Date().toISOString(), results });
});
