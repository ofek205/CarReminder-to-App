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
import { useQuery } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';

export default function useAccountRole() {
  const { user, isGuest, authState } = useAuth();

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

  if (isGuest || authState === 'guest') {
    return { role: null, accountId: null, isLoading: false, isGuest: true };
  }

  return {
    role: data?.role ?? null,
    accountId: data?.accountId ?? null,
    isLoading: authState === 'loading' || isLoading,
    isGuest: false,
  };
}
