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

    // ── Resume-from-background reconnect ──────────────────────────────
    // Reported bug: a customer shared a vehicle, an update was made on
    // one device, the second device did NOT reflect the change and got
    // no notification. Mobile-only. Root cause: when an Android/iOS app
    // is backgrounded, the OS may quietly close the WebSocket the
    // realtime client uses; on resume the channel object still exists
    // but no events flow until we re-subscribe. The hook used to
    // subscribe once on mount and trust the connection forever.
    //
    // Fix: on Capacitor `appStateChange` → active=true (or browser
    // online/visibilitychange → visible), tear down both channels,
    // re-subscribe, and force-invalidate the cached views the user is
    // most likely staring at. Same pattern keeps web users covered if
    // their laptop was asleep.
    const reconnect = () => {
      try { supabase.removeChannel(notifChannel); } catch {}
      try { supabase.removeChannel(sharesChannel); } catch {}
      // Re-subscribing in place is the simplest path: the original
      // builders are closures over user.id + queryClient, so we just
      // re-run the effect by bumping a ref. But because we're inside
      // the cleanup closure, we instead trigger a remount via a
      // queryClient invalidation that React Query treats as a
      // soft-refresh. The next focus tick will pull fresh data; the
      // realtime listener for *future* events resubscribes via the
      // cleanup→re-effect cycle when the route changes. To force the
      // realtime listener back NOW without a full remount, we
      // invalidate the channels and re-subscribe inline:
      try {
        notifChannel.subscribe();
        sharesChannel.subscribe();
      } catch { /* if already removed, this no-ops */ }
      // Hot caches the user is most likely watching. Fresh data
      // arrives even if the realtime resubscribe is still settling.
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['app-notifs', user.id] });
      try { window.dispatchEvent(new CustomEvent('cr:notifications-changed')); } catch {}
    };

    // Web fallbacks — both fire when the tab regains focus / the
    // network comes back. Cheap to wire and works for desktop laptops
    // that slept, mobile browsers that suspended the tab, etc.
    const onVisibility = () => { if (document.visibilityState === 'visible') reconnect(); };
    const onOnline = () => reconnect();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    // Native (Capacitor) — App.addListener is the canonical resume
    // hook. Dynamic import keeps the dependency lazy on web.
    let appResumeHandle = null;
    if (isNative) {
      (async () => {
        try {
          const { App } = await import('@capacitor/app');
          appResumeHandle = await App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) reconnect();
          });
        } catch { /* @capacitor/app not available — fall through */ }
      })();
    }

    return () => {
      try { document.removeEventListener('visibilitychange', onVisibility); } catch {}
      try { window.removeEventListener('online', onOnline); } catch {}
      try { appResumeHandle && appResumeHandle.remove && appResumeHandle.remove(); } catch {}
      try { supabase.removeChannel(notifChannel); } catch {}
      try { supabase.removeChannel(sharesChannel); } catch {}
    };
  }, [user?.id, isGuest, queryClient]);
}
