/**
 * Which re-authentication gate applies before a destructive account action.
 *
 * Extracted from DeleteAccount.jsx on purpose. This function encodes a
 * SECURITY rule, not a display detail, and it lives in its own module for
 * two reasons: the rule is auditable in one place, and it is a pure
 * function with zero imports so it can be unit-tested without dragging in
 * React, Supabase and the Capacitor Apple plugin.
 *
 * Background: until 2026-09-08 account deletion required a password, and
 * the submit button stayed disabled until one was typed. Users who signed
 * up with Google or Apple have no password, so roughly 92% of recent
 * signups could not delete their account at all — a violation of App Store
 * Guideline 5.1.1(v), which requires that all users be able to delete.
 */

// Apple's "Hide My Email" relay. Mail to these bounces unless the sending
// domain is registered with Apple, so an emailed code cannot be relied on
// to reach the user. See docs/runbook-apple-private-email-relay.md.
export const APPLE_RELAY_DOMAIN = '@privaterelay.appleid.com';

/**
 * Deletion is irreversible, so this returns the STRONGEST gate the user can
 * actually complete, never the most convenient one.
 *
 * @param {object|null} user       Supabase user, or null while loading.
 * @param {boolean}     iosNative  True only in the native iOS build.
 *                                 Passed in rather than imported so this
 *                                 module stays free of dependencies.
 * @returns {'apple'|'password'|'otp'|'word'|'unverifiable'|null}
 *
 * - `apple` wins even when the user also has a password, because the native
 *   sheet is the only place we can obtain a fresh `authorizationCode`, and
 *   without it we cannot revoke the Apple token as 5.1.1(v) requires.
 * - `otp` gives an OAuth user real proof of identity via an emailed code.
 *   A full OAuth redirect is not used because it destroys the screen's
 *   mode/step state mid-flow on a destructive path.
 * - `word` proves INTENT, not identity. It is reachable only when there is
 *   no address we can deliver to, and must never become a default.
 * - `unverifiable` is the fail-closed outcome. An account shape we do not
 *   recognise must refuse rather than silently fall through to the weakest
 *   gate — the caller disables the delete button on this value.
 * - `null` means "still loading", so the caller renders a placeholder
 *   instead of flickering between branches.
 */
export function resolveReauthMode(user, iosNative) {
  if (!user) return null;

  const providers = new Set(
    [
      user.app_metadata?.provider,
      ...(user.app_metadata?.providers || []),
      ...(user.identities || []).map((i) => i?.provider),
    ].filter(Boolean),
  );

  const email = String(user.email || '');
  const emailDeliverable =
    !!email && !email.toLowerCase().endsWith(APPLE_RELAY_DOMAIN);

  if (providers.has('apple') && iosNative) return 'apple';
  if (providers.has('email')) return 'password';
  if (emailDeliverable) return 'otp';
  if (providers.size > 0) return 'word';
  return 'unverifiable';
}
