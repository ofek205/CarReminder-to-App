// ═══════════════════════════════════════════════════════════════════════════
// dispatch-admin-alert — sends admin alerts to Telegram.
//
// Auth: gated on DISPATCH_SECRET header (x-dispatch-secret). Only internal
//   callers (DB triggers, other Edge Functions, cron) should know the
//   secret. Audit finding F-1 (2026-05-27): V1 had CORS * and no auth —
//   anyone on the internet could spam the admin's Telegram.
//
// Secrets required (set in Supabase Dashboard → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN  — from BotFather
//   TELEGRAM_CHAT_ID    — admin's private chat with the bot
//   DISPATCH_SECRET     — shared secret for internal callers
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { buildCorsHeaders } from '../_shared/cors.ts';

const BOT_TOKEN        = Deno.env.get('TELEGRAM_BOT_TOKEN');
const CHAT_ID          = Deno.env.get('TELEGRAM_CHAT_ID');
const DISPATCH_SECRET  = Deno.env.get('DISPATCH_SECRET');

const ALERT_ALLOWED_HEADERS =
  'authorization, content-type, apikey, x-client-info, x-dispatch-secret';

function buildCors(req: Request): HeadersInit {
  return buildCorsHeaders(req, { allowedHeaders: ALERT_ALLOWED_HEADERS });
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? buildCors(req) : {}), 'Content-Type': 'application/json' },
  });
}

// Stderr-only error reporter. We deliberately do NOT write to app_errors
// here: this function is the channel that ALERTS the admin. If a write
// to app_errors triggered check_admin_alerts() to insert a new alert,
// the next dispatch attempt could fail the same way and loop. Function
// Logs (24h retention) are sufficient for triaging Telegram delivery.
function logEdgeError(action: string, detail: unknown) {
  try {
    const err = detail as { message?: string } | null;
    const message = (err?.message || String(detail) || 'unknown').slice(0, 500);
    console.error(JSON.stringify({
      _: 'edge_error', fn: 'dispatch-admin-alert', action, message,
      ts: new Date().toISOString(),
    }));
  } catch {}
}

serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
    if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405, req);

    // Auth gate: require DISPATCH_SECRET or service-role key. Without
    // this, any caller who knows the function URL can spam the admin's
    // Telegram. Audit finding F-1 (2026-05-27).
    //
    // Accepted credentials (checked in order):
    //   1. x-dispatch-secret header matches DISPATCH_SECRET
    //   2. Authorization: Bearer matches DISPATCH_SECRET
    //   3. Authorization: Bearer matches SUPABASE_SERVICE_ROLE_KEY
    //      (for internal Edge Function callers like check-ai-quota)
    //
    // When DISPATCH_SECRET is not yet configured, the gate is OPEN with
    // a warning — this prevents breaking the DB trigger caller
    // (dispatch_admin_alert_via_http) which currently sends no auth.
    // Once DISPATCH_SECRET is set in Secrets, the gate activates.
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (DISPATCH_SECRET) {
      const headerSecret = req.headers.get('x-dispatch-secret') || '';
      const bearerToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const isAuthorized =
        headerSecret === DISPATCH_SECRET ||
        bearerToken === DISPATCH_SECRET ||
        (SERVICE_ROLE && bearerToken === SERVICE_ROLE);
      if (!isAuthorized) {
        logEdgeError('auth_rejected', new Error('invalid or missing dispatch secret'));
        return json({ error: 'Unauthorized' }, 401, req);
      }
    } else {
      // No secret configured — log warning but allow (backward compat).
      // TODO: set DISPATCH_SECRET in Supabase Secrets to activate the gate.
      console.warn('[dispatch-admin-alert] DISPATCH_SECRET not configured — auth gate inactive');
    }

    if (!BOT_TOKEN || !CHAT_ID) {
      logEdgeError('config_missing', new Error('telegram secrets missing'));
      return json({ error: 'Server missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID secrets' }, 500, req);
    }

    let body: { title?: string; message?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400, req);
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
      logEdgeError('telegram_api_failed', new Error(`status ${tg.status}: ${details.slice(0, 200)}`));
      return json({ error: 'Telegram API failed', status: tg.status, details }, 502, req);
    }

    const result = await tg.json();
    return json({ ok: true, telegram_message_id: result?.result?.message_id }, 200, req);
  } catch (err: unknown) {
    logEdgeError('main', err);
    return json({ error: 'internal error' }, 500, req);
  }
});
