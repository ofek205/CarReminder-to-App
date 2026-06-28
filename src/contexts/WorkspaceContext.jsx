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
import { withTimeout } from '@/lib/supabaseQuery';
import { useAuth } from '@/components/shared/GuestContext';
import useWorkspaces from '@/hooks/useWorkspaces';
import useViewAs from '@/hooks/useViewAs';
import useIsAdmin from '@/hooks/useIsAdmin';
import { setViewAs, clearViewAs } from '@/lib/viewAsState';
import { clearSignedUrlCache } from '@/hooks/useSignedUrl';
import { clearBreadcrumbs } from '@/lib/breadcrumbs';
import { MEMBER_STATUS, isActiveMember } from '@/lib/enums';

const WorkspaceContext = createContext(null);

// Per-user localStorage key for the last-known active workspace. Seeding
// `activeId` from this on cold start lets warm boots render the dashboard
// immediately even when the membership query is slow (or hung — the iOS
// WebView session-bridge bug seen in production). The real workspace
// resolution still runs in the background and overrides the seed when
// it lands.
const LAST_WS_KEY = (uid) => `cr_last_active_workspace:${uid || 'anon'}`;
function readCachedWorkspace(uid) {
  if (!uid) return null;
  try { return localStorage.getItem(LAST_WS_KEY(uid)) || null; } catch { return null; }
}
function writeCachedWorkspace(uid, accountId) {
  if (!uid) return;
  try {
    if (accountId) localStorage.setItem(LAST_WS_KEY(uid), accountId);
    else localStorage.removeItem(LAST_WS_KEY(uid));
  } catch { /* quota / private mode — silent */ }
}

const ROLE_PRIORITY = { 'בעלים': 0, 'מנהל': 1, 'שותף': 2 };
const sortByRole = (a, b) =>
  (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9);

/**
 * Pick the default active workspace from a memberships list.
 *
 * Resolution order:
 *   1. business workspace where the user is a driver — drivers spend
 *      their time-on-app in the company context.
 *   2. business workspace where the user is owner/manager/viewer — if
 *      the user has any business membership, the app boots into it
 *      even if the saved hint points to personal. Rationale: owners
 *      open the app to operate the fleet; landing on personal every
 *      refresh forces a manual switch every session. The hint still
 *      wins among multiple businesses (user picked a specific one).
 *   3. saved hint among the remaining (personal-only) memberships.
 *   4. first active 'personal' membership.
 *   5. first active membership of any type (sorted by role priority).
 *   6. first inactive membership (legacy fallback).
 *
 * In-session switches via the WorkspaceSwitcher still work — the hint
 * gets persisted and respected within a single business workspace, and
 * the switch survives until refresh. After refresh, business wins
 * again. The driver default is non-overridable for the same UX reason
 * the rule has been there since phase 3.
 */
function resolveDefault(memberships, savedHintId) {
  if (!memberships?.length) return null;

  const active = memberships.filter(m => m.status === MEMBER_STATUS.ACTIVE);

  // 1. Driver in a business workspace → always.
  const businessAsDriver = active.find(
    m => m.account_type === 'business' && m.role === 'driver'
  );
  if (businessAsDriver) return businessAsDriver;

  // 2. Any other business membership → preferred over personal. The
  // saved hint disambiguates between multiple businesses, but cannot
  // demote business to personal.
  const businesses = active.filter(m => m.account_type === 'business');
  if (businesses.length > 0) {
    if (savedHintId) {
      const hintedBiz = businesses.find(m => m.account_id === savedHintId);
      if (hintedBiz) return hintedBiz;
    }
    return businesses.slice().sort(sortByRole)[0];
  }

  // 3. No business — fall back to the original personal-friendly path.
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
  const viewAs = useViewAs();
  const isAdmin = useIsAdmin();

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

  // During view-as, load the TARGET user's accounts so the WorkspaceSwitcher
  // lists THEM (personal + business) instead of the admin's. Switching between
  // them re-targets the view session (see `switchTo` override in `value`).
  // admin_user_accounts already exists — it powers the AdminUserDrawer switcher.
  const { data: viewAsAccounts = [] } = useQuery({
    queryKey: ['view-as-accounts', viewAs?.targetUserId],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase.rpc('admin_user_accounts', { p_user_id: viewAs.targetUserId }),
        'admin_user_accounts'
      );
      if (error) return [];
      return (data || []).map(a => ({
        account_id:   a.account_id,
        account_type: a.type,
        account_name: a.name,
        role:         'בעלים',
        status:       MEMBER_STATUS.ACTIVE,
      }));
    },
    enabled: !!viewAs?.targetUserId,
    staleTime: 5 * 60 * 1000,
  });

  // Active workspace state. Seed from localStorage so warm boots paint
  // immediately — without this seed, the home + vehicles pages spin
  // through the entire useWorkspaces round-trip every refresh, and any
  // network hang leaves them stuck. The seed is corrected the moment
  // memberships arrive: if it isn't a valid membership anymore the
  // resolution effect below replaces it.
  const [activeId, setActiveId] = useState(() => readCachedWorkspace(user?.id));
  const initializedRef = useRef(false);
  const viewHydratedRef = useRef(false);

  // Re-seed whenever the auth user identity changes (sign in / sign out
  // / account switch). Without this the seed sticks across users and a
  // signed-out → signed-in cycle would inherit the previous user's id.
  useEffect(() => {
    setActiveId(readCachedWorkspace(user?.id));
    initializedRef.current = false;
    // A change of identity (sign in/out/switch) ends any view-as session
    // and allows boot re-hydration for the new identity.
    viewHydratedRef.current = false;
    clearViewAs();
  }, [user?.id]);

  // Initial resolution + revalidation when the active workspace
  // disappears (e.g., a manager removed the user from a workspace).
  useEffect(() => {
    if (membershipsLoading) return;
    if (!memberships) return;

    const stillValid = activeId && memberships.some(
      m => m.account_id === activeId && isActiveMember(m)
    );

    if (stillValid) return;

    if (!initializedRef.current || !stillValid) {
      const fallback = resolveDefault(memberships, savedHint);
      const nextId = fallback?.account_id ?? null;
      setActiveId(nextId);
      writeCachedWorkspace(user?.id, nextId);
      initializedRef.current = true;
    }
  }, [memberships, membershipsLoading, savedHint, activeId, user?.id]);

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

  // View-as (admin impersonation) — boot hydration from the server, which
  // is the source of truth. Only admins can have a session; for everyone
  // else this no-ops. Runs once per identity.
  useEffect(() => {
    if (isGuest || !user?.id) return;
    if (isAdmin !== true) return;
    if (viewHydratedRef.current) return;
    viewHydratedRef.current = true;
    (async () => {
      try {
        const { data } = await supabase.rpc('admin_current_view');
        if (data && data.target_account_id) {
          setViewAs({
            targetAccountId: data.target_account_id,
            targetUserId:    data.target_user_id,
            targetName:      data.target_name,
            targetType:      data.target_type,
            expiresAt:       data.expires_at,
          });
        }
      } catch { /* no active session — stay in normal mode */ }
    })();
  }, [isGuest, user?.id, isAdmin]);

  // enterViewAs — admin-only. Opens a server-side view session and points
  // the whole app at the target account. RLS (is_viewing) is what actually
  // grants the access; this only drives the client.
  const enterViewAs = useMemo(() => async (targetAccountId, reason) => {
    if (!targetAccountId) return false;
    const { data, error } = await supabase.rpc('admin_start_view', {
      p_account_id: targetAccountId,
      p_reason: reason ?? null,
    });
    if (error) throw error;
    setViewAs({
      targetAccountId: data.target_account_id,
      targetUserId:    data.target_user_id,
      targetName:      data.target_name,
      targetType:      data.target_type,
      ownerEmail:      data.owner_email,
      expiresAt:       data.expires_at,
    });
    // Hard-clear the cache (not just invalidate): any query the admin ran
    // under their own context — including results cached BEFORE the server
    // session existed — must not be served stale. Every screen then refetches
    // fresh, scoped to the target account.
    queryClient.clear();
    return data;
  }, [queryClient]);

  // exitViewAs — close the server session and drop every cached scrap of
  // the target's data so nothing bleeds back into the admin's own view.
  const exitViewAs = useMemo(() => async () => {
    try { await supabase.rpc('admin_end_view'); } catch { /* best effort */ }
    clearViewAs();
    // Drop every cached scrap of the target's data so nothing bleeds back
    // into the admin's own view: React Query cache, the signed-URL cache
    // (file URLs valid for days), and the breadcrumb ring buffer.
    queryClient.clear();
    try { clearSignedUrlCache(); } catch { /* noop */ }
    try { clearBreadcrumbs(); } catch { /* noop */ }
  }, [queryClient]);

  // switchTo — the only public mutation. Validates target, updates
  // local state, persists hint, then invalidates all queries so every
  // page refetches scoped to the new account.
  const switchTo = useMemo(() => async (targetAccountId) => {
    if (viewAs) return false;   // workspace switching is disabled during view-as
    if (!targetAccountId) return false;
    const target = memberships?.find(m => m.account_id === targetAccountId);
    if (!target) return false;
    if (!isActiveMember(target)) return false;
    if (targetAccountId === activeId) return true;

    setActiveId(targetAccountId);
    writeCachedWorkspace(user?.id, targetAccountId);

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
  }, [memberships, activeId, user?.id, queryClient, viewAs]);

  const realActiveWorkspace = useMemo(
    () => memberships?.find(m => m.account_id === activeId) ?? null,
    [memberships, activeId]
  );

  const value = useMemo(() => {
    const impersonating = !!viewAs;
    // When viewing-as, the admin is NOT a real member of the target, so we
    // synthesize a membership-shaped object with the OWNER perspective. This
    // is what makes business-vs-personal UI (account_type) and edit
    // affordances (role) resolve correctly downstream — every consumer reads
    // activeWorkspace, so the override propagates with no per-screen change.
    const exposedWorkspace = impersonating
      ? {
          account_id:    viewAs.targetAccountId,
          account_name:  viewAs.targetName,
          account_type:  viewAs.targetType,
          role:          'בעלים',
          owner_user_id: viewAs.targetUserId,
          status:        MEMBER_STATUS.ACTIVE,
        }
      : realActiveWorkspace;
    // The WorkspaceSwitcher reads `memberships`. In view-as we feed it the
    // TARGET user's accounts so the admin can move between the target's
    // personal/business workspaces; switching re-targets the session
    // (switchTo → enterViewAs) instead of jumping to the admin's own account.
    const exposedMemberships = impersonating
      ? (viewAsAccounts.length > 0 ? viewAsAccounts : [exposedWorkspace])
      : (memberships ?? []);
    return {
      memberships:        exposedMemberships,
      activeWorkspaceId:  impersonating ? viewAs.targetAccountId : activeId,
      activeWorkspace:    exposedWorkspace,
      switchTo:           impersonating ? enterViewAs : switchTo,
      enterViewAs,
      exitViewAs,
      viewAs,
      isViewAs:           impersonating,
      // If we have a seeded activeId (from localStorage), expose
      // isLoading=false so consumers like useAccountRole return the
      // cached id immediately. The membership query keeps running in
      // the background; once it lands the resolution effect either
      // confirms or replaces the seed. During view-as we always have an id.
      isLoading: membershipsLoading && !activeId && !impersonating,
      isGuest:   !!isGuest || authState === 'guest',
    };
  }, [memberships, viewAsAccounts, activeId, realActiveWorkspace, switchTo, enterViewAs, exitViewAs, viewAs, membershipsLoading, isGuest, authState]);

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
      enterViewAs: async () => false,
      exitViewAs: async () => {},
      viewAs: null,
      isViewAs: false,
      isLoading: false,
      isGuest: false,
    };
  }
  return ctx;
}
