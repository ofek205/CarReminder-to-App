/**
 * App-notification rendering config.
 *
 * Single source of truth for icon/color/navigation per notification
 * `type`. Imported by NotificationBell and the Notifications page so
 * both surfaces stay in sync when we add a type or change copy.
 *
 * Notification rows live in `public.app_notifications`. The RPC layer
 * writes the title + body in Hebrew (see supabase-vehicle-shares.sql);
 * this module is purely visual / navigational.
 */

import { Share2, Check, X, UserMinus, LogOut, Trash2, Clock, Edit3, Bell, Mail, MessageSquare, Briefcase, Truck, ClipboardList, ShieldCheck, UserPlus, Download } from 'lucide-react';

const ACTION_REQUIRED_TYPES = new Set([
  'share_offered',
  'account_invite_offered',
  'task_assigned',
  'driver_assigned',
  'workspace_member_added',
]);

// Build a deep-link href from the row's `data` jsonb. Each function is
// pure so callers can resolve the href without state. When a type
// genuinely has no follow-up screen (e.g. share_deleted — vehicle is
// already gone), return `null` and the bell will simply mark-read on
// click without navigating.
const hrefForVehicleDetail = (data) => data?.vehicle_id
  ? `/VehicleDetail?id=${encodeURIComponent(data.vehicle_id)}`
  : null;

export const APP_NOTIF_CONFIG = {
  share_offered: {
    icon: Share2,
    bg: '#ECFDF5',
    iconColor: '#059669',
    iconBg: '#059669',
    buildHref: (data) => data?.invite_token
      ? `/JoinInvite?token=${encodeURIComponent(data.invite_token)}&type=vehicle`
      : '/AccountSettings',
  },
  share_accepted: {
    icon: Check,
    bg: '#F0FDF4',
    iconColor: '#16A34A',
    iconBg: '#16A34A',
    buildHref: hrefForVehicleDetail,
  },
  share_declined: {
    icon: X,
    bg: '#FEF2F2',
    iconColor: '#DC2626',
    iconBg: '#DC2626',
    buildHref: hrefForVehicleDetail,
  },
  share_revoked: {
    icon: UserMinus,
    bg: '#FFF7ED',
    iconColor: '#EA580C',
    iconBg: '#EA580C',
    buildHref: hrefForVehicleDetail,
  },
  share_left: {
    icon: LogOut,
    bg: '#FFF7ED',
    iconColor: '#EA580C',
    iconBg: '#EA580C',
    buildHref: hrefForVehicleDetail,
  },
  share_deleted: {
    icon: Trash2,
    bg: '#FEF2F2',
    iconColor: '#DC2626',
    iconBg: '#DC2626',
    // Vehicle is gone. Don't navigate — clicking just dismisses.
    buildHref: () => null,
  },
  share_expired: {
    icon: Clock,
    bg: '#FFF8E1',
    iconColor: '#D97706',
    iconBg: '#D97706',
    // Re-invite happens from the vehicle's own access modal in the
    // owner case, or from the AccountSettings page in the recipient
    // case. Default to the vehicle if we have its id.
    buildHref: (data) => hrefForVehicleDetail(data) || '/AccountSettings',
  },
  vehicle_change: {
    icon: Edit3,
    bg: '#EEF2FF',
    iconColor: '#4338CA',
    iconBg: '#4338CA',
    buildHref: hrefForVehicleDetail,
  },
  share_role_changed: {
    // Owner changed the recipient's role on a shared vehicle. Same
    // indigo as vehicle_change — both are "the owner did something
    // and you should know" notifications. Routes to the vehicle so
    // the recipient can see what they now have access to.
    icon: Edit3,
    bg: '#EEF2FF',
    iconColor: '#4338CA',
    iconBg: '#4338CA',
    buildHref: hrefForVehicleDetail,
  },
  workspace_member_added: {
    // Manager added the user to a business workspace. Routes to the
    // driver-facing home page so a driver lands somewhere useful,
    // and a viewer/manager can navigate from there.
    icon: Briefcase,
    bg: '#E8F2EA',
    iconColor: '#2D5233',
    iconBg: '#2D5233',
    buildHref: () => '/MyVehicles',
  },
  task_assigned: {
    // Manager created or reassigned a task to this driver. Routes
    // straight to the task detail (RouteDetail) so the driver can
    // start working immediately. Falls back to the task list if the
    // route id is missing for any reason.
    icon: ClipboardList,
    bg: '#E8F2EA',
    iconColor: '#2D5233',
    iconBg: '#2D5233',
    buildHref: (data) => data?.route_id
      ? `/RouteDetail?id=${encodeURIComponent(data.route_id)}`
      : '/Routes',
  },
  driver_assigned: {
    // Manager assigned this user a vehicle. Routes the driver to
    // MyVehicles where the new card now appears so the next tap lands
    // them on something useful.
    icon: Truck,
    bg: '#E8F2EA',
    iconColor: '#2D5233',
    iconBg: '#2D5233',
    buildHref: () => '/MyVehicles',
  },
  workspace_member_left: {
    // A member voluntarily left a business workspace (delete-account
    // flow). Routes the manager to the Drivers page so they can see
    // the updated directory and reassign vehicles if needed.
    icon: LogOut,
    bg: '#FFF7ED',
    iconColor: '#EA580C',
    iconBg: '#EA580C',
    buildHref: () => '/Drivers',
  },
  test_renewed: {
    // Auto-detected annual-test renewal (the cron job spotted that
    // the ministry pushed a new tokef_dt for one of the user's
    // vehicles). Positive confirmation — green family, shield-check
    // icon. Routes to the vehicle so the user can see the new test
    // date inline on the vehicle card.
    icon: ShieldCheck,
    bg: '#F0FDF4',
    iconColor: '#16A34A',
    iconBg: '#16A34A',
    buildHref: hrefForVehicleDetail,
  },
  gov_sync_update: {
    // 2026-05-17: sibling of test_renewed, but for the km side of the
    // gov.il sync. Fires when the daily sync detects that the ministry
    // pushed a higher current_km value than we have stored AND the
    // user has not overridden it manually since the last test date.
    // Same green/shield language family so the two reads as a single
    // "we picked something up for you" experience. The actual title +
    // body strings are written by the server-side RPC (gov_sync.sql)
    // so they can interpolate the specific km / test-date values.
    icon: ShieldCheck,
    bg: '#F0FDF4',
    iconColor: '#16A34A',
    iconBg: '#16A34A',
    buildHref: hrefForVehicleDetail,
  },
  community_comment: {
    // Reused for any community thread reply on the user's own post.
    // Purple matches the existing "תגובות בקהילה" chrome elsewhere
    // in the app (CommentSection accent, post-comment chip).
    icon: MessageSquare,
    bg: '#F5F3FF',
    iconColor: '#7C3AED',
    iconBg: '#7C3AED',
    // Deep-link straight to the post via ?post=<id>. The Community
    // page reads that param on mount, scrolls to the matching card,
    // and gives it a brief highlight ring so the user lands exactly
    // where the comment is — no scrolling around to find their post.
    buildHref: (data) => data?.post_id
      ? `/Community?post=${encodeURIComponent(data.post_id)}`
      : '/Community',
  },
  admin_message: {
    icon: Mail,
    bg: '#DBEAFE',
    iconColor: '#1D4ED8',
    iconBg: '#1D4ED8',
    buildHref: () => null,
  },
  app_update: {
    icon: Download,
    bg: '#FEF3C7',
    iconColor: '#D97706',
    iconBg: '#D97706',
    buildHref: () => {
      const p = window?.Capacitor?.getPlatform?.();
      if (p === 'ios') return 'https://apps.apple.com/app/carreminder/id6764073107';
      if (p === 'android') return 'https://play.google.com/store/apps/details?id=com.carreminder.app';
      return null;
    },
  },
  account_invite_offered: {
    icon: UserPlus,
    bg: '#ECFDF5',
    iconColor: '#059669',
    iconBg: '#059669',
    buildHref: () => '/AccountSettings',
  },
  account_invite_accepted: {
    icon: Check,
    bg: '#F0FDF4',
    iconColor: '#16A34A',
    iconBg: '#16A34A',
    buildHref: () => '/AccountSettings',
  },
  account_invite_declined: {
    icon: X,
    bg: '#FEF2F2',
    iconColor: '#DC2626',
    iconBg: '#DC2626',
    buildHref: () => '/AccountSettings',
  },
  _default: {
    icon: Bell,
    bg: '#F9FAFB',
    iconColor: '#6B7280',
    iconBg: '#6B7280',
    buildHref: () => null,
  },
};

export function configForType(type) {
  return APP_NOTIF_CONFIG[type] ?? APP_NOTIF_CONFIG._default ?? {
    icon: Bell, bg: '#F9FAFB', iconColor: '#6B7280', iconBg: '#6B7280',
    buildHref: () => null,
  };
}

export function requiresActionForType(type) {
  return ACTION_REQUIRED_TYPES.has(type);
}

export function decodeNotifBody(s) {
  if (!s) return s;
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#8203;/g, '')
    .replace(/&nbsp;/g, ' ');
}
