import { describe, it, expect } from 'vitest';
import {
  consentStateFromRows,
  mayShare,
  shouldAsk,
  CONSENT_VERSION,
  AI_PROVIDERS,
  AI_TEXT,
  AI_IMAGES,
  GRANTED,
  DENIED,
  NOT_ASKED,
  UNKNOWN,
} from './aiConsent';

const row = (kind, over = {}) => ({
  kind,
  version: CONSENT_VERSION,
  revoked_at: null,
  ...over,
});

describe('consentStateFromRows', () => {
  it('reads a live row as granted', () => {
    expect(consentStateFromRows([row(AI_TEXT)], AI_TEXT)).toBe(GRANTED);
  });

  it('reads a revoked row as denied', () => {
    const revoked = [row(AI_TEXT, { revoked_at: '2026-09-08T10:00:00Z' })];
    expect(consentStateFromRows(revoked, AI_TEXT)).toBe(DENIED);
  });

  it('keeps the two kinds independent', () => {
    // Agreeing to send a typed question is not agreeing to send a photo of
    // a driving licence. This separation is the reason there are two.
    const rows = [row(AI_TEXT)];
    expect(consentStateFromRows(rows, AI_TEXT)).toBe(GRANTED);
    expect(consentStateFromRows(rows, AI_IMAGES)).toBe(NOT_ASKED);
  });

  // ── the guarantees worth having ─────────────────────────────────────
  //
  // Both of these mean "do not send". If either ever resolves to GRANTED,
  // the app shares user data without permission and every static gate in
  // this repo still passes.

  it('never treats a missing row as granted', () => {
    expect(consentStateFromRows([], AI_TEXT)).toBe(NOT_ASKED);
  });

  it('never treats a failed read as granted', () => {
    // fetchConsents returns UNKNOWN on any error, and UNKNOWN must not
    // pass mayShare.
    expect(consentStateFromRows(null, AI_TEXT)).toBe(UNKNOWN);
    expect(consentStateFromRows(undefined, AI_TEXT)).toBe(UNKNOWN);
    expect(mayShare(consentStateFromRows(null, AI_TEXT))).toBe(false);
  });

  it('ignores consent given for an older disclosure version', () => {
    // The user agreed to a sheet that named a different set of providers.
    // That is not permission for what we send now.
    const stale = [{ kind: AI_TEXT, version: CONSENT_VERSION - 1, revoked_at: null }];
    expect(consentStateFromRows(stale, AI_TEXT)).toBe(NOT_ASKED);
  });

  it('tolerates a version arriving as a string', () => {
    // PostgREST can hand back numerics as strings depending on the column
    // type; a string mismatch must not silently read as "no consent" for a
    // user who did consent.
    const asString = [{ kind: AI_TEXT, version: String(CONSENT_VERSION), revoked_at: null }];
    expect(consentStateFromRows(asString, AI_TEXT)).toBe(GRANTED);
  });
});

describe('mayShare', () => {
  it('passes only an explicit grant', () => {
    expect(mayShare(GRANTED)).toBe(true);
    expect(mayShare(DENIED)).toBe(false);
    expect(mayShare(NOT_ASKED)).toBe(false);
    expect(mayShare(UNKNOWN)).toBe(false);
    expect(mayShare(undefined)).toBe(false);
  });
});

describe('shouldAsk', () => {
  it('asks only when we have never asked', () => {
    expect(shouldAsk(NOT_ASKED)).toBe(true);
  });

  it('does not re-ask someone who said no', () => {
    // Re-prompting on every use is harassment, and reads as a dark pattern
    // in review. They re-enable it in Settings, or a version bump asks.
    expect(shouldAsk(DENIED)).toBe(false);
  });

  it('does not ask while the state is still unknown', () => {
    // Asking before we know what they already said would show the sheet to
    // someone who has already granted.
    expect(shouldAsk(UNKNOWN)).toBe(false);
  });

  it('does not ask someone who already granted', () => {
    expect(shouldAsk(GRANTED)).toBe(false);
  });
});

describe('disclosure content', () => {
  it('names every provider the proxy can actually reach', () => {
    // ai-proxy reads GEMINI_API_KEY, GROQ_API_KEY and ANTHROPIC_API_KEY.
    // If a fourth is added to the backend, this test is the reminder that
    // the sheet has to name it and CONSENT_VERSION has to move.
    expect(AI_PROVIDERS).toHaveLength(3);
    expect(AI_PROVIDERS.join(' ')).toMatch(/Gemini/);
    expect(AI_PROVIDERS.join(' ')).toMatch(/Groq/);
    expect(AI_PROVIDERS.join(' ')).toMatch(/Anthropic/);
  });
});
