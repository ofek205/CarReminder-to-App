import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Returns true if current user is admin, null while loading, false otherwise.
 *
 * Source of truth is the SECURITY DEFINER RPC public.is_admin() in Supabase.
 * The server decides — never the client. A patched JS bundle or a JWT with
 * faked user_metadata can no longer self-identify as admin; the RPC checks
 * auth.uid() against the server-side allow-list.
 */
export default function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) { setIsAdmin(false); return; }

        const { data, error } = await supabase.rpc('is_admin');
        if (cancelled) return;
        if (error) { setIsAdmin(false); return; }
        setIsAdmin(data === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  return isAdmin;
}
