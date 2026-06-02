// ════════════════════════════════════════════════════════════════════════
// unsubscribe — public, login-free marketing opt-out endpoint.
//
// Deploy with Verify JWT = OFF (it's reached from an email link / a mail
// provider's server, neither of which carries a Supabase JWT). Security comes
// from the HMAC-signed token, not from auth.
//
//   GET  /unsubscribe?token=...   → record opt-out, return a branded HTML page
//   POST /unsubscribe?token=...   → RFC 8058 List-Unsubscribe-Post one-click;
//                                    record opt-out, return 200 (no body)
//
// Records into email_marketing_optout via record_marketing_unsubscribe()
// (idempotent). The marketing audience RPCs exclude opted-out users, so the
// opt-out takes effect on the very next send.
//
// Secret required: UNSUBSCRIBE_SECRET (same value the senders sign with).
// ════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyUnsubscribeToken } from '../_shared/unsubscribeToken.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SECRET       = Deno.env.get('UNSUBSCRIBE_SECRET') || '';

const BRAND_GREEN = '#2D5233';

function htmlPage(title: string, message: string, ok: boolean): string {
  const accent = ok ? BRAND_GREEN : '#B91C1C';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;background:#F4F7F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1C3620">
  <div style="max-width:440px;margin:64px auto;padding:0 16px">
    <div style="background:#fff;border-radius:24px;box-shadow:0 6px 28px rgba(17,34,22,0.08);padding:36px 28px;text-align:center">
      <div style="width:64px;height:64px;border-radius:18px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;background:${accent}1A;color:${accent};font-size:30px">${ok ? '✓' : '!'}</div>
      <h1 style="font-size:20px;font-weight:800;margin:0 0 10px;color:${accent}">${title}</h1>
      <p style="font-size:15px;line-height:1.7;color:#475569;margin:0">${message}</p>
      <p style="font-size:12px;color:#94A3B8;margin:22px 0 0">CarReminder · ניהול חכם של כלי רכב</p>
    </div>
  </div>
</body>
</html>`;
}

function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  const isPost = req.method === 'POST'; // mail-client one-click (RFC 8058)

  if (!SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    return isPost
      ? new Response('server misconfigured', { status: 500 })
      : html(htmlPage('שגיאה זמנית', 'לא הצלחנו לעבד את הבקשה כרגע. נסה/י שוב מאוחר יותר.', false), 500);
  }

  const userId = await verifyUnsubscribeToken(token, SECRET);
  if (!userId) {
    return isPost
      ? new Response('invalid token', { status: 400 })
      : html(htmlPage('הקישור אינו תקין', 'ייתכן שהקישור שגוי או הועתק חלקית. אפשר לנהל העדפות מתוך האפליקציה.', false), 400);
  }

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await sb.rpc('record_marketing_unsubscribe', {
      p_user_id: userId,
      p_source: isPost ? 'list_unsubscribe' : 'email_link',
    });
    if (error) throw error;
  } catch (_e) {
    return isPost
      ? new Response('error', { status: 500 })
      : html(htmlPage('שגיאה זמנית', 'לא הצלחנו לעדכן את ההעדפה כרגע. נסה/י שוב מאוחר יותר.', false), 500);
  }

  if (isPost) return new Response('OK', { status: 200 });
  return html(htmlPage(
    'הוסרת מהדיוור השיווקי',
    'לא תקבל/י יותר מיילים שיווקיים מ-CarReminder. תזכורות חשובות על הרכב שלך (טסט, ביטוח, טיפולים) ימשיכו כרגיל.',
    true,
  ), 200);
});
