/**
 * AI Consent Gate — the choke point that enforces docs/ux-ai-consent.md.
 *
 * Every AI call in this app goes through aiRequest() in lib/aiProxy.js.
 * That makes it the one place where "was permission given?" can be
 * answered for all eleven call sites at once, including the two that carry
 * no `feature` tag (PostCreateDialog, aiAdvice). Gating per surface would
 * mean eleven chances to forget one; gating here means a surface added
 * tomorrow is covered before anyone remembers this file exists.
 *
 * TWO LAYERS, ON PURPOSE
 *   This module is the GUARANTEE: nothing reaches a provider without a
 *   stored grant. The per-surface polish (keeping the chat draft, posting
 *   to the community without a reply, the muted scan tile) is the
 *   EXPERIENCE, and it lives in the surfaces. If a surface is never
 *   polished, the worst case is a blunt error instead of leaked data.
 *
 * ⚠️ WHY THE KIND IS READ OFF THE PAYLOAD AND NOT OFF `feature`
 *   The obvious design is a map: yossi_chat -> ai_text, scan_extraction ->
 *   ai_images. It is wrong. AiAssistant attaches files to chat messages:
 *
 *     type: attachment.isImage ? 'image' : 'document'   (AiAssistant.jsx)
 *
 *   so a `yossi_chat` request can carry a photographed driving licence.
 *   Under a feature map that licence would ship on the strength of the
 *   TEXT consent. Community posts take photos too. So the image question
 *   is answered by looking for image parts in the actual body, which no
 *   tag can misreport, and an untagged call site is classified correctly
 *   without anyone tagging it.
 *
 * @see src/lib/aiConsent.js  state machine + storage
 * @see docs/ux-ai-consent.md
 */

import { isFeatureEnabled } from './featureFlags';
import {
  AI_TEXT,
  AI_IMAGES,
  DENIED,
  fetchConsents,
  mayShare,
  shouldAsk,
} from './aiConsent';

/**
 * Flag row in public.app_config. Enforcement is OFF until this is true.
 *
 * ⚠️ RUN THE MIGRATION BEFORE FLIPPING THIS. The consent read fails
 * closed, so with enforcement on and no `ai_consents` table every read
 * returns UNKNOWN and AI is blocked for everyone.
 *
 *   UPDATE public.app_config SET value = 'true'::jsonb, updated_at = NOW()
 *    WHERE key = 'ai_consent_enforced';
 *
 * ⚠️ READ WITH ignoreAdmin, AND HERE IS WHY.
 *   isFeatureEnabled normally passes admins whatever the row says, so
 *   they can see a new feature early. That bypass is actively wrong for
 *   a flag whose meaning is "this restriction now applies": it enrols
 *   admins in the restriction before anyone has decided to enable it.
 *   Combined with the fail-closed read, deploying this with the bypass
 *   would have taken AI away from every admin account the moment the
 *   build went out, before the migration, in production, because staging
 *   shares that database. And the canary it was supposed to buy does not
 *   exist: the flag row is global, so flipping it on staging flips it in
 *   production too. All cost, no benefit.
 *
 * This is also the only kill switch that reaches the native apps. Their
 * JS is bundled into the binary, so a bug in this flow cannot be fixed by
 * a deploy, only by a store release. A server-side flag can turn it off
 * in one UPDATE.
 */
const FLAG_KEY = 'ai_consent_enforced';

/**
 * Features whose message text is written by US, not by the user: an
 * extraction instruction wrapped around the user's photo. The image
 * consent covers those end to end, so asking for text consent as well
 * would prompt twice for one scan.
 *
 * Everything else, including an unknown or missing feature, counts as
 * user-authored text and needs the text consent.
 */
const EXTRACTION_FEATURES = new Set(['scan_extraction', 'plate_scan']);

/**
 * Message content parts that are NOT binary payload. Anything else,
 * including a part shape this app has never seen, counts as an image:
 * an unrecognised part is more likely to be a new attachment type than a
 * new flavour of plain text, and guessing wrong in that direction sends
 * a document without permission.
 */
const TEXT_PART_TYPES = new Set(['text']);

/**
 * Does this request body carry an image or a document?
 *
 * Pure and exported so the classification is unit-testable, since a
 * mistake here is silent: it does not throw, it just sends a photograph
 * under the wrong permission.
 *
 * Fail-closed on anything malformed. A body we cannot read is a body we
 * cannot clear.
 */
export function requestCarriesImage(body) {
  if (!body || typeof body !== 'object') return true;
  const messages = body.messages;
  if (!Array.isArray(messages)) return true;

  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === 'string') continue;      // plain text turn
    if (!Array.isArray(content)) {
      if (content == null) continue;                // empty turn, harmless
      return true;                                  // unreadable shape
    }
    for (const part of content) {
      const type = part?.type;
      if (typeof type !== 'string') return true;
      if (!TEXT_PART_TYPES.has(type)) return true;  // image / document / new
    }
  }
  return false;
}

/**
 * Which consents this request needs. Returns an array so the caller can
 * require both, which is exactly what a chat message with a photo
 * attached does.
 *
 * @param {object} body  the aiRequest body
 * @returns {string[]} some of [AI_TEXT, AI_IMAGES]
 */
export function kindsForRequest(body) {
  const kinds = [];
  if (!EXTRACTION_FEATURES.has(body?.feature)) kinds.push(AI_TEXT);
  if (requestCarriesImage(body)) kinds.push(AI_IMAGES);
  return kinds;
}

// ── the ask ───────────────────────────────────────────────────────────────
//
// Recycles the pub-sub shape of aiScanGate.js: one sheet mounted in
// Layout, any caller anywhere raises it. The difference is that this one
// is AWAITABLE. aiScanGate fires and forgets because there is nothing to
// decide; here the request has to wait for an answer and then continue,
// so the message the user typed is sent the moment they agree instead of
// making them press send twice.

/**
 * How long a pending ask may sit unanswered before it resolves itself as
 * "no answer". The sheet clears its own pending asks on unmount, so this
 * is only reached if the sheet is never mounted or wedges.
 *
 * ⚠️ This exists because the alternative is a promise that never settles,
 * which leaves the caller's spinner up forever. That is the exact failure
 * class CLAUDE.md's Query Timeout gate was written for, and a permission
 * prompt is a much easier place to reintroduce it than a query.
 */
const ASK_TIMEOUT_MS = 120_000;

const listeners = new Set();

/** kind -> { promise, settle } for asks currently on screen. */
const pending = new Map();

/**
 * Tell subscribers the full list of kinds currently waiting for an
 * answer, rather than just the one that arrived.
 *
 * ⚠️ This shape matters. An earlier version notified `(kind)` and the
 * sheet appended it to a queue of its own, which meant the sheet held a
 * COPY of this module's state and the two could disagree: settling an
 * ask elsewhere left the sheet still showing a prompt nobody was waiting
 * on. Sending the whole set makes the sheet a mirror instead of a copy,
 * so a cancellation, an answer and a new ask all correct it by the same
 * path.
 */
function notify() {
  const snapshot = [...pending.keys()];
  for (const cb of listeners) {
    try { cb(snapshot); } catch { /* a listener bug must not wedge an ask */ }
  }
}

/**
 * Subscribe to the set of kinds waiting for an answer. The callback gets
 * an array of kinds, newest last; an empty array means nothing is
 * pending. The sheet in Layout is the only subscriber today.
 *
 * Returns an unsubscribe function.
 */
export function onAiConsentRequested(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Answer a pending ask. Called by the sheet. A kind with no pending ask
 * is ignored, so a late click on a prompt that already timed out cannot
 * resolve someone else's request.
 *
 * @param {string} kind
 * @param {boolean} granted  true only when the row was actually stored
 */
export function resolveAiConsentRequest(kind, granted) {
  const entry = pending.get(kind);
  if (!entry) return;
  pending.delete(kind);
  entry.settle(granted === true);
  notify();
}

/**
 * Abandon every pending ask, answering each "no answer". The sheet calls
 * this on unmount so a route change during the prompt fails the request
 * instead of hanging it.
 */
export function cancelAllAiConsentRequests() {
  if (pending.size === 0) return;
  for (const kind of [...pending.keys()]) {
    const entry = pending.get(kind);
    pending.delete(kind);
    entry.settle(false);
  }
  notify();
}

/** Test seam. */
export function _pendingAskCount() {
  return pending.size;
}

/**
 * Raise the sheet for one kind and wait.
 *
 * Resolves false rather than hanging when nothing is listening: a
 * request that cannot be shown to the user cannot be consented to.
 * Concurrent callers for the same kind share one ask, so two surfaces
 * firing at once produce one sheet and two satisfied callers.
 */
function askConsent(kind) {
  if (listeners.size === 0) return Promise.resolve(false);

  const existing = pending.get(kind);
  if (existing) return existing.promise;

  let settle;
  const promise = new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      pending.delete(kind);
      resolve(false);
      // Tell the sheet, or it keeps showing a prompt for a request that
      // has already been failed.
      notify();
    }, ASK_TIMEOUT_MS);
    settle = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
  });

  pending.set(kind, { promise, settle });
  notify();
  return promise;
}

/**
 * DEV-only seam for looking at the sheet without a database.
 *
 * The real path needs three things that do not exist yet on a fresh
 * checkout: the ai_consents table, the ai_consent_enforced flag, and a
 * signed-in user. This lets the sheet be opened and photographed from the
 * console during development:
 *
 *   await window.__aiConsentAsk('ai_images')   // → true / false
 *
 * `import.meta.env.DEV` is replaced with `false` in a production build and
 * the branch is eliminated, the same mechanism that keeps the dev login
 * credentials out of the bundle. Verified by grepping dist/ for the name.
 */
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__aiConsentAsk = askConsent;
}

// ── enforcement ───────────────────────────────────────────────────────────

/** Resolve the signed-in user id without a network round trip. */
async function currentUserId() {
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Throws unless every consent this request needs is on record. Called by
 * aiRequest before the payload leaves the device.
 *
 * Error codes, so surfaces can tell the two apart:
 *   AI_CONSENT_DECLINED     the user said no, or dismissed the sheet
 *   AI_CONSENT_UNAVAILABLE  we could not read the consent record
 *
 * The anonymous case is a deliberate no-op rather than a block. There is
 * no path where an unauthenticated request reaches a provider: callEdgeProxy
 * throws NO_SESSION without a token, that error carries a `code`, and
 * aiRequest rethrows coded errors before the dev fallback. Blocking here
 * as well would only replace an accurate "sign in" message with a
 * misleading one about AI permissions.
 */
export async function requireAiConsent(body) {
  const enforced = await isFeatureEnabled(FLAG_KEY, { ignoreAdmin: true });
  if (!enforced) return;

  const kinds = kindsForRequest(body);
  if (kinds.length === 0) return;

  const userId = await currentUserId();
  if (!userId) return;

  const states = await fetchConsents(userId);

  for (const kind of kinds) {
    const state = states[kind];
    if (mayShare(state)) continue;

    if (state === DENIED) {
      throw declined(kind);
    }
    if (shouldAsk(state)) {
      const granted = await askConsent(kind);
      if (!granted) throw declined(kind);
      continue;
    }
    // UNKNOWN: the read failed. Fail closed, and say so plainly rather
    // than claiming the user refused something they were never shown.
    const e = new Error('לא הצלחנו לבדוק את הרשאת השיתוף. בדוק את החיבור ונסה שוב.');
    e.code = 'AI_CONSENT_UNAVAILABLE';
    e.consentKind = kind;
    e.retryable = false;
    throw e;
  }
}

// Both messages name the exact screen, which exists: Settings ->
// שירותי AI (src/pages/AiServices.jsx). Pointing at a screen that is not
// there would make a stored refusal a one-way door.
function declined(kind) {
  const e = new Error(
    kind === AI_IMAGES
      ? 'שליחת תמונות לשירות AI לא אושרה. אפשר לאשר בהגדרות, במסך שירותי AI, או למלא את הפרטים ידנית.'
      : 'שיתוף עם שירות AI לא אושר. אפשר לאשר בהגדרות, במסך שירותי AI.',
  );
  e.code = 'AI_CONSENT_DECLINED';
  e.consentKind = kind;
  // ⚠️ CONTRACT FOR RETRY WRAPPERS. A provider 429 or a cold start is
  // worth a second attempt; an answer about privacy is not. Any code that
  // automatically re-calls aiRequest after a throw MUST stop on
  // retryable === false, or dismissing the sheet makes it reappear
  // instantly, which is the harassment pattern §6 of the UX doc rules
  // out and store review reads as coercion. PlateScanButton is the one
  // automatic retry in the app today; AiAssistant's retry is a button the
  // user presses, so re-asking there is correct.
  e.retryable = false;
  return e;
}
