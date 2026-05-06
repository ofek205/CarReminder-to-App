import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle, Calendar, Shield, Wrench, FileText, AlertTriangle, Clock, User } from "lucide-react";
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { configForType as appConfigForType, requiresActionForType } from '@/lib/appNotificationConfig';
import { ListSkeleton } from "../components/shared/Skeletons";
import { formatDateHe } from "../components/shared/DateStatusUtils";
import { useAuth } from "../components/shared/GuestContext";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { calcAllReminders, daysUntil } from "../components/shared/ReminderEngine";
import { C } from '@/lib/designTokens';

const TYPE_CONFIG = {
  'טסט':        { icon: Calendar,  bg: '#FFF8E1', color: '#D97706', border: '#FDE68A' },
  'כושר שייט':  { icon: Calendar,  bg: '#E0F7FA', color: '#0C7B93', border: '#B2EBF2' },
  'ביטוח':      { icon: Shield,    bg: '#FFF8E1', color: '#D97706', border: '#FDE68A' },
  'ביטוח ימי':  { icon: Shield,    bg: '#E0F7FA', color: '#0C7B93', border: '#B2EBF2' },
  'טיפול':      { icon: Wrench,    bg: '#FFF8E1', color: '#D97706', border: '#FDE68A' },
  'צמיגים':     { icon: Wrench,    bg: '#FFF8E1', color: '#D97706', border: '#FDE68A' },
  'בלמים':      { icon: AlertTriangle, bg: '#FFF7ED', color: '#EA580C', border: '#FFEDD5' },
  'עדכון':      { icon: Clock,     bg: '#F0FDF4', color: '#16A34A', border: '#BBF7D0' },
  'מספנה':      { icon: Wrench,    bg: '#E0F7FA', color: '#0C7B93', border: '#B2EBF2' },
  'פירוטכניקה': { icon: AlertTriangle, bg: '#FFF7ED', color: '#EA580C', border: '#FFEDD5' },
  'מטף כיבוי':  { icon: AlertTriangle, bg: '#FFF7ED', color: '#EA580C', border: '#FFEDD5' },
  'אסדת הצלה':  { icon: AlertTriangle, bg: '#FFF7ED', color: '#EA580C', border: '#FFEDD5' },
  'תסקיר':       { icon: FileText,  bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
};

// Map notification id prefix to EditVehicle field
const NOTIF_TO_FIELD = {
  test: 'test_due_date', ins: 'insurance_due_date',
  pyro: 'pyrotechnics_expiry_date', ext: 'fire_extinguisher_expiry_date', raft: 'life_raft_expiry_date',
  mileage: 'current_km',
  inspect: 'inspection_report_expiry_date',
};

function getNotifEditUrl(notif) {
  if (!notif.vehicleId) return null;
  const prefix = (notif.id || '').split('-')[0];
  const field = NOTIF_TO_FIELD[prefix];
  if (field) return `${createPageUrl('EditVehicle')}?id=${notif.vehicleId}&field=${field}`;
  // For maintenance/brakes/tires/service/shipyard → go to VehicleDetail
  return `${createPageUrl('VehicleDetail')}?id=${notif.vehicleId}`;
}

const GOV_LICENSE_URL = 'https://www.gov.il/he/service/car-license-renewal';
const GOV_VESSEL_URL = 'https://www.gov.il/he/service/seaworthiness-certificate';

//  Notification Card 
function NotifCard({ notif, onMarkRead, onMarkUnread, isRead }) {
  const navigate = useNavigate();
  const tc = TYPE_CONFIG[notif.notification_type] || { icon: Bell, bg: '#F5F5F5', color: '#757575', border: '#E0E0E0' };
  const Icon = tc.icon;
  const isOverdue = notif.is_overdue;
  const editUrl = getNotifEditUrl(notif);
  const isTestNotif = (notif.id || '').startsWith('test-');
  const isInsNotif = (notif.id || '').startsWith('ins-');

  return (
    <div
      className={`rounded-2xl p-4 mb-2.5 transition-all ${editUrl ? 'cursor-pointer active:scale-[0.99]' : ''}`}
      style={{
        background: isOverdue ? '#FEF2F2' : isRead ? '#FAFAFA' : '#fff',
        border: `1.5px solid ${isOverdue ? '#FECACA' : isRead ? '#E5E7EB' : C.border}`,
        boxShadow: isRead ? 'none' : `0 2px 10px ${C.primary}08`,
        opacity: isRead ? 0.65 : 1,
      }}
      dir="rtl">
      <div className="flex items-center gap-3"
        onClick={async () => {
          if (!editUrl) return;
          // Mark as read BEFORE navigating so the server-side state is updated
          // before the destination page mounts and possibly refetches. On slow
          // networks this used to leave the notification looking unread after
          // returning to the list.
          try { if (onMarkRead) await onMarkRead(notif.id); } catch {}
          navigate(editUrl);
        }}>
      {/* Icon */}
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: isOverdue ? '#DC2626' : tc.bg, boxShadow: isOverdue ? '0 3px 10px rgba(220,38,38,0.2)' : 'none' }}>
        <Icon className="w-5 h-5" style={{ color: isOverdue ? '#fff' : tc.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${isRead ? 'font-medium' : 'font-bold'}`}
          style={{ color: isOverdue ? '#991B1B' : isRead ? '#6B7280' : C.text }}>
          {/* Strip the trailing "פג תוקף!" from the label. the chip below
              already communicates that, and duplicating it turns the card into
              visual noise ("טסט פג תוקף!" + chip "פג תוקף"). Keep bang for
              non-expired upcoming labels. */}
          {isOverdue ? (notif.message || '').replace(/\s*פג תוקף[!\s]*$/,'').trim() : notif.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {(notif.due_date || notif.name) && (
            <span className="text-xs font-medium" style={{ color: isOverdue ? '#DC2626' : C.muted }}>
              {notif.due_date ? formatDateHe(notif.due_date) : (notif.name || '')}
            </span>
          )}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#92400E' }}>
            דורש פעולה
          </span>
          {isOverdue && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              {notif.days_left !== undefined && notif.days_left < 0
                ? `פג לפני ${Math.abs(notif.days_left)} ${Math.abs(notif.days_left) === 1 ? 'יום' : 'ימים'}`
                : 'פג תוקף'}
            </span>
          )}
          {!isOverdue && notif.days_left !== undefined && notif.days_left <= 7 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>
              {notif.days_left === 0 ? 'היום' : notif.days_left === 1 ? 'מחר' : `בעוד ${notif.days_left} ימים`}
            </span>
          )}
        </div>
      </div>

      {/* Read/unread toggle */}
      {isRead ? (
        onMarkUnread && (
          <button onClick={() => onMarkUnread(notif.id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold shrink-0 hover:bg-gray-100 transition-all"
            style={{ color: '#6B7280' }}>
            <div className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: '#D1D5DB' }} />
            סמן כלא נקרא
          </button>
        )
      ) : (
        onMarkRead && (
          <button onClick={() => onMarkRead(notif.id)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold shrink-0 hover:bg-gray-100 transition-all"
            style={{ color: C.primary }}>
            <CheckCircle className="w-3.5 h-3.5" />
            נקרא
          </button>
        )
      )}
      </div>

      {/* Action buttons for test/insurance notifications */}
      {(isTestNotif || isInsNotif) && notif.vehicleId && (
        <div className="flex gap-2 mt-3 pt-3 border-t" style={{ borderColor: isOverdue ? '#FECACA' : '#F3F4F6' }}
          onClick={(e) => e.stopPropagation()}>
          {isTestNotif && (
            <a href={notif.notification_type === 'כושר שייט' ? GOV_VESSEL_URL : GOV_LICENSE_URL}
              target="_blank" rel="noopener noreferrer"
              onClick={() => onMarkRead && onMarkRead(notif.id)}
              className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-bold transition-all active:scale-95"
              style={{ background: '#EEF2FF', color: '#4338CA' }}>
              💳 תשלום אגרה
            </a>
          )}
          <button onClick={() => {
            if (onMarkRead) onMarkRead(notif.id);
            navigate(`${createPageUrl('EditVehicle')}?id=${notif.vehicleId}&field=${isTestNotif ? 'test_due_date' : 'insurance_due_date'}`);
          }}
            className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-[11px] font-bold transition-all active:scale-95"
            style={{ background: '#E8F5E9', color: '#2E7D32' }}>
            ✓ ביצעתי + העלה מסמך
          </button>
        </div>
      )}
    </div>
  );
}

//  Empty State 
function NotifEmptyState() {
  return (
    <div className="text-center py-12" dir="rtl">
      <div className="rounded-3xl p-8 relative overflow-hidden" style={{ background: C.light }}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full" style={{ background: `${C.primary}08` }} />
        <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full" style={{ background: `${C.yellow}15` }} />
        <div className="relative z-10">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: C.border }}>
            <Bell className="w-8 h-8" style={{ color: C.primary, opacity: 0.5 }} />
          </div>
          <h3 className="font-bold text-lg mb-2" style={{ color: C.text }}>אין התראות</h3>
          <p className="text-sm max-w-xs mx-auto leading-relaxed" style={{ color: C.muted }}>
            ההתראות שלך יופיעו כאן כשמועד הטסט/כושר שייט, הביטוח או הטיפול מתקרב
          </p>
        </div>
      </div>
    </div>
  );
}

//  Status Summary 
function NotifSummary({ overdue, upcoming }) {
  const items = [
    { label: 'פג תוקף', count: overdue, color: '#DC2626', bg: '#FEF2F2', icon: AlertTriangle },
    { label: 'בקרוב',   count: upcoming, color: '#D97706', bg: '#FEF3C7', icon: Clock },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 mb-5" dir="rtl">
      {items.map(item => (
        <div key={item.label} className="rounded-2xl py-3 px-3 flex items-center gap-2.5"
          style={{ background: item.bg }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: item.color, boxShadow: `0 3px 10px ${item.color}30` }}>
            <item.icon className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg block leading-none" style={{ color: item.color }}>{item.count}</span>
            <span className="text-xs font-bold" style={{ color: item.color }}>{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

//  Guest Notifications 
function GuestNotifications() {
  const { guestVehicles, guestReminderSettings } = useAuth();
  const today = new Date();

  // Detect if any vehicles are demo. if so, widen the reminder window so users
  // see the system working. Real guest vehicles keep the user-configured window.
  const hasDemoOnly = guestVehicles.every(v => v._isDemo || v.id?.startsWith('demo_'));
  const defaultBase = guestReminderSettings || {};
  const expandedSettings = hasDemoOnly ? {
    ...defaultBase,
    remind_test_days_before:       365,
    remind_insurance_days_before:  365,
    remind_document_days_before:   180,
    remind_maintenance_days_before: 180,
    overdue_repeat_every_days:      3,
  } : defaultBase;

  // Use the UNIFIED reminder engine (same as authenticated mode + notification bell)
  // so all 13 reminder types are covered: test, insurance, pyrotechnics, fire
  // extinguisher, life raft, maintenance, tires, brakes, seasonal, etc.
  const rawItems = calcAllReminders({
    vehicles: guestVehicles || [],
    documents: [],
    settings: expandedSettings,
  });

  const notifications = rawItems.map(r => ({
    id: r.id,
    notification_type: r.typeName || REMINDER_TYPE_FALLBACK[r.type] || 'טיפול',
    message: r.label || `${r.typeName || r.type} - ${r.name || ''}`,
    due_date: r.dueDate,
    days_left: r.daysLeft,
    is_overdue: r.daysLeft !== null && r.daysLeft < 0,
    name: r.name,
    vehicleId: r.vehicleId,
    emoji: r.emoji,
  }));

  const overdue = notifications.filter(n => n.is_overdue).length;
  const upcoming = notifications.filter(n => !n.is_overdue).length;

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="rounded-3xl p-5 mb-5"
        style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">התראות</h1>
              <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                {notifications.length > 0 ? `${notifications.length} התראות פעילות` : 'אין התראות'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Guest banner */}
      <div className="mb-4 rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#FDE68A' }}>
          <AlertTriangle className="w-4 h-4" style={{ color: '#92400E' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{ color: '#92400E' }}>התראות זמניות</p>
          <p className="text-xs" style={{ color: '#B45309' }}>
            <button onClick={() => window.location.href = '/Auth'} className="underline font-bold">הירשם</button>
            {' '}כדי לקבל התראות אמיתיות למכשיר
          </p>
        </div>
      </div>

      {notifications.length === 0 ? (
        <NotifEmptyState />
      ) : (
        <>
          <NotifSummary overdue={overdue} upcoming={upcoming} />
          {notifications.sort((a, b) => (a.is_overdue === b.is_overdue ? 0 : a.is_overdue ? -1 : 1)).map(n => (
            <NotifCard key={n.id} notif={n} />
          ))}
        </>
      )}
    </div>
  );
}

//  Map ReminderEngine output → NotifCard shape 
const REMINDER_TYPE_FALLBACK = {
  test: 'טסט',
  insurance: 'ביטוח',
  inspection: 'תסקיר',
  maintenance: 'טיפול',
  safety: 'טיפול',
  document: 'מסמך',
};

function remindersToNotifs(reminders) {
  return reminders.map(r => ({
    id: r.id,
    notification_type: r.typeName || REMINDER_TYPE_FALLBACK[r.type] || 'טיפול',
    message: `${r.typeName || r.type} - ${r.name}`,
    due_date: r.dueDate,
    days_left: r.daysLeft,
    is_overdue: r.daysLeft !== null && r.daysLeft < 0,
    is_read: false,
  }));
}

//  Auth Notifications 
function AuthNotifications() {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  // useNavigate was missing here — the app-notification onClick below
  // called navigate(href) against undefined, throwing a silent
  // ReferenceError inside the handler. Result: clicking a share /
  // vehicle-change card on this page did nothing, while the same
  // cards in NotificationBell worked because the bell already had
  // its own useNavigate. Profile / license cards above use <Link>
  // so they were unaffected — only app_notifications regressed.
  const navigate = useNavigate();

  // Fetch vehicles for the active workspace. We don't gate the query on
  // activeWorkspaceId itself because doing so leaves users with zero
  // memberships (auto-heal in flight) stuck on a permanent loading
  // spinner — `isLoading` below derives from `!accountData`. Instead we
  // run the query as soon as user.id is known and let the queryFn
  // return an empty payload while activeWorkspaceId is still resolving.
  // Once the workspace resolves, the queryKey changes and the data
  // refetches with the correct scope.
  const { data: accountData } = useQuery({
    queryKey: ['auth-notif-account', user?.id, activeWorkspaceId],
    queryFn: async () => {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length === 0) return { accountId: null, vehicles: [] };
      // While activeWorkspaceId is null (zero-membership user mid heal,
      // or a transient state), return an empty payload rather than
      // pinning to members[0] — that was the original leak.
      if (!activeWorkspaceId) return { accountId: null, vehicles: [] };
      const targetMember = members.find(m => m.account_id === activeWorkspaceId);
      if (!targetMember) return { accountId: null, vehicles: [] };
      const accountId = targetMember.account_id;
      const isBusinessDriver = targetMember?.account_type === 'business' && targetMember?.role === 'driver';

      if (isBusinessDriver) {
        const { data: assignments, error: assignmentError } = await supabase
          .from('driver_assignments')
          .select('vehicle_id')
          .eq('account_id', accountId)
          .eq('driver_user_id', user.id)
          .eq('status', 'active');
        if (assignmentError) throw assignmentError;
        const vehicleIds = (assignments || []).map(a => a.vehicle_id).filter(Boolean);
        if (vehicleIds.length === 0) return { accountId, vehicles: [] };
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('account_id', accountId)
          .in('id', vehicleIds);
        if (error) throw error;
        return { accountId, vehicles: data || [] };
      }

      const vehicles = await db.vehicles.filter({ account_id: accountId });
      return { accountId, vehicles };
    },
    enabled: !!user?.id && !!activeWorkspaceId,
  });

  // Fetch reminder settings
  const { data: settings } = useQuery({
    queryKey: ['reminder-settings', user?.id],
    queryFn: async () => {
      try {
        const rows = await db.reminder_settings.filter({ user_id: user.id });
        return rows.length > 0 ? rows[0] : null;
      } catch { return null; }
    },
    enabled: !!user?.id,
  });

  const vehicles = accountData?.vehicles || [];
  const isLoading = !accountData;

  // Check if profile is incomplete
  const { data: profileData } = useQuery({
    queryKey: ['user-profile-check', user?.id],
    queryFn: async () => {
      try {
        const profiles = await db.user_profiles.filter({ user_id: user.id });
        return profiles.length > 0 ? profiles[0] : null;
      } catch { return null; }
    },
    enabled: !!user?.id,
  });
  const PROFILE_REMIND_KEY = 'profile_remind_dismissed_at';
  const [profileDismissed, setProfileDismissed] = useState(() => {
    try {
      const ts = localStorage.getItem(PROFILE_REMIND_KEY);
      if (!ts) return false;
      const daysSince = (Date.now() - Number(ts)) / 86400000;
      return daysSince < 30; // show again after 30 days
    } catch { return false; }
  });
  const profileIncomplete = (!profileData || !profileData.phone) && !profileDismissed;
  const dismissProfileReminder = () => {
    localStorage.setItem(PROFILE_REMIND_KEY, String(Date.now()));
    setProfileDismissed(true);
  };

  // Check license expiration — use the shared daysUntil() to avoid the
  // timezone-truncation bug the inline `Math.ceil((... - now) / 86400000)`
  // version had (expired-yesterday reported as "today").
  const licenseDays = daysUntil(profileData?.license_expiration_date);
  const licenseAlert = licenseDays !== null && licenseDays <= 30;

  // Generic app notifications (share offered/accepted + future event types).
  // Fetched from app_notifications — always show unread, plus the most
  // recent 20 read items so users can still see history.
  const { data: appNotifs = [] } = useQuery({
    queryKey: ['app-notifs', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return [];
      return data || [];
    },
    enabled: !!user?.id,
  });

  const markAppNotifRead = async (id, nextRead = true) => {
    await supabase.from('app_notifications').update({ is_read: nextRead }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['app-notifs', user?.id] });
    try { window.dispatchEvent(new CustomEvent('cr:notifications-changed')); } catch {}
  };

  // Build notifications using UNIFIED engine (same as bell)
  const notifications = useMemo(() => {
    if (!vehicles.length) return [];
    const rawItems = calcAllReminders({ vehicles, documents: [], settings: settings || {} });
    // Map to page format + filter dismissed
    let dismissedIds = [];
    try { dismissedIds = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]'); } catch {}
    const dismissedSet = new Set(dismissedIds);
    return rawItems
      .filter(n => !dismissedSet.has(n.id))
      .map(n => ({
        id: n.id,
        notification_type: n.typeName,
        message: n.label,
        due_date: n.dueDate,
        days_left: n.daysLeft,
        is_overdue: n.daysLeft < 0,
        name: n.name,
        vehicleId: n.vehicleId,
        emoji: n.emoji,
        linkTo: n.linkTo,
      }));
  }, [vehicles, settings]);

  // Read state - synced with localStorage (same as bell)
  // Re-read on every render to stay in sync with bell's markRead/markUnread
  const getReadIds = () => {
    try {
      const stored = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
      const timedReads = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
      const now = Date.now();
      const validTimedIds = Object.entries(timedReads)
        .filter(([_, ts]) => now - ts < 7 * 24 * 60 * 60 * 1000)
        .map(([id]) => id);
      return new Set([...stored, ...validTimedIds]);
    } catch { return new Set(); }
  };
  const [readIds, setReadIds] = useState(getReadIds);
  // Re-sync when page gains focus (user may have marked in bell then navigated here)
  useEffect(() => {
    const sync = () => setReadIds(getReadIds());
    window.addEventListener('focus', sync);
    // Also sync on storage event (cross-tab)
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('focus', sync); window.removeEventListener('storage', sync); };
  }, []);

  const markAsRead = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('read_notif_ids', JSON.stringify([...next]));
      return next;
    });
  };

  const markAsUnread = (id) => {
    setReadIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      localStorage.setItem('read_notif_ids', JSON.stringify([...next]));
      return next;
    });
  };

  const markAllRead = async () => {
    const allIds = notifications.map(n => n.id);
    setReadIds(prev => {
      const next = new Set([...prev, ...allIds]);
      localStorage.setItem('read_notif_ids', JSON.stringify([...next]));
      return next;
    });
    const unreadAppIds = appNotifs.filter(n => !n.is_read).map(n => n.id);
    if (unreadAppIds.length > 0) {
      await supabase
        .from('app_notifications')
        .update({ is_read: true })
        .in('id', unreadAppIds);
      queryClient.invalidateQueries({ queryKey: ['app-notifs', user?.id] });
      try { window.dispatchEvent(new CustomEvent('cr:notifications-changed')); } catch {}
    }
  };

  if (!user?.id || isLoading) {
    return (
      <div dir="rtl" className="px-4 pt-4">
        <ListSkeleton count={4} variant="notification" />
      </div>
    );
  }

  const sorted = [...notifications].sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return (a.days_left ?? 999) - (b.days_left ?? 999);
  });
  const unread = sorted.filter(n => !readIds.has(n.id));
  const read = sorted.filter(n => readIds.has(n.id));
  const appUnreadCount = appNotifs.filter(n => !n.is_read).length;
  const totalUnread = unread.length + appUnreadCount;
  const hasAnyNotifications = appNotifs.length > 0 || sorted.length > 0 || profileIncomplete || licenseAlert;

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="rounded-3xl p-5 mb-5"
        style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white">התראות</h1>
            <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {totalUnread > 0 ? `${totalUnread} חדשות` : 'אין התראות חדשות'}
            </p>
          </div>
          {totalUnread > 0 && (
            <button onClick={markAllRead}
              className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 shrink-0"
              style={{ background: 'rgba(255,255,255,0.25)', color: '#fff' }}>
              סמן הכל כנקרא
            </button>
          )}
        </div>
      </div>

      {/* Profile incomplete notification - shows once per month */}
      {profileIncomplete && (
        <div className="rounded-2xl p-4 mb-2.5 flex items-center gap-3"
          style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE', boxShadow: '0 2px 10px rgba(67,56,202,0.08)' }}
          dir="rtl">
          <Link to={createPageUrl('UserProfile')} className="flex items-center gap-3 flex-1 min-w-0 transition-all active:scale-[0.99]">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: '#4338CA', boxShadow: '0 3px 10px rgba(67,56,202,0.3)' }}>
              <User className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: '#312E81' }}>השלם פרטים אישיים</p>
              <p className="text-xs mt-0.5" style={{ color: '#6366F1' }}>הוסף טלפון ותאריך לידה באזור האישי</p>
            </div>
          </Link>
          <button onClick={dismissProfileReminder}
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90"
            style={{ background: '#C7D2FE' }}>
            <span className="text-xs font-bold" style={{ color: '#4338CA' }}>✕</span>
          </button>
        </div>
      )}

      {/* App notifications — typed via appNotificationConfig.
          Each row uses the icon + bg + nav target defined for its
          `type` in the shared config, so adding a new server-side
          notification type shows up here automatically. */}
      {appNotifs.map(an => {
        const isRead = an.is_read;
        const cfg = appConfigForType(an.type);
        const Icon = cfg.icon;
        const href = cfg.buildHref(an.data || {});
        const actionRequired = requiresActionForType(an.type);
        return (
          <div key={`app-${an.id}`}
            className="rounded-2xl p-4 mb-2.5 flex items-center gap-3 transition-all"
            style={{
              background: isRead ? '#FAFAFA' : cfg.bg,
              border: `1.5px solid ${isRead ? '#E5E7EB' : cfg.iconColor + '40'}`,
              opacity: isRead ? 0.7 : 1,
            }}
            dir="rtl">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: isRead ? '#E5E7EB' : cfg.iconBg,
                boxShadow: isRead ? 'none' : `0 3px 10px ${cfg.iconColor}30`,
              }}>
              <Icon className="w-5 h-5" style={{ color: isRead ? '#6B7280' : '#fff' }} />
            </div>
            <button type="button"
              onClick={async () => {
                if (!isRead) await markAppNotifRead(an.id, true);
                // The config decides where each notification routes —
                // share_deleted intentionally returns null (vehicle is
                // already gone), so we just mark-read and stay put.
                if (href) navigate(href);
              }}
              className="flex-1 min-w-0 text-right">
              <p className={`text-sm ${isRead ? 'font-medium' : 'font-bold'}`}
                style={{ color: isRead ? '#6B7280' : cfg.iconColor }}>
                {an.title}
              </p>
              {an.body && (
                <p className="text-xs mt-0.5" style={{ color: isRead ? '#9CA3AF' : cfg.iconColor + 'CC' }}>{an.body}</p>
              )}
              <span
                className="inline-flex mt-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  background: actionRequired ? '#FEF3C7' : '#F3F4F6',
                  color: actionRequired ? '#92400E' : '#6B7280',
                }}>
                {actionRequired ? 'דורש פעולה' : 'לידיעה'}
              </span>
            </button>
            <button
              onClick={() => markAppNotifRead(an.id, !isRead)}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/60 transition-all shrink-0"
              title={isRead ? 'סמן כלא נקרא' : 'סמן כנקרא'}>
              <div className="w-2.5 h-2.5 rounded-full border-2 transition-all"
                style={{
                  background: isRead ? 'transparent' : cfg.iconColor,
                  borderColor: isRead ? '#D1D5DB' : cfg.iconColor,
                }} />
            </button>
          </div>
        );
      })}

      {/* License expiration alert */}
      {licenseAlert && (
        <Link to={createPageUrl('UserProfile')}
          className="rounded-2xl p-4 mb-2.5 flex items-center gap-3 transition-all active:scale-[0.99]"
          style={{ background: licenseDays < 0 ? '#FEF2F2' : '#FFF8E1', border: `1.5px solid ${licenseDays < 0 ? '#FECACA' : '#FDE68A'}` }}
          dir="rtl">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: licenseDays < 0 ? '#DC2626' : '#D97706', boxShadow: `0 3px 10px ${licenseDays < 0 ? 'rgba(220,38,38,0.3)' : 'rgba(217,119,6,0.3)'}` }}>
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: licenseDays < 0 ? '#991B1B' : '#92400E' }}>
              {licenseDays < 0 ? 'רישיון נהיגה פג תוקף!' : `רישיון נהיגה פג בעוד ${licenseDays} ימים`}
            </p>
            <p className="text-xs mt-0.5" style={{ color: licenseDays < 0 ? '#DC2626' : '#B45309' }}>לחץ לעדכון באזור האישי</p>
          </div>
        </Link>
      )}

      {!hasAnyNotifications ? (
        <NotifEmptyState />
      ) : sorted.length > 0 ? (
        <>
          {unread.length > 0 && (
            <p className="text-xs font-bold mb-2 px-1" style={{ color: C.muted }}>חדשות</p>
          )}
          {unread.map(n => (
            <NotifCard key={n.id} notif={n} onMarkRead={markAsRead} />
          ))}
          {read.length > 0 && (
            <>
              <p className="text-xs font-bold mt-4 mb-2 px-1" style={{ color: C.muted }}>נקראו</p>
              {read.map(n => (
                <NotifCard key={n.id} notif={n} isRead onMarkUnread={markAsUnread} />
              ))}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function Notifications() {
  const { isGuest } = useAuth();
  return isGuest ? <GuestNotifications /> : <AuthNotifications />;
}
