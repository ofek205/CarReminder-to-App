/**
 * NotificationBell — authenticated-only bell icon + dropdown.
 *
 * Lives in its own module (previously a 568-line inner function in
 * Layout.jsx) so Vite can emit a separate chunk and Layout's initial
 * bundle gets meaningfully smaller. Guest users never render this, and
 * even authenticated users don't need the code parsed until the header
 * paints.
 *
 * No behavior change from the inline version — same queries, same
 * localStorage keys ('read_notif_ids', 'read_notif_timed',
 * 'dismissed_notif_ids', 'carreminder_mileage_dates',
 * 'winter_dismissed_{year}', 'sailing_dismissed_{year}'), same UI.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { MEMBER_STATUS } from '@/lib/enums';
import { Bell, User, FileText, MessageSquare, AlertTriangle, Wrench, Gauge, X, Clock, Check, Loader2 } from 'lucide-react';
import AdminMessageDialog from '@/components/shared/AdminMessageDialog';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { he as heLocale } from 'date-fns/locale';
import { configForType as appConfigForType, requiresActionForType, decodeNotifBody } from '@/lib/appNotificationConfig';
import { calcAllReminders } from '@/components/shared/ReminderEngine';

// Hebrew "X ago" label for an ISO timestamp. Returns null for
// missing/invalid input so callers can omit the row entirely.
// addSuffix: true → date-fns prefixes "לפני" automatically with
// the Hebrew locale, so "5 minutes ago" → "לפני 5 דקות". Wrapped
// in try/catch because clock skew on the device can yield
// negative diffs, which formatDistanceToNow throws on.
function formatRelativeTime(isoString) {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;
    return formatDistanceToNow(d, { addSuffix: true, locale: heLocale });
  } catch { return null; }
}

function reminderToBellItem(reminder) {
  return {
    id: reminder.id,
    vehicleId: reminder.vehicleId || null,
    type: reminder.type,
    label: reminder.label || reminder.typeName || 'תזכורת',
    name: reminder.name || '',
    days: reminder.daysLeft ?? 999,
    isExpired: reminder.daysLeft !== null && reminder.daysLeft !== undefined && reminder.daysLeft < 0,
    navTarget: reminder.linkTo,
  };
}

function isActionNotification(notification) {
  if (!notification) return false;
  if (notification.type === 'app') return requiresActionForType(notification.appType);
  return ['profile', 'license', 'test', 'insurance', 'inspection', 'maintenance', 'mileage', 'safety'].includes(notification.type);
}

// ── Tier palette + classifier (visual urgency triage) ──────────────
// Each row gets a 3-4px RTL leading-edge stripe + matching icon-chip
// tint based on tier. Section headers reuse the same hue so the
// reader's eye scans by urgency before reading any text. Colors are
// SEMANTIC (don't change with vehicle theme) — urgency reads the
// same on a green Toyota dashboard or a marine-blue boat dashboard.
const NOTIF_TIER = {
  urgent:    { fg: '#DC2626', bg: 'rgba(220,38,38,0.10)', label: 'דחוף',  rank: 0 },
  warn:      { fg: '#F59E0B', bg: 'rgba(245,158,11,0.10)', label: 'בקרוב', rank: 1 },
  share:     { fg: '#4F46E5', bg: 'rgba(79,70,229,0.10)', label: 'שיתוף', rank: 2 },
  community: { fg: '#0D9488', bg: 'rgba(13,148,136,0.10)', label: 'קהילה', rank: 3 },
  info:      { fg: '#16A34A', bg: 'rgba(22,163,74,0.10)', label: 'כללי',  rank: 4 },
};

function getNotifTier(n) {
  if (!n) return 'info';
  if (n.isExpired) return 'urgent';
  // App-type prefix routing — share_* go to share, community_* go to community.
  if (n.type === 'app' && typeof n.appType === 'string') {
    if (n.appType.startsWith('share') || n.appType.startsWith('workspace_')
        || n.appType === 'driver_assigned' || n.appType === 'task_assigned') return 'share';
    if (n.appType === 'community_comment') return 'community';
  }
  if (n.type === 'community') return 'community';
  // Date-bound items with limited horizon are "warn"; everything else
  // (mileage nudge, seasonal, profile-incomplete, info-only) is info.
  if (typeof n.days === 'number' && n.days >= 0 && n.days <= 14) return 'warn';
  return 'info';
}

// ── Section header (sticky inside the popover scroll) ──────────────
// Renders the tier dot + Hebrew label + counter chip. backdrop-blur
// gives the sticky header that subtle glassiness when rows scroll
// underneath. Counter chip uses tabular numerals so 1/10/100 don't
// jitter the layout width.
function TierHeader({ tier, count }) {
  const t = NOTIF_TIER[tier];
  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-2 px-4"
      style={{
        height: 32,
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid #EEF2EE',
      }}
    >
      <span className="rounded-full" style={{ width: 6, height: 6, background: t.fg, boxShadow: `0 0 8px ${t.fg}66` }} />
      <span className="text-[11px] font-bold tracking-wide" style={{ color: '#5A6B5D' }}>
        {t.label}
      </span>
      <span
        className="text-[11px] font-bold px-1.5 rounded-full"
        style={{
          background: '#E8E2D2',
          border: '1px solid #D8D0BD',
          color: '#3D4F40',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 22,
          textAlign: 'center',
          lineHeight: '18px',
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ── Empty-state envelope ───────────────────────────────────────────
// One SVG, two variants — `plain` for "אין התראות" (truly empty),
// `checked` for "הכל קראת" (read items exist on /Notifications page).
// Inline SVG instead of an icon library so the variant logic stays
// self-contained and the colors track the surrounding paper bg.
function EmptyEnvelope({ variant }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="mx-auto block">
      <rect x="8" y="16" width="48" height="32" rx="6" stroke="#B5AC9A" strokeWidth="2" />
      <path d="M8 22l24 16 24-16" stroke="#B5AC9A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {variant === 'checked' && (
        <g>
          <circle cx="48" cy="48" r="9" fill="#FFFFFF" stroke="#16A34A" strokeWidth="2" />
          <path d="M44 48l3 3 5-6" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}

function EmptyState({ allEmpty }) {
  return (
    <div className="py-12 px-6 text-center">
      <EmptyEnvelope variant={allEmpty ? 'plain' : 'checked'} />
      <p className="mt-4 text-[14px] font-semibold" style={{ color: '#1C2E20' }}>
        {allEmpty ? 'אין התראות' : 'הכל קראת'}
      </p>
      <p className="mt-1 text-[12px]" style={{ color: '#8B9C8E' }}>
        {allEmpty ? 'תוצג כאן כל התראה חדשה' : 'להיסטוריה — "כל ההתראות"'}
      </p>
    </div>
  );
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [readIds, setReadIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
      // Check timed reads. remove expired ones (older than 7 days)
      const timedReads = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
      const now = Date.now();
      const validTimedIds = Object.entries(timedReads)
        .filter(([_, ts]) => now - ts < 7 * 24 * 60 * 60 * 1000)
        .map(([id]) => id);
      return new Set([...stored, ...validTimedIds]);
    } catch { return new Set(); }
  });
  const [popupOpen, setPopupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inviteActing, setInviteActing] = useState(null);
  const [adminMsg, setAdminMsg] = useState(null);

  // Inject the badge-pulse keyframes exactly once per page. Doing it
  // here (instead of importing a CSS file) keeps the animation
  // collocated with the only component that uses it — no global CSS
  // file proliferation for a 4-line keyframe.
  useEffect(() => {
    if (document.getElementById('cr-bell-pulse-css')) return;
    const s = document.createElement('style');
    s.id = 'cr-bell-pulse-css';
    s.textContent = `
      @keyframes crBellPulse {
        0%, 100% { transform: scale(1);    opacity: 1;   }
        50%      { transform: scale(1.08); opacity: 0.82;}
      }
    `;
    document.head.appendChild(s);
  }, []);
  const { user } = useAuth();
  // activeWorkspaceId scopes the vehicle-derived reminders. Without it,
  // a multi-workspace user always saw the bell pinned to the first
  // membership row (personal or business, whichever sorted first), so
  // switching workspaces left the bell mismatched against the page they
  // were looking at. User-level rows (profile, license, app_notifications,
  // community) stay untouched — those aren't tied to a workspace.
  const { activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();

  useEffect(() => {
    // Debounced refetch trigger. Three different events feed this
    // pipeline (profile saves, custom dispatches, realtime
    // notifications) and they often fire back-to-back — a profile
    // save dispatches both userProfileUpdated AND profileSaved, and a
    // realtime burst can deliver several share-changed events in one
    // tick. Without this, the bell's full 4-table fetch cascade
    // (~30-50KB) ran 3-5× in a single second. 300ms collapses the
    // burst into one refetch while still feeling instant.
    let timer = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRefreshKey(k => k + 1), 300);
    };
    window.addEventListener('userProfileUpdated', handler);
    window.addEventListener('profileSaved', handler);
    // Fired by useSharedVehicleRealtime when a new app_notifications
    // row arrives via Supabase realtime — bumps the bell so the new
    // share/vehicle-change/etc lights up without a manual refresh.
    window.addEventListener('cr:notifications-changed', handler);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('userProfileUpdated', handler);
      window.removeEventListener('profileSaved', handler);
      window.removeEventListener('cr:notifications-changed', handler);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { db } = await import('@/lib/supabaseEntities');
        const [profilesResult, membersResult, settingsResult] = await Promise.all([
          db.user_profiles.filter({ user_id: user.id }).catch(() => []),
          db.account_members.filter({ user_id: user.id, status: MEMBER_STATUS.ACTIVE }).catch(() => []),
          db.reminder_settings.filter({ user_id: user.id }).catch(() => []),
        ]);

        const profileNotifs = [];
        const profile = profilesResult.length > 0 ? profilesResult[0] : null;
        if (!profile || !profile.phone) {
          profileNotifs.push({
            id: 'profile-incomplete', vehicleId: null, type: 'profile',
            label: 'השלם פרטים אישיים',
            name: 'הוסף טלפון ותאריך לידה באזור האישי',
            days: -999, isExpired: false,
          });
        }
        if (profile?.license_expiration_date) {
          const licDays = Math.ceil((new Date(profile.license_expiration_date) - new Date()) / 86400000);
          if (licDays <= 30) {
            profileNotifs.push({
              id: 'license-expiry', vehicleId: null, type: 'license',
              label: licDays < 0 ? 'רישיון נהיגה פג תוקף!' : `רישיון נהיגה בעוד ${licDays} ימים`,
              name: 'עדכן באזור האישי',
              days: licDays, isExpired: licDays < 0,
            });
          }
        }
        setNotifications(prev => {
          const withoutProfile = prev.filter(n => n.id !== 'profile-incomplete' && n.id !== 'license-expiry');
          return [...profileNotifs, ...withoutProfile];
        });

        if (membersResult.length === 0) return;
        // Pick the workspace the user is currently looking at. Falls
        // back to the first active membership only when the workspace
        // context hasn't resolved yet (very first render); otherwise
        // the bell would either lag behind a workspace switch or pull
        // vehicles from the wrong account entirely.
        const activeMember = activeWorkspaceId
          ? membersResult.find(m => m.account_id === activeWorkspaceId)
          : null;
        const targetAccountId = activeMember?.account_id || membersResult[0].account_id;
        const targetMember = activeMember || membersResult[0];
        // Bell only reads dates and labels off each vehicle — never
        // photos, notes, or any base64 column. Restricting to the
        // exact 11 columns used below shaves the per-vehicle payload
        // from ~50-200 KB (because of vehicle_photo) to a few hundred
        // bytes. Multiplied across an account's vehicles + every
        // refresh, this is the bell's biggest single egress win.
        const BELL_COLS = [
          'id', 'nickname', 'manufacturer', 'model', 'year', 'vehicle_type',
          'is_vintage',
          // expiry dates the bell renders
          'test_due_date', 'insurance_due_date',
          'pyrotechnics_expiry_date', 'fire_extinguisher_expiry_date',
          'life_raft_expiry_date', 'inspection_report_expiry_date',
          // mileage-driven reminders (tires, service, "no update" warning)
          'current_km', 'current_engine_hours',
          'last_tire_change_date', 'km_since_tire_change',
          'km_baseline', 'last_shipyard_date',
          'km_update_date', 'engine_hours_update_date',
        ].join(',');
        let vehicles = [];
        const isBusinessDriver = targetMember?.account_type === 'business' && targetMember?.role === 'driver';
        if (isBusinessDriver) {
          const { data: assignments, error: assignmentError } = await supabase
            .from('driver_assignments')
            .select('vehicle_id')
            .eq('account_id', targetAccountId)
            .eq('driver_user_id', user.id)
            .eq('status', 'active');
          if (assignmentError) throw assignmentError;
          const vehicleIds = (assignments || []).map(a => a.vehicle_id).filter(Boolean);
          if (vehicleIds.length > 0) {
            const { data, error } = await supabase
              .from('vehicles')
              .select(BELL_COLS)
              .eq('account_id', targetAccountId)
              .in('id', vehicleIds);
            if (error) throw error;
            vehicles = data || [];
          }
        } else {
          vehicles = await db.vehicles.filter(
            { account_id: targetAccountId },
            { select: BELL_COLS },
          );
        }

        const items = [];
        items.push(...calcAllReminders({
          vehicles,
          documents: [],
          settings: settingsResult[0] || {},
        }).map(reminderToBellItem));

        // Defer sorting to setNotifications below — we need to mix in
        // community + app_notifications (which carry real createdAt
        // timestamps) and the legacy profile/license rows from prev,
        // and only THEN apply a single unified sort. Sorting here would
        // be a partial sort that the trailing pushes invalidate.

        try {
          const { data: communityNotifs, error: cnError } = await supabase
            .from('community_notifications')
            // Narrow select — the bell only reads id, commenter_name and
            // created_at. Pulling '*' dragged the full notification body
            // (post excerpts, comment text, metadata) over the wire on
            // every bell mount, which the UI never showed.
            .select('id, commenter_name, created_at')
            .eq('user_id', user.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!cnError && communityNotifs) communityNotifs.forEach(cn => {
            items.push({
              id: `community-${cn.id}`, vehicleId: null, type: 'community',
              label: `${cn.commenter_name} הגיב/ה על השאלה שלך`,
              name: 'לחץ לצפייה',
              days: 500, isExpired: false,
              navTarget: 'Community',
              _communityNotifId: cn.id,
              // Real arrival timestamp — used by the chronological sort
              // and by the "לפני N דקות" label on each row.
              createdAt: cn.created_at,
            });
          });
        } catch {}

        // Generic app_notifications (share_offered / share_accepted / …).
        // Displayed alongside reminders. Marking read clears the row so the
        // bell count deflates; we never delete — users can still see history
        // on the full Notifications page.
        try {
          const { data: appNotifs, error: anError } = await supabase
            .from('app_notifications')
            // Narrow select — the bell renders id, type, title, body,
            // data (for buildHref), created_at, is_read. Internal
            // bookkeeping columns (updated_at, push_fired flags etc)
            // are not needed for the dropdown.
            .select('id, type, title, body, data, created_at, is_read')
            .eq('user_id', user.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false })
            .limit(10);
          if (!anError && appNotifs) {
            appNotifs.forEach(an => {
              // Resolve href via the shared config so a new type gets
              // the right target/icon by adding one row to the map —
              // no edits in the bell or page click handlers.
              const cfg = appConfigForType(an.type);
              const href = cfg.buildHref(an.data || {});
              items.push({
                id: `app-${an.id}`, vehicleId: null, type: 'app',
                appType: an.type,
                label: an.title,
                name: an.body || '',
                days: 500, isExpired: false,
                navHref: href,                            // resolved string or null
                // Keep the raw data jsonb on the item so the click
                // handler can re-resolve href at click time as a
                // fallback (covers the stale-cache window where a
                // notification arrived in a tab that loaded the bell
                // before the appNotificationConfig got a new type
                // added to the map).
                appData: an.data || {},
                _appNotifId: an.id,
                // Real arrival timestamp from the DB row. Drives both
                // chronological sort (newest first) and the visible
                // "לפני N דקות" label.
                createdAt: an.created_at,
              });
            });

            // Fire a device-level local notification for any app_notification
            // we haven't pinged yet. Key pattern: `app_push_fired_<id>` in
            // localStorage so a single event only fires once per install,
            // even if the bell reloads multiple times. No-op on web.
            try {
              const { isNative: native } = await import('@/lib/capacitor');
              if (native) {
                const { scheduleLocalNotification, requestNotificationPermission, checkNotificationPermission, createNotificationChannel } = await import('@/lib/notificationChannels');
                let granted = await checkNotificationPermission();
                if (!granted) granted = await requestNotificationPermission();
                if (granted) {
                  await createNotificationChannel();
                  for (const an of appNotifs) {
                    const key = `app_push_fired_${an.id}`;
                    if (localStorage.getItem(key)) continue;
                    // Fire ~2s from now so the scheduler doesn't drop a past-time
                    // notification. Good enough for "ping on app open".
                    await scheduleLocalNotification({
                      id: `app-${an.id}`,
                      title: an.title,
                      body: an.body || '',
                      scheduleAt: new Date(Date.now() + 2000),
                      extra: { type: 'app', appType: an.type, appNotifId: an.id },
                    });
                    localStorage.setItem(key, '1');
                  }
                }
              }
            } catch {}
          }
        } catch {}

        let dismissedIds = [];
        try { dismissedIds = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]'); } catch {}
        const dismissedSet = new Set(dismissedIds);

        setNotifications(prev => {
          const profileNotifs = prev.filter(n => n.id === 'profile-incomplete' || n.id === 'license-expiry');
          const filtered = [...profileNotifs, ...items].filter(n => !dismissedSet.has(n.id));
          // Chronological-first sort:
          //   1. Items with a real createdAt (DB-backed: shares,
          //      vehicle-change events, community replies) — newest
          //      arrival on top. This is what the user sees as
          //      "התראה חדשה" — must lead.
          //   2. Items WITHOUT createdAt (synthetic reminders:
          //      profile/license/expiry/mileage/seasonal) — these
          //      are derived from data state, not arrival events;
          //      they fall below the dated section, ordered by
          //      urgency (expired first, then by days remaining).
          filtered.sort((a, b) => {
            const aHas = !!a.createdAt;
            const bHas = !!b.createdAt;
            if (aHas && bHas) return new Date(b.createdAt) - new Date(a.createdAt);
            if (aHas) return -1;
            if (bHas) return 1;
            if (a.isExpired && !b.isExpired) return -1;
            if (!a.isExpired && b.isExpired) return 1;
            return (a.days ?? 0) - (b.days ?? 0);
          });
          return filtered;
        });
      } catch (err) {
        // Surface in dev so we notice regressions in the notification pipeline;
        // still don't block rendering — an empty bell is fine for the user.
        if (import.meta.env?.DEV) console.warn('[NotificationBell] fetch failed:', err?.message);
      }
    })();
    // activeWorkspaceId is in deps so a workspace switch refetches the
    // bell against the new account immediately. Without it the bell
    // would keep showing the previous workspace's reminders until some
    // unrelated event (profile save, realtime ping) bumped refreshKey.
  }, [user, refreshKey, activeWorkspaceId]);

  const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

  const markRead = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      if (id === 'profile-incomplete') {
        try {
          const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
          timed[id] = Date.now();
          localStorage.setItem('read_notif_timed', JSON.stringify(timed));
        } catch {}
      } else {
        const permanentIds = [...next].filter(i => i !== 'profile-incomplete');
        localStorage.setItem('read_notif_ids', JSON.stringify(permanentIds));
      }
      return next;
    });
  };

  const markUnread = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      if (id === 'profile-incomplete') {
        try {
          const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
          delete timed[id];
          localStorage.setItem('read_notif_timed', JSON.stringify(timed));
        } catch {}
      } else {
        localStorage.setItem('read_notif_ids', JSON.stringify([...next].filter(i => i !== 'profile-incomplete')));
      }
      return next;
    });
  };

  const persistRemoteReadState = async (notification, nextRead) => {
    if (!notification) return;
    try {
      if (notification._communityNotifId) {
        await supabase
          .from('community_notifications')
          .update({ is_read: nextRead })
          .eq('id', notification._communityNotifId);
      }
      if (notification._appNotifId) {
        await supabase
          .from('app_notifications')
          .update({ is_read: nextRead })
          .eq('id', notification._appNotifId);
        window.dispatchEvent(new CustomEvent('cr:notifications-changed'));
      }
    } catch {}
  };

  const handleInviteAction = async (n, action) => {
    const memberId = n.appData?.member_id;
    if (!memberId) return;
    setInviteActing(`${n.id}-${action}`);
    try {
      const rpc = action === 'accept' ? 'accept_account_invite' : 'decline_account_invite';
      const { error } = await supabase.rpc(rpc, { p_member_id: memberId });
      if (error) throw error;
      await persistRemoteReadState(n, true);
      markRead(n.id);
      setRefreshKey(k => k + 1);
      toast.success(action === 'accept' ? 'הצטרפת לחשבון בהצלחה' : 'ההזמנה נדחתה');
    } catch (e) {
      const msg = (e?.message || '').includes('invite_not_pending')
        ? 'ההזמנה כבר טופלה'
        : `שגיאה: ${e?.message || 'נסה שוב'}`;
      toast.error(msg);
    } finally {
      setInviteActing(null);
    }
  };

  const markItemReadState = async (notification, nextRead = true) => {
    if (nextRead) markRead(notification.id);
    else markUnread(notification.id);
    await persistRemoteReadState(notification, nextRead);
  };

  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      const dismissed = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]');
      if (!dismissed.includes(id)) {
        dismissed.push(id);
        localStorage.setItem('dismissed_notif_ids', JSON.stringify(dismissed));
      }
    } catch {}
  };

  const markAllRead = async () => {
    const allIds = new Set(notifications.map(n => n.id));
    setReadIds(allIds);
    localStorage.setItem('read_notif_ids', JSON.stringify([...allIds].filter(i => i !== 'profile-incomplete')));
    if (allIds.has('profile-incomplete')) {
      try {
        const timed = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
        timed['profile-incomplete'] = Date.now();
        localStorage.setItem('read_notif_timed', JSON.stringify(timed));
      } catch {}
    }
    const appIds = notifications.map(n => n._appNotifId).filter(Boolean);
    const communityIds = notifications.map(n => n._communityNotifId).filter(Boolean);
    try {
      if (appIds.length > 0) {
        await supabase.from('app_notifications').update({ is_read: true }).in('id', appIds);
      }
      if (communityIds.length > 0) {
        await supabase.from('community_notifications').update({ is_read: true }).in('id', communityIds);
      }
      if (appIds.length > 0 || communityIds.length > 0) {
        window.dispatchEvent(new CustomEvent('cr:notifications-changed'));
      }
    } catch {}
  };

  useEffect(() => {
    const onClosePopups = () => setPopupOpen(false);
    window.addEventListener('cr:close-popups', onClosePopups);
    return () => window.removeEventListener('cr:close-popups', onClosePopups);
  }, []);

  // Browser-back / Android-back closes the popover instead of navigating
  // away from the current page. Two listeners:
  //   * popstate — covers web browser back + the historic native back
  //     button when initBackButton calls history.back().
  //   * cr:android-back — fast-path for the new native handler in
  //     capacitor.js that emits this event before invoking history.
  //     We preventDefault to tell the handler "we consumed the press"
  //     so it doesn't continue and pop the route.
  useEffect(() => {
    if (!popupOpen) return;
    const onPop = () => setPopupOpen(false);
    const onAndroidBack = (ev) => {
      ev.preventDefault();
      setPopupOpen(false);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('cr:android-back', onAndroidBack);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('cr:android-back', onAndroidBack);
    };
  }, [popupOpen]);

  const toggleBell = () => {
    const next = !popupOpen;
    if (next) {
      window.dispatchEvent(new CustomEvent('cr:close-popups'));
      try { window.history.pushState({ crBellOpen: true }, ''); } catch {}
    } else if (window.history.state?.crBellOpen) {
      // User tapped the bell again to close — pop our sentinel so we
      // don't leak history entries.
      try { window.history.back(); return; } catch {}
    }
    setPopupOpen(next);
  };

  return (
    <div className="relative" data-tour="notif-bell">
      <button
        onClick={toggleBell}
        // w-11 h-11 = 44pt — Apple HIG minimum tap target.
        className="relative w-11 h-11 rounded-xl flex items-center justify-center transition-all active:scale-[0.95]"
        style={{ background: unreadCount > 0 ? '#FEF2F2' : '#F3F4F6' }}
        aria-label={unreadCount > 0 ? `התראות (${unreadCount} חדשות)` : 'התראות'}
        aria-expanded={popupOpen}
        aria-haspopup="menu"
      >
        <Bell className="w-5 h-5" style={{ color: unreadCount > 0 ? '#DC2626' : '#6B7280' }} aria-hidden="true" />
        {unreadCount > 0 && (
          // Badge with a soft outer glow + pulse animation. Outer ring
          // (box-shadow first stop) blends into the surrounding top bar
          // so the dot reads as "glowing on" rather than stuck on. The
          // pulse loop runs only while popup is closed — the keyframes
          // are injected once via the effect below.
          <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{
              background: '#DC2626',
              boxShadow: '0 0 0 2px #fff, 0 0 14px rgba(220,38,38,0.55)',
              fontVariantNumeric: 'tabular-nums',
              animation: popupOpen ? 'none' : 'crBellPulse 1800ms ease-in-out infinite',
            }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {popupOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopupOpen(false)} />
          {/* Popover surface — PURE WHITE (#FFFFFF) on the app's
              paper bg. First attempt used the same paper #FCF9F4 as
              the page; user feedback was that it "felt disconnected"
              — the popover merged with the dashboard behind it
              instead of reading as a separate card. White creates a
              clean lift: page = paper, surface = white, accents =
              bold colors. Same pattern as iOS Notification Center,
              Apple Reminders, Linear, GitHub — utility popovers are
              always lighter than the surface they float over.
              Shadow stack is two-layer + slight brand-green tint
              to give depth without harshness. */}
          <div className="absolute left-0 top-12 z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-3xl overflow-hidden"
            style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              boxShadow: '0 24px 60px rgba(28,46,32,0.22), 0 4px 12px rgba(28,46,32,0.08)',
            }} dir="rtl">
            {/* Header — subtle green-tinted bg strip gives the
                popover a "branded top edge" without polluting the
                body. The faint tint reads as "this is CarReminder",
                not "another generic shadcn popover". */}
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ background: '#F4FAF6', borderBottom: '1px solid #E5EBE6' }}
            >
              <span className="text-[15px] font-bold tracking-tight" style={{ color: '#1C2E20' }}>התראות</span>
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="text-[12px] font-semibold transition-colors hover:opacity-80" style={{ color: '#2D5233' }}>
                  סמן הכל כנקרא
                </button>
              )}
            </div>

            <div className="max-h-[440px] overflow-y-auto">
              {(() => {
                // Bell shows ONLY unread items. Read items (cleared
                // via "סמן הכל כנקרא" or row click) are filtered out —
                // explicit user preference. Full history lives on the
                // /Notifications page; this dropdown is signal-to-act.
                const visible = notifications.filter(n => !readIds.has(n.id));
                if (visible.length === 0) {
                  const allEmpty = notifications.length === 0;
                  return <EmptyState allEmpty={allEmpty} />;
                }

                // Group by urgency tier. Ranks order sections:
                // urgent → warn → share → community → info. Within
                // each section we preserve the existing chronological
                // sort (newest first) inherited from the fetch loop.
                const groups = new Map();
                for (const n of visible.slice(0, 12)) {
                  const tier = getNotifTier(n);
                  if (!groups.has(tier)) groups.set(tier, []);
                  groups.get(tier).push(n);
                }
                const orderedTiers = [...groups.entries()]
                  .sort((a, b) => NOTIF_TIER[a[0]].rank - NOTIF_TIER[b[0]].rank);

                return orderedTiers.map(([tier, rows]) => (
                  <React.Fragment key={tier}>
                    <TierHeader tier={tier} count={rows.length} />
                    {rows.map(n => renderRow(n))}
                  </React.Fragment>
                ));

                function renderRow(n) {
                  const tier = getNotifTier(n);
                  const t = NOTIF_TIER[tier];
                  const isUrgent = tier === 'urgent';
                  const isRead = false;  // by construction — filtered above
                  const actionRequired = isActionNotification(n);
                  return (
                    <div key={n.id}
                      className="flex items-center gap-3 transition-all"
                      style={{
                        background: 'transparent',
                        borderBottom: '1px solid #F3F4F6',
                        borderRight: `${isUrgent ? 4 : 3}px solid ${t.fg}`,
                        padding: isUrgent ? '14px 16px' : '12px 16px',
                      }}>
                      <button
                        onClick={async () => {
                          await markItemReadState(n, true);
                          setPopupOpen(false);
                          if (n.type === 'profile' || n.type === 'license') navigate(createPageUrl('UserProfile'));
                          else if (n.type === 'seasonal') {
                            const key = n.id === 'winter-prep' ? `winter_dismissed_${new Date().getFullYear()}` : `sailing_dismissed_${new Date().getFullYear()}`;
                            localStorage.setItem(key, '1');
                            navigate(createPageUrl('Vehicles'));
                          }
                          else if (n.type === 'community') {
                            navigate(createPageUrl('Community'));
                          }
                          else if (n.type === 'app' && n.appType === 'admin_message') {
                            setAdminMsg({ title: decodeNotifBody(n.appData?.subject || n.label), body: decodeNotifBody(n.appData?.body || n.name), createdAt: n.createdAt });
                          }
                          else if (n.type === 'app') {
                            const liveHref = n.navHref
                              || appConfigForType(n.appType).buildHref(n.appData || {});
                            if (liveHref) navigate(liveHref);
                          }
                          else if (n.vehicleId) {
                            const NOTIF_FIELD_MAP = {
                              test: 'test_due_date',
                              insurance: 'insurance_due_date',
                              inspection: 'inspection_report_expiry_date',
                              mileage: 'current_km',
                            };
                            const SAFETY_FIELD_MAP = {
                              pyro: 'pyrotechnics_expiry_date', ext: 'fire_extinguisher_expiry_date', raft: 'life_raft_expiry_date',
                            };
                            let field = NOTIF_FIELD_MAP[n.type];
                            if (n.type === 'safety') {
                              const prefix = (n.id || '').split('-')[0];
                              field = SAFETY_FIELD_MAP[prefix];
                            }
                            if (field) {
                              navigate(`${createPageUrl('EditVehicle')}?id=${n.vehicleId}&field=${field}`);
                            } else {
                              navigate(`${createPageUrl('VehicleDetail')}?id=${n.vehicleId}`);
                            }
                          }
                          else navigate(createPageUrl('Dashboard'));
                        }}
                        className="flex items-start gap-3 flex-1 min-w-0 text-right">
                        {/* Icon chip — tier-colored (10% bg, 100% fg).
                            The chip ROLE here is to reinforce the
                            stripe's urgency cue and provide a glyph
                            for the underlying notification type. Size
                            jumps from 24px → 28px for urgent rows so
                            the eye lands there first. */}
                        <div className="rounded-lg flex items-center justify-center shrink-0"
                          style={{
                            width:  isUrgent ? 28 : 24,
                            height: isUrgent ? 28 : 24,
                            background: t.bg,
                            color: t.fg,
                          }}>
                          {n.type === 'profile'
                            ? <User className="w-4 h-4" />
                            : n.type === 'license'
                              ? <FileText className="w-4 h-4" />
                            : n.type === 'community'
                              ? <MessageSquare className="w-4 h-4" />
                            : n.type === 'app'
                              ? (() => {
                                  const cfg = appConfigForType(n.appType);
                                  const Icon = cfg.icon;
                                  return <Icon className="w-4 h-4" />;
                                })()
                            : n.type === 'seasonal'
                              ? <span className="text-sm">{n.id === 'winter-prep' ? '❄️' : '⛵'}</span>
                            : n.isExpired
                              ? <AlertTriangle className="w-4 h-4" />
                              : n.type === 'safety'
                                ? <AlertTriangle className="w-4 h-4" />
                                : n.type === 'maintenance'
                                  ? <Wrench className="w-4 h-4" />
                                  : n.type === 'mileage'
                                    ? <Gauge className="w-4 h-4" />
                                    : <Bell className="w-4 h-4" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* Title — Heebo 500 14px, primary text. */}
                          <p className="text-[14px] font-medium truncate" style={{ color: '#1C2E20', lineHeight: 1.35 }}>
                            {n.appType === 'admin_message' ? decodeNotifBody(n.label) : n.label}
                          </p>
                          {/* Body — 12px muted; truncates after one line. */}
                          <p className="text-[12px] truncate mt-0.5" style={{ color: '#5A6B5D' }}>{n.appType === 'admin_message' ? decodeNotifBody(n.name) : n.name}</p>
                          {/* Meta row — relative time (when available)
                              + a tiny "דורש פעולה" pill when relevant.
                              Old design stacked these on separate
                              lines; collapsing to one keeps the row
                              tight and lets the eye scan vertically
                              by stripe color. */}
                          {(n.createdAt || actionRequired) && (
                            <div className="flex items-center gap-2 mt-1">
                              {n.createdAt && (() => {
                                const rel = formatRelativeTime(n.createdAt);
                                return rel ? (
                                  <span className="text-[11px] flex items-center gap-1" style={{ color: '#8B9C8E' }}>
                                    <Clock className="w-2.5 h-2.5 shrink-0" />
                                    <span>{rel}</span>
                                  </span>
                                ) : null;
                              })()}
                              {actionRequired && (
                                <span
                                  className="inline-flex rounded-full px-1.5 text-[10px] font-bold"
                                  style={{
                                    background: t.bg,
                                    color: t.fg,
                                    lineHeight: '16px',
                                  }}>
                                  דורש פעולה
                                </span>
                              )}
                            </div>
                          )}
                          {n.appType === 'account_invite_offered' && n.appData?.member_id && (
                            <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleInviteAction(n, 'accept'); }}
                                disabled={!!inviteActing}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                                style={{ background: '#059669', color: 'white' }}>
                                {inviteActing === `${n.id}-accept`
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <Check className="w-3 h-3" />}
                                אישור
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleInviteAction(n, 'decline'); }}
                                disabled={!!inviteActing}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all active:scale-95"
                                style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                                {inviteActing === `${n.id}-decline`
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <X className="w-3 h-3" />}
                                דחייה
                              </button>
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await markItemReadState(n, !isRead);
                          }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-all"
                          title={isRead ? 'סמן כלא נקרא' : 'סמן כנקרא'}>
                          <div className="w-2.5 h-2.5 rounded-full border-2 transition-all"
                            style={{
                              background: isRead ? 'transparent' : '#DC2626',
                              borderColor: isRead ? '#D1D5DB' : '#DC2626',
                            }} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); dismissNotification(n.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-50 transition-all"
                          title="הסר התראה">
                          <X className="w-3 h-3" style={{ color: '#D1D5DB' }} />
                        </button>
                      </div>
                    </div>
                  );
                }
              })()}
            </div>

            {notifications.length > 0 && (
              <button onClick={() => { setPopupOpen(false); navigate(createPageUrl('Notifications')); }}
                className="w-full py-3.5 text-center text-[13px] font-semibold transition-colors hover:bg-gray-50"
                style={{ color: '#2D5233', borderTop: '1px solid #F3F4F6' }}>
                כל ההתראות ←
              </button>
            )}
          </div>
        </>
      )}

      {adminMsg && (
        <AdminMessageDialog
          title={adminMsg.title}
          body={adminMsg.body}
          timestamp={adminMsg.createdAt}
          formatTime={formatRelativeTime}
          onClose={() => setAdminMsg(null)}
        />
      )}
    </div>
  );
}
