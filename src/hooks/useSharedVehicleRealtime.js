/**
 * useSharedVehicleRealtime — keeps all sides of a shared vehicle in
 * sync without manual refresh.
 *
 * Subscribes (per logged-in user) to two real-time channels:
 *
 *  1. `app_notifications` INSERT where user_id = me.
 *     - Refreshes the bell counter + the Notifications page.
 *     - On Capacitor native, fires a LocalNotification so the user
 *       sees the change land even if the app is in the background.
 *     - If the row is a `vehicle_change`, invalidates every cached
 *       query keyed on that vehicle so the page they're looking at
 *       repaints with the new data instantly.
 *
 *  2. `vehicle_shares` UPDATE/INSERT/DELETE where the row is one of
 *     mine. Catches the case where Owner A revokes Sharee B mid-
 *     session — B's Dashboard kicks the now-revoked vehicle off
 *     without B having to refresh.
 *
 * Mounted once at the Layout level for authenticated users. Designed
 * to be a no-op on web for guests + safe to remount (each subscribe
 * is balanced by an unsubscribe in the cleanup).
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { isNative } from '@/lib/capacitor';

export default function useSharedVehicleRealtime() {
  const { user, isGuest } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest || !user?.id) return;

    // ── Channel 1: my own notifications ─────────────────────────────
    const notifChannel = supabase
      .channel(`app_notifs_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload?.new || {};
          // Bell + Notifications page both consume these caches.
          queryClient.invalidateQueries({ queryKey: ['app-notifs', user.id] });
          // The bell builds notifications inline from a different
          // queryKey ('notifications-bell'); we trigger its refetch
          // by bumping a window event the bell already listens to.
          try { window.dispatchEvent(new CustomEvent('cr:notifications-changed')); } catch {}

          // For vehicle_change events, also invalidate the affected
          // vehicle's cached views so the change appears immediately
          // on whatever page the user is looking at.
          const vid = row?.data?.vehicle_id;
          if (row?.type === 'vehicle_change' && vid) {
            queryClient.invalidateQueries({ queryKey: ['vehicle', vid] });
            queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
            queryClient.invalidateQueries({ queryKey: ['repairLogs'] });
            queryClient.invalidateQueries({ queryKey: ['maintenance-logs-v2', vid] });
            queryClient.invalidateQueries({ queryKey: ['cork-notes', vid] });
            queryClient.invalidateQueries({ queryKey: ['tasks-v2', vid] });
            queryClient.invalidateQueries({ queryKey: ['documents'] });
            queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', vid] });
          }
          // share_revoked / share_deleted / share_left: the recipient's
          // vehicle list just changed. Drop the cached version.
          if (
            row?.type === 'share_revoked'
            || row?.type === 'share_deleted'
            || row?.type === 'share_left'
            || row?.type === 'share_accepted'
          ) {
            queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
            queryClient.invalidateQueries({ queryKey: ['vehicle-shares', vid] });
            queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', vid] });
          }

          // Native: ping the device. Web doesn't have this surface; the
          // bell + toast on focus cover that case.
          if (isNative && row?.title) {
            (async () => {
              try {
                const { scheduleLocalNotification, requestNotificationPermission, checkNotificationPermission, createNotificationChannel } = await import('@/lib/notificationChannels');
                let granted = await checkNotificationPermission();
                if (!granted) granted = await requestNotificationPermission();
                if (!granted) return;
                await createNotificationChannel();
                // Dedup with the bell-fetch path so we don't ping twice
                // for the same row (the bell also fires LocalNotifications
                // on first-fetch). localStorage flag is shared.
                const key = `app_push_fired_${row.id}`;
                if (localStorage.getItem(key)) return;
                localStorage.setItem(key, '1');
                await scheduleLocalNotification({
                  id: `app-${row.id}`,
                  title: row.title,
                  body:  row.body || '',
                  scheduleAt: new Date(Date.now() + 1500),
                  extra: { type: 'app', appType: row.type, appNotifId: row.id },
                });
              } catch { /* never block the realtime listener */ }
            })();
          }
        }
      )
      .subscribe();

    // ── Channel 2: my vehicle_shares lifecycle ─────────────────────
    // Catches the case where someone else (the owner) changed a row
    // that affects MY visible vehicles. The notification path above
    // handles most cases, but a direct table subscribe gives instant
    // dashboard reactivity even when the notification insert is
    // delayed by a millisecond or two.
    const sharesChannel = supabase
      .channel(`vehicle_shares_mine_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',                         // INSERT | UPDATE | DELETE
          schema: 'public',
          table: 'vehicle_shares',
          filter: `shared_with_user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
          queryClient.invalidateQueries({ queryKey: ['app-notifs', user.id] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'vehicle_shares',
          filter: `owner_user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload?.new || payload?.old || {};
          queryClient.invalidateQueries({ queryKey: ['vehicle-shares', row.vehicle_id] });
          queryClient.invalidateQueries({ queryKey: ['vehicle-share-info', row.vehicle_id] });
          queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(notifChannel); } catch {}
      try { supabase.removeChannel(sharesChannel); } catch {}
    };
  }, [user?.id, isGuest, queryClient]);
}
