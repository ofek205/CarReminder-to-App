import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle, Calendar, Shield, Wrench, FileText, AlertTriangle, Clock } from "lucide-react";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { formatDateHe, getVehicleLabels } from "../components/shared/DateStatusUtils";
import { useAuth } from "../components/shared/GuestContext";
import { calcReminders } from "../components/shared/ReminderEngine";
import { markNotificationRead } from "@/lib/notificationChannels";
import { C } from '@/lib/designTokens';

const TYPE_CONFIG = {
  'טסט':   { icon: Calendar,  bg: '#E3F2FD', color: '#1565C0', border: '#90CAF9' },
  'ביטוח': { icon: Shield,    bg: '#F3E5F5', color: '#7B1FA2', border: '#CE93D8' },
  'טיפול': { icon: Wrench,    bg: '#FFF8E1', color: '#F57F17', border: '#FFD54F' },
  'מסמך':  { icon: FileText,  bg: C.light,   color: C.primary, border: C.border },
};

// ── Notification Card ────────────────────────────────────────────────────────
function NotifCard({ notif, onMarkRead, isRead }) {
  const tc = TYPE_CONFIG[notif.notification_type] || { icon: Bell, bg: '#F5F5F5', color: '#757575', border: '#E0E0E0' };
  const Icon = tc.icon;
  const isOverdue = notif.is_overdue;

  return (
    <div
      className={`rounded-2xl p-4 mb-2.5 flex items-center gap-3 transition-all ${isRead ? 'opacity-50' : ''}`}
      style={{
        background: isOverdue ? '#FEF2F2' : '#fff',
        border: `1.5px solid ${isOverdue ? '#FECACA' : C.border}`,
        boxShadow: isRead ? 'none' : `0 2px 10px ${C.primary}08`,
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
        <p className="text-sm font-bold" style={{ color: isOverdue ? '#991B1B' : C.text }}>{notif.message}</p>
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

      {/* Mark as read */}
      {onMarkRead && !isRead && (
        <button onClick={() => onMarkRead(notif.id)}
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:bg-gray-50 transition-all">
          <CheckCircle className="w-4 h-4" style={{ color: C.muted }} />
        </button>
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
            ההתראות שלך יופיעו כאן כשמועד הטסט, הביטוח או הטיפול מתקרב
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
    const name = v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || 'הרכב';
    const remindTestBefore = guestReminderSettings?.remind_test_days_before ?? 14;
    const remindInsBefore = guestReminderSettings?.remind_insurance_days_before ?? 14;

    if (v.test_due_date) {
      const days = Math.ceil((new Date(v.test_due_date) - today) / 86400000);
      const vLabels = getVehicleLabels(v.vehicle_type, v.nickname);
      if (days <= remindTestBefore) {
        notifications.push({
          id: `notif_test_${v.id}`, notification_type: 'טסט', due_date: v.test_due_date,
          is_overdue: days < 0, days_left: days,
          message: days < 0 ? `${vLabels.testWord} של ${name} עבר את תאריך התוקף`
            : days === 0 ? `${vLabels.testWord} של ${name} היום!`
            : `${vLabels.testWord} ל${name} בעוד ${days} ימים`,
        });
      }
    }
    if (v.insurance_due_date) {
      const days = Math.ceil((new Date(v.insurance_due_date) - today) / 86400000);
      if (days <= remindInsBefore) {
        notifications.push({
          id: `notif_ins_${v.id}`, notification_type: 'ביטוח', due_date: v.insurance_due_date,
          is_overdue: days < 0, days_left: days,
          message: days < 0 ? `הביטוח של ${name} עבר את תאריך התוקף`
            : days === 0 ? `הביטוח של ${name} מסתיים היום!`
            : `ביטוח ל${name} בעוד ${days} ימים`,
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
const REMINDER_TYPE_MAP = {
  test: 'טסט',
  insurance: 'ביטוח',
  maintenance: 'טיפול',
  safety: 'טיפול',
  document: 'מסמך',
};

function remindersToNotifs(reminders) {
  return reminders.map(r => ({
    id: r.id,
    notification_type: REMINDER_TYPE_MAP[r.type] || 'טיפול',
    message: `${r.typeName || r.type} — ${r.name}`,
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

  // Calculate notifications from vehicle data
  const notifications = remindersToNotifs(
    calcReminders({ vehicles, documents: [], settings: settings || undefined })
  );

  const markAsRead = async (id) => {
    // For now, just remove from UI — future: persist to notification_log
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  if (!user?.id || isLoading) return <LoadingSpinner />;

  const sorted = [...notifications].sort((a, b) => {
    // Overdue first, then by days_left ascending
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return (a.days_left ?? 999) - (b.days_left ?? 999);
  });
  const unread = sorted.filter(n => !n.is_read);
  const read = sorted.filter(n => n.is_read);

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

      {sorted.length === 0 ? (
        <NotifEmptyState />
      ) : (
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
                <NotifCard key={n.id} notif={n} isRead />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function Notifications() {
  const { isGuest } = useAuth();
  return isGuest ? <GuestNotifications /> : <AuthNotifications />;
}
