import { describe, it, expect } from 'vitest';
import { resolveReauthMode, APPLE_RELAY_DOMAIN } from './reauthMode';

// Shapes mirroring what supabase.auth.getUser() actually returns.
const u = (provider, email, extra = {}) => ({
  email,
  app_metadata: { provider, providers: [provider] },
  identities: [{ provider }],
  ...extra,
});

describe('resolveReauthMode', () => {
  it('returns null while the user is still loading, so the gate can show a placeholder', () => {
    expect(resolveReauthMode(null, false)).toBe(null);
    expect(resolveReauthMode(undefined, false)).toBe(null);
  });

  it('sends a password user to the password gate', () => {
    expect(resolveReauthMode(u('email', 'a@b.com'), false)).toBe('password');
  });

  it('sends a Google user to the emailed code, NOT to the typed word', () => {
    // This is the case that was broken: no password, and before the fix the
    // delete button stayed permanently disabled.
    expect(resolveReauthMode(u('google', 'a@gmail.com'), false)).toBe('otp');
  });

  it('sends an Apple user to the native sheet on iOS', () => {
    expect(resolveReauthMode(u('apple', 'a@b.com'), true)).toBe('apple');
  });

  it('prefers the Apple sheet over a password the user also has', () => {
    // Not a convenience call. The sheet is the only source of a fresh
    // authorizationCode, and without it the Apple token cannot be revoked
    // as Guideline 5.1.1(v) requires. Weakening this to "password first"
    // would silently break compliance while every existing gate still passes.
    const both = {
      email: 'a@b.com',
      app_metadata: { provider: 'apple', providers: ['apple', 'email'] },
      identities: [{ provider: 'apple' }, { provider: 'email' }],
    };
    expect(resolveReauthMode(both, true)).toBe('apple');
  });

  it('falls back off the Apple sheet when not on native iOS', () => {
    // Apple sign-in in a browser cannot open the native sheet, so a real
    // address still earns the emailed code.
    expect(resolveReauthMode(u('apple', 'a@b.com'), false)).toBe('otp');
  });

  it('uses the typed word only when the address is an Apple relay', () => {
    // Mail to the relay bounces unless the sending domain is registered
    // with Apple, so a code cannot be relied on to arrive.
    const relay = u('apple', `abc123${APPLE_RELAY_DOMAIN}`);
    expect(resolveReauthMode(relay, false)).toBe('word');
  });

  it('treats a relay address case-insensitively', () => {
    const shouty = u('apple', `ABC123${APPLE_RELAY_DOMAIN.toUpperCase()}`);
    expect(resolveReauthMode(shouty, false)).toBe('word');
  });

  // ── the fail-closed guarantee ────────────────────────────────────────
  //
  // These are the tests worth having. Deletion is irreversible, so an
  // account shape we cannot verify must REFUSE. If someone later
  // "simplifies" the function to `return 'word'` as its default, they
  // weaken a security gate on a destructive path — and eslint, the build,
  // and every check-*.cjs gate in this repo would all still pass.

  it('refuses when there is no provider and no address', () => {
    expect(resolveReauthMode({ email: '', app_metadata: {}, identities: [] }, false))
      .toBe('unverifiable');
  });

  it('refuses on an unrecognised account shape rather than degrading', () => {
    expect(resolveReauthMode({}, false)).toBe('unverifiable');
  });

  it('never returns the typed word as a fallback for a missing provider', () => {
    // A deliverable address must earn the real gate even when the provider
    // is unknown to us.
    expect(resolveReauthMode({ email: 'a@b.com', app_metadata: {} }, false)).toBe('otp');
  });

  it('reads providers from identities when app_metadata is empty', () => {
    // Supabase populates both; a shape carrying only one must still resolve.
    const identityOnly = { email: 'a@b.com', identities: [{ provider: 'email' }] };
    expect(resolveReauthMode(identityOnly, false)).toBe('password');
  });
});
