import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { MEMBER_STATUS } from '@/lib/enums';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle, Calendar, Shield, Wrench, FileText, AlertTriangle, Clock, User, Check, X, Loader2, RefreshCw, BellOff } from "lucide-react";
import { withTimeout } from '@/lib/supabaseQuery';
import AdminMessageDialog from "../components/shared/AdminMessageDialog";
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { configForType as appConfigForType, requiresActionForType, decodeNotifBody } from '@/lib/appNotificationConfig';
import { ListSkeleton } from "../components/shared/Skeletons";
import { formatDateHe } from "../components/shared/DateStatusUtils";
import { useAuth } from "../components/shared/GuestContext";
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { calcAllReminders, daysUntil } from "../components/shared/ReminderEngine";
import { toast } from 'sonner';
import { C } from '@/lib/designTokens';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '../components/ui/drawer';
import useReminderSnooze, { SNOOZE_OPTIONS } from '../hooks/useReminderSnooze';

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

//  Map ReminderEngine output → NotifCard shape
const REMINDER_TYPE_FALLBACK = {
  test: 'טסט',
  insurance: 'ביטוח',
  inspection: 'תסקיר',
  maintenance: 'טיפול',
  safety: 'טיפול',
  document: 'מסמך',
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

// ── Semantic urgency palette — mirrors NotificationBell's tier system
// so that the bell dropdown and the full /Notifications page read
// as one product. Stripes on the RTL leading edge + tier-tinted
// icon chips replace the rainbow of per-type colors the page used
// to render; the eye now scans by urgency first, type second.
const NOTIF_TIER = {
  urgent:    { fg: '#DC2626', bg: 'rgba(220,38,38,0.10)' },
  warn:      { fg: '#F59E0B', bg: 'rgba(245,158,11,0.10)' },
  info:      { fg: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
};

function tierForNotif(notif) {
  if (notif?.is_overdue) return 'urgent';
  if (notif?.days_left !== undefined && notif.days_left !== null && notif.days_left <= 7) return 'warn';
  return 'info';
}

//  Notification Card
function NotifCard({ notif, onMarkRead, onMarkUnread, isRead, onSnooze, snoozedUntilDate, onUnsnooze }) {
  const navigate = useNavigate();
  const tc = TYPE_CONFIG[notif.notification_type] || { icon: Bell, bg: '#F5F5F5', color: '#757575', border: '#E0E0E0' };
  const Icon = tc.icon;
  const isOverdue = notif.is_overdue;
  const editUrl = getNotifEditUrl(notif);
  const isTestNotif = (notif.id || '').startsWith('test-');
  const isInsNotif = (notif.id || '').startsWith('ins-');
  const tier = tierForNotif(notif);
  const t = NOTIF_TIER[tier];
  const isUrgent = tier === 'urgent';
  const isSnoozed = !!snoozedUntilDate;
  const snoozeDateStr = snoozedUntilDate
    ? `${snoozedUntilDate.getDate()}/${snoozedUntilDate.getMonth() + 1}`
    : '';

  return (
    <div
      className={`rounded-2xl mb-2.5 transition-all ${editUrl ? 'cursor-pointer active:scale-[0.99]' : ''}`}
      style={{
        background: isSnoozed ? '#FAFAFA' : (isRead ? '#FAFAFA' : '#FFFFFF'),
        border: `1px solid ${isSnoozed || isRead ? '#E5E7EB' : '#E5EBE6'}`,
        borderRight: isSnoozed
          ? '3px solid #9CA3AF'
          : `${isUrgent ? 4 : 3}px solid ${t.fg}`,
        boxShadow: isSnoozed ? 'none' : (isRead ? 'none' : '0 2px 10px rgba(28,46,32,0.06)'),
        opacity: isSnoozed ? 0.45 : (isRead ? 0.7 : 1),
        padding: isUrgent && !isSnoozed ? '14px 16px' : '12px 16px',
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
      {/* Icon chip — tier-tinted bg (10%) with tier-colored glyph,
          mirrors the NotificationBell row pattern. The per-type
          glyph (Wrench / Shield / Calendar / …) stays so the user
          still sees WHICH category the row is about; the chip
          background only carries the urgency signal. */}
      <div className="rounded-xl flex items-center justify-center shrink-0"
        style={{
          width:  isUrgent ? 44 : 40,
          height: isUrgent ? 44 : 40,
          background: t.bg,
          color: t.fg,
        }}>
        <Icon className="w-5 h-5" />
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
          {/* Urgency chips — colors are theme-bound to the row tier
              instead of hard-coded amber/red. Keeps the row's visual
              voice consistent (stripe + chip + icon all sing the
              same tier) instead of mixing three different palettes
              within one notification card. */}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.fg }}>
            דורש פעולה
          </span>
          {isOverdue && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.fg }}>
              {notif.days_left !== undefined && notif.days_left < 0
                ? `פג לפני ${Math.abs(notif.days_left)} ${Math.abs(notif.days_left) === 1 ? 'יום' : 'ימים'}`
                : 'פג תוקף'}
            </span>
          )}
          {!isOverdue && notif.days_left !== undefined && notif.days_left <= 7 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: t.bg, color: t.fg }}>
              {notif.days_left === 0 ? 'היום' : notif.days_left === 1 ? 'מחר' : `בעוד ${notif.days_left} ימים`}
            </span>
          )}
        </div>
      </div>

      {/* Snoozed → amber un-snooze pill; Active → read/unread toggle + snooze icon */}
      {isSnoozed ? (
        <button onClick={(e) => { e.stopPropagation(); onUnsnooze?.(notif); }}
          className="flex items-center gap-1 px-2.5 py-2 rounded-full text-[10px] font-bold shrink-0 transition-all active:scale-95 min-h-[44px]"
          style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
          title="בטל השתקה">
          <BellOff className="w-3 h-3" />
          מושתק עד {snoozeDateStr}
        </button>
      ) : (
        <>
          {isRead ? (
            onMarkUnread && (
              <button onClick={(e) => { e.stopPropagation(); onMarkUnread(notif.id); }}
                className="flex items-center gap-1 px-2.5 py-3 rounded-lg text-[10px] font-bold shrink-0 hover:bg-gray-100 transition-all min-h-[44px]"
                style={{ color: '#6B7280' }}>
                <div className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: '#D1D5DB' }} />
                סמן כלא נקרא
              </button>
            )
          ) : (
            onMarkRead && (
              <button onClick={(e) => { e.stopPropagation(); onMarkRead(notif.id); }}
                className="flex items-center gap-1 px-2.5 py-3 rounded-lg text-[10px] font-bold shrink-0 hover:bg-gray-100 transition-all min-h-[44px]"
                style={{ color: C.primary }}>
                <CheckCircle className="w-3.5 h-3.5" />
                נקרא
              </button>
            )
          )}
          {onSnooze && (
            <button onClick={(e) => { e.stopPropagation(); onSnooze(notif); }}
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 hover:bg-gray-100 transition-all"
              style={{ color: C.muted }}
              title="השתק התראה">
              <BellOff className="w-4 h-4" />
            </button>
          )}
        </>
      )}
      </div>

      {/* Action buttons for test/insurance notifications — hidden when snoozed */}
      {!isSnoozed && (isTestNotif || isInsNotif) && notif.vehicleId && (
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

//  Snooze Bottom Sheet
function SnoozeDrawer({ open, onOpenChange, notif, onSelect }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent dir="rtl" className="rounded-t-2xl">
        <DrawerHeader className="text-right pb-1">
          <DrawerTitle className="flex items-center gap-2 text-base font-bold" style={{ color: C.text }}>
            <BellOff className="w-4 h-4" style={{ color: C.muted }} />
            השתק התראה
          </DrawerTitle>
          {notif && (
            <DrawerDescription className="text-right text-xs" style={{ color: C.muted }}>
              {notif.message}
            </DrawerDescription>
          )}
        </DrawerHeader>
        <div className="px-4 pb-6 pt-1 space-y-1.5">
          {SNOOZE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => onSelect(opt)}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
              style={{ color: C.text }}
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: C.light }}>
                <BellOff className="w-4 h-4" style={{ color: C.primary }} />
              </div>
              {opt.label}
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

//  Empty State
// Visually mirrors the NotificationBell empty state — same envelope
// SVG, same Hebrew phrasing convention, just on a roomier page-level
// card. The decorative gradients + colored circles the older version
// painted competed with the actual content; replaced with a clean
// white card that reads as "you're done, breathe".
function NotifEmptyState() {
  return (
    <div className="text-center py-8" dir="rtl">
      <div className="rounded-3xl p-10 max-w-md mx-auto" style={{ background: '#FFFFFF', border: '1px solid #E5E7EB' }}>
        <svg width="80" height="80" viewBox="0 0 64 64" fill="none" className="mx-auto block mb-5">
          <rect x="8" y="16" width="48" height="32" rx="6" stroke="#B5AC9A" strokeWidth="2" />
          <path d="M8 22l24 16 24-16" stroke="#B5AC9A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="48" cy="48" r="9" fill="#FFFFFF" stroke="#16A34A" strokeWidth="2" />
          <path d="M44 48l3 3 5-6" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="font-bold text-lg mb-2" style={{ color: '#1C2E20' }}>אין התראות פעילות</h3>
        <p className="text-sm max-w-xs mx-auto leading-relaxed" style={{ color: '#8B9C8E' }}>
          ההתראות שלך יופיעו כאן כשמועד הטסט, הביטוח או הטיפול מתקרב
        </p>
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
  const { data: accountData, isError: accountError, refetch: refetchAccount } = useQuery({
    queryKey: ['auth-notif-account', user?.id, activeWorkspaceId],
    queryFn: async () => {
      const members = await db.account_members.filter({ user_id: user.id, status: MEMBER_STATUS.ACTIVE });
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
        const { data: assignments, error: assignmentError } = await withTimeout(
          supabase
            .from('driver_assignments')
            .select('vehicle_id')
            .eq('account_id', accountId)
            .eq('driver_user_id', user.id)
            .eq('status', 'active'),
          'driver_assignments'
        );
        if (assignmentError) throw assignmentError;
        const vehicleIds = (assignments || []).map(a => a.vehicle_id).filter(Boolean);
        if (vehicleIds.length === 0) return { accountId, vehicles: [] };
        const { data, error } = await withTimeout(
          supabase
            .from('vehicles')
            .select('*')
            .eq('account_id', accountId)
            .in('id', vehicleIds),
          'vehicles'
        );
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
  const { data: appNotifs = [], isError: appNotifsError, refetch: refetchAppNotifs } = useQuery({
    queryKey: ['app-notifs', user?.id],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase
          .from('app_notifications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30),
        'app_notifications'
      );
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
    retry: 1,
    retryDelay: 500,
  });

  const markAppNotifRead = async (id, nextRead = true) => {
    await supabase.from('app_notifications').update({ is_read: nextRead }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['app-notifs', user?.id] });
    try { window.dispatchEvent(new CustomEvent('cr:notifications-changed')); } catch {}
  };

  const [inviteActing, setInviteActing] = useState(null);
  const [adminMsg, setAdminMsg] = useState(null);

  // ── Snooze ────────────────────────────────────────────────────
  const {
    isSnoozed, snoozedUntil: getSnoozedUntil,
    snooze, unsnooze, parseReminderId,
    loading: snoozeLoading,
  } = useReminderSnooze(user?.id);
  const [snoozeTarget, setSnoozeTarget] = useState(null);

  const handleSnoozeSelect = async (option) => {
    if (!snoozeTarget) return;
    const parsed = parseReminderId(snoozeTarget.id);
    if (!parsed) { toast.error('לא ניתן להשתיק התראה זו'); setSnoozeTarget(null); return; }
    try {
      await snooze(parsed.vehicleId, parsed.reminderType, option.days, option.days === null ? snoozeTarget.due_date : null);
      toast.success(`ההתראה הושתקה — ${option.label}`);
    } catch {
      toast.error('שגיאה בהשתקת ההתראה');
    }
    setSnoozeTarget(null);
  };

  const handleUnsnooze = async (notif) => {
    const parsed = parseReminderId(notif.id);
    if (!parsed) return;
    try {
      await unsnooze(parsed.vehicleId, parsed.reminderType);
      toast.success('ההתראה הופעלה מחדש');
    } catch {
      toast.error('שגיאה בביטול ההשתקה');
    }
  };

  const handleInviteAction = async (notif, action) => {
    const memberId = notif.data?.member_id;
    if (!memberId) return;
    setInviteActing(`${notif.id}-${action}`);
    try {
      const rpc = action === 'accept' ? 'accept_account_invite' : 'decline_account_invite';
      const { error } = await supabase.rpc(rpc, { p_member_id: memberId });
      if (error) throw error;
      await markAppNotifRead(notif.id, true);
      queryClient.invalidateQueries({ queryKey: ['account-members'] });
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
    // If the account query errored, show retry instead of infinite skeleton
    if (accountError) {
      return (
        <div dir="rtl" className="px-4 pt-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3" style={{ color: '#D97706' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#92400E' }}>שגיאה בטעינת התראות</p>
          <p className="text-xs mb-4" style={{ color: '#B45309' }}>לא הצלחנו לטעון את הנתונים</p>
          <button onClick={() => refetchAccount()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
            <RefreshCw className="w-4 h-4" />
            נסה שוב
          </button>
        </div>
      );
    }
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
  // Split active vs snoozed — snoozed cards are demoted to bottom section
  const activeNotifs = sorted.filter(n => !isSnoozed(n.id));
  const snoozedNotifs = sorted.filter(n => isSnoozed(n.id));
  const unread = activeNotifs.filter(n => !readIds.has(n.id));
  const read = activeNotifs.filter(n => readIds.has(n.id));
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

      {/* Inline retry for app notifications fetch failure */}
      {appNotifsError && (
        <div className="rounded-2xl p-3.5 mb-2.5 flex items-center gap-3"
          style={{ background: '#FEF3C7', border: '1.5px solid #FDE68A' }} dir="rtl">
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: '#D97706' }} />
          <p className="text-xs font-bold flex-1" style={{ color: '#92400E' }}>שגיאה בטעינת הודעות מערכת</p>
          <button onClick={() => refetchAppNotifs()}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 transition-all active:scale-95"
            style={{ background: '#FDE68A', color: '#92400E' }}>
            <RefreshCw className="w-3.5 h-3.5" />
            נסה שוב
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
                if (an.type === 'account_invite_offered' && !isRead) return;
                if (!isRead) await markAppNotifRead(an.id, true);
                if (an.type === 'admin_message') {
                  setAdminMsg({ title: decodeNotifBody(an.data?.subject || an.title), body: decodeNotifBody(an.data?.body || an.body), createdAt: an.created_at });
                  return;
                }
                if (href?.startsWith('http')) window.open(href, '_blank');
                else if (href) navigate(href);
              }}
              className="flex-1 min-w-0 text-right">
              <p className={`text-sm ${isRead ? 'font-medium' : 'font-bold'}`}
                style={{ color: isRead ? '#6B7280' : cfg.iconColor }}>
                {an.type === 'admin_message' ? decodeNotifBody(an.title) : an.title}
              </p>
              {an.body && (
                <p className="text-xs mt-0.5" style={{ color: isRead ? '#9CA3AF' : cfg.iconColor + 'CC' }}>{decodeNotifBody(an.body)}</p>
              )}
              <span
                className="inline-flex mt-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{
                  background: actionRequired ? '#FEF3C7' : '#F3F4F6',
                  color: actionRequired ? '#92400E' : '#6B7280',
                }}>
                {actionRequired ? 'דורש פעולה' : 'לידיעה'}
              </span>
              {an.type === 'account_invite_offered' && !isRead && an.data?.member_id && (
                <div className="flex gap-2 mt-2.5" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleInviteAction(an, 'accept')}
                    disabled={!!inviteActing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                    style={{ background: '#059669', color: 'white' }}>
                    {inviteActing === `${an.id}-accept`
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Check className="w-3.5 h-3.5" />}
                    אישור
                  </button>
                  <button
                    onClick={() => handleInviteAction(an, 'decline')}
                    disabled={!!inviteActing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                    style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                    {inviteActing === `${an.id}-decline`
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <X className="w-3.5 h-3.5" />}
                    דחייה
                  </button>
                </div>
              )}
            </button>
            <button
              onClick={() => markAppNotifRead(an.id, !isRead)}
              className="w-11 h-11 rounded-xl flex items-center justify-center transition-all shrink-0"
              style={{ background: isRead ? '#F3F4F6' : cfg.iconColor + '18' }}
              title={isRead ? 'סמן כלא נקרא' : 'סמן כנקרא'}>
              {isRead
                ? <Bell className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                : <X className="w-3.5 h-3.5" style={{ color: cfg.iconColor }} />}
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
            <NotifCard key={n.id} notif={n} onMarkRead={markAsRead} onSnooze={setSnoozeTarget} />
          ))}
          {read.length > 0 && (
            <>
              <p className="text-xs font-bold mt-4 mb-2 px-1" style={{ color: C.muted }}>נקראו</p>
              {read.map(n => (
                <NotifCard key={n.id} notif={n} isRead onMarkUnread={markAsUnread} onSnooze={setSnoozeTarget} />
              ))}
            </>
          )}
          {/* ── Snoozed section ── */}
          {snoozedNotifs.length > 0 && (
            <>
              <div className="flex items-center gap-3 mt-5 mb-3 px-1">
                <div className="flex-1 h-px" style={{ background: C.border }} />
                <span className="flex items-center gap-1 text-xs font-bold whitespace-nowrap" style={{ color: C.muted }}>
                  <BellOff className="w-3 h-3" />
                  מושתקים
                </span>
                <div className="flex-1 h-px" style={{ background: C.border }} />
              </div>
              {snoozedNotifs.map(n => (
                <NotifCard
                  key={n.id}
                  notif={n}
                  snoozedUntilDate={getSnoozedUntil(n.id)}
                  onUnsnooze={handleUnsnooze}
                />
              ))}
            </>
          )}
        </>
      ) : null}

      {/* Snooze bottom sheet */}
      <SnoozeDrawer
        open={!!snoozeTarget}
        onOpenChange={(open) => { if (!open) setSnoozeTarget(null); }}
        notif={snoozeTarget}
        onSelect={handleSnoozeSelect}
      />

      {adminMsg && (
        <AdminMessageDialog
          title={adminMsg.title}
          body={adminMsg.body}
          timestamp={adminMsg.createdAt}
          formatTime={formatDateHe}
          onClose={() => setAdminMsg(null)}
        />
      )}
    </div>
  );
}

export default function Notifications() {
  const { isGuest } = useAuth();
  return isGuest ? <GuestNotifications /> : <AuthNotifications />;
}
