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
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { dal } from '@/lib/dal';
import { withTimeout } from '@/lib/supabaseQuery';
import { useAuth } from '@/components/shared/GuestContext';
import useWorkspaces from '@/hooks/useWorkspaces';
import useViewAs from '@/hooks/useViewAs';
import useIsAdmin from '@/hooks/useIsAdmin';
import { setViewAs, clearViewAs, getViewAs } from '@/lib/viewAsState';
import { clearSignedUrlCache } from '@/hooks/useSignedUrl';
import { clearVehiclesCache } from '@/lib/vehiclesCache';
import { clearBreadcrumbs } from '@/lib/breadcrumbs';
import { clearPersistedCache } from '@/lib/query-persister';
import { MEMBER_STATUS, isGrantedMember } from '@/lib/enums';
import { adminSupabase, setImpersonationToken, clearImpersonationToken } from '@/lib/supabase';

/**
 * Ask admin-impersonate for a token whose `sub` is the target of the active
 * view session, and route data calls through it.
 *
 * Returns true when data calls are now scoped to the target, false otherwise —
 * and the return value MUST be checked. Both callers treat false as fatal and
 * abandon the session.
 *
 * This was originally documented as best-effort: a failure left the admin on
 * their own token, which was called "degraded, not broken" because the old
 * is_viewing() RLS escapes were still there to carry some screens. That reasoning
 * was wrong. Those escapes cover a handful of the 22 membership-gated functions,
 * so what the admin actually gets is a screen mixing their own rows with the
 * target's, under a banner naming the target — a wrong answer wearing the
 * costume of a right one, with no error anywhere. Refusing to start the session
 * is the only failure mode an operator can act on.
 */
/**
 * Monotonic view-as generation. Every operation that changes WHICH session is
 * live — enter, exit, a workspace switch (which re-enters), and the identity
 * change that force-clears — bumps it. An async mint captures the generation
 * it began under and refuses to install its token if the number has moved on.
 *
 * Why it must exist: enterViewAs sets viewAs and mounts the banner BEFORE the
 * mint edge-call resolves (~2-3s on the mobile networks this app targets). If
 * an exit runs in that window, the exit clears the not-yet-installed token and
 * ends the server session, then the in-flight mint resolves and re-installs
 * the token — leaving _impersonationClient SET while viewAs is null: every
 * data call silently runs as the target, with no banner and no renewal, until
 * the token's 15-minute expiry or a reload. The generation check turns that
 * late install into a no-op.
 */
let viewGeneration = 0;

/**
 * Mint a token for the session identified by `generation` and install it, but
 * ONLY if that generation is still current when the edge-call returns. A stale
 * generation means a concurrent exit or re-enter already owns the shared token
 * state; installing now would strand it. Returns true only when the token was
 * actually installed for the still-current session.
 */
async function mintImpersonationToken(generation) {
  try {
    // adminSupabase, not supabase: minting must speak as the admin, and
    // `functions` is on the redirected plane.
    const { data, error } = await adminSupabase.functions.invoke('admin-impersonate', { body: {} });
    // Re-check AFTER the await: the world may have moved while it was in flight.

    // (1) Session torn down while we were minting. This is the tighter test and
    // it IS the invariant: viewAs null must imply no token. The generation
    // number alone cannot catch every case — a renewal reads the current
    // generation WITHOUT bumping it (to keep the same session), so a renewal
    // and a concurrent enter can carry the SAME number; if that enter then
    // fails and clears viewAs, the renewal's own install still passes a pure
    // generation check and re-installs a token onto a session that no longer
    // exists. Clearing here is always safe: a live enter sets viewAs BEFORE it
    // installs, so viewAs===null means no operation legitimately owns a token.
    if (getViewAs() === null) {
      clearImpersonationToken();
      return false;
    }
    // (2) A newer operation (with its own viewAs) superseded us by generation.
    // It owns the token now — do NOT clear it, just decline to install ours.
    if (generation !== viewGeneration) return false;
    // (3) A genuine mint failure while we still own the live session.
    if (error || !data?.token) {
      if (import.meta.env.DEV) console.warn('[view-as] impersonation unavailable:', error?.message || 'no token');
      clearImpersonationToken();
      return false;
    }
    // The checks and the install are synchronous together — no await between —
    // so nothing can interleave in the gap and be overwritten.
    return setImpersonationToken(data.token);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[view-as] impersonation failed:', e?.message || e);
    if (generation === viewGeneration) clearImpersonationToken();
    return false;
  }
}

/**
 * How long a minted token is good for, minus a safety margin.
 *
 * admin-impersonate caps the token at 15 minutes while a view session runs for
 * 30, so a session that is never renewed spends its entire second half holding
 * an expired token: the banner keeps counting down, every data call comes back
 * 401, and the feature looks broken for reasons nothing on screen explains.
 * Renewing at 10 leaves five minutes of slack for a slow network, and each
 * renewal re-runs all three server-side gates in admin-impersonate.
 */
const TOKEN_RENEW_MS = 10 * 60 * 1000;

/**
 * Shape the admin_start_view / admin_current_view payload into view-as state.
 *
 * Both RPCs deliberately return the same fields so that entering a session and
 * restoring one after a reload cannot drift apart. They did drift: the hydrate
 * path used to omit the role and the email, so pressing F5 while viewing a
 * driver silently promoted them to an owner in the UI.
 */
function viewAsFromPayload(data) {
  return {
    targetAccountId: data.target_account_id,
    targetUserId:    data.target_user_id,
    targetName:      data.target_name,        // the ACCOUNT's name
    targetUserName:  data.target_user_name,   // the PERSON's name
    targetRole:      data.target_role,        // their real role in that account
    targetType:      data.target_type,
    ownerEmail:      data.owner_email,
    expiresAt:       data.expires_at,
  };
}

// Distinguishes "this mount has not seen an identity yet" from "signed out",
// which `user?.id === undefined` cannot express on its own.
const NO_PREVIOUS_IDENTITY = Symbol('no-previous-identity');

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
        adminSupabase.rpc('admin_user_accounts', { p_user_id: viewAs.targetUserId }),
        'admin_user_accounts'
      );
      if (error) return [];
      // role is deliberately null: admin_user_accounts returns account identity
      // only, and inventing 'בעלים' here made the switcher route a driver to
      // BusinessDashboard — straight into the "אין הרשאה לדשבורד" guard. The
      // authoritative role arrives from admin_start_view once the switch lands,
      // and WorkspaceSwitcher navigates on that instead.
      return (data || []).map(a => ({
        account_id:   a.account_id,
        account_type: a.type,
        account_name: a.name,
        role:         null,
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
  // Sentinel, deliberately not `undefined`: the effect below must be able to
  // tell "first run of this mount" apart from "signed out", because
  // `user?.id` is undefined in both cases.
  const prevUserIdRef = useRef(NO_PREVIOUS_IDENTITY);

  // Re-seed whenever the auth user identity changes (sign in / sign out
  // / account switch). Without this the seed sticks across users and a
  // signed-out → signed-in cycle would inherit the previous user's id.
  useEffect(() => {
    setActiveId(readCachedWorkspace(user?.id));
    initializedRef.current = false;
    // A change of identity (sign in/out/switch) ends any view-as session
    // and allows boot re-hydration for the new identity.
    viewHydratedRef.current = false;
    // Sign-out and account-switch must drop the borrowed identity too.
    // Leaving it set would let the next signed-in user inherit data calls
    // scoped to whoever the previous admin was viewing. Bump the generation
    // so any enter/renew mint still in flight from the previous identity
    // cannot install its token after this clear.
    viewGeneration++;
    clearImpersonationToken();
    clearViewAs();

    // Wipe the persisted cache ONLY on a real transition between identities.
    //
    // This effect runs on mount too, and `user` starts null, so a signed-in
    // cold boot passes through here twice: once with no id, then again when
    // auth resolves. Clearing unconditionally destroyed the snapshot the
    // persister had just restored a few hundred ms earlier, which made offline
    // reads across a reload impossible — verified: a planted snapshot was gone
    // after one reload, replaced by an empty one. The feature was a no-op.
    //
    // undefined -> id is the normal boot path and must NOT clear. A different
    // user signing in is already covered, because the previous session's
    // sign-out cleared at the GuestContext chokepoint. What must still clear is
    // id -> undefined (sign-out) and id -> other-id (a switch with no
    // intervening sign-out event).
    // The test is "did we previously KNOW a real user id" — not merely "have we
    // run before". Storing `user?.id` on the first run turns the sentinel into
    // `undefined`, so a plain !== check would read the normal
    // undefined -> 'abc' boot as a transition and clear anyway. Requiring the
    // previous value to be an actual id string is what makes sign-out and
    // user-switch clear while a cold boot does not.
    const prevUserId = prevUserIdRef.current;
    prevUserIdRef.current = user?.id;
    if (typeof prevUserId === 'string' && prevUserId !== user?.id) {
      clearPersistedCache();
    }
  }, [user?.id]);

  // Initial resolution + revalidation when the active workspace
  // disappears (e.g., a manager removed the user from a workspace).
  useEffect(() => {
    if (membershipsLoading) return;
    if (!memberships) return;

    const stillValid = activeId && memberships.some(
      m => m.account_id === activeId && isGrantedMember(m)
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
        await dal.run('account.ensure', {});
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
    const gen = ++viewGeneration;
    (async () => {
      try {
        const { data } = await adminSupabase.rpc('admin_current_view');
        if (gen !== viewGeneration) return;   // superseded while we asked
        if (data && data.target_account_id) {
          setViewAs(viewAsFromPayload(data));
          // A reload mid-session restores the flag from the server but not the
          // token — it is deliberately never persisted, so it does not survive
          // a refresh. Re-mint here, or the admin would come back to a session
          // that says "viewing" while every query silently runs as themselves.
          //
          // Same fail-closed rule as enterViewAs: no token, no view-as. The
          // server session is deliberately left OPEN — it is still valid and
          // the admin never asked to end it, so a transient network failure on
          // reload should cost a retry, not the session.
          if (!await mintImpersonationToken(gen) && gen === viewGeneration) clearViewAs();
        }
      } catch { /* no active session — stay in normal mode */ }
    })();
  }, [isGuest, user?.id, isAdmin]);

  // enterViewAs — admin-only. Opens a server-side view session and points the
  // whole app at (targetUserId, targetAccountId). RLS is what actually grants
  // the access; this only drives the client.
  //
  // targetUserId is what makes the session about a PERSON rather than an
  // account. Omit it and the server falls back to the account's owner, which is
  // the old behaviour and the source of the worst bug in this feature: because
  // the workspace switcher routes through here, moving between the target's
  // workspaces re-targeted the session at each new account's OWNER. An admin
  // who asked to see a manager's business workspace was silently handed the
  // owner's identity instead — visible in admin_view_sessions as a chain whose
  // target_email changes mid-sequence.
  const enterViewAs = useMemo(() => async (targetAccountId, reason, targetUserId) => {
    if (!targetAccountId) return false;
    // Claim this generation up front. Every await below re-checks it, so a
    // concurrent exit or a second enter (e.g. two quick workspace-switch taps)
    // that supersedes us can never be clobbered by our late writes.
    const gen = ++viewGeneration;
    // adminSupabase: admin_start_view opens with is_admin(), so switching
    // workspaces mid-session — which routes through here — must not arrive as
    // the person currently being viewed.
    const { data, error } = await adminSupabase.rpc('admin_start_view', {
      p_account_id: targetAccountId,
      p_reason: reason ?? null,
      p_user_id: targetUserId ?? null,
    });
    if (error) throw error;
    // Superseded while admin_start_view was in flight? We opened a server
    // session nobody will use — close it as the admin and touch nothing else.
    if (gen !== viewGeneration) {
      try { await adminSupabase.rpc('admin_end_view'); } catch { /* best effort */ }
      return false;
    }
    setViewAs(viewAsFromPayload(data));
    // Mint BEFORE clearing the cache. Otherwise the refetch storm that
    // queryClient.clear() triggers races the token and the first wave of
    // queries goes out on the admin's own identity — which is precisely the
    // mixed-identity screen this feature exists to eliminate.
    //
    // And fail CLOSED if it doesn't work. Ignoring the result left the worst
    // possible state: viewAs set, banner reading "צופה בחשבון של X", and every
    // data call still carrying the ADMIN's token. The is_viewing() escapes
    // from the old model are still on those policies, so the screen fills with
    // a plausible blend of the admin's own rows and the target's — a wrong
    // answer that looks like a right one. An error the admin can read beats a
    // session that lies about whose data is on screen.
    if (!await mintImpersonationToken(gen)) {
      // Only tear down if we are STILL the current operation. If the generation
      // moved on, a concurrent exit/enter already owns teardown and running it
      // here would clobber their state — the very race this guard prevents.
      if (gen !== viewGeneration) return false;
      clearViewAs();
      // The token was already cleared inside mint on failure, so this speaks
      // as the admin and actually closes the row we just opened. Leaving it
      // open would let it be resumed on the next reload.
      try { await adminSupabase.rpc('admin_end_view'); } catch { /* best effort */ }
      throw new Error('impersonation_unavailable');
    }
    // Hard-clear every cache, not just React Query. A workspace switch during
    // view-as routes back through here (switchWorkspaceDuringView), so this is
    // also the switch-from-A-to-B path — and B's session must not inherit A's
    // signed URLs (valid for days), breadcrumb trail, or localStorage vehicle
    // lists. Clearing only the query cache here left the other three holding
    // the previous target's data while the admin viewed the next one. Same set
    // exitViewAs clears, for the same reason.
    queryClient.clear();
    try { clearSignedUrlCache(); } catch { /* noop */ }
    try { clearBreadcrumbs(); } catch { /* noop */ }
    try { clearVehiclesCache(); } catch { /* noop */ }
    // queryClient.clear() only empties MEMORY. The persisted snapshot lives in
    // IndexedDB and would otherwise rehydrate the customer's rows on the
    // admin's next load — the same class of leak as the vehicles-cache one
    // described above, one layer down.
    clearPersistedCache();
    return data;
  }, [queryClient]);

  // exitViewAs — close the server session and drop every cached scrap of
  // the target's data so nothing bleeds back into the admin's own view.
  const exitViewAs = useMemo(() => async () => {
    // Claim a generation. Bumping before anything else makes a concurrent
    // enter's or renewal's in-flight mint a no-op (its post-await check sees
    // the number moved). Capturing our own bump value lets us detect the
    // REVERSE interleaving below.
    const myGen = ++viewGeneration;
    // Drop the impersonation token FIRST. admin_end_view opens with
    // `if not public.is_admin() then raise exception 'unauthorized'` and then
    // closes the session `where admin_user_id = auth.uid()`. Called while the
    // token is still active it runs as the TARGET — who is never an admin,
    // since minting refuses admin targets — so it raises, the catch below
    // swallows it, and ended_at silently stays NULL. The client would look
    // exited while the server session lived on until expires_at, still able to
    // mint fresh tokens. An exit that does not exit.
    clearImpersonationToken();
    try { await adminSupabase.rpc('admin_end_view'); } catch { /* best effort */ }
    // exit-then-enter guard. If a fresh enterViewAs started while admin_end_view
    // was in flight, it has by now set viewAs and installed a token for its own
    // session (a consistent pair) under a newer generation. Running the teardown
    // below would null viewAs while that newer token stays installed — the exact
    // orphaned-token state (_impersonationClient set, viewAs null, no banner,
    // data calls silently as the target) this whole generation mechanism exists
    // to prevent. The newer operation owns the state now; yield to it.
    if (myGen !== viewGeneration) return;
    clearViewAs();
    // Clear the token a SECOND time, after clearViewAs. The first clear (above,
    // before the await) is required so admin_end_view runs as the admin — but a
    // renewal firing DURING that await shares this exit's generation (renewal
    // reads viewGeneration without bumping) and viewAs is still set at that
    // instant, so neither the generation guard nor mint's viewAs-null guard
    // stops it from installing a fresh token. That token would then outlive the
    // clearViewAs above as an orphan (viewAs null, token set, no banner). This
    // second clear wipes exactly that late install; any renewal resolving after
    // this point is refused by mint because viewAs is now null.
    clearImpersonationToken();
    // Drop every cached scrap of the target's data so nothing bleeds back
    // into the admin's own view: React Query cache, the signed-URL cache
    // (file URLs valid for days), the breadcrumb ring buffer, and the
    // localStorage vehicle lists.
    //
    // That last one was missing, and it was the only cache that outlived the
    // browser tab. useMyVehicles keyed on accountId alone, so viewing a
    // customer wrote their plates and models to the admin's disk under the
    // CUSTOMER's account id, where nothing ever removed them — not exit, not
    // sign-out, not session expiry. The hook no longer writes during a session
    // at all; this sweep is what clears what older builds already left behind.
    queryClient.clear();
    try { clearSignedUrlCache(); } catch { /* noop */ }
    try { clearBreadcrumbs(); } catch { /* noop */ }
    try { clearVehiclesCache(); } catch { /* noop */ }
    // queryClient.clear() only empties MEMORY. The persisted snapshot lives in
    // IndexedDB and would otherwise rehydrate the customer's rows on the
    // admin's next load — the same class of leak as the vehicles-cache one
    // described above, one layer down.
    clearPersistedCache();
  }, [queryClient]);

  // Keep the borrowed identity alive for as long as the session runs.
  //
  // The token expires at 15 minutes, the session at 30. Without this the whole
  // second half of every session ran on a dead token: the banner counted down
  // normally while each request came back 401, so the screens emptied for no
  // reason the operator could see. Renewal is deliberately silent — no cache
  // clear, no refetch storm — because the identity is unchanged; only the
  // credential is refreshed.
  //
  // Failing to renew is treated exactly like failing to mint: leave, rather
  // than sit inside a session that can no longer read anything.
  useEffect(() => {
    if (!viewAs) return undefined;
    const id = setInterval(async () => {
      // Renewal keeps the SAME session, so it renews under the current
      // generation. If an exit fires mid-renewal, the generation moves and the
      // freshly-minted token is discarded rather than installed over the exit.
      const gen = viewGeneration;
      if (await mintImpersonationToken(gen)) return;
      // Nothing to report if the session is already gone. Two ways that
      // happens: a newer operation bumped the generation (exit/enter), or a
      // user-initiated exit nulled viewAs while this renewal's mint was in
      // flight — in which case mint refused the install via its viewAs-null
      // guard and there is no failed session to announce. Without this second
      // check the admin gets a spurious "view ended" toast in the ~1-2s window
      // right after they themselves pressed exit.
      if (gen !== viewGeneration || getViewAs() === null) return;
      toast.error('הצפייה בחשבון הסתיימה', {
        description: 'לא ניתן היה לחדש את ההרשאה. היכנס שוב מניהול המשתמשים.',
      });
      try { await exitViewAs(); } catch { /* best effort */ }
    }, TOKEN_RENEW_MS);
    return () => clearInterval(id);
  }, [viewAs, exitViewAs]);

  // switchTo — the only public mutation. Validates target, updates
  // local state, persists hint, then invalidates all queries so every
  // page refetches scoped to the new account.
  const switchTo = useMemo(() => async (targetAccountId) => {
    if (viewAs) return false;   // workspace switching is disabled during view-as
    if (!targetAccountId) return false;
    const target = memberships?.find(m => m.account_id === targetAccountId);
    if (!target) return false;
    // Defense in depth: useWorkspaces already returns granted rows only,
    // so a pending invite can't reach here — but switching into a
    // workspace the server won't authorize is the exact failure this
    // whole path guards against, so assert it rather than assume it.
    if (!isGrantedMember(target)) return false;
    if (targetAccountId === activeId) return true;

    setActiveId(targetAccountId);
    writeCachedWorkspace(user?.id, targetAccountId);

    // Persist hint. Fire-and-forget — never block the UI on this.
    (async () => {
      try {
        await dal.run('userPreferences.setLastActive', {
          userId: user.id,
          accountId: targetAccountId,
          updatedAt: new Date().toISOString(),
        });
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

  // switchWorkspaceDuringView — the switcher's behaviour while impersonating.
  //
  // Moving between workspaces has to re-open the session, because the session
  // row is what target_account_id-scoped RLS reads. What must NOT change is WHO
  // we are: passing the current targetUserId keeps the same person and moves
  // only the workspace. Without it the server falls back to the new account's
  // owner, which is how "view Zvika's business workspace" turned into "become
  // the owner of that business" mid-session.
  // targetUserId can legitimately be missing on a session opened before this
  // change against an ownerless account, where the server stored NULL. Passing
  // it through as undefined lets the server fall back to the owner, which then
  // raises account_has_no_owner and reaches the operator as a readable error.
  // Returning false here instead would make the click do nothing at all — the
  // silent failure this whole rework exists to remove.
  const switchWorkspaceDuringView = useMemo(() => async (targetAccountId) => {
    if (!viewAs) return false;
    if (targetAccountId === viewAs.targetAccountId) return true;
    return enterViewAs(targetAccountId, 'workspace switch', viewAs.targetUserId);
  }, [viewAs, enterViewAs]);

  const realActiveWorkspace = useMemo(
    () => memberships?.find(m => m.account_id === activeId) ?? null,
    [memberships, activeId]
  );

  const value = useMemo(() => {
    const impersonating = !!viewAs;
    // When viewing-as, the admin is NOT a real member of the target, so we
    // synthesize a membership-shaped object. Every consumer reads
    // activeWorkspace, so the override propagates with no per-screen change.
    //
    // The role is the TARGET's actual role, resolved server-side by
    // admin_start_view. It used to be hardcoded to 'בעלים', which meant viewing
    // a driver or a manager still rendered the owner's interface — the opposite
    // of what a support session is for, and actively misleading: under real
    // impersonation auth.uid() IS the target, so the server enforces THEIR
    // permissions and every owner-only button we drew was one the click would
    // have been refused. useAccountRole reads this straight through to roughly
    // thirty pages.
    //
    // Falls back to 'בעלים' only when the server sent nothing — an old bundle
    // talking to a pre-migration database, where the previous behaviour is the
    // safer landing spot.
    const exposedWorkspace = impersonating
      ? {
          account_id:    viewAs.targetAccountId,
          account_name:  viewAs.targetName,
          account_type:  viewAs.targetType,
          role:          viewAs.targetRole || 'בעלים',
          owner_user_id: viewAs.targetUserId,
          status:        MEMBER_STATUS.ACTIVE,
        }
      : realActiveWorkspace;
    // The WorkspaceSwitcher reads `memberships`. In view-as we feed it the
    // TARGET user's accounts so the admin can move between the target's
    // personal/business workspaces; switching re-opens the session on the new
    // workspace WITHOUT changing who we are (switchWorkspaceDuringView).
    const exposedMemberships = impersonating
      ? (viewAsAccounts.length > 0 ? viewAsAccounts : [exposedWorkspace])
      : (memberships ?? []);
    return {
      memberships:        exposedMemberships,
      activeWorkspaceId:  impersonating ? viewAs.targetAccountId : activeId,
      activeWorkspace:    exposedWorkspace,
      switchTo:           impersonating ? switchWorkspaceDuringView : switchTo,
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
  }, [memberships, viewAsAccounts, activeId, realActiveWorkspace, switchTo, switchWorkspaceDuringView, enterViewAs, exitViewAs, viewAs, membershipsLoading, isGuest, authState]);

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
