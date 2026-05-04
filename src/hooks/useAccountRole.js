/**
 * Phase 3 — useAccountRole.
 *
 * Now a thin wrapper over WorkspaceContext. Returns the role + accountId
 * of the currently-ACTIVE workspace, not "the highest-priority membership"
 * as it did pre-Phase-3.
 *
 * This change is what makes workspace switching propagate to every page:
 * the ~30 pages that destructure { role, accountId, isLoading } from
 * this hook automatically see the new active account when the user
 * picks a different workspace from the switcher. Their query keys (most
 * include accountId) become new keys, React Query fetches fresh data,
 * old workspace data is never displayed.
 *
 * The return shape is preserved 1:1:
 *   { role, accountId, isLoading, needsProvisioning, isGuest }
 *
 * Behavior for single-membership users is identical to pre-Phase-3:
 * the only membership is the active workspace, so role + accountId
 * resolve to the same values.
 *
 * Auto-heal (ensure_user_account RPC for users with zero memberships)
 * has moved into WorkspaceContext, so it runs exactly once per session
 * regardless of which page mounted first.
 */
import { useWorkspace } from '@/contexts/WorkspaceContext';

export default function useAccountRole() {
  const {
    memberships, activeWorkspaceId, activeWorkspace,
    isLoading, isGuest,
  } = useWorkspace();

  if (isGuest) {
    return { role: null, accountId: null, isLoading: false, isGuest: true };
  }

  // Seed-aware short circuit: if WorkspaceContext already exposes an
  // activeWorkspaceId (via the localStorage cache it now seeds on
  // cold start) we return it immediately, even if the live membership
  // query hasn't finished. Without this, pages would still show null
  // accountId while memberships=[] for the brief window between mount
  // and `useWorkspaces` resolving — re-introducing the stuck-loading
  // bug for users where the network is slow / hung.
  if (activeWorkspaceId) {
    return {
      role: activeWorkspace?.role ?? null,
      accountId: activeWorkspaceId,
      isLoading: false,
      needsProvisioning: false,
      isGuest: false,
    };
  }

  if (isLoading) {
    return { role: null, accountId: null, isLoading: true, isGuest: false };
  }

  if (!memberships || memberships.length === 0) {
    return {
      role: null,
      accountId: null,
      isLoading: false,
      needsProvisioning: true,
      isGuest: false,
    };
  }

  return {
    role: activeWorkspace?.role ?? null,
    accountId: activeWorkspaceId ?? null,
    isLoading: false,
    needsProvisioning: false,
    isGuest: false,
  };
}
