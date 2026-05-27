/**
 * Timeout wrapper for Supabase calls.
 *
 * Background: a Supabase query that hangs (network stall, WKWebView
 * session-bridge wedge, slow PG plan) leaves React Query's `isLoading`
 * true forever. Pages that gate their spinner on `isLoading` end up
 * stuck on a loading screen that never resolves. We patched this for
 * useWorkspaces (commit e106f36) but the same hazard exists in every
 * page-level query that hits Supabase. This wrapper makes the timeout
 * pattern available to every call site so we never bake another
 * "stuck on loading" into the app.
 *
 * Usage — wrap the supabase builder, then await as usual:
 *
 *   const { data, error } = await withTimeout(
 *     supabase.from('my_vehicles_v').select('*'),
 *     'my_vehicles_v'
 *   );
 *
 * If the underlying request takes longer than the timeout the wrapper
 * rejects with `Error("supabase query timeout: <label>")`. React Query
 * then surfaces `isError = true` and the page can render its retry
 * fallback instead of an infinite spinner.
 *
 * The check-query-timeouts gate (scripts/check-query-timeouts.cjs)
 * blocks any new useQuery/queryFn that talks to Supabase without going
 * through this helper or an inline Promise.race.
 */

export const DEFAULT_SUPABASE_TIMEOUT_MS = 8000;

// Slow query threshold — anything taking longer than this is logged as
// a `type='slow_query'` row in app_errors so the admin can see "this
// query is degrading" BEFORE it crosses the 8s timeout and breaks the
// user experience. Raised from 3s → 5s: on mobile networks 3-5s is
// normal latency and was generating noise that obscured real problems
// (the 30× redundant user_profiles issue was hidden among hundreds of
// benign slow-network entries). 5s is closer to "actually degraded".
const SLOW_QUERY_THRESHOLD_MS = 5000;

// Per-label cooldown — once a slow-query alert fires for a given label,
// suppress duplicates for 5 minutes. Prevents alert storms when a user
// sits on a slow connection and every page load re-triggers the same
// slow query (we saw 30× user_profiles.filter in 15 min).
const SLOW_QUERY_COOLDOWN_MS = 5 * 60 * 1000;
const _slowQueryLastFired = {};

export function withTimeout(promise, label = 'supabase query', ms = DEFAULT_SUPABASE_TIMEOUT_MS) {
  const startedAt = Date.now();
  const timeoutPromise = new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(`supabase query timeout: ${label}`)), ms)
  );
  return Promise.race([promise, timeoutPromise]).finally(() => {
    // Slow-query telemetry — fire-and-forget. Runs whether the query
    // resolved, rejected, or timed out (`finally` is unconditional).
    // We don't log the timeout case here (that's already a hard error
    // path that goes through React Query → user sees an error state).
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_QUERY_THRESHOLD_MS && elapsed < ms) {
      // Per-label cooldown: skip if we already reported this label recently.
      const now = Date.now();
      if (_slowQueryLastFired[label] && now - _slowQueryLastFired[label] < SLOW_QUERY_COOLDOWN_MS) {
        return; // suppress duplicate — already reported within cooldown window
      }
      _slowQueryLastFired[label] = now;
      // Lazy-import to avoid a circular dep + keep this file zero-runtime
      // when the threshold isn't crossed (the import is the expensive bit).
      // dynamic import is cached after first hit so subsequent slow queries
      // pay nothing extra.
      import('./crashReporter').then(({ reportError }) => {
        try {
          reportError('slow_query', new Error(`slow query: ${label} (${elapsed}ms)`), {
            action: 'supabase_query',
            severity: 'warning',
            visible: false,
            label,
            elapsed_ms: elapsed,
          });
        } catch { /* fire-and-forget */ }
      }).catch(() => { /* lazy import itself failed — ignore */ });
    }
  });
}
