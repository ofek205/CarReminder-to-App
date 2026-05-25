// ═══════════════════════════════════════════════════════════════════════════
// reportEdgeError — persists Edge Function runtime errors to the
// public.app_errors table so they show up in the AdminDashboard Bugs tab
// alongside frontend errors.
//
// Why this exists:
//   Before this helper, the only record of an Edge Function crash was a
//   line in Supabase's Function Logs (24h retention on the free tier).
//   After 24h: gone. The admin had no visibility into "the reminder
//   dispatcher failed 12 times yesterday" — only frontend crashes were
//   queryable. This closes that gap.
//
// What it captures (mirrors the frontend crashReporter v2 schema):
//   type        — 'edge'
//   message     — error.message
//   stack       — error.stack
//   route       — the function's POST URL (so we can group "all errors
//                 from /dispatch-reminder-emails")
//   action      — caller-supplied label ("send_welcome_email", "tick")
//   severity    — 'critical' | 'error' | 'warning' (caller chooses)
//   visible     — false (Edge errors are never directly user-visible)
//   user_id     — if known (e.g., when the function was triggered for a
//                 specific user)
//   app_version — function name + version comment (best-effort)
//   extra       — free-form context (payload, partial response, etc.)
//
// Best-effort by design:
//   The helper swallows its own errors. If the insert fails (RLS, network,
//   the table doesn't exist yet), the original Edge Function continues
//   without disruption. We do NOT want a logging failure to break the
//   actual workload.
//
// Usage:
//   import { reportEdgeError } from '../_shared/reportEdgeError.ts';
//   try {
//     await doWork();
//   } catch (err) {
//     await reportEdgeError({
//       fn: 'dispatch-reminder-emails',
//       action: 'send_batch',
//       error: err,
//       severity: 'error',
//       userId: someUserId,    // optional
//       extra: { batchSize: 50, sentSoFar: 12 },
//     });
//     throw err;  // re-throw so the function still returns 500
//   }
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Singleton service-role client. Edge Functions are short-lived but a
// single function can call reportEdgeError multiple times in one run
// (per-batch error handling), so we cache the client.
let cachedClient: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (cachedClient) return cachedClient;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  cachedClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

export type EdgeErrorReport = {
  /** Edge function name — keep stable across deploys for grouping. */
  fn: string;
  /** What was the function trying to do? Short label. */
  action?: string;
  /** The thrown Error (preferred) or any value that has .message. */
  error: unknown;
  /** Triage severity. Default 'error'. */
  severity?: 'critical' | 'error' | 'warning' | 'info';
  /** Affected user, if the function was scoped to one. */
  userId?: string | null;
  /** Free-form context — keep small, no secrets. */
  extra?: Record<string, unknown> | null;
};

/**
 * Persist an Edge Function error to public.app_errors.
 *
 * Returns void; never throws — best-effort logging that must not
 * destabilise the calling function. If something goes wrong (no env
 * vars, table missing, RLS denial), the error is also logged to stderr
 * as a structured line so it still surfaces in Supabase Function Logs
 * as a fallback.
 */
export async function reportEdgeError(report: EdgeErrorReport): Promise<void> {
  const { fn, action, error, severity = 'error', userId = null, extra = null } = report;

  // Normalise the error into the columns app_errors expects.
  const err = error as { message?: string; stack?: string } | null;
  const message = (err?.message || String(error) || 'unknown').slice(0, 500);
  const stack = (err?.stack || '').slice(0, 2000) || null;

  // Always echo to stderr first — guarantees the error appears in
  // Function Logs even if the table insert fails.
  try {
    console.error(JSON.stringify({
      _: 'edge_error',
      fn,
      action: action ?? null,
      severity,
      message,
      user_id: userId,
      ts: new Date().toISOString(),
    }));
  } catch {
    // console.error itself failed (extremely unlikely on Deno).
  }

  const client = getClient();
  if (!client) return;

  // Insert into app_errors. The v2 schema (supabase-app-errors-v2.sql)
  // has all the columns we want. We rely on it; if the migration hasn't
  // been run yet, this insert fails silently and we already wrote the
  // stderr line above.
  try {
    await client.from('app_errors').insert({
      type: 'edge',
      message,
      stack,
      url: `edge:/${fn}`,
      route: `edge:/${fn}`,
      action: action ?? null,
      severity,
      visible: false,
      app_version: 'edge',
      user_agent: 'edge-function',
      user_id: userId,
      extra: extra ? { fn, ...extra } : { fn },
      created_at: new Date().toISOString(),
    });
  } catch {
    // Table missing / RLS / network — we already logged to stderr.
  }
}
