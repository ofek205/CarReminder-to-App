// ═══════════════════════════════════════════════════════════════════════════
// app-store-notifications — App Store Server Notifications V2.
//
// Deploy with Verify JWT = OFF. The caller is Apple, which carries no
// Supabase JWT. Authentication is the shared secret in the URL, below.
//
// WHY THIS EXISTS, AND WHY IT MUST BE LIVE BEFORE THE FIRST REAL SUBSCRIBER
//   account_plan() stops granting a store plan three days after
//   current_period_end (ledger 31). Only this function moves that date
//   forward when Apple renews. Without it every Apple subscriber drops to
//   free about a month after paying, and every cancellation, refund and
//   failed card passes in silence. Same role as play-rtdn.
//
// ⚠️ THE NOTIFICATION IS A TRIGGER, NOT A FACT. Same principle as play-rtdn.
//   We read the notification only to learn WHICH subscription to ask about,
//   then ask the App Store Server API for its current status and apply that.
//   So order, duplicates and retries cannot matter, and we never need to
//   verify the notification's own signature: a forged one can at most make
//   us re-read the true state of a real subscription, which is a no-op.
//   Nothing from the notification body is ever written to an account; the
//   account link, the product and the dates all come from Apple's answer.
//
// ⚠️ 200 MEANS "DO NOT SEND THIS AGAIN". In production Apple retries any
//   non-2xx five times, at 1, 12, 24, 48 and 72 hours; in sandbox it sends
//   once and never retries. Anything understood and deliberately ignored
//   answers 200; only a failure a retry could fix (Apple unreachable, our
//   key, the database) answers 5xx.
//
// SETUP (App Store Connect → the app → General → App Information → App Store
// Server Notifications), Version 2, for BOTH Production and Sandbox:
//   https://<project-ref>.supabase.co/functions/v1/app-store-notifications?key=<APPLE_ASN_SECRET>
//
// ⚠️ THE SECRET MAY ALSO BE THE LAST PATH SEGMENT:
//   https://<project-ref>.supabase.co/functions/v1/app-store-notifications/<APPLE_ASN_SECRET>
//   Apple documents HTTPS, TLS 1.2 and the port, and says nothing either way
//   about a query string. Play's endpoint uses one and works; if Apple turns
//   out to drop it, every notification would answer 403 in silence, so the
//   path form exists as the fallback that no client can strip. Either one is
//   accepted. The probe below tells you within a minute which one works.
//
// ⚠️ WHY A URL SECRET AND NOT APPLE'S SIGNATURE. Apple's own model is to
//   verify the JWS certificate chain. We do not need to, because nothing in
//   the body is trusted (see above), so the secret only has to stop strangers
//   making us call Apple on their behalf. That is a much smaller job.
//
// PROVING IT LIVE, the counterpart of Play's "send test notification":
//   curl -X POST "<the same URL>&probe=test&env=sandbox"
//   asks Apple to send a TEST notification to the Sandbox URL. Answering
//   {ok:true} means Apple accepted the request; the TEST arriving (visible in
//   this function's logs) proves the whole loop.
//
// SECRETS
//   APPLE_ASN_SECRET        a long random string, yours to pick
//   APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY
//                           shared with verify-apple-purchase
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reportEdgeError } from '../_shared/reportEdgeError.ts';
import {
  BUNDLE_ID,
  readAppleIapConfig,
  makeAppStoreApiToken,
  decodeJwsPayload,
  getSubscriptionStatuses,
  entitlementFromStatuses,
  requestTestNotification,
  resolveAppleAccount,
  otherHolders,
  releaseHolders,
  type AppleTransaction,
} from '../_shared/appleStore.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ASN_SECRET   = Deno.env.get('APPLE_ASN_SECRET');

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Length-independent comparison, as in play-rtdn. */
function secretMatches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Which account does this subscription belong to? See resolveAppleAccount
 * in _shared/appleStore.ts: the appAccountToken inside APPLE'S latest copy
 * of the transaction first, our stored row only as a fallback.
 *
 * That order is what lets this endpoint grant a purchase the device never
 * managed to report (the app closing mid-verification, Ask to Buy approved
 * hours later, a renewal after a reinstall), and what follows the
 * subscription when the same Apple ID buys for a different account of ours.
 */
const makeAdmin = () => createClient(SUPABASE_URL, SERVICE_ROLE);

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // ── 1. authenticate the caller ────────────────────────────────────────
  // Fail closed: an unset secret means nobody may call this, never anybody.
  if (!ASN_SECRET) return json({ error: 'not_configured' }, 503);
  const url = new URL(req.url);
  // The segment after this function's own name, wherever the runtime puts
  // the prefix. See the header for why both forms exist.
  const segments = url.pathname.split('/').filter(Boolean);
  const at = segments.lastIndexOf('app-store-notifications');
  let pathKey = '';
  try { pathKey = at >= 0 ? decodeURIComponent(segments[at + 1] || '') : ''; } catch { /* malformed: no key */ }
  const queryKey = url.searchParams.get('key') || '';
  if (!secretMatches(queryKey, ASN_SECRET) && !secretMatches(pathKey, ASN_SECRET)) {
    return json({ error: 'forbidden' }, 403);
  }

  const cfg = readAppleIapConfig((k) => Deno.env.get(k));

  // ── 2. the probe: ask Apple to send us a TEST notification ────────────
  if (url.searchParams.get('probe') === 'test') {
    if (!cfg) return json({ error: 'not_configured' }, 503);
    const env = url.searchParams.get('env') === 'sandbox' ? 'Sandbox' : 'Production';
    try {
      const token = await makeAppStoreApiToken(cfg);
      const r = await requestTestNotification(token, env, fetch);
      // A 401 here is the fastest way to learn the key, the key id or the
      // issuer id is wrong, before any customer finds out.
      return json({ ok: r.ok, environment: env, status: r.status, apple: r.body }, r.ok ? 200 : 502);
    } catch (e) {
      return json({ ok: false, environment: env, error: String(e) }, 500);
    }
  }

  // ── 3. which subscription is this about ───────────────────────────────
  let note: Record<string, any> | null = null;
  try {
    const body = await req.json();
    note = decodeJwsPayload(body?.signedPayload);
  } catch { /* handled below */ }
  if (!note) return json({ ok: true, ignored: 'unparseable' }, 200);

  const type = String(note.notificationType || '');
  const data = (note.data || {}) as Record<string, any>;

  if (type === 'TEST') {
    return json({ ok: true, test: true, environment: data.environment ?? null }, 200);
  }
  if (data.bundleId && data.bundleId !== BUNDLE_ID) {
    return json({ ok: true, ignored: 'other_app' }, 200);
  }

  // Used ONLY as an id to look up. See the header.
  const hint = decodeJwsPayload<AppleTransaction>(data.signedTransactionInfo);
  const originalTransactionId = String(hint?.originalTransactionId || hint?.transactionId || '');
  if (!originalTransactionId || !/^\d{1,20}$/.test(originalTransactionId)) {
    return json({ ok: true, ignored: 'no_transaction', type }, 200);
  }

  // Missing config IS worth a retry: Apple keeps trying for days, and the
  // key being set tomorrow should still catch today's renewals.
  if (!cfg) return json({ error: 'not_configured' }, 503);

  // ── 4. ask Apple what is true now ─────────────────────────────────────
  let token: string;
  try {
    token = await makeAppStoreApiToken(cfg);
  } catch (e) {
    await reportEdgeError({ fn: 'app-store-notifications', action: 'token_signing_failed', error: e, severity: 'critical' });
    return json({ error: 'token_signing_failed' }, 500);
  }

  const prefer = data.environment === 'Sandbox' ? 'Sandbox' : 'Production';
  let statuses;
  try {
    statuses = await getSubscriptionStatuses(token, originalTransactionId, fetch, prefer);
  } catch (e) {
    return json({ error: 'apple_unreachable', detail: String(e) }, 500);
  }
  if (!statuses.ok) {
    // Neither environment knows it: nothing a retry could change.
    if (statuses.status === 404) return json({ ok: true, ignored: 'unknown_subscription' }, 200);
    if (statuses.status === 401) {
      await reportEdgeError({
        fn: 'app-store-notifications', action: 'apple_401', error: new Error(statuses.detail || '401'),
        severity: 'critical',
        extra: { hint: 'APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / key type (must be an In-App Purchase key)' },
      });
    }
    return json({ error: 'status_lookup_failed', status: statuses.status }, 500);
  }

  const ent = entitlementFromStatuses(statuses.body, originalTransactionId);
  if (!ent.found) return json({ ok: true, ignored: 'not_a_subscription', type }, 200);
  if (ent.transaction?.bundleId !== BUNDLE_ID) return json({ ok: true, ignored: 'other_app' }, 200);

  const admin = makeAdmin();
  // ⚠️ EVERY DATABASE ERROR BELOW ANSWERS 500. In production Apple retries
  // a non-2xx five times over three days and never resends a notification it
  // was told it delivered. Reading a failed query as "no account" or "not
  // current" answered 200, so a renewal lost that way let a paying
  // subscriber age out to free, and a refund lost that way was never revoked.
  const resolved = await resolveAppleAccount(admin, originalTransactionId, ent.transaction);
  if (!resolved.ok) return json({ error: 'db_error', detail: resolved.error }, 500);
  const accountId = resolved.value;
  if (!accountId) {
    // No row and no usable account token. Answering 500 would only make
    // Apple resend something that can never resolve.
    return json({ ok: true, ignored: 'unknown_account', type, status: ent.status }, 200);
  }

  const { data: current, error: currentErr } = await admin
    .from('account_subscriptions')
    .select('source, status, current_period_end, external_subscription_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (currentErr) return json({ error: 'db_error', detail: currentErr.message }, 500);

  // ── 5. apply it ───────────────────────────────────────────────────────
  if (ent.entitled && ent.productId) {
    /**
     * ⚠️ NEVER OVERWRITE A LIVE GOOGLE SUBSCRIPTION FROM HERE.
     * One account paying both stores is a support case, not a state to
     * resolve automatically. Granting would switch the row to Apple, the
     * next Play renewal would switch it back, and the plan would flip every
     * month. The purchase itself was granted by verify-apple-purchase when
     * the user bought it; this is the renewal path, and it steps aside.
     */
    const googleLive = current?.source === 'iap_google'
      && current?.status === 'active'
      && (!current?.current_period_end || Date.parse(current.current_period_end) > Date.now());
    if (googleLive) {
      await reportEdgeError({
        fn: 'app-store-notifications', action: 'double_store_subscription',
        error: new Error('account holds a live Google subscription and a live Apple one'),
        severity: 'warning', extra: { accountId, type },
      });
      return json({ ok: true, ignored: 'held_by_google' }, 200);
    }

    const holders = await otherHolders(admin, originalTransactionId, accountId);
    if (!holders.ok) return json({ error: 'db_error', detail: holders.error }, 500);

    const { error } = await admin.rpc('grant_iap_entitlement', {
      p_account_id:      accountId,
      p_store:           'apple',
      p_product_id:      ent.productId,
      p_expires_at:      ent.periodEnd,
      p_external_sub_id: originalTransactionId,
    });
    if (error) return json({ error: 'grant_failed', detail: error.message }, 500);

    // Apple moved the subscription to this account: take it off the old one,
    // only now that the new grant has landed.
    if (holders.value.length > 0) {
      const releaseErr = await releaseHolders(
        admin, originalTransactionId, holders.value, `apple_moved_to_${accountId}`,
      );
      if (releaseErr) return json({ error: 'release_failed', detail: releaseErr }, 500);
    }
    return json({
      ok: true, action: 'granted', type, status: ent.status, periodEnd: ent.periodEnd,
      moved_from: holders.value.length ? holders.value : undefined,
    }, 200);
  }

  /**
   * ⚠️ REVOKE ONLY ROWS THAT NAME THIS SUBSCRIPTION, BUT ALL OF THEM.
   * revoke_iap_entitlement() drops the account to free whatever store holds
   * it. An old Apple subscription expiring must not take down a Google plan
   * or a newer Apple one bought for the same account, so a row is revoked
   * only if it is source iap_apple AND names this originalTransactionId.
   *
   * Every such row, not just the one Apple's token points at: if the
   * subscription moved between two accounts of ours and the move was never
   * processed, the earlier owner still names it, and an expiry that revoked
   * only the new owner would leave the old one on a paid plan for ever.
   */
  const holders = await otherHolders(admin, originalTransactionId, '');
  if (!holders.ok) return json({ error: 'db_error', detail: holders.error }, 500);
  if (holders.value.length === 0) {
    return json({ ok: true, ignored: 'not_current', type, status: ent.status }, 200);
  }

  for (const holder of holders.value) {
    const { error } = await admin.rpc('revoke_iap_entitlement', {
      p_account_id: holder,
      p_reason: `apple_${type || 'status'}_${ent.status ?? 'unknown'}`,
    });
    if (error) return json({ error: 'revoke_failed', detail: error.message }, 500);
  }
  return json({ ok: true, action: 'revoked', type, status: ent.status, accounts: holders.value.length }, 200);
});
