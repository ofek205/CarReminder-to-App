// ═══════════════════════════════════════════════════════════════════════════
// admin-delete-user — Supabase Edge Function that fully removes a user
// account from the system, including the auth.users row.
//
// Why an Edge Function?
//   The Postgres RPC `admin_delete_account` only deletes from the public
//   `accounts` table. It deliberately does NOT touch `auth.users` because
//   that table is owned by Supabase and only the service role can mutate
//   it. The result was an unsatisfying admin UX: clicking "delete" emptied
//   the account but the user could still log in and reappear in lists,
//   and the email stayed reserved.
//
//   This function holds the SUPABASE_SERVICE_ROLE_KEY secret and uses
//   `supabase.auth.admin.deleteUser()` — the only sanctioned path for
//   removing an auth user. Because every domain table FK's `auth.users`
//   with `ON DELETE CASCADE` (see supabase-base44-migration.sql:41,
//   supabase-vehicle-shares.sql:26, etc.), a single delete here cleans
//   up accounts, vehicles, documents, shares, notifications, the lot.
//
// Authorization model:
//   1. JWT gate (Supabase auto-validates the bearer token).
//   2. We then re-check via `is_current_user_admin()` RPC — same source
//      of truth the rest of the admin surface uses, so an ex-admin who
//      kept their JWT after demotion can't still delete users.
//   3. Self-delete is blocked (an admin shouldn't be able to delete
//      themselves through this endpoint — they'd lose access mid-call
//      and leave a half-deleted state).
//
// Deploy:
//   • Dashboard: Edge Functions → Deploy new function → paste this file
//   • CLI:       `supabase functions deploy admin-delete-user`
//
// Secret required: SUPABASE_SERVICE_ROLE_KEY (auto-set by Supabase on
//   every project, available to any Edge Function in that project).
//
// Invoke from client:
//   const { data, error } = await supabase.functions.invoke(
//     'admin-delete-user', { body: { user_id: '<auth-user-uuid>' } }
//   );
// ═══════════════════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// CORS — same allow-list pattern as send-email. Wildcards would let any
// page on the internet with a stolen admin JWT issue deletes from the
// browser; explicit origins close that vector.
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'https://car-reminder.app';

function buildCors(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowList = ALLOWED_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
  const allow = allowList.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin':  allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status = 200, req?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? buildCors(req) : {}), 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCors(req) });
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, req);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'server_misconfigured' }, 500, req);
  }

  // ── 1. Parse + validate the request body ────────────────────────────
  let body: { user_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400, req); }
  const userId = (body.user_id || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return json({ error: 'invalid_user_id' }, 400, req);
  }

  // ── 2. Authorize the caller ─────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthenticated' }, 401, req);

  // Use the *caller's* JWT here so RLS / is_current_user_admin() see
  // them, not the service role. Two clients on purpose: callerClient
  // for the admin check, adminClient for the actual delete.
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user: caller }, error: whoErr } = await callerClient.auth.getUser();
  if (whoErr || !caller) return json({ error: 'unauthenticated' }, 401, req);

  // Self-delete guard — an admin nuking their own auth row mid-request
  // would lose access before the cascade settles, leaving the system
  // in a weird half-state. Force them to use account deletion flows.
  if (caller.id === userId) return json({ error: 'cannot_delete_self' }, 400, req);

  const { data: isAdmin, error: roleErr } = await callerClient.rpc('is_current_user_admin');
  if (roleErr) return json({ error: 'role_check_failed', detail: roleErr.message }, 500, req);
  if (!isAdmin) return json({ error: 'forbidden' }, 403, req);

  // ── 3. Delete the auth user ────────────────────────────────────────
  // Service-role client. ONLY used for the privileged admin call; never
  // exposed to the browser. The CASCADE FKs do the rest.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
  if (delErr) {
    // Common cause: user already deleted (404). Treat as success so the
    // admin UI doesn't get stuck on stale rows.
    const msg = (delErr.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('user_not_found')) {
      return json({ ok: true, already_deleted: true }, 200, req);
    }
    return json({ error: 'delete_failed', detail: delErr.message }, 500, req);
  }

  return json({ ok: true, user_id: userId }, 200, req);
});
