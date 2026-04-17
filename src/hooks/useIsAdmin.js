import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const ADMIN_EMAILS = ['ofek205@gmail.com'];

/**
 * Returns true if current user is admin, null while loading, false otherwise.
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
        const admin = user.user_metadata?.role === 'admin' || ADMIN_EMAILS.includes(user.email);
        setIsAdmin(admin);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  return isAdmin;
}
