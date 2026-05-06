/**
 * Phase 1 — read-only workspaces hook.
 *
 * Returns every workspace (account) the current user is a member of.
 * Backed by the v_user_workspaces view added in
 * supabase-phase1-workspace-foundation.sql.
 *
 * This hook is intentionally NOT consumed by any page in Phase 1. It
 * exists so WorkspaceContext can expose memberships; page-level
 * consumption begins in Phase 3 when the workspace switcher lands.
 *
 * Returns:
 *   - memberships: Array<{
 *       user_id, account_id, role, status, joined_at,
 *       account_type, account_name, account_created_via, owner_user_id
 *     }>
 *   - isLoading: boolean
 *   - isGuest:   boolean
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';

export default function useWorkspaces() {
  const { user, isGuest, authState } = useAuth();
  const enabled = !!user?.id && !isGuest;

  const { data, isLoading } = useQuery({
    queryKey: ['user-workspaces', user?.id],
    queryFn: async () => {
      // Hard timeout race. Prod has seen this query stall on iOS
      // WKWebView (Capacitor session bridge) — without a timeout,
      // React Query's `isLoading` stays true forever and every page
      // that gates on accountId is permanently stuck on a spinner.
      // 6s is more than the p99 latency for this view but short enough
      // that a stuck request fails over to the localStorage seed in
      // WorkspaceContext quickly. The query auto-retries once via
      // the `retry` option below, doubling worst-case to ~12s.
      const TIMEOUT_MS = 6000;
      const fetchPromise = supabase
        .from('v_user_workspaces')
        .select('*')
        .eq('user_id', user.id);
      const timeoutPromise = new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('useWorkspaces timeout')), TIMEOUT_MS)
      );
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
      if (error) throw error;
      return data || [];
    },
    enabled,
    // staleTime kept short because workspace membership changes mid-
    // session (driver gets added to a fleet, manual SQL hot-fix mints
    // a personal workspace, etc.) and a 5-minute stale window meant
    // the switcher rendered the OLD list for the rest of the session.
    // 30s lets the user see new memberships almost immediately on the
    // next render-trigger without flooding Supabase with refetches.
    staleTime: 30 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // Retry once on timeout / transient failure, then surface the
    // error to consumers so the localStorage seed in WorkspaceContext
    // takes over and the page renders.
    retry: 1,
    retryDelay: 500,
  });

  // Mirror the existing useAccountRole filter: never surface 'הוסר' /
  // 'removed' rows. Keeps semantics aligned for the eventual Phase 3
  // migration where useAccountRole becomes a thin wrapper over this.
  const memberships = (data || []).filter(
    m => m.status !== 'הוסר' && m.status !== 'removed'
  );

  return {
    memberships,
    isLoading: enabled && isLoading,
    isGuest: !!isGuest || authState === 'guest',
  };
}
