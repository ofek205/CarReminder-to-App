/**
 * Notification write commands.
 *
 * notification.vehicleChange is a pure SIDE EFFECT: it fans a change out to the
 * other parties on a shared vehicle and is a server-side no-op when the vehicle
 * isn't shared. It always rides along AFTER a parent write succeeds, so in a
 * later phase it should be modelled as a derived effect of that parent command
 * rather than its own outbox entry — hence offlineCapable: false (never queue a
 * notification about a change that may itself never have landed).
 *
 * appNotification.markRead is the user's own inbox row: single-writer, safe
 * offline. NOTE the bulk variants (`.in('id', ids)` in NotificationBell) are
 * intentionally NOT here — they need a bulk command shape, and that file is
 * frequently under parallel edit. See docs/offline-architecture-spec.md.
 */
import { defineCommand } from '../registry';
import { supabase } from '@/lib/supabase';

defineCommand('notification.vehicleChange', {
  offlineCapable: false,
  table: 'app_notifications',
  kind: 'rpc',
  returnsEnvelope: true,
  run: ({ vehicleId, changeType, summary }) =>
    supabase.rpc('notify_vehicle_change', {
      p_vehicle_id: vehicleId,
      p_change_type: changeType,
      p_summary: summary,
    }),
});

defineCommand('appNotification.markRead', {
  offlineCapable: true,
  table: 'app_notifications',
  returnsEnvelope: true,
  run: ({ id, isRead = true }) =>
    supabase.from('app_notifications').update({ is_read: isRead }).eq('id', id),
});
