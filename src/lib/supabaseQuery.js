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

export function withTimeout(promise, label = 'supabase query', ms = DEFAULT_SUPABASE_TIMEOUT_MS) {
  const timeoutPromise = new Promise((_resolve, reject) =>
    setTimeout(() => reject(new Error(`supabase query timeout: ${label}`)), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}
