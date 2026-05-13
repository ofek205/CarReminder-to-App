// ═══════════════════════════════════════════════════════════════════════════
// securityLog — structured logging for security-relevant Edge Function
// events. Writes single-line JSON to stderr so Supabase's Function Logs
// surface it as a queryable record.
//
// Why structured logs:
//   Supabase's log viewer can grep across functions, filter by JSON keys,
//   and time-bucket. Free-form `console.error('not an admin: ' + id)`
//   strings are great for one-off debugging but useless for "show me
//   all permission denied events from the last 24 hours across all
//   functions" — which is the actual operational need.
//
// Event taxonomy (consistent across all Edge Functions):
//   auth_failed         — missing / invalid / expired token
//   permission_denied   — token valid but caller is not authorised
//   rate_limit_hit      — per-user limit exceeded
//   rate_limit_error    — the rate-limit RPC itself errored (fail-closed)
//   ssrf_rejected       — fetch_url blocked by hostname allow-list
//   payload_rejected    — input failed format / size validation
//
// To query later (Supabase Dashboard → Logs → Edge Function Logs):
//   message: "security_event" AND payload.event: "permission_denied"
// ═══════════════════════════════════════════════════════════════════════════

export type SecurityEvent =
  | 'auth_failed'
  | 'permission_denied'
  | 'rate_limit_hit'
  | 'rate_limit_error'
  | 'ssrf_rejected'
  | 'payload_rejected';

/**
 * Emit a single structured security log line.
 *
 * @param fn      The Edge Function name (so logs from multiple functions
 *                stay distinguishable in the aggregated viewer).
 * @param event   One of the SecurityEvent strings above.
 * @param details Free-form metadata. Avoid raw tokens / passwords / PII;
 *                IDs and reason codes are fine.
 *
 * Output shape:
 *   {"_": "security_event", "fn": "...", "event": "...", "ts": "...", ...details}
 *
 * The leading `_` key is a sentinel that makes the line easy to grep for
 * in mixed log streams. Going through console.warn instead of
 * console.error so it doesn't trip Supabase's "function errored" badge.
 */
export function logSecurityEvent(
  fn: string,
  event: SecurityEvent,
  details: Record<string, unknown> = {},
): void {
  // Strip undefined values so the line is compact and grep-friendly.
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v !== undefined && v !== null) safe[k] = v;
  }
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({
    _:      'security_event',
    fn,
    event,
    ts:     new Date().toISOString(),
    ...safe,
  }));
}
