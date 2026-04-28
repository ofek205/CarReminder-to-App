/**
 * Hook to get current user's role in their account.
 *
 * Usage:
 *   const { role, accountId, isLoading } = useAccountRole();
 *   if (canEdit(role)) { ... }
 *
 * Returns:
 *   - role: 'בעלים' | 'מנהל' | 'חבר' | null (guest/loading)
 *   - accountId: string | null
 *   - isLoading: boolean
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';

export default function useAccountRole() {
  const { user, isGuest, authState } = useAuth();
  const queryClient = useQueryClient();
  // Tracks whether we've already issued an auto-heal call for this
  // user this session. ensure_user_account is idempotent but we don't
  // want to hammer the RPC if it's truly broken — one auto-retry is
  // enough to recover from a transient miss.
  const healedRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['account-role', user?.id],
    queryFn: async () => {
      if (!user?.id) return { role: null, accountId: null };
      // Pull ALL of the user's membership rows (not just status='פעיל').
      // Legacy / migrated rows can have status NULL, 'active' (English),
      // or 'ממתין' — the old filter dropped them and the app got stuck
      // in an infinite loading state because accountId never resolved.
      // Prefer 'פעיל' if present; otherwise fall back to any row so the
      // user sees the app at all. Ownership is inferred from the row we
      // end up using; canEdit/canView checks in permissions.js still
      // apply so we don't hand out new privileges here.
      const all = await db.account_members.filter({ user_id: user.id });
      if (all.length === 0) return { role: null, accountId: null };
      // Exclude explicitly-removed rows ("הוסר" / "removed") so a user who
      // was kicked from a family account doesn't get routed back into it.
      // Active rows are always preferred; inactive rows (legacy/migration
      // artefacts) are the fallback. Within each bucket we sort by role
      // so a בעלים account wins over a שותף one.
      const usable = all.filter(m => m.status !== 'הוסר' && m.status !== 'removed');
      if (usable.length === 0) return { role: null, accountId: null };
      const ROLE_PRIORITY = { 'בעלים': 0, 'מנהל': 1, 'שותף': 2 };
      const sortByRole = (a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9);
      const active = usable.filter(m => m.status === 'פעיל').sort(sortByRole);
      const inactive = usable.filter(m => m.status !== 'פעיל').sort(sortByRole);
      const pick = active[0] || inactive[0];
      return { role: pick.role, accountId: pick.account_id };
    },
    enabled: !!user?.id && !isGuest,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Auto-heal: if the user is authenticated and the membership query
  // resolved with no row, call the SECURITY DEFINER RPC to provision
  // them and refetch. This is the third defense layer (after the
  // signup trigger and the GuestContext provision call) — it catches
  // users whose initial provisioning didn't land for any reason and
  // would otherwise be stuck on infinite skeletons until they hit
  // /Dashboard. Runs at most once per session per user.
  useEffect(() => {
    if (isGuest || !user?.id) return;
    if (isLoading) return;
    if (data?.accountId) return;          // already provisioned — nothing to do
    if (healedRef.current) return;         // already attempted this session
    healedRef.current = true;
    (async () => {
      try {
        await supabase.rpc('ensure_user_account');
        queryClient.invalidateQueries({ queryKey: ['account-role', user.id] });
      } catch { /* page-level UI surfaces stuck state via the soft-fail banner */ }
    })();
  }, [user?.id, isGuest, isLoading, data?.accountId, queryClient]);

  if (isGuest || authState === 'guest') {
    return { role: null, accountId: null, isLoading: false, isGuest: true };
  }

  return {
    role: data?.role ?? null,
    accountId: data?.accountId ?? null,
    isLoading: authState === 'loading' || isLoading,
    // True when auth resolved + query resolved + still no membership.
    // Page components use this to switch from infinite skeleton to a
    // visible "we're still setting up your account, retry?" banner.
    needsProvisioning: authState === 'authenticated' && !isLoading && !data?.accountId && healedRef.current,
    isGuest: false,
  };
}
