import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle, Calendar, Shield, Wrench, FileText, AlertTriangle, Clock, User } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { formatDateHe, getVehicleLabels } from "../components/shared/DateStatusUtils";
import { useAuth } from "../components/shared/GuestContext";
import { calcReminders } from "../components/shared/ReminderEngine";
import { markNotificationRead } from "@/lib/notificationChannels";
import { C } from '@/lib/designTokens';

const TYPE_CONFIG = {
  'טסט':        { icon: Calendar,  bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
  'כושר שייט':  { icon: Calendar,  bg: '#E0F7FA', color: '#0C7B93', border: '#B2EBF2' },
  'ביטוח':      { icon: Shield,    bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' },
  'ביטוח ימי':  { icon: Shield,    bg: '#E0F7FA', color: '#0C7B93', border: '#B2EBF2' },
  'טיפול':      { icon: Wrench,    bg: '#FFF8E1', color: '#F57F17', border: '#FFD54F' },
  'מסמך':       { icon: FileText,  bg: C.light,   color: C.primary, border: C.border },
  'פירוטכניקה': { icon: AlertTriangle, bg: '#FEF2F2', color: '#DC2626', border: '#FECACA' },
  'מטף כיבוי':  { icon: AlertTriangle, bg: '#FEF3C7', color: '#D97706', border: '#FDE68A' },
  'אסדת הצלה':  { icon: AlertTriangle, bg: '#E0F7FA', color: '#0C7B93', border: '#B2EBF2' },
};

// ── Notification Card ────────────────────────────────────────────────────────
function NotifCard({ notif, onMarkRead, onMarkUnread, isRead }) {
  const tc = TYPE_CONFIG[notif.notification_type] || { icon: Bell, bg: '#F5F5F5', color: '#757575', border: '#E0E0E0' };
  const Icon = tc.icon;
  const isOverdue = notif.is_overdue;

  return (
    <div
      className={`rounded-2xl p-4 mb-2.5 flex items-center gap-3 transition-all`}
      style={{
        background: isOverdue ? '#FEF2F2' : isRead ? '#FAFAFA' : '#fff',
        border: `1.5px solid ${isOverdue ? '#FECACA' : isRead ? '#E5E7EB' : C.border}`,
        boxShadow: isRead ? 'none' : `0 2px 10px ${C.primary}08`,
        opacity: isRead ? 0.65 : 1,
      }}
      dir="rtl"
    >
      {/* Icon */}
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: isOverdue ? '#DC2626' : tc.bg, boxShadow: isOverdue ? '0 3px 10px rgba(220,38,38,0.2)' : 'none' }}>
        <Icon className="w-5 h-5" style={{ color: isOverdue ? '#fff' : tc.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${isRead ? 'font-medium' : 'font-bold'}`}
          style={{ color: isOverdue ? '#991B1B' : isRead ? '#6B7280' : C.text }}>
          {notif.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs font-medium" style={{ color: isOverdue ? '#DC2626' : C.muted }}>
            {formatDateHe(notif.due_date)}
          </span>
          {isOverdue && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              פג תוקף
            </span>
          )}
          {!isOverdue && notif.days_left !== undefined && notif.days_left <= 7 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FEF3C7', color: '#D97706' }}>
              בקרוב
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
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────
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
          <h3 className="font-black text-lg mb-2" style={{ color: C.text }}>אין התראות</h3>
          <p className="text-sm max-w-xs mx-auto leading-relaxed" style={{ color: C.muted }}>
            ההתראות שלך יופיעו כאן כשמועד הטסט/כושר שייט, הביטוח או הטיפול מתקרב
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Status Summary ───────────────────────────────────────────────────────────
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
            <span className="font-black text-lg block leading-none" style={{ color: item.color }}>{item.count}</span>
            <span className="text-xs font-bold" style={{ color: item.color }}>{item.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Guest Notifications ──────────────────────────────────────────────────────
function GuestNotifications() {
  const { guestVehicles, guestReminderSettings } = useAuth();
  const notifications = [];
  const today = new Date();

  guestVehicles.forEach(v => {
    const vLabels = getVehicleLabels(v.vehicle_type, v.nickname);
    const name = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || vLabels.vehicleFallback;
    const remindTestBefore = guestReminderSettings?.remind_test_days_before ?? 14;
    const remindInsBefore = guestReminderSettings?.remind_insurance_days_before ?? 14;

    if (v.test_due_date) {
      const days = Math.ceil((new Date(v.test_due_date) - today) / 86400000);
      if (days <= remindTestBefore) {
        notifications.push({
          id: `notif_test_${v.id}`, notification_type: vLabels.testWord, due_date: v.test_due_date,
          is_overdue: days < 0, days_left: days,
          message: days < 0 ? `${vLabels.testWord} של ${name} עבר את תאריך התוקף`
            : days === 0 ? `${vLabels.testWord} של ${name} היום!`
            : `${vLabels.testWord} ל${name} בעוד ${days} ימים`,
        });
      }
    }
    if (v.insurance_due_date) {
      const days = Math.ceil((new Date(v.insurance_due_date) - today) / 86400000);
      const insWord = vLabels.insuranceWord || 'ביטוח';
      if (days <= remindInsBefore) {
        notifications.push({
          id: `notif_ins_${v.id}`, notification_type: insWord, due_date: v.insurance_due_date,
          is_overdue: days < 0, days_left: days,
          message: days < 0 ? `ה${insWord} של ${name} עבר את תאריך התוקף`
            : days === 0 ? `ה${insWord} של ${name} מסתיים היום!`
            : `${insWord} ל${name} בעוד ${days} ימים`,
        });
      }
    }
  });

  const overdue = notifications.filter(n => n.is_overdue).length;
  const upcoming = notifications.filter(n => !n.is_overdue).length;

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="rounded-3xl p-5 mb-5 relative overflow-hidden"
        style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full" style={{ background: `${C.yellow}20` }} />
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white">התראות</h1>
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
        <span className="text-lg">🔒</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black" style={{ color: '#92400E' }}>התראות זמניות</p>
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

// ── Map ReminderEngine output → NotifCard shape ─────────────────────────────
const REMINDER_TYPE_FALLBACK = {
  test: 'טסט',
  insurance: 'ביטוח',
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

// ── Auth Notifications ───────────────────────────────────────────────────────
function AuthNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch vehicles
  const { data: accountData } = useQuery({
    queryKey: ['auth-notif-account', user?.id],
    queryFn: async () => {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length === 0) return { accountId: null, vehicles: [] };
      const accountId = members[0].account_id;
      const vehicles = await db.vehicles.filter({ account_id: accountId });
      return { accountId, vehicles };
    },
    enabled: !!user?.id,
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
  const profileIncomplete = !profileData || !profileData.phone;

  // Check license expiration
  const licenseExpDate = profileData?.license_expiration_date;
  const licenseDays = licenseExpDate ? Math.ceil((new Date(licenseExpDate) - new Date()) / 86400000) : null;
  const licenseAlert = licenseDays !== null && licenseDays <= 30;

  // Build notifications with SAME logic as the bell (NotificationBell in Layout.jsx)
  const notifications = useMemo(() => {
    if (!vehicles.length) return [];
    const items = [];
    const now = new Date();
    const threshold = (settings?.remind_test_days_before) || 14;
    const VESSEL_TYPES = ['כלי שייט','מפרשית','סירה מנועית','אופנוע ים','סירת גומי'];
    const isVesselV = (v) => VESSEL_TYPES.includes(v.vehicle_type);
    const daysTo = (d) => d ? Math.ceil((new Date(d) - now) / 86400000) : null;
    const add = (id, type, label, name, days) => {
      items.push({ id, notification_type: type, message: label, due_date: null, days_left: days, is_overdue: days < 0, name });
    };

    // Mileage dates from localStorage
    let mileageDates = {};
    try { mileageDates = JSON.parse(localStorage.getItem('carreminder_mileage_dates') || '{}'); } catch {}

    vehicles.forEach(v => {
      const name = v.nickname || v.manufacturer || 'רכב';
      const isVessel = isVesselV(v);
      const testWord = isVessel ? 'כושר שייט' : 'טסט';
      const vehicleAge = v.year ? now.getFullYear() - Number(v.year) : 0;

      // Test/כושר שייט
      const testDays = daysTo(v.test_due_date);
      if (testDays !== null && testDays <= threshold) {
        add(`test-${v.id}`, testWord, testDays < 0 ? `${testWord} פג תוקף!` : `${testWord} בעוד ${testDays} ימים`, name, testDays);
      }
      // Insurance
      const insDays = daysTo(v.insurance_due_date);
      if (insDays !== null && insDays <= threshold) {
        add(`ins-${v.id}`, 'ביטוח', insDays < 0 ? 'ביטוח פג תוקף!' : `ביטוח בעוד ${insDays} ימים`, name, insDays);
      }
      // Vessel safety equipment
      if (isVessel) {
        const pyroDays = daysTo(v.pyrotechnics_expiry_date);
        if (pyroDays !== null && pyroDays <= threshold) add(`pyro-${v.id}`, 'פירוטכניקה', pyroDays < 0 ? 'פירוטכניקה פג תוקף!' : `פירוטכניקה בעוד ${pyroDays} ימים`, name, pyroDays);
        const extDays = daysTo(v.fire_extinguisher_expiry_date);
        if (extDays !== null && extDays <= threshold) add(`ext-${v.id}`, 'מטף כיבוי', extDays < 0 ? 'מטף כיבוי פג תוקף!' : `מטף כיבוי בעוד ${extDays} ימים`, name, extDays);
        const raftDays = daysTo(v.life_raft_expiry_date);
        if (raftDays !== null && raftDays <= threshold) add(`raft-${v.id}`, 'אסדת הצלה', raftDays < 0 ? 'אסדת הצלה פג תוקף!' : `אסדת הצלה בעוד ${raftDays} ימים`, name, raftDays);
      }
      // Tires (100K km / 3 years)
      if (!isVessel && v.current_km && v.last_tire_change_date) {
        const tireDaysAgo = Math.floor((now - new Date(v.last_tire_change_date)) / 86400000);
        if (tireDaysAgo / 365 >= 2.75 || (v.km_since_tire_change && v.current_km - Number(v.km_since_tire_change) >= 90000)) {
          add(`tires-${v.id}`, 'צמיגים', 'הגיע זמן לבדוק צמיגים', name, 30);
        }
      }
      // Service (15K km)
      if (!isVessel && v.current_km && v.km_baseline) {
        const kmSince = v.current_km - v.km_baseline;
        if (kmSince >= 13500) add(`service-${v.id}`, 'טיפול', `טיפול תקופתי (${Math.round(kmSince / 1000)}K ק"מ)`, name, kmSince >= 15000 ? 0 : 30);
      }
      // Brakes (15+ years)
      if (!isVessel && vehicleAge >= 15 && v.test_due_date) {
        const td = daysTo(v.test_due_date);
        if (td !== null && td <= 60 && td > 0) add(`brakes-${v.id}`, 'בלמים', `רכב ותיק (${vehicleAge} שנים) - נדרש אישור בלמים`, name, td);
      }
      // Mileage update (6 months)
      const mileageDate = mileageDates[v.id] || v.km_update_date || v.engine_hours_update_date;
      if (mileageDate) {
        const mDays = Math.floor((now - new Date(mileageDate)) / 86400000);
        if (mDays > 180) add(`mileage-${v.id}`, 'עדכון', !isVessel ? `עדכן קילומטראז' (${mDays} ימים)` : `עדכן שעות מנוע (${mDays} ימים)`, name, 999);
      } else if (v.current_km || v.current_engine_hours) {
        add(`mileage-${v.id}`, 'עדכון', !isVessel ? 'עדכן קילומטראז\'' : 'עדכן שעות מנוע', name, 999);
      }
      // Shipyard (3 years)
      if (isVessel && v.last_shipyard_date) {
        const sDays = Math.floor((now - new Date(v.last_shipyard_date)) / 86400000);
        if (sDays / 365 >= 2.75) add(`shipyard-${v.id}`, 'מספנה', sDays / 365 >= 3 ? 'הגיע זמן לביקור מספנה!' : 'ביקור מספנה מתקרב', name, sDays / 365 >= 3 ? 0 : 30);
      }
    });

    // Filter dismissed
    let dismissedIds = [];
    try { dismissedIds = JSON.parse(localStorage.getItem('dismissed_notif_ids') || '[]'); } catch {}
    const dismissedSet = new Set(dismissedIds);

    return items.filter(n => !dismissedSet.has(n.id)).sort((a, b) => {
      if (a.is_overdue && !b.is_overdue) return -1;
      if (!a.is_overdue && b.is_overdue) return 1;
      return (a.days_left ?? 999) - (b.days_left ?? 999);
    });
  }, [vehicles, settings]);

  // Read state - synced with localStorage (same as bell)
  const [readIds, setReadIds] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('read_notif_ids') || '[]');
      const timedReads = JSON.parse(localStorage.getItem('read_notif_timed') || '{}');
      const now = Date.now();
      const validTimedIds = Object.entries(timedReads)
        .filter(([_, ts]) => now - ts < 7 * 24 * 60 * 60 * 1000)
        .map(([id]) => id);
      return new Set([...stored, ...validTimedIds]);
    } catch { return new Set(); }
  });

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

  if (!user?.id || isLoading) return <LoadingSpinner />;

  const sorted = [...notifications].sort((a, b) => {
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return (a.days_left ?? 999) - (b.days_left ?? 999);
  });
  const unread = sorted.filter(n => !readIds.has(n.id));
  const read = sorted.filter(n => readIds.has(n.id));

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="rounded-3xl p-5 mb-5 relative overflow-hidden"
        style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white">התראות</h1>
            <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {unread.length > 0 ? `${unread.length} חדשות` : 'אין התראות חדשות'}
            </p>
          </div>
        </div>
      </div>

      {/* Profile incomplete notification */}
      {profileIncomplete && (
        <Link to={createPageUrl('UserProfile')}
          className="rounded-2xl p-4 mb-2.5 flex items-center gap-3 transition-all active:scale-[0.99]"
          style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE', boxShadow: '0 2px 10px rgba(67,56,202,0.08)' }}
          dir="rtl">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: '#4338CA', boxShadow: '0 3px 10px rgba(67,56,202,0.3)' }}>
            <User className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#312E81' }}>השלם פרטים אישיים</p>
            <p className="text-xs mt-0.5" style={{ color: '#6366F1' }}>הוסף טלפון ותאריך לידה באזור האישי</p>
          </div>
        </Link>
      )}

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

      {sorted.length === 0 && !profileIncomplete && !licenseAlert ? (
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
