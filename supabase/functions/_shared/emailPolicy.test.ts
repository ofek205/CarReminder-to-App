import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FROM,
  normalizeRecipients,
  isSingleAddress,
  isOwnDomainAddress,
  sanitizeFrom,
  userNotificationKey,
  recipientRelated,
  resolvePolicyMode,
  ilikeExact,
  type RecipientEvidence,
} from './emailPolicy';

const NONE: RecipientEvidence = {
  isSelf: false, share: false, transfer: false, pendingMember: false, recentInvite: false,
};

// ── The five legitimate non-admin flows, replayed exactly as the client ────
// builds them. If any of these start failing, a real email in the product
// just stopped going out. That is the whole point of this block.
//
// Sources:
//   AuthPage.jsx dispatchWelcomeEmail      sendEmail({ to: email, notificationKey: 'welcome' })
//   GuestContext.jsx OAuth welcome         sendEmail({ to: user.email, notificationKey: 'welcome' })
//   ShareVehicleDialog.jsx sendShareEmail  sendEmail({ to: toEmail })              (no from, no key)
//   TransferVehicleDialog.jsx              sendEmail({ to: toEmail })              (no from, no key)
//   inviteEmail.js templated path          from: `${fromName} <${fromEmail}>`, key 'invite'
//   inviteEmail.js fallback path           sendEmail({ to, notificationKey: 'invite' })
// sendEmail() forwards `from: undefined` when no sender is given, and JSON
// drops undefined, so the Edge Function sees `from` as undefined.
describe('legitimate non-admin flows keep working', () => {
  it('welcome (email + OAuth): single own-address recipient, default sender, key kept', () => {
    const to = normalizeRecipients('new.user@gmail.com');
    expect(to).toEqual(['new.user@gmail.com']);
    expect(isSingleAddress(to![0])).toBe(true);
    expect(sanitizeFrom(undefined)).toBe(DEFAULT_FROM);
    expect(userNotificationKey('welcome')).toBe('welcome');
    expect(recipientRelated({ ...NONE, isSelf: true })).toBe(true);
  });

  it('Apple private-relay welcome address is a valid single recipient', () => {
    expect(isSingleAddress('abc123xyz@privaterelay.appleid.com')).toBe(true);
  });

  it('vehicle share: one recipient, no sender, no key → default sender + catch-all bucket', () => {
    expect(normalizeRecipients('friend@walla.co.il')).toEqual(['friend@walla.co.il']);
    expect(sanitizeFrom(undefined)).toBe(DEFAULT_FROM);
    expect(userNotificationKey(undefined)).toBe('system_alert');
    expect(recipientRelated({ ...NONE, share: true })).toBe(true);
  });

  it('vehicle transfer: related through the pending transfer', () => {
    expect(recipientRelated({ ...NONE, transfer: true })).toBe(true);
  });

  it('templated invite: the template sender is preserved exactly', () => {
    expect(sanitizeFrom('CarReminder <no-reply@car-reminder.app>'))
      .toBe('CarReminder <no-reply@car-reminder.app>');
    expect(userNotificationKey('invite')).toBe('invite');
  });

  it('templated invite with a Hebrew display name keeps the name', () => {
    expect(sanitizeFrom('קאר רמיינדר <no-reply@car-reminder.app>'))
      .toBe('קאר רמיינדר <no-reply@car-reminder.app>');
  });

  it('both invite paths are related (pending member, or a token invite just minted)', () => {
    expect(recipientRelated({ ...NONE, pendingMember: true })).toBe(true);
    expect(recipientRelated({ ...NONE, recentInvite: true })).toBe(true);
  });

  it('plus-addressing and subdomains are ordinary single addresses', () => {
    expect(isSingleAddress('ofek+test@mail.example.co.il')).toBe(true);
  });
});

// ── The relay the audit found ──────────────────────────────────────────────
describe('open-relay attempts are contained', () => {
  it('an array of several recipients is visible as more than one', () => {
    expect(normalizeRecipients(['a@x.com', 'b@y.com', 'c@z.com'])).toHaveLength(3);
  });

  it('a comma-joined string is NOT a single address (Resend would split it)', () => {
    expect(isSingleAddress('a@x.com, b@y.com')).toBe(false);
    expect(isSingleAddress('a@x.com;b@y.com')).toBe(false);
  });

  it('display-name and header-injection shapes are not single addresses', () => {
    expect(isSingleAddress('Victim <v@x.com>')).toBe(false);
    expect(isSingleAddress('v@x.com\r\nBcc: z@y.com')).toBe(false);
    expect(isSingleAddress('not-an-email')).toBe(false);
    expect(isSingleAddress('')).toBe(false);
  });

  it('non-string or mixed `to` is rejected outright', () => {
    expect(normalizeRecipients(42)).toBeNull();
    expect(normalizeRecipients(['a@x.com', 7])).toBeNull();
  });

  it('a foreign sender collapses to the default sender', () => {
    expect(sanitizeFrom('PayPal <service@paypal.com>')).toBe(DEFAULT_FROM);
    expect(sanitizeFrom('service@paypal.com')).toBe(DEFAULT_FROM);
  });

  it('a look-alike domain is not our domain', () => {
    expect(sanitizeFrom('CR <x@car-reminder.app.evil.com>')).toBe(DEFAULT_FROM);
    expect(sanitizeFrom('CR <x@evil-car-reminder.app>')).toBe(DEFAULT_FROM);
    expect(isOwnDomainAddress('x@car-reminder.app.evil.com')).toBe(false);
  });

  it('CR/LF in the sender collapses to the default (header injection)', () => {
    expect(sanitizeFrom('CR <a@car-reminder.app>\r\nBcc: x@y.com')).toBe(DEFAULT_FROM);
  });

  it('an address-shaped display name is stripped of its @ (spoof)', () => {
    expect(sanitizeFrom('service@paypal.com <no-reply@car-reminder.app>'))
      .toBe('servicepaypal.com <no-reply@car-reminder.app>');
  });

  it('an empty display name falls back to the brand name', () => {
    expect(sanitizeFrom('<no-reply@car-reminder.app>')).toBe('CarReminder <no-reply@car-reminder.app>');
    expect(sanitizeFrom('no-reply@car-reminder.app')).toBe('CarReminder <no-reply@car-reminder.app>');
  });

  it('admin-only keys are relabelled for a non-admin caller', () => {
    expect(userNotificationKey('admin_direct')).toBe('system_alert');
    expect(userNotificationKey('welcome_business')).toBe('system_alert');
    expect(userNotificationKey('reminder_insurance')).toBe('system_alert');
    expect(userNotificationKey({})).toBe('system_alert');
  });

  it('a stranger with no relationship is unrelated', () => {
    expect(recipientRelated(NONE)).toBe(false);
  });
});

describe('policy mode fails toward monitor', () => {
  it('only the exact word enforce turns blocking on', () => {
    expect(resolvePolicyMode('enforce')).toBe('enforce');
    expect(resolvePolicyMode('  ENFORCE ')).toBe('enforce');
  });

  it('unset, typos and anything else stay in monitor', () => {
    expect(resolvePolicyMode(undefined)).toBe('monitor');
    expect(resolvePolicyMode('')).toBe('monitor');
    expect(resolvePolicyMode('enforced')).toBe('monitor');
    expect(resolvePolicyMode('true')).toBe('monitor');
    expect(resolvePolicyMode('monitor')).toBe('monitor');
  });
});

describe('ilikeExact makes a case-insensitive match exact', () => {
  it('escapes the LIKE wildcards % and _', () => {
    expect(ilikeExact('a_b@x.com')).toBe('a\\_b@x.com');
    expect(ilikeExact('50%off@x.com')).toBe('50\\%off@x.com');
  });

  it('leaves an ordinary address untouched', () => {
    expect(ilikeExact('friend@walla.co.il')).toBe('friend@walla.co.il');
  });

  it('refuses * (PostgREST reads it as %) so the caller uses eq instead', () => {
    expect(ilikeExact('a*b@x.com')).toBeNull();
  });
});
