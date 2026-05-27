/**
 * Shared cached hook for the current user's profile row.
 *
 * Backed by React Query so the profile is fetched ONCE and shared across
 * every consumer (Dashboard phone-check, NotificationBell license-expiry,
 * Notifications profile-incomplete card). Before this hook, each page did
 * its own raw `db.user_profiles.filter()` — the Bell alone was firing a
 * fresh Supabase round-trip on every page navigation because its useEffect
 * re-ran without caching. With ~30 slow-query alerts in 15 min, this was
 * the single biggest source of user_profiles.filter traffic.
 *
 * staleTime is 2 min — profile changes are rare (user edits phone/license
 * once), so aggressive caching is safe. On profile save, callers should
 * invalidate the query key to get immediate updates:
 *
 *   queryClient.invalidateQueries({ queryKey: USER_PROFILE_QUERY_KEY });
 *
 * Returns:
 *   - profile:   { id, user_id, phone, birth_date, driver_license_number,
 *                  license_expiration_date } | null
 *   - isLoading: boolean
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/shared/GuestContext';

export const USER_PROFILE_QUERY_KEY = 'user-profile';

export default function useUserProfile() {
  const { user, isGuest } = useAuth();
  const enabled = !!user?.id && !isGuest;

  const { data: profile = null, isLoading } = useQuery({
    queryKey: [USER_PROFILE_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { db } = await import('@/lib/supabaseEntities');
      const profiles = await db.user_profiles.filter(
        { user_id: user.id },
        { light: true },
      );
      return profiles.length > 0 ? profiles[0] : null;
    },
    enabled,
    staleTime: 2 * 60 * 1000,        // 2 min — profile rarely changes
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: 1,
    retryDelay: 500,
  });

  return { profile, isLoading: enabled && isLoading };
}
