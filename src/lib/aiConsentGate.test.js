import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestCarriesImage, kindsForRequest, requireAiConsent } from './aiConsentGate';
import { AI_TEXT, AI_IMAGES } from './aiConsent';

// Mocked so the enforcement decisions can be tested without a database.
// The classification tests below need none of this.
const flagEnabled = vi.fn();
const consents = vi.fn();

vi.mock('./featureFlags', () => ({
  isFeatureEnabled: (...a) => flagEnabled(...a),
}));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) } },
}));
vi.mock('./aiConsent', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchConsents: (...a) => consents(...a),
}));

// Bodies copied from the shapes the real call sites build, so these tests
// break if a call site changes shape rather than passing on a fiction.
const chatTextOnly = {
  feature: 'yossi_chat',
  system: 'אתה ברוך...',
  messages: [
    { role: 'user', content: 'יש רעש מהגלגל הקדמי' },
    { role: 'assistant', content: 'מאיזה צד?' },
    { role: 'user', content: [{ type: 'text', text: 'שמאל' }] },
  ],
};

// AiAssistant.jsx: `type: attachment.isImage ? 'image' : 'document'`
const chatWithPhoto = {
  feature: 'yossi_chat',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'מה רשום כאן?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      ],
    },
  ],
};

const chatWithPdf = {
  feature: 'yossi_chat',
  messages: [
    {
      role: 'user',
      content: [{ type: 'document', source: { type: 'base64', data: 'AAAA' } }],
    },
  ],
};

const scanRequest = {
  feature: 'scan_extraction',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'חלץ את השדות מהמסמך' },
        { type: 'image', source: { type: 'base64', data: 'AAAA' } },
      ],
    },
  ],
};

describe('requestCarriesImage', () => {
  it('is false for a text-only conversation', () => {
    expect(requestCarriesImage(chatTextOnly)).toBe(false);
  });

  it('is true when a photo is attached to a chat message', () => {
    expect(requestCarriesImage(chatWithPhoto)).toBe(true);
  });

  it('treats a document the same as an image', () => {
    // A photographed licence uploaded as a PDF is not less personal than
    // the same licence as a JPEG.
    expect(requestCarriesImage(chatWithPdf)).toBe(true);
  });

  // ── fail-closed: every unreadable shape counts as carrying an image ──
  //
  // These are the cases where being wrong is silent. A false negative
  // here does not throw, it sends a photograph under the text consent.

  it('treats an unrecognised part type as an image', () => {
    // The guess that protects the user: a part shape this app has never
    // seen is likelier to be a new attachment kind than a new kind of
    // plain text.
    const future = { messages: [{ role: 'user', content: [{ type: 'video', source: {} }] }] };
    expect(requestCarriesImage(future)).toBe(true);
  });

  it('treats a malformed body as carrying an image', () => {
    expect(requestCarriesImage(null)).toBe(true);
    expect(requestCarriesImage(undefined)).toBe(true);
    expect(requestCarriesImage('nonsense')).toBe(true);
    expect(requestCarriesImage({})).toBe(true);
    expect(requestCarriesImage({ messages: 'nope' })).toBe(true);
    expect(requestCarriesImage({ messages: [{ role: 'user', content: 42 }] })).toBe(true);
    expect(requestCarriesImage({ messages: [{ role: 'user', content: [{ text: 'no type' }] }] })).toBe(true);
  });

  it('tolerates an empty turn without calling it an image', () => {
    // Null content is a harmless artefact of history mapping, not an
    // attachment. Reading it as one would prompt for image consent on a
    // plain typed question.
    expect(requestCarriesImage({ messages: [{ role: 'user', content: null }] })).toBe(false);
    expect(requestCarriesImage({ messages: [] })).toBe(false);
  });
});

describe('kindsForRequest', () => {
  it('needs only text consent for a typed question', () => {
    expect(kindsForRequest(chatTextOnly)).toEqual([AI_TEXT]);
  });

  it('needs BOTH when a chat message carries a photo', () => {
    // The hole a feature -> kind map would leave open: someone who
    // granted text consent and refused images could still ship a
    // photographed licence through the chat attachment.
    expect(kindsForRequest(chatWithPhoto)).toEqual([AI_TEXT, AI_IMAGES]);
  });

  it('needs only image consent for a scan', () => {
    // The message text in an extraction request is our instruction, not
    // the user's words. Asking for text consent too would show a second
    // sheet for one scan.
    expect(kindsForRequest(scanRequest)).toEqual([AI_IMAGES]);
  });

  it('needs only image consent for a plate scan', () => {
    const plate = {
      feature: 'plate_scan',
      messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'A' } }] }],
    };
    expect(kindsForRequest(plate)).toEqual([AI_IMAGES]);
  });

  it('needs text consent for an untagged call site', () => {
    // PostCreateDialog and lib/aiAdvice send no `feature`. They must be
    // covered without anyone remembering to tag them.
    const untagged = { messages: [{ role: 'user', content: 'מה דעתך?' }] };
    expect(kindsForRequest(untagged)).toEqual([AI_TEXT]);
  });

  it('needs both for an untagged call site that sends an image', () => {
    const untagged = {
      messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'A' } }] }],
    };
    expect(kindsForRequest(untagged)).toEqual([AI_TEXT, AI_IMAGES]);
  });

  it('never returns an empty list for a malformed body', () => {
    // An empty list means "no permission needed", which for a body we
    // could not parse is the one answer that must be impossible.
    expect(kindsForRequest(null).length).toBeGreaterThan(0);
    expect(kindsForRequest({}).length).toBeGreaterThan(0);
  });

  it('does not let an unknown feature skip the text consent', () => {
    // Only the two extraction features are exempt. A new feature name,
    // including a typo of an existing one, needs text consent.
    expect(kindsForRequest({ feature: 'scan_extractio', messages: [] })).toContain(AI_TEXT);
    expect(kindsForRequest({ feature: 'brand_new_thing', messages: [] })).toContain(AI_TEXT);
  });
});

describe('requireAiConsent', () => {
  beforeEach(() => {
    flagEnabled.mockReset();
    consents.mockReset();
  });

  const textOnly = { feature: 'yossi_chat', messages: [{ role: 'user', content: 'שאלה' }] };

  it('does nothing at all while the flag is off', async () => {
    flagEnabled.mockResolvedValue(false);
    await expect(requireAiConsent(textOnly)).resolves.toBeUndefined();
    // Must not even read the consent table: before the migration is
    // applied that read fails, and a flag that is off has to mean the
    // whole feature is absent rather than merely quiet.
    expect(consents).not.toHaveBeenCalled();
  });

  it('reads the flag with ignoreAdmin, never the admin bypass', async () => {
    // The bypass would enrol admins in a fail-closed restriction before
    // anyone turned it on, and take AI away from them in production.
    flagEnabled.mockResolvedValue(false);
    await requireAiConsent(textOnly);
    expect(flagEnabled).toHaveBeenCalledWith(expect.any(String), { ignoreAdmin: true });
  });

  it('passes silently when the consent is granted', async () => {
    flagEnabled.mockResolvedValue(true);
    consents.mockResolvedValue({ [AI_TEXT]: 'granted', [AI_IMAGES]: 'granted' });
    await expect(requireAiConsent(textOnly)).resolves.toBeUndefined();
  });

  it('throws a NON-RETRYABLE error when the user declined', async () => {
    flagEnabled.mockResolvedValue(true);
    consents.mockResolvedValue({ [AI_TEXT]: 'denied', [AI_IMAGES]: 'denied' });
    const err = await requireAiConsent(textOnly).catch((e) => e);
    expect(err.code).toBe('AI_CONSENT_DECLINED');
    // The contract PlateScanButton relies on. Without it an automatic
    // retry re-raises the sheet the instant the user dismisses it.
    expect(err.retryable).toBe(false);
  });

  it('throws a NON-RETRYABLE error when the consent could not be read', async () => {
    flagEnabled.mockResolvedValue(true);
    consents.mockResolvedValue({ [AI_TEXT]: 'unknown', [AI_IMAGES]: 'unknown' });
    const err = await requireAiConsent(textOnly).catch((e) => e);
    expect(err.code).toBe('AI_CONSENT_UNAVAILABLE');
    expect(err.retryable).toBe(false);
  });

  it('blocks a photo in chat when only text was granted', async () => {
    // The hole a feature -> kind map would leave: text consent carrying
    // a photographed licence through the chat attachment.
    flagEnabled.mockResolvedValue(true);
    consents.mockResolvedValue({ [AI_TEXT]: 'granted', [AI_IMAGES]: 'denied' });
    const withPhoto = {
      feature: 'yossi_chat',
      messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'A' } }] }],
    };
    const err = await requireAiConsent(withPhoto).catch((e) => e);
    expect(err.code).toBe('AI_CONSENT_DECLINED');
    expect(err.consentKind).toBe(AI_IMAGES);
  });
});
