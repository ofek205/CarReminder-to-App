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
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length > 0) {
        return { role: members[0].role, accountId: members[0].account_id };
      }
      return { role: null, accountId: null };
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
