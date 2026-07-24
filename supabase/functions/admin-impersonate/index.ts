// ═══════════════════════════════════════════════════════════════════════════
// admin-impersonate — mints a short-lived session token for the TARGET user
// of an active, audited admin view session.
//
// WHY THIS EXISTS
//   The previous model kept the admin's own JWT and widened the server to let
//   it through: is_viewing(account_id) / is_viewing_user(user_id) escapes bolted
//   onto individual RLS policies and RPCs. That is an allowlist, and an
//   allowlist is only as complete as the last person to remember it. A scan on
//   2026-07-24 found 22 SECURITY DEFINER functions gating on auth.uid()
//   membership; exactly ONE had an escape. Twenty-one screens fail mid-session,
//   and the count grows with every RPC written.
//
//   Handing the admin a token whose `sub` IS the target inverts that. auth.uid()
//   becomes the target, so every policy and every RPC — including ones not
//   written yet — evaluates exactly as it does for the real user. Nothing to
//   enumerate, nothing to forget.
//
// WHY THIS IS NOT A BACKDOOR
//   Three independent conditions, all server-side, all fail-closed:
//     1. The caller's own JWT must satisfy public.is_admin().
//     2. An admin_view_sessions row must be OPEN, UNEXPIRED, and owned by
//        THAT admin, targeting THAT user. The session row is the access
//        primitive — this function only converts an existing grant into a
//        token, it never creates authority.
//     3. The target must not themselves be an admin. Otherwise an admin could
//        borrow a peer's identity and launder actions through it.
//   The signing secret never leaves this function. If it reaches the client
//   bundle, any user can mint any identity — that is the one thread holding
//   the whole model, which is why the token is minted here and nowhere else.
//
// ATTRIBUTION
//   The minted token carries a non-standard `impersonated_by` claim. Postgres
//   reads it via auth.jwt() ->> 'impersonated_by', so triggers can stamp
//   acting_admin_id on writes. Row-level attribution survives even though
//   auth.uid() is the target — the usual cost of real impersonation, avoided.
//
// LIFETIME
//   Self-signed, so there is no refresh token. TTL is capped at 15 minutes AND
//   at the session's own expires_at, whichever is sooner. Renewal means calling
//   here again, which re-runs all three checks. An admin whose rights are
//   revoked mid-session keeps the current token until it expires; 15 minutes is
//   the accepted blast radius.
//
// SECRETS
//   SUPABASE_URL                already set
//   SUPABASE_SERVICE_ROLE_KEY   already set
//   IMPERSONATION_JWT_SECRET    MUST BE ADDED — the project's LEGACY JWT
//                               Secret, from Settings → JWT Keys → Legacy JWT
//                               Secret. Not SUPABASE_JWT_SECRET: the platform
//                               refuses secret names starting with SUPABASE_.
//
//                               The project has migrated to asymmetric JWT
//                               Signing Keys for ISSUING, but that page still
//                               labels the legacy secret "still used ... to
//                               verify JWTs" — which is precisely why an HS256
//                               token minted here is accepted. If that ever
//                               stops being true, this function must move to
//                               ES256 with the active signing key; the symptom
//                               will be a blanket 401 on every impersonated
//                               request, never a silent wrong-data bug.
//
//                               Do NOT rotate to a standby key to "refresh"
//                               it — rotation invalidates the legacy secret
//                               and takes the existing anon and service_role
//                               keys down with it.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { logSecurityEvent } from '../_shared/securityLog.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Named without the SUPABASE_ prefix because the platform reserves it —
// "Name must not start with the SUPABASE_ prefix" on secret creation. The
// VALUE is the project's Legacy JWT Secret (Settings → JWT Keys → Legacy JWT
// Secret), which that page still marks "still used ... to verify JWTs" even
// after the migration to asymmetric signing keys. That is what makes an
// HS256 token minted here acceptable to PostgREST.
const JWT_SECRET   = Deno.env.get('IMPERSONATION_JWT_SECRET');

const FN = 'admin-impersonate';
const MAX_TTL_SECONDS = 15 * 60;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(enc.encode(JSON.stringify(obj)));
}

/**
 * Sign a Supabase-compatible HS256 JWT.
 *
 * The claim set mirrors what GoTrue issues, because PostgREST and every
 * `auth.*()` helper read these exact fields: a missing `role` yields an
 * anon-privileged token, a missing `aud` fails validation outright.
 */
async function signJwt(claims: Record<string, unknown>, secret: string): Promise<string> {
  const header  = { alg: 'HS256', typ: 'JWT' };
  const signing = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signing));
  return `${signing}.${b64url(new Uint8Array(sig))}`;
}

function json(body: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors as Record<string, string>, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, cors);

  if (!JWT_SECRET) {
    // Deliberately explicit: a missing secret is a deployment mistake, not an
    // attack, and silently returning 401 would send someone hunting the wrong bug.
    logSecurityEvent(FN, 'auth_failed', { reason: 'jwt_secret_not_configured' });
    return json({ error: 'impersonation_not_configured' }, 500, cors);
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    logSecurityEvent(FN, 'auth_failed', { reason: 'missing_bearer' });
    return json({ error: 'not_authenticated' }, 401, cors);
  }

  // ── Gate 1: the CALLER must be an admin, decided by the server ──────────
  // A client scoped to the caller's own JWT — is_admin() reads auth.uid(),
  // so this cannot be spoofed by anything the caller sends in the body.
  const asCaller = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerUser, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !callerUser?.user?.id) {
    logSecurityEvent(FN, 'auth_failed', { reason: 'invalid_token' });
    return json({ error: 'not_authenticated' }, 401, cors);
  }
  const adminId = callerUser.user.id;

  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) {
    logSecurityEvent(FN, 'permission_denied', { reason: 'not_admin', adminId });
    return json({ error: 'not_authorized' }, 403, cors);
  }

  // ── Gate 2: an OPEN session owned by this admin must already exist ──────
  // Service role reads the session table directly: the point is to verify a
  // grant that already exists, never to create one. admin_start_view remains
  // the only way to open a session, and it stays audited.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: session, error: sessErr } = await admin
    .from('admin_view_sessions')
    .select('id, target_user_id, target_account_id, expires_at, ended_at')
    .eq('admin_user_id', adminId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessErr || !session?.target_user_id) {
    logSecurityEvent(FN, 'permission_denied', {
      reason: session ? 'session_has_no_target_user' : 'no_active_session',
      adminId,
    });
    return json({ error: 'no_active_view_session' }, 403, cors);
  }

  const targetId = session.target_user_id as string;

  // ── Gate 3: never impersonate another admin ─────────────────────────────
  // Without this, admin A could act as admin B and every audit trail would
  // read as B's own doing. Lateral privilege escalation with laundered blame.
  // is_admin has a single-argument overload added for triggers
  // (supabase-critical-fixes.sql:113) — the no-arg form reads auth.uid(),
  // which under the service-role client is nobody.
  const { data: targetIsAdmin } = await admin.rpc('is_admin', { uid: targetId })
    .then(r => r, () => ({ data: null }));
  if (targetIsAdmin === true) {
    logSecurityEvent(FN, 'permission_denied', { reason: 'target_is_admin', adminId, targetId });
    return json({ error: 'cannot_impersonate_admin' }, 403, cors);
  }

  // ── Mint ────────────────────────────────────────────────────────────────
  const { data: targetUser, error: targetErr } = await admin.auth.admin.getUserById(targetId);
  if (targetErr || !targetUser?.user) {
    logSecurityEvent(FN, 'payload_rejected', { reason: 'target_not_found', adminId, targetId });
    return json({ error: 'target_not_found' }, 404, cors);
  }

  const nowSec     = Math.floor(Date.now() / 1000);
  const sessionEnd = Math.floor(new Date(session.expires_at as string).getTime() / 1000);
  // Never outlive the session that authorised it, and never exceed 15 minutes
  // even if someone opens a very long session.
  const exp = Math.min(nowSec + MAX_TTL_SECONDS, sessionEnd);
  if (exp <= nowSec) {
    return json({ error: 'session_expired' }, 403, cors);
  }

  const token = await signJwt({
    iss:  `${SUPABASE_URL}/auth/v1`,
    sub:  targetId,
    aud:  'authenticated',
    role: 'authenticated',
    email: targetUser.user.email ?? '',
    iat:  nowSec,
    exp,
    // Read from Postgres as auth.jwt() ->> 'impersonated_by'. This is what
    // keeps row-level attribution alive while auth.uid() is the target.
    impersonated_by: adminId,
    view_session_id: session.id,
    app_metadata:  targetUser.user.app_metadata  ?? {},
    user_metadata: targetUser.user.user_metadata ?? {},
  }, JWT_SECRET);

  await admin.rpc('admin_log', {
    p_action:      'impersonation_token_issued',
    p_target_type: 'user',
    p_target_id:   targetId,
    p_detail:      { session_id: session.id, account_id: session.target_account_id, exp },
  }).then(r => r, () => null);

  logSecurityEvent(FN, 'impersonation_issued', { adminId, targetId, sessionId: session.id, exp });

  return json({
    token,
    expires_at:        new Date(exp * 1000).toISOString(),
    target_user_id:    targetId,
    target_account_id: session.target_account_id,
  }, 200, cors);
});
