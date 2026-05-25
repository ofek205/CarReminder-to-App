// ═══════════════════════════════════════════════════════════════════════════
// send-daily-digest — Telegram daily summary at 20:00 Israel time.
//
// Called by pg_cron. Auth via X-Dispatch-Secret (same secret as email
// dispatcher). Queries get_daily_digest() RPC, formats a Telegram message,
// and sends to the admin chat.
//
// Secrets required (already set for other functions):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DISPATCH_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Deploy: Dashboard → Edge Functions → send-daily-digest → paste → Deploy.
//         Verify JWT: OFF (called by pg_cron, not browser).
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DISPATCH_SECRET  = Deno.env.get('DISPATCH_SECRET');
const BOT_TOKEN        = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID          = Deno.env.get('TELEGRAM_CHAT_ID');

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Inline best-effort error reporter. Writes a structured stderr line
// (always works) and attempts an app_errors insert (silent fail-safe).
// Inlined rather than imported from _shared/ so this file remains
// deployable through the Supabase Dashboard editor without manual
// auxiliary file uploads.
async function reportEdgeError(action: string, error: unknown, extra?: Record<string, unknown>) {
  const FN = 'send-daily-digest';
  const err = error as { message?: string; stack?: string } | null;
  const message = (err?.message || String(error) || 'unknown').slice(0, 500);
  const stack = (err?.stack || '').slice(0, 2000) || null;
  try {
    console.error(JSON.stringify({ _: 'edge_error', fn: FN, action, message, ts: new Date().toISOString() }));
  } catch { /* never throw from logging */ }
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
  } catch { /* best-effort */ }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST')   return json({ error: 'Method not allowed' }, 405);

  // Auth: shared secret only (cron caller).
  const secret = req.headers.get('x-dispatch-secret');
  if (!DISPATCH_SECRET || secret !== DISPATCH_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    return json({ error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID' }, 500);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await supabase.rpc('get_daily_digest');
    if (error) throw new Error(`RPC error: ${error.message}`);

    const text = formatDigest(data);

    const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });

    if (!tg.ok) {
      const details = await tg.text();
      throw new Error(`Telegram API ${tg.status}: ${details}`);
    }

    const result = await tg.json();
    return json({ ok: true, telegram_message_id: result?.result?.message_id });
  } catch (err: any) {
    await reportEdgeError('digest_main', err);
    return json({ error: err.message }, 500);
  }
});

function formatDigest(d: any): string {
  const lines: string[] = [];

  lines.push(`📊 <b>סיכום יומי — ${d.date}</b>`);
  lines.push('');
  lines.push(`👥 הרשמות היום: <b>${d.signups}</b>`);
  lines.push(`🚗 רכבים חדשים: <b>${d.vehicles}</b>`);
  lines.push(`📄 מסמכים: <b>${d.documents}</b>`);

  if (d.errors > 0) {
    lines.push(`⚠️ שגיאות: <b>${d.errors}</b>`);
  }
  if (d.unack_alerts > 0) {
    lines.push(`🔔 התראות פתוחות: <b>${d.unack_alerts}</b>`);
  }
  if (d.new_support > 0) {
    lines.push(`💬 פניות חדשות: <b>${d.new_support}</b>`);
  }

  const highlights: any[] = d.highlights || [];
  if (highlights.length > 0) {
    lines.push('');
    lines.push('📌 <b>שים לב:</b>');
    for (const h of highlights) {
      if (h.type === 'alert') {
        const sev = h.severity === 'high' ? '🔴' : '🟡';
        lines.push(`${sev} ${escapeHtml(h.text)}`);
      } else {
        lines.push(`• ${escapeHtml(h.text)}`);
      }
    }
  }

  lines.push('');
  lines.push(`📈 סה"כ: <b>${d.total_users}</b> משתמשים · <b>${d.total_vehicles}</b> רכבים`);

  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
