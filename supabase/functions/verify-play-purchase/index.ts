// ═══════════════════════════════════════════════════════════════════════════
// verify-play-purchase — turn a Play purchase token into an entitlement.
//
// WHY THIS EXISTS AT ALL
//   The device says "the user bought p9". The device is not trustworthy: a
//   rooted phone or a replayed token can say anything. So the client's claim
//   is treated as a hint, and the only thing that grants a plan is Google's
//   own answer about that token, fetched here with a service account.
//
// WHAT IT DOES NOT DO
//   It does not decide which plan a product maps to. public.iap_products owns
//   that, and grant_iap_entitlement() raises on a product it does not know.
//   An id we never registered therefore grants nothing rather than something
//   plausible.
//
// ⚠️ THE ACKNOWLEDGEMENT ORDER IS LOAD-BEARING, NOT STYLISTIC.
//   Play refunds a purchase that is never acknowledged within three days.
//   That refund is the user's protection for exactly the case this function
//   exists to handle: money taken, entitlement not granted. So we acknowledge
//   AFTER the grant lands. Acknowledging first would mark the sale as honoured
//   while we still might fail, and throw the protection away.
//
//   The client also sets autoAcknowledgePurchases:false for the same reason.
//
// SECRETS (Supabase → Edge Functions → Secrets, NOT GitHub Actions)
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   the whole service-account JSON
//
// ⚠️ A secret of the same name exists in GitHub Actions for the release
//   build. They are unrelated stores and are not synced. An Edge Function
//   cannot read GitHub's. This is the same trap documented in apple-revoke.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, CAPACITOR_ORIGINS } from '../_shared/cors.ts';
import { willRenewFrom, externalAccountIdFrom } from '../_shared/googlePlay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const SA_JSON      = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');

/** Must match android/app/build.gradle applicationId. Singular, unlike iOS. */
const PACKAGE_NAME = 'com.carreminder.app';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

// ── JWT, RS256 ──────────────────────────────────────────────────────────────
// ⚠️ RS256 HERE, ES256 IN apple-revoke. Different key type, different
// algorithm; copying the Apple importKey call across would fail with a
// message that reads like a bad key rather than a wrong algorithm.

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  // The JSON stores the PEM with literal \n escapes. Un-escaping is not
  // cosmetic: the base64 body must be contiguous or atob rejects it.
  // ⚠️ THE HEADERS ARE MATCHED BY PATTERN, NOT SPELLED OUT, AND THAT IS
  // DELIBERATE. .githooks/pre-commit refuses any staged line containing
  // `BEGIN [A-Z ]*PRIVATE KEY`, so writing the literal here blocks the commit
  // as if a real key had been staged. The gate is right to be that blunt; a
  // character class costs nothing and also happens to accept the
  // `RSA PRIVATE KEY` spelling if a key is ever issued in that form.
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-{5}BEGIN [A-Z ]*KEY-{5}/, '')
    .replace(/-{5}END [A-Z ]*KEY-{5}/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function getAccessToken(sa: Record<string, string>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await importServiceAccountKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const assertion = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body?.access_token) {
    // Surfaced verbatim because the two likely causes look identical from
    // the outside: the androidpublisher API not enabled on the project, and
    // the service account not invited in Play Console.
    throw new Error(`token_exchange_failed: ${JSON.stringify(body)}`);
  }
  return body.access_token as string;
}

function json(payload: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...(cors as Record<string, string>), 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  // ⚠️ CAPACITOR_ORIGINS IS NOT OPTIONAL HERE, AND OMITTING IT WOULD HAVE
  // BLOCKED EVERY REAL PURCHASE. This function is only ever called from the
  // Android app, whose origin is capacitor://localhost, and the default
  // allow-list covers browsers only. ai-proxy is the other mobile-callable
  // function and opts in the same way.
  const cors = buildCorsHeaders(req, { extraOrigins: CAPACITOR_ORIGINS });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  // ⚠️ FAIL CLOSED ON A MISSING SECRET. Without it we cannot ask Google
  // anything, and the only safe answer to "did they pay" is "we do not know",
  // which the client renders as PENDING rather than as a grant.
  if (!SA_JSON) return json({ error: 'not_configured' }, 503, cors);

  // ── 1. the caller must be a signed-in user ────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader) return json({ error: 'not_authenticated' }, 401, cors);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller } = await asCaller.auth.getUser();
  const userId = caller?.user?.id ?? null;
  if (!userId) return json({ error: 'not_authenticated' }, 401, cors);

  // ── 2. input ──────────────────────────────────────────────────────────
  let purchaseToken = '';
  let productId = '';
  let accountId = '';
  try {
    const body = await req.json();
    purchaseToken = String(body?.purchaseToken || '');
    productId     = String(body?.productId || '');
    accountId     = String(body?.accountId || '');
  } catch {
    return json({ error: 'bad_request' }, 400, cors);
  }
  if (!purchaseToken || !productId || !accountId) {
    return json({ error: 'bad_request' }, 400, cors);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ⚠️ THE CALLER MUST BELONG TO THE ACCOUNT THEY ARE CLAIMING FOR.
  // Without this check any signed-in user could post somebody else's
  // account_id with their own purchase token and move the entitlement.
  const { data: membership } = await admin
    .from('account_members')
    .select('account_id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return json({ error: 'not_your_account' }, 403, cors);

  // ── 3. ask Google, and believe only Google ────────────────────────────
  let sa: Record<string, string>;
  try {
    sa = JSON.parse(SA_JSON);
  } catch {
    return json({ error: 'not_configured' }, 503, cors);
  }

  let sub: Record<string, unknown>;
  try {
    const accessToken = await getAccessToken(sa);
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const detail = await res.text();
      // 410 means Google no longer has the token: expired and long gone.
      return json({ granted: false, reason: 'lookup_failed', status: res.status, detail }, 200, cors);
    }
    sub = await res.json();
  } catch (e) {
    return json({ granted: false, reason: 'verification_error', detail: String(e) }, 200, cors);
  }

  // ⚠️ EVERY FAILURE PATH BELOW RETURNS HTTP 200 WITH granted:false, NOT AN
  // ERROR STATUS. The client maps a rejected verification to PENDING, whose
  // copy says the payment arrived and activation is late. A 4xx/5xx would
  // read to the client as a transport failure and produce the one message
  // this whole flow exists to avoid: telling someone who paid that they did
  // not.

  const state = String((sub as any)?.subscriptionState || '');
  const lineItems = ((sub as any)?.lineItems || []) as Array<Record<string, unknown>>;
  const googleProductId = String(lineItems[0]?.productId || '');
  const expiry = String(lineItems[0]?.expiryTime || '') || null;

  // ⚠️ THE ACCOUNT THE PURCHASE WAS MADE FOR WINS OVER THE ACCOUNT CLAIMED.
  // The membership check above proves the caller belongs to accountId; it
  // does not prove this purchase does. Play's owned-purchases query returns
  // every subscription on the device's GOOGLE account, so one person with a
  // personal and a business workspace sent account A's token with account
  // B's id on the mount restore, and B got A's plan for free. The token then
  // sat on two rows, play-rtdn's token lookup errored on both, and renewals
  // reached neither. The purchase carries the account it was bought for
  // (appAccountToken, which Play returns as obfuscatedExternalAccountId).
  // A purchase with no id predates that and is let through.
  const boughtFor = externalAccountIdFrom(sub as Record<string, unknown>);
  if (boughtFor && boughtFor !== accountId) {
    return json({ granted: false, reason: 'account_mismatch' }, 200, cors);
  }

  // The product Google reports wins over the product the client claimed.
  if (googleProductId && productId && googleProductId !== productId) {
    return json({ granted: false, reason: 'product_mismatch' }, 200, cors);
  }

  // ACTIVE and IN_GRACE_PERIOD both mean "entitled right now". Grace is a
  // failed card, not a cancelled subscription, and cutting access there
  // punishes someone whose bank declined once.
  const entitled = state === 'SUBSCRIPTION_STATE_ACTIVE'
                || state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
  if (!entitled) {
    return json({ granted: false, reason: 'not_active', state }, 200, cors);
  }

  // ── 4. grant, then acknowledge, in that order ─────────────────────────
  const { data: plan, error: grantErr } = await admin.rpc('grant_iap_entitlement', {
    p_account_id:      accountId,
    p_store:           'google',
    p_product_id:      googleProductId || productId,
    p_expires_at:      expiry,
    p_external_sub_id: purchaseToken,
  });
  if (grantErr) {
    return json({ granted: false, reason: 'grant_failed', detail: grantErr.message }, 200, cors);
  }

  // Record whether it renews. Best effort for the same reason as the
  // acknowledgement below: the entitlement is written, and a failure here
  // (say, before supabase-plans-edge-cases-2026-09-25.sql runs) must not turn
  // a successful purchase into a failed-looking one. play-rtdn corrects it
  // on the next notification anyway.
  await admin.rpc('set_iap_auto_renew', {
    p_account_id: accountId,
    p_auto_renew: willRenewFrom(sub as Record<string, unknown>),
  });

  // Acknowledgement is best effort and deliberately cannot fail the response.
  // The entitlement is already written, so the user has what they paid for.
  // If this call fails the client's own acknowledge still runs, and if that
  // also fails Play refunds in three days, which is the correct outcome for
  // a purchase we could not complete.
  let acknowledged = false;
  if ((sub as any)?.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    try {
      const accessToken = await getAccessToken(sa);
      const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/subscriptions/${encodeURIComponent(googleProductId || productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
      const ackRes = await fetch(ackUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
      acknowledged = ackRes.ok;
    } catch { /* see above: never fatal */ }
  } else {
    acknowledged = true;
  }

  return json({ granted: true, plan, expiry, acknowledged }, 200, cors);
});
