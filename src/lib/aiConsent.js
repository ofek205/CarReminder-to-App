/**
 * Consent to share data with third-party AI providers.
 *
 * App Store Guideline 5.1.2(i), updated 2026-11-13, requires an app to
 * "clearly disclose where personal data will be shared with third parties,
 * including with third-party AI, and obtain explicit permission before
 * doing so". A link to the privacy policy is disclosure, not permission.
 *
 * Design: docs/ux-ai-consent.md   Table: supabase-ai-consents-2026-09-08.sql
 *
 * The state machine is exported separately from the IO so it can be
 * unit-tested without a database, the same shape as lib/reauthMode.js.
 */

import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { reportError } from '@/lib/crashReporter';

/**
 * Bump this when the DISCLOSURE changes in substance: a new provider, a new
 * category of data, a new surface that sends something the old wording did
 * not describe. Bumping asks again instead of leaning on permission that
 * was given for a different set of facts.
 *
 * v1 (2026-09-08): Google (Gemini), Groq, Anthropic (Claude).
 */
export const CONSENT_VERSION = 1;

export const AI_TEXT = 'ai_text';
export const AI_IMAGES = 'ai_images';

/**
 * The providers named in the sheet. Kept here so the UI cannot drift from
 * what the backend actually calls: ai-proxy reads GEMINI_API_KEY,
 * GROQ_API_KEY and ANTHROPIC_API_KEY.
 *
 * ⚠️ Adding one means bumping CONSENT_VERSION. Naming a provider the user
 * never agreed to is the exact failure 5.1.2(i) is about.
 */
export const AI_PROVIDERS = ['Google (Gemini)', 'Groq', 'Anthropic (Claude)'];

/** Consent state for one kind. */
export const UNKNOWN = 'unknown';   // not loaded yet
export const GRANTED = 'granted';
export const DENIED = 'denied';     // asked and declined, or later revoked
export const NOT_ASKED = 'not_asked';

/**
 * Turns the rows for one kind into a single state.
 *
 * Pure, so the rule is testable. Two things it deliberately does NOT do:
 *
 *  - It never treats a missing row as granted. An absent record means we
 *    have not asked, so the caller must ask before sending anything.
 *  - It never honours consent for an older version. A row at v1 when the
 *    app is at v2 reads as NOT_ASKED, because the user agreed to a
 *    disclosure that no longer describes what we send.
 *
 * @param {Array<{kind:string,version:number,revoked_at:string|null}>|null} rows
 * @param {string} kind
 * @param {number} version
 */
export function consentStateFromRows(rows, kind, version = CONSENT_VERSION) {
  if (!Array.isArray(rows)) return UNKNOWN;
  const row = rows.find((r) => r?.kind === kind && Number(r?.version) === version);
  if (!row) return NOT_ASKED;
  return row.revoked_at ? DENIED : GRANTED;
}

/** May we send this kind of data right now? Only an explicit GRANTED counts. */
export function mayShare(state) {
  return state === GRANTED;
}

/**
 * Should the consent sheet be offered for this action?
 *
 * NOT_ASKED yes. DENIED no: the user chose, and re-prompting on every use
 * is harassment and reads as a dark pattern in review. They can turn it
 * back on in Settings, or a CONSENT_VERSION bump will ask again.
 * UNKNOWN no, because we do not yet know what they said.
 */
export function shouldAsk(state) {
  return state === NOT_ASKED;
}

// ── IO ────────────────────────────────────────────────────────────────────

/**
 * Reads both kinds in one round trip.
 *
 * Returns `{ ai_text, ai_images }`. On ANY failure both come back UNKNOWN,
 * never GRANTED: a read that failed is not permission.
 *
 * ⚠️ This is the opposite of lib/aiScanGate.js, which is deliberately
 * `defaultOnError: true` so a Supabase blip cannot kill scanning for
 * everyone. That trade is right for a feature flag and wrong here: failing
 * open on consent means sending someone's driving licence to a third party
 * without permission, which is a legal exposure rather than an
 * inconvenience. Do not "make this consistent" with the scan gate.
 */
export async function fetchConsents(userId) {
  if (!userId) return { [AI_TEXT]: UNKNOWN, [AI_IMAGES]: UNKNOWN };
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('ai_consents')
        .select('kind, version, revoked_at')
        .eq('user_id', userId)
        .eq('version', CONSENT_VERSION),
      'ai_consents_read',
    );
    if (error) throw error;
    return {
      [AI_TEXT]: consentStateFromRows(data, AI_TEXT),
      [AI_IMAGES]: consentStateFromRows(data, AI_IMAGES),
    };
  } catch (e) {
    reportError('ai_consent_read_failed', e);
    return { [AI_TEXT]: UNKNOWN, [AI_IMAGES]: UNKNOWN };
  }
}

/**
 * Records a grant. Resolves `true` only when the row is actually written.
 *
 * The caller MUST NOT proceed to send anything on `false`. A consent we
 * failed to store is a consent we cannot show we obtained, which is the
 * whole point of storing it.
 */
export async function grantConsent(userId, kind) {
  if (!userId || (kind !== AI_TEXT && kind !== AI_IMAGES)) return false;
  try {
    const { error } = await withTimeout(
      supabase.from('ai_consents').upsert(
        {
          user_id: userId,
          kind,
          version: CONSENT_VERSION,
          granted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'user_id,kind,version' },
      ),
      'ai_consents_grant',
    );
    if (error) throw error;
    return true;
  } catch (e) {
    reportError('ai_consent_grant_failed', e);
    return false;
  }
}

/**
 * Withdraws consent, by stamping revoked_at rather than deleting the row:
 * the record that permission was once given is part of the audit trail and
 * the client has no DELETE policy on this table.
 *
 * Declining the sheet uses this same path, so "asked and said no" and
 * "granted then turned off" are the same DENIED state. That is intentional:
 * both mean do not send, and both mean do not ask again unasked.
 */
export async function revokeConsent(userId, kind) {
  if (!userId || (kind !== AI_TEXT && kind !== AI_IMAGES)) return false;
  try {
    const { error } = await withTimeout(
      supabase.from('ai_consents').upsert(
        {
          user_id: userId,
          kind,
          version: CONSENT_VERSION,
          revoked_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,kind,version' },
      ),
      'ai_consents_revoke',
    );
    if (error) throw error;
    return true;
  } catch (e) {
    reportError('ai_consent_revoke_failed', e);
    return false;
  }
}
