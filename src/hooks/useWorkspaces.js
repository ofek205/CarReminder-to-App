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
      const { data, error } = await supabase
        .from('v_user_workspaces')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
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
