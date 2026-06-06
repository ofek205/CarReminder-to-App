import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { useAuth } from '@/components/shared/GuestContext';

/**
 * Returns true if current user is admin, null while loading, false otherwise.
 *
 * Source of truth is the SECURITY DEFINER RPC public.is_admin() in Supabase.
 * The server decides — never the client. A patched JS bundle or a JWT with
 * faked user_metadata can no longer self-identify as admin; the RPC checks
 * auth.uid() against the server-side allow-list.
 */
export default function useIsAdmin() {
  const { user, isGuest, isLoading: authLoading, authState } = useAuth();
  const enabled = !!user?.id && !isGuest;

  const { data, isLoading } = useQuery({
    queryKey: ['is-admin', user?.id],
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    retryDelay: 500,
    queryFn: async () => {
      // withTimeout so a hung is_admin RPC can't pin the whole admin area on
      // an infinite loading spinner (Query Timeout Gate). On timeout/error we
      // resolve to false rather than staying pending forever.
      const { data, error } = await withTimeout(supabase.rpc('is_admin'), 'is_admin');
      if (error) return false;
      const isAdmin = data === true;
      try { localStorage.setItem('cr_is_admin', isAdmin ? '1' : '0'); } catch {}
      return isAdmin;
    },
  });

  if (isGuest || authState === 'guest') return false;
  if (authLoading || (enabled && isLoading)) return null;

  return data === true;
}
