// ═══════════════════════════════════════════════════════════════════════════
// verify-apple-purchase — turn a StoreKit transaction id into an entitlement.
//
// The Apple counterpart of verify-play-purchase, and the same rule: the
// device's claim is a hint, and only Apple's own answer grants a plan. The
// client sends a transaction id; we ask the App Store Server API about it
// with our own key and act on what Apple says.
//
// ⚠️ NO ACKNOWLEDGEMENT STEP, UNLIKE PLAY. Apple has no "acknowledge or be
// refunded" rule, and finishing a transaction is something only the device
// can do. See the autoAcknowledgePurchases note in src/lib/billing/appleBackend.js.
//
// ⚠️ APP REVIEW AND TESTFLIGHT BUY IN SANDBOX, AND THIS FUNCTION ACCEPTS
// SANDBOX TRANSACTIONS IN PRODUCTION. That is Apple's documented expectation:
// a reviewer who buys and gets nothing is an IAP rejection. The price is that
// a TestFlight tester gets a paid plan for free until the sandbox
// subscription lapses, which is acceptable because testers are invited by
// hand. The environment is returned in every answer so it shows in logs.
//
// SECRETS: APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY.
// See _shared/appleStore.ts.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCorsHeaders, CAPACITOR_ORIGINS } from '../_shared/cors.ts';
import { reportEdgeError } from '../_shared/reportEdgeError.ts';
import {
  readAppleIapConfig,
  makeAppStoreApiToken,
  getTransactionInfo,
  getSubscriptionStatuses,
  entitlementFromStatuses,
  linkProblem,
  ownerToken,
  otherHolders,
  releaseHolders,
} from '../_shared/appleStore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(payload: unknown, status: number, cors: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...(cors as Record<string, string>), 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  // The iOS app's origin is capacitor://localhost, which the default
  // browser allow-list does not include.
  const cors = buildCorsHeaders(req, { extraOrigins: CAPACITOR_ORIGINS });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);

  // Fail closed: without the key we cannot ask Apple anything, and "we do not
  // know" renders as PENDING on the client, never as a grant.
  const cfg = readAppleIapConfig((k) => Deno.env.get(k));
  if (!cfg) return json({ error: 'not_configured' }, 503, cors);

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
  let transactionId = '';
  let productId = '';
  let accountId = '';
  try {
    const body = await req.json();
    transactionId = String(body?.transactionId || '');
    productId     = String(body?.productId || '');
    accountId     = String(body?.accountId || '');
  } catch {
    return json({ error: 'bad_request' }, 400, cors);
  }
  // A StoreKit transaction id is a UInt64 rendered as digits. Anything else
  // is not one, and does not deserve a call to Apple.
  if (!/^\d{1,20}$/.test(transactionId) || !productId || !UUID_RE.test(accountId)) {
    return json({ error: 'bad_request' }, 400, cors);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // The caller must belong to the account being credited.
  const { data: membership } = await admin
    .from('account_members')
    .select('account_id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return json({ error: 'not_your_account' }, 403, cors);

  // ⚠️ FROM HERE ON EVERY REFUSAL IS HTTP 200 WITH granted:false, exactly as
  // in verify-play-purchase. The card is already charged by the time this
  // runs, and the client renders any refusal as PENDING ("payment received,
  // activation delayed"). A 4xx/5xx would read as a transport failure.

  // ── 3. ask Apple about this transaction ───────────────────────────────
  let token: string;
  try {
    token = await makeAppStoreApiToken(cfg);
  } catch (e) {
    await reportEdgeError({
      fn: 'verify-apple-purchase', action: 'token_signing_failed', error: e, severity: 'error', userId,
      extra: { hint: 'APPLE_IAP_PRIVATE_KEY is not a readable .p8' },
    });
    return json({ granted: false, reason: 'verification_error' }, 200, cors);
  }

  let info;
  try {
    info = await getTransactionInfo(token, transactionId, fetch);
  } catch (e) {
    return json({ granted: false, reason: 'verification_error', detail: String(e) }, 200, cors);
  }
  if (!info.ok) {
    if (info.status === 401) {
      // Our key, not the user. Loud, because every Apple purchase fails
      // until it is fixed and nothing else would say so.
      await reportEdgeError({
        fn: 'verify-apple-purchase', action: 'apple_401', error: new Error(info.detail || '401'),
        severity: 'critical', userId,
        extra: { hint: 'APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / key type (must be an In-App Purchase key)' },
      });
    }
    return json({
      granted: false, reason: 'lookup_failed', status: info.status, errorCode: info.errorCode,
    }, 200, cors);
  }

  const txn = info.body.transaction;
  const environment = info.environment;

  const problem = linkProblem(txn, { bundleId: cfg.bundleId, accountId });
  if (problem) return json({ granted: false, reason: problem, environment }, 200, cors);

  // What Apple says was bought wins over what the client claimed.
  if (txn.productId && txn.productId !== productId) {
    return json({ granted: false, reason: 'product_mismatch', environment }, 200, cors);
  }

  const originalTransactionId = String(txn.originalTransactionId || '');
  if (!originalTransactionId) {
    return json({ granted: false, reason: 'no_original_transaction', environment }, 200, cors);
  }

  // ── 4. is it entitled now, and until when ─────────────────────────────
  let statuses;
  try {
    statuses = await getSubscriptionStatuses(token, originalTransactionId, fetch, environment);
  } catch (e) {
    return json({ granted: false, reason: 'verification_error', detail: String(e), environment }, 200, cors);
  }
  if (!statuses.ok) {
    return json({
      granted: false, reason: 'status_lookup_failed', status: statuses.status, environment,
    }, 200, cors);
  }
  const ent = entitlementFromStatuses(statuses.body, originalTransactionId);
  if (!ent.entitled || !ent.productId) {
    return json({ granted: false, reason: 'not_active', status: ent.status, environment }, 200, cors);
  }

  // ── 5. one Apple subscription credits one account: Apple's latest pick ─
  // ⚠️ THE KEY IS originalTransactionId, NOT transactionId. Every renewal
  // and every upgrade inside the group mints a new transactionId; the
  // original one is the only id that stays put for the life of the
  // subscription, and it is what the notification endpoint looks up by.
  //
  // ⚠️ AND THE OWNER IS WHOEVER APPLE'S LATEST TRANSACTION NAMES, NOT OUR
  // ROW. One Apple ID holds one subscription in the group. Subscribe for
  // account A, later buy for account B: Apple keeps the original id and
  // signs B's token into the new transaction. The first version refused B
  // ("held_by_other_account") because A's row still named the id, so B paid
  // for nothing while the renewal notification handed the plan back to A.
  const owner = ownerToken(ent.transaction) || accountId.toLowerCase();
  if (owner !== accountId.toLowerCase()) {
    // Apple says the subscription now belongs to a different account of
    // ours: this transaction is an older one in the chain.
    return json({ granted: false, reason: 'held_by_other_account', environment }, 200, cors);
  }
  const holders = await otherHolders(admin, originalTransactionId, accountId);
  if (!holders.ok) {
    return json({ granted: false, reason: 'verification_error', detail: holders.error, environment }, 200, cors);
  }

  // ⚠️ PAYING BOTH STORES IS GRANTED, AND REPORTED. The user is looking at a
  // screen that just took their money, so refusing here would tell them the
  // activation is late for ever. But two live subscriptions on one account
  // is a double charge support has to unwind, and the renewal path
  // (app-store-notifications) deliberately will not fight Google over it.
  const { data: current } = await admin
    .from('account_subscriptions')
    .select('source, status, current_period_end')
    .eq('account_id', accountId)
    .maybeSingle();
  if (current?.source === 'iap_google' && current?.status === 'active'
      && (!current?.current_period_end || Date.parse(current.current_period_end) > Date.now())) {
    await reportEdgeError({
      fn: 'verify-apple-purchase', action: 'double_store_subscription',
      error: new Error('Apple purchase on an account with a live Google subscription'),
      severity: 'warning', userId, extra: { accountId, environment },
    });
  }

  const { data: plan, error: grantErr } = await admin.rpc('grant_iap_entitlement', {
    p_account_id:      accountId,
    p_store:           'apple',
    // The CURRENT product from the status, which differs from the one first
    // bought after an upgrade or downgrade inside the group.
    p_product_id:      ent.productId,
    p_expires_at:      ent.periodEnd,
    p_external_sub_id: originalTransactionId,
  });
  if (grantErr) {
    await reportEdgeError({
      fn: 'verify-apple-purchase', action: 'grant_failed', error: new Error(grantErr.message),
      severity: 'critical', userId, extra: { productId: ent.productId, environment },
    });
    return json({ granted: false, reason: 'grant_failed', detail: grantErr.message }, 200, cors);
  }

  // Only now, with the new owner's grant written, take it off the old one:
  // a failure half way leaves two accounts with the plan, never none.
  if (holders.value.length > 0) {
    const releaseErr = await releaseHolders(
      admin, originalTransactionId, holders.value, `apple_moved_to_${accountId}`,
    );
    if (releaseErr) {
      await reportEdgeError({
        fn: 'verify-apple-purchase', action: 'release_previous_owner_failed', error: new Error(releaseErr),
        severity: 'error', userId, extra: { previous: holders.value, accountId, environment },
      });
    }
  }

  return json({ granted: true, plan, expiry: ent.periodEnd, environment }, 200, cors);
});
