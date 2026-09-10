import { describe, it, expect } from 'vitest';
import {
  DOC_OR_IMAGE_ACCEPT,
  acceptsNonImage,
  isPdfFileRef,
  dataUrlMimeType,
  ALLOWED_DOC_MIME_TYPES,
} from './securityUtils';

/**
 * Regression cover for "Android only lets me pick a photo, never a PDF"
 * (2026-09-09).
 *
 * Two separate causes, neither of which build or lint can see:
 *
 * 1. ORDER. Android WebView builds the chooser intent with
 *    setType(accept[0]) and nothing more; Capacitor passes the rest as
 *    EXTRA_MIME_TYPES. Since Android 13 the platform hijacks an
 *    ACTION_GET_CONTENT carrying a media type and routes it to the system
 *    photo picker, which can only return images and videos. Confirmed on
 *    an API 34 emulator: type=image/* resolved to
 *    PhotoPickerGetContentActivity, type=application/pdf resolved to
 *    DocumentsUI PickActivity. So a list that merely CONTAINS
 *    application/pdf is not enough. It has to come first.
 *
 * 2. The native gallery shortcut ignoring `accept` altogether.
 *
 * Both are invisible to every other gate in the project: the strings are
 * valid, the types check out, the app builds. Only an assertion on the
 * ordering itself keeps a future tidy-up from silently undoing this.
 */

describe('DOC_OR_IMAGE_ACCEPT', () => {
  it('leads with a non-media type so Android opens the document picker', () => {
    const first = DOC_OR_IMAGE_ACCEPT.split(',')[0].trim();
    // The whole bug in one assertion. Do not relax this to a
    // "contains application/pdf" check.
    expect(first.startsWith('image/')).toBe(false);
    expect(first.startsWith('video/')).toBe(false);
    expect(first).toBe('application/pdf');
  });

  it('still offers images, which DocumentsUI honours via EXTRA_MIME_TYPES', () => {
    expect(DOC_OR_IMAGE_ACCEPT).toContain('image/*');
  });

  it('only promises what validateUploadFile will actually accept', () => {
    // A picker that offers a type the validator rejects just moves the
    // failure one step later, into a toast the user cannot act on.
    expect(ALLOWED_DOC_MIME_TYPES).toContain('application/pdf');
    expect(ALLOWED_DOC_MIME_TYPES.some(m => m.startsWith('image/'))).toBe(true);
  });
});

describe('acceptsNonImage', () => {
  it('sends document-capable callers to the real file input', () => {
    expect(acceptsNonImage(DOC_OR_IMAGE_ACCEPT)).toBe(true);
    expect(acceptsNonImage('image/*,application/pdf')).toBe(true);
    expect(acceptsNonImage('image/*,.pdf')).toBe(true);
    expect(acceptsNonImage('.xlsx,.csv')).toBe(true);
  });

  it('lets image-only callers keep the nicer native gallery picker', () => {
    // AddVehicle passes "image/*" on purpose: a vehicle photo is never a
    // PDF, and the plugin gives resizing plus orientation correction.
    expect(acceptsNonImage('image/*')).toBe(false);
    expect(acceptsNonImage('image/jpeg,image/png')).toBe(false);
    expect(acceptsNonImage('.jpg,.jpeg,.png')).toBe(false);
  });

  it('is not fooled by whitespace, case, or a trailing comma', () => {
    expect(acceptsNonImage(' IMAGE/JPEG , .PNG ')).toBe(false);
    expect(acceptsNonImage('image/*,')).toBe(false);
    expect(acceptsNonImage(' image/* , application/pdf ')).toBe(true);
  });

  it('treats an absent accept as image-only rather than throwing', () => {
    // No accept means the caller expressed no document intent, so the
    // gallery shortcut stays. Must not crash on undefined.
    expect(acceptsNonImage(undefined)).toBe(false);
    expect(acceptsNonImage('')).toBe(false);
  });
});

describe('isPdfFileRef', () => {
  it('recognises a freshly picked file, which arrives as a data URL', () => {
    expect(isPdfFileRef('data:application/pdf;base64,JVBERi0x')).toBe(true);
    expect(isPdfFileRef('data:image/webp;base64,UklGRg')).toBe(false);
    // compressImage prefers WebP, so this is the common real case.
    expect(isPdfFileRef('data:image/jpeg;base64,/9j/4AA')).toBe(false);
  });

  it('recognises a stored record, which arrives as a URL', () => {
    expect(isPdfFileRef('https://x.supabase.co/o/receipts/a.pdf')).toBe(true);
    expect(isPdfFileRef('https://x.supabase.co/o/receipts/a.PDF?token=e30')).toBe(true);
    expect(isPdfFileRef('https://x.supabase.co/o/receipts/a.jpg?token=e30')).toBe(false);
  });

  it('leaves an unrecognisable reference rendering as an image', () => {
    // Deliberate: every receipt stored before PDFs were allowed is an
    // image, so an extensionless URL must keep its thumbnail rather than
    // regress to a file pill. Only a positive PDF signal switches it.
    expect(isPdfFileRef('https://x.supabase.co/o/receipts/abc123')).toBe(false);
    expect(isPdfFileRef(null)).toBe(false);
    expect(isPdfFileRef(undefined)).toBe(false);
    expect(isPdfFileRef('')).toBe(false);
  });

  it('does not fire on a pdf that is only part of the path', () => {
    // "pdf" inside a directory or filename stem is not a PDF file.
    expect(isPdfFileRef('https://x.supabase.co/pdf/receipt.jpg')).toBe(false);
    expect(isPdfFileRef('https://x.supabase.co/o/my-pdf-scan.png')).toBe(false);
  });
});

describe('dataUrlMimeType', () => {
  // The receipt scan used to do
  // `startsWith('data:image/png') ? 'image/png' : 'image/jpeg'`, which
  // mislabelled every WebP compressImage produces and would have called a
  // PDF a JPEG. The proxy forwards media_type to Gemini as inline_data
  // mime_type, so a wrong label is wrong on the wire.
  it('reads the real type instead of guessing', () => {
    expect(dataUrlMimeType('data:image/webp;base64,UklGRg')).toBe('image/webp');
    expect(dataUrlMimeType('data:image/png;base64,iVBOR')).toBe('image/png');
    expect(dataUrlMimeType('data:application/pdf;base64,JVBERi0x')).toBe('application/pdf');
  });

  it('handles a data URL with no base64 marker', () => {
    expect(dataUrlMimeType('data:application/pdf,rawbytes')).toBe('application/pdf');
  });

  it('falls back to jpeg on bad input rather than sending an empty type', () => {
    expect(dataUrlMimeType('not-a-data-url')).toBe('image/jpeg');
    expect(dataUrlMimeType('')).toBe('image/jpeg');
    expect(dataUrlMimeType(undefined)).toBe('image/jpeg');
  });

  it('only ever claims a type the document allowlist permits', () => {
    for (const url of [
      'data:image/webp;base64,x',
      'data:image/png;base64,x',
      'data:application/pdf;base64,x',
      'garbage',
    ]) {
      expect(ALLOWED_DOC_MIME_TYPES).toContain(dataUrlMimeType(url));
    }
  });
});
