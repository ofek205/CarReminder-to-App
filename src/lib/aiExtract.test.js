import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cover for the server-side half of the scan kill switch (2026-09-08).
 *
 * Background: app_config.scan_extraction_enabled was enforced only
 * inside aiRequest, so the four surfaces that reach the Edge Function
 * through supabase.functions.invoke('ai-proxy', { mode:
 * 'extract_document' }) ignored it completely — personal and business
 * receipts, vessel licence, driver licence. Flipping the flag stopped
 * half the system while the dashboard read "off".
 *
 * The subtle part these tests exist for: invoke() does NOT put a
 * non-2xx response in `data`. It nulls `data` and hands back a
 * FunctionsHttpError with the Response in `error.context`. A naive
 * `if (error) return { details: error.message }` therefore DROPS the
 * reason, and a deliberate "temporarily disabled" reaches the user as
 * "we could not read your document".
 */

const invoke = vi.fn();
const emitAiScanDisabled = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: (...args) => invoke(...args) } },
}));
vi.mock('./aiScanGate', () => ({
  emitAiScanDisabled: (...args) => emitAiScanDisabled(...args),
}));
// Pass the promise straight through — the real helper drags in slow-query
// telemetry, which is not what is under test here.
vi.mock('./supabaseQuery', () => ({ withTimeout: (p) => p }));

const { extractDataFromUploadedFile } = await import('./aiExtract');

const ARGS = { file_url: 'https://x.supabase.co/storage/v1/object/sign/a', json_schema: { type: 'object' } };

/** A FunctionsHttpError as supabase-js v2 actually shapes it. */
const httpError = (body) => ({
  data: null,
  error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: { json: async () => body },
  }),
});

beforeEach(() => {
  invoke.mockReset();
  emitAiScanDisabled.mockReset();
});

describe('extractDataFromUploadedFile — kill switch', () => {
  it('raises the global explainer when a 403 carries the disabled code', async () => {
    invoke.mockResolvedValue(httpError({
      status: 'error', code: 'SCAN_EXTRACTION_DISABLED', details: 'שירות הסריקה מושבת זמנית.',
    }));

    const res = await extractDataFromUploadedFile(ARGS);

    expect(emitAiScanDisabled).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('error');
    // The code must survive, or callers cannot tell policy from failure.
    expect(res.code).toBe('SCAN_EXTRACTION_DISABLED');
  });

  it('also honours the code on a 200 envelope, so a status change cannot break it', async () => {
    invoke.mockResolvedValue({
      data: { status: 'error', code: 'SCAN_EXTRACTION_DISABLED', details: 'x' }, error: null,
    });

    await extractDataFromUploadedFile(ARGS);

    expect(emitAiScanDisabled).toHaveBeenCalledTimes(1);
  });

  it('does NOT raise the explainer for an ordinary edge failure', async () => {
    invoke.mockResolvedValue(httpError({ status: 'error', details: 'AI call failed: 429' }));

    const res = await extractDataFromUploadedFile(ARGS);

    expect(emitAiScanDisabled).not.toHaveBeenCalled();
    expect(res.status).toBe('error');
    // Prefers the body's detail over the opaque wrapper message.
    expect(res.details).toBe('AI call failed: 429');
  });

  it('survives an unreadable error body instead of throwing', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('boom'), {
        context: { json: async () => { throw new Error('already consumed'); } },
      }),
    });

    const res = await extractDataFromUploadedFile(ARGS);

    expect(emitAiScanDisabled).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'error', details: 'boom' });
  });

  it('passes a successful extraction through untouched', async () => {
    invoke.mockResolvedValue({ data: { status: 'success', output: { amount: 250 } }, error: null });

    const res = await extractDataFromUploadedFile(ARGS);

    expect(emitAiScanDisabled).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'success', output: { amount: 250 } });
  });

  it('rejects missing arguments before touching the network', async () => {
    expect((await extractDataFromUploadedFile({ json_schema: {} })).status).toBe('error');
    expect((await extractDataFromUploadedFile({ file_url: 'https://x.supabase.co/a' })).status).toBe('error');
    expect(invoke).not.toHaveBeenCalled();
  });
});
