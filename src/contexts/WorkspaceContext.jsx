/**
 * Phase 3 — WorkspaceContext (with switching).
 *
 * Single source of truth for the user's currently-active workspace.
 *
 * Resolution order on boot:
 *   1. user_preferences.last_active_account_id (if still a valid membership)
 *   2. first 'personal' workspace
 *   3. first active membership of any type, by role priority
 *   (4. nothing — auto-heal kicks in for users with zero memberships)
 *
 * On switch:
 *   1. validate target accountId is in the membership list
 *   2. update local state immediately (UI is responsive)
 *   3. persist last_active_account_id (fire-and-forget upsert)
 *   4. invalidate ALL React Query queries — every page refetches fresh
 *      data scoped to the new active account on next render
 *
 * Auto-heal:
 *   When the user is authenticated and the membership list resolves
 *   empty, we call ensure_user_account() once per session. This used
 *   to live in useAccountRole; consolidated here so there is exactly
 *   one place that triggers provisioning.
 *
 * Backward compatibility: useAccountRole reads from this context, so
 * every existing page continues to work. Single-membership users
 * resolve to the same accountId they always did, which means private
 * users see literally no behavioural change.
 */
import React, {
  createContext, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useWorkspaces from '@/hooks/useWorkspaces';

const WorkspaceContext = createContext(null);

const ROLE_PRIORITY = { 'בעלים': 0, 'מנהל': 1, 'שותף': 2 };
const sortByRole = (a, b) =>
  (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9);

/**
 * Pick the default active workspace from a memberships list.
 *
 * Resolution order:
 *   1. saved hint, if still a valid + non-removed membership
 *   2. business workspace where the user is a driver — drivers do their
 *      job in the company workspace, so opening the app there saves
 *      them a manual workspace switch every session
 *   3. first active 'personal' membership (default for everyone else)
 *   4. first active membership of any type (sorted by role priority)
 *   5. first inactive membership (legacy fallback)
 */
function resolveDefault(memberships, savedHintId) {
  if (!memberships?.length) return null;

  const active = memberships.filter(m => m.status === 'פעיל');

  // Driver in a business workspace → ALWAYS land there, even if a stale
  // saved hint points elsewhere. The hint loses to the driver default
  // because most drivers' time-on-app is purely workplace activity, and
  // a once-set hint to "personal" used to trap them in the wrong context
  // every login. Drivers can still reach the personal workspace via the
  // switcher in one tap.
  const businessAsDriver = active.find(
    m => m.account_type === 'business' && m.role === 'driver'
  );
  if (businessAsDriver) return businessAsDriver;

  if (savedHintId) {
    const hinted = memberships.find(m => m.account_id === savedHintId);
    if (hinted) return hinted;
  }

  const personal = active.find(m => m.account_type === 'personal');
  if (personal) return personal;

  const anyActive = active.slice().sort(sortByRole)[0];
  if (anyActive) return anyActive;

  return memberships.slice().sort(sortByRole)[0] ?? null;
}

export function WorkspaceProvider({ children }) {
  const { user, isGuest, authState } = useAuth();
  const { memberships, isLoading: membershipsLoading } = useWorkspaces();
  const queryClient = useQueryClient();

  // Saved hint from user_preferences. Read once when the user is known;
  // refreshes if user changes (sign out / sign in).
  const { data: savedHint } = useQuery({
    queryKey: ['user-preferences-active-workspace', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('last_active_account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) {
        // Table missing pre-Phase-3 SQL apply, or transient: behave as
        // if no hint. The default-resolution path still works.
        return null;
      }
      return data?.last_active_account_id ?? null;
    },
    enabled: !!user?.id && !isGuest,
    staleTime: 60 * 60 * 1000,
  });

  // Active workspace state. Null until first resolution. We DO NOT
  // re-resolve every time memberships changes — once the user has
  // chosen a workspace this session, we keep it (subject to it still
  // being a valid membership).
  const [activeId, setActiveId] = useState(null);
  const initializedRef = useRef(false);

  // Initial resolution + revalidation when the active workspace
  // disappears (e.g., a manager removed the user from a workspace).
  useEffect(() => {
    if (membershipsLoading) return;
    if (!memberships) return;

    const stillValid = activeId && memberships.some(
      m => m.account_id === activeId && m.status !== 'הוסר' && m.status !== 'removed'
    );

    if (stillValid) return;

    if (!initializedRef.current || !stillValid) {
      const fallback = resolveDefault(memberships, savedHint);
      setActiveId(fallback?.account_id ?? null);
      initializedRef.current = true;
    }
  }, [memberships, membershipsLoading, savedHint, activeId]);

  // Auto-heal: authenticated user, no memberships at all, call the
  // SECURITY DEFINER RPC once per session and let useWorkspaces refetch.
  const healedRef = useRef(false);
  useEffect(() => {
    if (isGuest) return;
    if (!user?.id) return;
    if (membershipsLoading) return;
    if (memberships && memberships.length > 0) return;
    if (healedRef.current) return;
    healedRef.current = true;
    (async () => {
      try {
        await supabase.rpc('ensure_user_account');
        queryClient.invalidateQueries({ queryKey: ['user-workspaces', user.id] });
      } catch { /* surfaced to user via per-page empty-state banners */ }
    })();
  }, [user?.id, isGuest, membershipsLoading, memberships, queryClient]);

  // switchTo — the only public mutation. Validates target, updates
  // local state, persists hint, then invalidates all queries so every
  // page refetches scoped to the new account.
  const switchTo = useMemo(() => async (targetAccountId) => {
    if (!targetAccountId) return false;
    const target = memberships?.find(m => m.account_id === targetAccountId);
    if (!target) return false;
    if (target.status === 'הוסר' || target.status === 'removed') return false;
    if (targetAccountId === activeId) return true;

    setActiveId(targetAccountId);

    // Persist hint. Fire-and-forget — never block the UI on this.
    (async () => {
      try {
        await supabase.from('user_preferences').upsert({
          user_id: user.id,
          last_active_account_id: targetAccountId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch { /* hint not saved; resolution will fall back next boot */ }
    })();

    // Invalidate everything except the membership list itself (we
    // know that hasn't changed). React Query refetches active queries
    // immediately; inactive ones become stale and refetch on next mount.
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return k !== 'user-workspaces'
            && k !== 'user-preferences-active-workspace';
      },
    });

    return true;
  }, [memberships, activeId, user?.id, queryClient]);

  const activeWorkspace = useMemo(
    () => memberships?.find(m => m.account_id === activeId) ?? null,
    [memberships, activeId]
  );

  const value = useMemo(() => ({
    memberships:        memberships ?? [],
    activeWorkspaceId:  activeId,
    activeWorkspace,
    switchTo,
    isLoading: membershipsLoading,
    isGuest:   !!isGuest || authState === 'guest',
  }), [memberships, activeId, activeWorkspace, switchTo, membershipsLoading, isGuest, authState]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * Safe consumer. Returns a quiet "empty" shape outside the provider
 * (tests / storybook / boot-error states) so legacy code paths don't
 * crash.
 */
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    return {
      memberships: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
      switchTo: async () => false,
      isLoading: false,
      isGuest: false,
    };
  }
  return ctx;
}
