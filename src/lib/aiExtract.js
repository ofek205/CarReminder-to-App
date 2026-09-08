/**
 * aiExtract — client-side wrapper for document extraction.
 *
 * Replaces base44.integrations.Core.ExtractDataFromUploadedFile. Sends the
 * signed file URL + a JSON schema to our ai-proxy Edge Function (mode:
 * 'extract_document'), which fetches the file server-side, hands it to
 * Gemini, and returns the parsed fields.
 *
 * Return shape mirrors Base44's original API:
 *   { status: 'success', output: {...} }
 *   { status: 'error',   details: '...' }
 */
import { supabase } from './supabase';
import { withTimeout } from './supabaseQuery';
import { emitAiScanDisabled } from './aiScanGate';

/**
 * Read the JSON body out of a supabase-js FunctionsHttpError.
 *
 * Needed because invoke() does NOT put a non-2xx response in `data` —
 * it nulls `data` and wraps the Response in `error.context`. The scan
 * kill switch answers 403 and carries its reason in the BODY, so
 * without this the reason is dropped and a deliberate "temporarily
 * disabled" degrades into a generic "we could not read the file".
 *
 * Returns null on anything unexpected: a non-JSON body, an already
 * consumed stream, or an older supabase-js that shapes errors
 * differently. Callers must treat null as "no extra information".
 */
async function readEdgeErrorBody(error) {
  try {
    const res = error?.context;
    if (res && typeof res.json === 'function') return await res.json();
  } catch { /* not JSON, or the stream was already read */ }
  return null;
}

export async function extractDataFromUploadedFile({ file_url, json_schema, instructions, surface }) {
  if (!file_url) return { status: 'error', details: 'Missing file_url' };
  if (!json_schema) return { status: 'error', details: 'Missing json_schema' };

  // Cap the edge-function call so a wedged request surfaces as an error the
  // scan UI can recover from, instead of leaving the spinner stuck forever
  // (audit ב-20). 45s — AI extraction is legitimately slow, so this is well
  // above the 8s default but still bounded.
  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.functions.invoke('ai-proxy', {
        body: {
          mode: 'extract_document',
          file_url,
          json_schema,
          instructions,
          // Surface tag — see ALLOWED_SURFACES in ai-proxy/index.ts. Optional;
          // the server validates and drops unknown values to NULL.
          surface,
        },
      }),
      'ai_extract_document',
      45000,
    ));
  } catch (e) {
    return { status: 'error', details: e?.message || 'Edge function timeout' };
  }

  // The scan kill switch (app_config.scan_extraction_enabled) is
  // enforced server-side for this path, because invoke() bypasses the
  // client gate that aiRequest applies. Surface it as the global
  // "currently unavailable" explainer rather than letting each of the
  // four call sites report a generic read failure — the user needs to
  // know the service is off, not think their document was unreadable.
  //
  // Checked on BOTH shapes on purpose: the flag path answers 403 (body
  // in error.context), while other soft errors in this Edge Function
  // answer 200 with the envelope in `data`. Keying on the code in both
  // places means a future status change cannot silently break this.
  if (error) {
    const body = await readEdgeErrorBody(error);
    if (body?.code === 'SCAN_EXTRACTION_DISABLED') {
      emitAiScanDisabled();
      return { status: 'error', code: body.code, details: body.details || 'שירות הסריקה מושבת זמנית.' };
    }
    return { status: 'error', details: body?.details || error.message || 'Edge function error' };
  }
  if (!data)  return { status: 'error', details: 'Empty response' };
  if (data?.code === 'SCAN_EXTRACTION_DISABLED') emitAiScanDisabled();
  return data; // already in { status, output | details } shape
}
