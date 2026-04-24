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

export async function extractDataFromUploadedFile({ file_url, json_schema, instructions }) {
  if (!file_url) return { status: 'error', details: 'Missing file_url' };
  if (!json_schema) return { status: 'error', details: 'Missing json_schema' };

  const { data, error } = await supabase.functions.invoke('ai-proxy', {
    body: {
      mode: 'extract_document',
      file_url,
      json_schema,
      instructions,
    },
  });

  if (error) return { status: 'error', details: error.message || 'Edge function error' };
  if (!data)  return { status: 'error', details: 'Empty response' };
  return data; // already in { status, output | details } shape
}
