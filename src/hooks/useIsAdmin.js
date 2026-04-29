import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
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
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_admin');
      if (error) return false;
      return data === true;
    },
  });

  if (isGuest || authState === 'guest') return false;
  if (authLoading || (enabled && isLoading)) return null;

  return data === true;
}
