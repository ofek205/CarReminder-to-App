/**
 * Phase 6 — useWorkspaceRole.
 *
 * Convenience derivations on top of useAccountRole + useWorkspace.
 * Exposes booleans the new B2B pages need to gate UI affordances:
 *
 *   - isManager  → 'בעלים' or 'מנהל' in active workspace (any type)
 *   - isViewer   → 'שותף' in active workspace
 *   - isDriver   → 'driver' in active workspace
 *   - isBusiness → active workspace is a business workspace
 *   - canManageRoutes → manager AND business
 *   - canDriveRoutes  → driver AND business
 *
 * UI gating only — server-side RLS + RPC checks are the actual
 * enforcement boundary.
 */
import useAccountRole from '@/hooks/useAccountRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export default function useWorkspaceRole() {
  const { role, isLoading, isGuest } = useAccountRole();
  const { activeWorkspace } = useWorkspace();

  const isManager  = role === 'בעלים' || role === 'מנהל';
  const isViewer   = role === 'שותף';
  const isDriver   = role === 'driver';
  const isBusiness = activeWorkspace?.account_type === 'business';

  return {
    role,
    isLoading,
    isGuest,
    isManager,
    isViewer,
    isDriver,
    isBusiness,
    canManageRoutes: isManager && isBusiness,
    canDriveRoutes:  isDriver  && isBusiness,
  };
}
