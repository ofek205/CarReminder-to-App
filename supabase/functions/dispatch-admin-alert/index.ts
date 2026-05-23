// ═══════════════════════════════════════════════════════════════════════════
// dispatch-admin-alert — sends admin alerts to Telegram.
//
// V1 (this file): accepts {title, message} via POST, forwards to Telegram.
//   - Verify JWT: OFF (will be tightened in V2)
//   - No auth check (URL must be kept private)
//
// V2 (Stream 7 main): will read from admin_alerts table, run dedup logic,
//   add inline keyboard for "acknowledge", record notified_via, and gate
//   on shared secret OR service-role for safe public-URL hosting.
//
// Secrets required (set in Supabase Dashboard → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN — from BotFather
//   TELEGRAM_CHAT_ID   — admin's private chat with the bot
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

const corsHeaders: HeadersInit = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405);

  if (!BOT_TOKEN || !CHAT_ID) {
    return json({ error: 'Server missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secrets' }, 500);
  }

  let body: { title?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Hard length caps so a runaway caller can't blast huge messages.
  const title   = (body.title   || 'Test Alert').slice(0, 200);
  const message = (body.message || 'No message provided').slice(0, 3000);

  // Plain text (no parse_mode) so special characters in error messages
  // never break the send. V2 will switch to MarkdownV2 with proper escaping
  // once we have control over the content shape.
  const text = `🚨 ${title}\n\n${message}`;

  const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: CHAT_ID, text }),
  });

  if (!tg.ok) {
    const details = await tg.text();
    return json({ error: 'Telegram API failed', status: tg.status, details }, 502);
  }

  const result = await tg.json();
  return json({ ok: true, telegram_message_id: result?.result?.message_id });
});
