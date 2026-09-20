// ═══════════════════════════════════════════════════════════════════════════
// play-rtdn — Google Play Real-time Developer Notifications.
//
// Deploy with Verify JWT = OFF. The caller is Google Cloud Pub/Sub, which
// carries no Supabase JWT and never will. Authentication is the shared
// secret below, checked on every request.
//
// WHY THIS EXISTS
//   Without it, Google tells us about a purchase exactly once, at the moment
//   it happens, and never speaks again. Renewals, cancellations, refunds,
//   failed cards, account holds and expiries all pass in silence. An account
//   that cancels or charges back keeps its paid plan for ever, because
//   nothing in the system is capable of learning otherwise.
//
//   It is also the half that makes an expiry check in account_plan() safe to
//   turn on at all. Expiry alone, with no renewals arriving, would cut off
//   every paying customer one month after they subscribed.
//
// ⚠️ THE NOTIFICATION IS A TRIGGER, NOT A FACT.
//   Every handler here ignores notificationType when deciding what to do and
//   re-reads the subscription from subscriptionsv2. Pub/Sub delivers
//   at-least-once and out of order, so two messages racing and applied by
//   type can leave an account revoked immediately after a renewal. Fetching
//   state makes the handler idempotent and order-independent, which is the
//   property Pub/Sub actually requires of its subscribers.
//
// ⚠️ 200 MEANS "DO NOT SEND THIS AGAIN", NOT "SOMETHING HAPPENED".
//   Pub/Sub retries any non-2xx with backoff, for days. So anything we
//   understood and chose not to act on (a test message, an unknown token, a
//   one-time product) answers 200. Only a genuinely transient failure, where
//   a retry could succeed, answers 500. Returning 500 for an unrecognised
//   message shape would build a permanent retry storm against a message that
//   can never succeed.
//
// SETUP, IN PLAY CONSOLE AND GOOGLE CLOUD
//   1. Cloud console: create a Pub/Sub topic, e.g. play-rtdn.
//   2. Grant google-play-developer-notifications@system.gserviceaccount.com
//      the "Pub/Sub Publisher" role ON THAT TOPIC. Play refuses the topic
//      name without it, with an error that does not say why.
//   3. Create a PUSH subscription on the topic. Endpoint URL:
//        https://<project-ref>.supabase.co/functions/v1/play-rtdn?key=<PLAY_RTDN_SECRET>
//   4. Play Console → Monetise → Monetisation setup → paste the topic name.
//   5. Use "Send test notification" there; it arrives as testNotification
//      and this function answers 200 without touching any account.
//
// SECRETS (Supabase → Edge Functions → Secrets)
//   PLAY_RTDN_SECRET                   a long random string, yours to pick
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   already set for verify-play-purchase
//
// ⚠️ THE SECRET TRAVELS IN THE QUERY STRING, WHICH IS A REAL TRADE-OFF.
//   Pub/Sub push lets you set the endpoint URL but not custom headers, so a
//   header-based secret is not available. The alternative is verifying the
//   OIDC token Pub/Sub can attach, which is stronger and needs Google's
//   rotating certificates fetched and cached on every cold start. The query
//   string is what this ships with; it is over TLS and the URL is not
//   logged by us, but it IS the weaker of the two and should be revisited if
//   this endpoint ever carries more than subscription state.
// ═══════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  readServiceAccount,
  getAccessToken,
  getSubscriptionState,
  entitlementFrom,
  externalAccountIdFrom,
  PACKAGE_NAME,
} from '../_shared/googlePlay.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RTDN_SECRET  = Deno.env.get('PLAY_RTDN_SECRET');

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Length-independent comparison.
 *
 * Not because a timing attack on this endpoint is likely, but because the
 * cheap version (`a === b`) returns early on the first differing byte and
 * there is no reason to write the leaky one when the safe one is four lines.
 */
function secretMatches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

type Admin = ReturnType<typeof createClient>;

/**
 * Which account does this purchase token belong to?
 *
 * ⚠️ TWO LOOKUPS, AND THE SECOND IS NOT A FALLBACK FOR TIDINESS.
 * On an upgrade or downgrade Play issues a BRAND NEW purchase token and the
 * old one stops resolving, so a handler that only matches on the stored
 * token silently stops recognising the very customers who changed plan. The
 * external account id we attach at purchase time is the link that survives.
 */
async function resolveAccountId(
  admin: Admin,
  purchaseToken: string,
  sub: Record<string, unknown> | null,
): Promise<string | null> {
  const { data: byToken } = await admin
    .from('account_subscriptions')
    .select('account_id')
    .eq('external_subscription_id', purchaseToken)
    .maybeSingle();
  if (byToken?.account_id) return byToken.account_id as string;

  const external = sub ? externalAccountIdFrom(sub) : null;
  if (!external) return null;

  // Confirm it names a real account before handing it to a grant. The value
  // came from Google, but it originally came from a device, and a uuid we
  // cannot find is not an account we should be writing to.
  const { data: acct } = await admin
    .from('accounts')
    .select('id')
    .eq('id', external)
    .maybeSingle();
  return acct?.id ? (acct.id as string) : null;
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // ── 1. authenticate the caller ────────────────────────────────────────
  // ⚠️ FAIL CLOSED ON A MISSING SECRET. An unset PLAY_RTDN_SECRET must mean
  // "nobody may call this", never "anybody may". Without that, a deploy that
  // lands before the secret is set is a public write endpoint into
  // account_subscriptions.
  if (!RTDN_SECRET) return json({ error: 'not_configured' }, 503);
  const key = new URL(req.url).searchParams.get('key') || '';
  if (!secretMatches(key, RTDN_SECRET)) return json({ error: 'forbidden' }, 403);

  // ── 2. unwrap the Pub/Sub envelope ────────────────────────────────────
  let notification: Record<string, unknown>;
  try {
    const envelope = await req.json();
    const data = envelope?.message?.data;
    if (!data) {
      // A push with no data is malformed, and no retry will add one.
      return json({ ok: true, ignored: 'no_data' }, 200);
    }
    notification = JSON.parse(atob(String(data)));
  } catch {
    return json({ ok: true, ignored: 'unparseable' }, 200);
  }

  // Play's own "Send test notification" button. Answering 200 is what makes
  // the console report the topic as working.
  if (notification?.testNotification) {
    return json({ ok: true, test: true }, 200);
  }

  // ⚠️ CHECK THE PACKAGE. One Pub/Sub topic can legitimately carry more than
  // one app, and acting on another app's tokens would mean asking Google
  // about a purchase that is not ours.
  if (notification?.packageName && notification.packageName !== PACKAGE_NAME) {
    return json({ ok: true, ignored: 'other_package' }, 200);
  }

  const subNote = notification?.subscriptionNotification as Record<string, unknown> | undefined;
  const voided  = notification?.voidedPurchaseNotification as Record<string, unknown> | undefined;

  const purchaseToken = String(subNote?.purchaseToken || voided?.purchaseToken || '');
  if (!purchaseToken) {
    // oneTimeProductNotification and anything else we do not sell.
    return json({ ok: true, ignored: 'no_subscription_token' }, 200);
  }

  const sa = readServiceAccount();
  if (!sa) return json({ error: 'not_configured' }, 503);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 3. a refund or chargeback ends the entitlement immediately ────────
  // ⚠️ HANDLED BEFORE THE STATE LOOKUP, BECAUSE THE LOOKUP MAY NO LONGER
  // WORK. A voided purchase can stop resolving in subscriptionsv2, so
  // requiring a successful state read first would turn "the money was taken
  // back" into "we could not check", and leave the plan in place.
  if (voided) {
    const accountId = await resolveAccountId(admin, purchaseToken, null);
    if (!accountId) return json({ ok: true, ignored: 'unknown_token' }, 200);
    const { error } = await admin.rpc('revoke_iap_entitlement', {
      p_account_id: accountId,
      p_reason: 'play_voided_purchase',
    });
    // A database failure IS worth retrying, unlike everything above.
    if (error) return json({ error: 'revoke_failed', detail: error.message }, 500);
    return json({ ok: true, action: 'revoked', reason: 'voided' }, 200);
  }

  // ── 4. ask Google what is true now ────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await getAccessToken(sa);
  } catch (e) {
    // Transient by nature: the token endpoint was unreachable or the API is
    // not enabled yet. Worth a retry.
    return json({ error: 'token_exchange_failed', detail: String(e) }, 500);
  }

  const lookup = await getSubscriptionState(accessToken, purchaseToken);
  if (!lookup.ok) {
    // 400/404/410 mean Google does not have this token and never will again.
    // Retrying is pointless, so it is an acknowledged no-op.
    if (lookup.status === 400 || lookup.status === 404 || lookup.status === 410) {
      return json({ ok: true, ignored: 'token_gone', status: lookup.status }, 200);
    }
    return json({ error: 'lookup_failed', status: lookup.status, detail: lookup.detail }, 500);
  }

  const { entitled, state, productId, expiry } = entitlementFrom(lookup.sub);
  const accountId = await resolveAccountId(admin, purchaseToken, lookup.sub);
  if (!accountId) {
    // A purchase we have never seen. This is normal and not an error: the
    // notification for a brand new purchase can beat the client's own
    // verification call to us by a moment, and that call is what creates the
    // row. Play will not resend, but the client's verification does the
    // grant, and the next renewal notification will resolve cleanly.
    return json({ ok: true, ignored: 'unknown_token', state }, 200);
  }

  // ── 5. apply it ───────────────────────────────────────────────────────
  if (entitled) {
    // Covers renewal, recovery, restart, grace and a cancellation that still
    // has paid time left. Writing the fresh expiry on every one of these is
    // what keeps a live subscriber from ageing out of their own plan.
    const { error } = await admin.rpc('grant_iap_entitlement', {
      p_account_id:      accountId,
      p_store:           'google',
      p_product_id:      productId,
      p_expires_at:      expiry,
      p_external_sub_id: purchaseToken,
    });
    if (error) return json({ error: 'grant_failed', detail: error.message }, 500);
    return json({ ok: true, action: 'granted', state, expiry }, 200);
  }

  const { error } = await admin.rpc('revoke_iap_entitlement', {
    p_account_id: accountId,
    p_reason: `play_${state || 'not_entitled'}`,
  });
  if (error) return json({ error: 'revoke_failed', detail: error.message }, 500);
  return json({ ok: true, action: 'revoked', state }, 200);
});
