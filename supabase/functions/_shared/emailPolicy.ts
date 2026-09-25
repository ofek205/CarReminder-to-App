// ═══════════════════════════════════════════════════════════════════════════
// emailPolicy — the pure rules send-email applies to NON-admin callers.
//
// Audit finding F2 (2026-09-15): send-email was an open relay. Any signed-in
// user could send any HTML, from any display name at our verified domain, to up
// to 50 arbitrary recipients per request. The emails pass SPF/DKIM as the real
// brand, which makes them ideal phishing.
//
// Everything here is pure (no Deno, no Supabase) so vitest can pin it, the same
// way aiQuota.ts is tested. The database lookups that answer "is this recipient
// related to the caller?" live in send-email/index.ts and feed
// recipientRelated() with booleans.
//
// The five legitimate non-admin flows, all of which these rules must allow
// (see emailPolicy.test.ts, which replays each one):
//   1. welcome after email signup        → to = caller's own email
//   2. welcome after OAuth signup        → to = caller's own email
//   3. vehicle share                     → to = a pending/accepted share the
//                                           caller owns (row exists BEFORE the
//                                           email is sent)
//   4. vehicle transfer                  → to = a pending transfer from caller
//   5. account invite (two paths)        → a pending membership the caller
//                                           invited, or a token invite the
//                                           caller just created
// Every one of them sends to exactly ONE address and passes no custom sender.
// ═══════════════════════════════════════════════════════════════════════════

export const SENDER_DOMAIN = 'car-reminder.app';
export const DEFAULT_FROM = 'CarReminder <no-reply@car-reminder.app>';
const DEFAULT_FROM_NAME = 'CarReminder';

// Keys a NON-admin may tag a send with. These are exactly the keys the
// non-admin flows pass today (welcome, invite) plus the catch-all the function
// already defaults to. Admin-only keys (admin_direct, welcome_business,
// reminder_* test sends) are deliberately absent: an admin is exempt from this
// policy and keeps whatever key they pass. The key only decides which bucket a
// send lands in on the EmailCenter dashboard, so relabelling an unknown key is
// harmless, never a failed send.
export const USER_NOTIFICATION_KEYS: readonly string[] = Object.freeze([
  'welcome',
  'invite',
  'system_alert',
]);

// How far back a token invite / pending membership still counts as "just
// created" for the unbound invite paths. The client sends the email in the
// same code path, seconds after the invite RPC returns, so ten minutes covers
// a slow network with a wide margin.
//
// KNOWN LIMIT (read before enforcing): these two invite checks are NOT tied to
// the recipient. invite_account_member_by_email accepts any caller who is owner
// or manager of some account, and every user owns their personal account, so
// any user can mint an invite and then satisfy this check for any address for
// this window. The fix needs a schema change, storing the invited address on
// `invites` (which audit finding F16 needs anyway), after which the check can
// match the exact address like shares and transfers already do.
export const RECENT_INVITE_WINDOW_MS = 10 * 60 * 1000;

// One address, no display name, no list separators, no header-injection
// characters. A comma matters most: Resend would read "a@x.com, b@y.com" as
// TWO recipients, which would quietly undo the single-recipient rule.
const SINGLE_ADDRESS_RE = /^[^\s@<>,;"'()\[\]\\]+@[^\s@<>,;"'()\[\]\\]+\.[^\s@<>,;"'()\[\]\\]{2,}$/;

/** Flatten `to` into a trimmed list, or null if it is not a string/string[]. */
export function normalizeRecipients(to: unknown): string[] | null {
  const list = Array.isArray(to) ? to : [to];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

/** True for exactly one plain address, with nothing Resend could split. */
export function isSingleAddress(value: unknown): boolean {
  return typeof value === 'string' && SINGLE_ADDRESS_RE.test(value.trim());
}

/** True when `value` is a plain address at our own verified domain. */
export function isOwnDomainAddress(value: unknown): boolean {
  if (!isSingleAddress(value)) return false;
  const addr = (value as string).trim().toLowerCase();
  return addr.slice(addr.lastIndexOf('@') + 1) === SENDER_DOMAIN;
}

/**
 * Return a sender that is guaranteed to be at our domain.
 *
 * Accepts `Name <local@car-reminder.app>` or a bare `local@car-reminder.app`
 * and keeps a cleaned display name. Anything else collapses to DEFAULT_FROM
 * instead of being rejected: our Resend account only has car-reminder.app
 * verified, so a foreign sender already fails at Resend today, and replacing it
 * turns a failed send into a delivered one rather than the reverse.
 */
export function sanitizeFrom(from: unknown): string {
  if (typeof from !== 'string' || !from.trim() || /[\r\n]/.test(from)) return DEFAULT_FROM;
  const raw = from.trim();

  const angled = raw.match(/^(.*?)<\s*([^<>\s]+)\s*>$/);
  const address = (angled ? angled[2] : raw).trim();
  if (!isOwnDomainAddress(address)) return DEFAULT_FROM;

  // `@` is stripped too: a display name that looks like an address
  // ("service@paypal.com <x@car-reminder.app>") is a classic spoof, since
  // many mail clients show only the name.
  const name = (angled ? angled[1] : '')
    .replace(/["<>,;\\@]/g, '')
    .trim()
    .slice(0, 60);
  return `${name || DEFAULT_FROM_NAME} <${address.toLowerCase()}>`;
}

/** Keep a known non-admin key; relabel anything else as the catch-all. */
export function userNotificationKey(key: unknown): string {
  return typeof key === 'string' && USER_NOTIFICATION_KEYS.includes(key) ? key : 'system_alert';
}

export interface RecipientEvidence {
  isSelf: boolean;        // recipient is the caller's own login email
  share: boolean;         // caller owns a pending/accepted share to this address
  transfer: boolean;      // caller has a pending transfer to this address
  pendingMember: boolean; // caller just invited a registered user (unbound)
  recentInvite: boolean;  // caller just minted a token invite (unbound)
}

/** A send is related when any legitimate flow explains it. */
export function recipientRelated(e: RecipientEvidence): boolean {
  return e.isSelf || e.share || e.transfer || e.pendingMember || e.recentInvite;
}

/**
 * Parse the SEND_EMAIL_RECIPIENT_POLICY secret. Only the exact word "enforce"
 * turns blocking on; anything else, including unset, means "monitor". Failing
 * toward monitor is deliberate: a typo in a secret must never start silently
 * dropping every share and invite email.
 */
export function resolvePolicyMode(raw: unknown): 'monitor' | 'enforce' {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'enforce' ? 'enforce' : 'monitor';
}

/**
 * Escape a value for an exact, case-insensitive PostgREST `ilike` match.
 * `%` and `_` are LIKE wildcards; `*` is PostgREST's URL alias for `%`. An
 * address containing `*` returns null so the caller falls back to `eq`.
 */
export function ilikeExact(value: string): string | null {
  if (value.includes('*')) return null;
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
