// ═══════════════════════════════════════════════════════════════════════════
// apple-revoke — revokes a user's Sign in with Apple tokens on account delete.
//
// WHY THIS EXISTS
//   App Store Guideline 5.1.1(v) and Apple's "Offering Account Deletion"
//   page require that an app offering Sign in with Apple call the REST API
//   to revoke user tokens when the user deletes their account. Until this
//   function existed the app did not do that at all.
//
// WHY IT TAKES A CODE INSTEAD OF READING A STORED TOKEN
//   Apple's /auth/revoke needs a token Apple issued (refresh or access).
//   We never stored one: the login flow (AuthPage) takes only the
//   `identityToken` from the native sheet and hands it to Supabase, and the
//   `authorizationCode` was discarded. Rather than start persisting an Apple
//   refresh token forever — a credential at rest, a DB migration, and no way
//   to cover the users who signed up before it existed — the delete flow
//   re-authenticates the user against Apple and passes the FRESH
//   authorizationCode here. Nothing is stored, and existing Apple users are
//   covered too. Apple explicitly permits re-authentication in a delete flow.
//
// FLOW
//   1. Verify the caller is a signed-in user (JWT). Not an open endpoint:
//      without this, anyone could pump codes at Apple through us.
//   2. Mint a client_secret — a short-lived ES256 JWT signed with the
//      Sign in with Apple key (.p8).
//   3. POST /auth/token   → exchange authorizationCode for a refresh_token.
//   4. POST /auth/revoke  → revoke it.
//
// RESPONSE CONTRACT
//   200            revoked. The caller does nothing.
//   4xx / 5xx      NOT revoked. `supabase.functions.invoke` surfaces this as
//                  an error and the client logs it to app_errors. The client
//                  treats the whole call as best-effort and never blocks the
//                  deletion on it — a person cannot act on "your Apple token
//                  wasn't revoked", so it is a compliance signal for us, not
//                  a message for them.
//
// SECRETS (Supabase → Edge Functions → Secrets; these are NOT the same place
// as the Auth → Providers → Apple form, which the function cannot read)
//   APPLE_SIWA_PRIVATE_KEY   full .p8 contents, PEM header/footer included
//   APPLE_SIWA_KEY_ID        10 chars, from the key you created
//   APPLE_TEAM_ID            10 chars, Membership Details
//   APPLE_BUNDLE_ID          optional, defaults to com.carreminders.app
//
//   All four already exist for this project: the .p8, Key ID and Team ID were
//   created in docs/apple-4.8-sign-in-with-apple-setup.md steps 1.12–1.16 and
//   pasted into the Auth provider config. They just need copying here.
//
// NOTE ON client_id
//   The native sheet authorizes against the app's BUNDLE ID, so the token
//   exchange and the revoke must both use the bundle ID — not the
//   `com.carreminders.app.signin` Services ID, which is for the web callback.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/reportEdgeError.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE;

const APPLE_PRIVATE_KEY = Deno.env.get('APPLE_SIWA_PRIVATE_KEY') || '';
const APPLE_KEY_ID = Deno.env.get('APPLE_SIWA_KEY_ID') || '';
const APPLE_TEAM_ID = Deno.env.get('APPLE_TEAM_ID') || '';
const APPLE_CLIENT_ID = Deno.env.get('APPLE_BUNDLE_ID') || 'com.carreminders.app';

const APPLE_AUD = 'https://appleid.apple.com';

// ── base64url helpers ────────────────────────────────────────────────────
function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * Imports the .p8 (PEM-wrapped PKCS#8, EC P-256) as a WebCrypto signing key.
 * Tolerates the escaped-newline form ("\\n") that secret managers often
 * produce when a multi-line value is pasted through a single-line field.
 */
async function importApplePrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * Apple's client_secret: an ES256 JWT. Apple allows up to 6 months of
 * validity; 5 minutes is plenty for two back-to-back calls and limits the
 * blast radius if it ever leaked into a log.
 *
 * WebCrypto's ECDSA sign returns the raw r||s pair, which is exactly what
 * JWS ES256 expects. (Node's crypto defaults to DER instead, which is the
 * classic reason a hand-rolled Apple client_secret gets rejected.)
 */
async function makeClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' };
  const payload = {
    iss: APPLE_TEAM_ID,
    iat: now,
    exp: now + 300,
    aud: APPLE_AUD,
    sub: APPLE_CLIENT_ID,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const key = await importApplePrivateKey(APPLE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // ── 1. the caller must be a signed-in user ────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader) return json({ error: 'not_authenticated' }, 401);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await asCaller.auth.getUser();
  const userId = caller?.user?.id ?? null;
  if (callerErr || !userId) return json({ error: 'not_authenticated' }, 401);

  // ── 2. input ──────────────────────────────────────────────────────────
  let authorizationCode = '';
  try {
    const body = await req.json();
    authorizationCode = String(body?.authorizationCode || '');
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!authorizationCode) return json({ error: 'missing_authorization_code' }, 400);

  // Misconfiguration is our fault, not the user's. Report it loudly —
  // otherwise the revoke silently never happens and we stay non-compliant
  // without any signal.
  if (!APPLE_PRIVATE_KEY || !APPLE_KEY_ID || !APPLE_TEAM_ID) {
    await reportEdgeError({
      fn: 'apple-revoke',
      action: 'missing_secrets',
      error: new Error('APPLE_SIWA_PRIVATE_KEY / APPLE_SIWA_KEY_ID / APPLE_TEAM_ID not all set'),
      severity: 'error',
      userId,
    });
    return json({ error: 'not_configured' }, 500);
  }

  try {
    const clientSecret = await makeClientSecret();

    // ── 3. authorizationCode → refresh_token ──────────────────────────
    const tokenRes = await fetch(`${APPLE_AUD}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
    });

    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      // Apple's error strings name the reason (invalid_client,
      // invalid_grant for a reused/expired code) and carry no user data,
      // so they are safe and genuinely useful to record.
      await reportEdgeError({
        fn: 'apple-revoke',
        action: 'token_exchange_failed',
        error: new Error(`apple /auth/token ${tokenRes.status}: ${tokenBody?.error || 'unknown'}`),
        severity: 'error',
        userId,
      });
      return json({ error: 'token_exchange_failed', apple: tokenBody?.error ?? null }, 502);
    }

    const refreshToken = tokenBody?.refresh_token;
    const accessToken = tokenBody?.access_token;
    const token = refreshToken || accessToken;
    const tokenTypeHint = refreshToken ? 'refresh_token' : 'access_token';
    if (!token) {
      await reportEdgeError({
        fn: 'apple-revoke',
        action: 'no_token_returned',
        error: new Error('apple /auth/token returned neither refresh_token nor access_token'),
        severity: 'error',
        userId,
      });
      return json({ error: 'no_token_returned' }, 502);
    }

    // ── 4. revoke ─────────────────────────────────────────────────────
    const revokeRes = await fetch(`${APPLE_AUD}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APPLE_CLIENT_ID,
        client_secret: clientSecret,
        token,
        token_type_hint: tokenTypeHint,
      }),
    });

    // Apple answers 200 with an empty body on success.
    if (!revokeRes.ok) {
      const detail = await revokeRes.text().catch(() => '');
      await reportEdgeError({
        fn: 'apple-revoke',
        action: 'revoke_failed',
        error: new Error(`apple /auth/revoke ${revokeRes.status}: ${detail.slice(0, 200)}`),
        severity: 'error',
        userId,
      });
      return json({ error: 'revoke_failed', status: revokeRes.status }, 502);
    }

    return json({ revoked: true, token_type: tokenTypeHint });
  } catch (e) {
    await reportEdgeError({
      fn: 'apple-revoke',
      action: 'unexpected',
      error: e,
      severity: 'error',
      userId,
    });
    return json({ error: 'unexpected' }, 500);
  }
});
