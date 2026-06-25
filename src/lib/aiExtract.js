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

  if (error) return { status: 'error', details: error.message || 'Edge function error' };
  if (!data)  return { status: 'error', details: 'Empty response' };
  return data; // already in { status, output | details } shape
}
