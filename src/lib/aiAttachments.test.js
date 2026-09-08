import { describe, it, expect } from 'vitest';
import { buildChatAttachmentGuide } from './aiExpert';
import { VISION_IMAGE_MIME } from './aiProxy';

/**
 * Regression cover for the two failures behind "the expert doesn't read
 * my images" (2026-09-08).
 *
 * Neither was a transport bug. ai_usage_logs proved the image reached
 * Gemini — had_attachment=true, provider=gemini, ~3.2k prompt tokens
 * against ~1.8k for a text-only turn — and the answer ignored it. Build
 * and lint cannot see either failure: one is the CONTENT of a prompt
 * string, the other is a mime allowlist that had drifted between two
 * call sites. That is exactly what the CI vitest job is for.
 */

describe('buildChatAttachmentGuide', () => {
  it('tells the model the attachment is the subject, not a garnish', () => {
    const guide = buildChatAttachmentGuide(true);
    // The failure mode was answering as though nothing was attached.
    expect(guide).toContain('אל תתעלם');
    expect(guide).toContain('לא צורף דבר');
  });

  it('orders the answer before any follow-up question', () => {
    const guide = buildChatAttachmentGuide(true);
    const answerAt   = guide.indexOf('תן את האבחנה');
    const questionAt = guide.indexOf('שאל שאלה אחת');
    expect(answerAt).toBeGreaterThan(-1);
    expect(questionAt).toBeGreaterThan(-1);
    // Answer first. Reversing these is what made an attached photo
    // produce an interrogation about the photo.
    expect(answerAt).toBeLessThan(questionAt);
  });

  it('never demands a better file as a precondition for answering', () => {
    const guide = buildChatAttachmentGuide(true);
    expect(guide).toContain('אל תבקש תמונה אחרת כתנאי');
  });

  it('switches its noun for a PDF instead of calling it a photo', () => {
    const pdf = buildChatAttachmentGuide(false);
    expect(pdf).toContain('מסמך');
    expect(pdf).not.toContain('צורפה תמונה');
  });
});

describe('VISION_IMAGE_MIME', () => {
  it.each(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])(
    'accepts %s, which the vision providers read',
    (mime) => expect(VISION_IMAGE_MIME.test(mime)).toBe(true),
  );

  // HEIC is the one that mattered: it is the default for iPhone library
  // photos, `image/*` accepted it, and Gemini answered 400. Because
  // hasImages was true server-side the auto-ladder then skipped the
  // text-only Groq fallback, so the user saw a bare "שירות ה-AI לא זמין"
  // that blamed the service rather than the file.
  it.each(['image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/svg+xml', 'image/tiff'])(
    'rejects %s, which no provider in the ladder reads',
    (mime) => expect(VISION_IMAGE_MIME.test(mime)).toBe(false),
  );

  it('does not match non-images that merely contain an image type', () => {
    expect(VISION_IMAGE_MIME.test('application/pdf')).toBe(false);
    expect(VISION_IMAGE_MIME.test('text/html;image/png')).toBe(false);
  });
});
