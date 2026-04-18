import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Mail, Bell, Smartphone, Calendar, Shield, Wrench, FileText, Anchor, MessageCircle, HelpCircle, Lock, Send } from "lucide-react";
import { resetOnboarding } from "../components/shared/OnboardingTour";
import PinLock from "../components/shared/PinLock";
import { isPinEnabled, clearPin } from "@/lib/pinLock";
import { sendTestNotification } from "@/lib/notificationService";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import { isNative } from "@/lib/capacitor";
import { requestNotificationPermission, checkNotificationPermission } from "@/lib/notificationChannels";
import { C } from '@/lib/designTokens';

// ── Notification type toggles ────────────────────────────────────────────────
const NOTIFICATION_TYPES = [
  { key: 'notify_test',        label: 'טסט / כושר שייט',  icon: Calendar,  emoji: '📋', description: 'תזכורת לפני פקיעת הטסט' },
  { key: 'notify_insurance',   label: 'ביטוח',            icon: Shield,    emoji: '🛡️', description: 'תזכורת לפני פקיעת הביטוח' },
  { key: 'notify_maintenance', label: 'טיפול תקופתי',     icon: Wrench,    emoji: '🔧', description: 'תזכורת לטיפולים שמתקרבים' },
  { key: 'notify_document',    label: 'מסמכים',           icon: FileText,  emoji: '📄', description: 'תזכורת למסמכים שפוקעים' },
  { key: 'notify_safety',      label: 'ציוד בטיחות (שייט)', icon: Anchor, emoji: '🛟', description: 'תזכורת לציוד בטיחות ימי' },
];

// ── Timing fields ────────────────────────────────────────────────────────────
const TIMING_FIELDS = [
  { key: 'remind_test_days_before',         label: 'טסט',         icon: '📋', suffix: 'ימים', max: 365 },
  { key: 'remind_insurance_days_before',     label: 'ביטוח',       icon: '🛡️', suffix: 'ימים', max: 365 },
  { key: 'remind_document_days_before',      label: 'מסמכים',      icon: '📄', suffix: 'ימים', max: 365 },
  { key: 'remind_maintenance_days_before',   label: 'טיפולים',     icon: '🔧', suffix: 'ימים', max: 365 },
  { key: 'overdue_repeat_every_days',        label: 'חזרה על איחור', icon: '🔁', suffix: 'ימים', max: 30 },
];

const DEFAULT_FORM = {
  remind_test_days_before:       14,
  remind_insurance_days_before:  14,
  remind_document_days_before:   14,
  remind_maintenance_days_before: 7,
  overdue_repeat_every_days:      3,
  daily_job_hour:                 8,
  // Notification type toggles (all on by default)
  notify_test: true,
  notify_insurance: true,
  notify_maintenance: true,
  notify_document: true,
  notify_safety: true,
  // Channel toggles
  device_notifications_enabled: true,
  email_enabled: false,
  whatsapp_enabled: false,
};

// ── Guest version ─────────────────────────────────────────────────────────────
function GuestReminderSettings() {
  const { guestReminderSettings, updateGuestReminderSettings } = useAuth();
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...guestReminderSettings });
  const [showGuestSignup, setShowGuestSignup] = useState(false);

  const handleSave = () => {
    setShowGuestSignup(true);
  };

  return (
    <div className="px-4 pb-20" dir="rtl">
      <div className="mb-4 rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }}>
        <span className="text-lg">🔒</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black" style={{ color: '#92400E' }}>הגדרות זמניות</p>
          <p className="text-xs" style={{ color: '#B45309' }}>
            נשמרות במכשיר בלבד.{' '}
            <button onClick={() => window.location.href = '/Auth'} className="underline font-bold">הירשם לשמירה קבועה</button>
          </p>
        </div>
      </div>
      <SettingsUI form={form} setForm={setForm} onSave={handleSave} saving={false} isGuest={true} />

      {/* Guest signup prompt */}
      {showGuestSignup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center" style={{ background: '#FFF8E1' }}>
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className="text-lg font-black text-gray-900">הירשם כדי לשמור</h2>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              הרשמה בחינם - ותוכל לשמור הגדרות, לקבל תזכורות אמיתיות ולגשת מכל מכשיר
            </p>
            <button
              onClick={() => { window.location.href = '/Auth'; }}
              className="w-full h-12 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: '#FFBF00', color: '#2D5233' }}
            >
              הירשם בחינם
            </button>
            <button
              onClick={() => setShowGuestSignup(false)}
              className="w-full text-xs py-1 font-medium"
              style={{ color: '#D1D5DB' }}
            >
              חזרה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ReminderSettingsPage() {
  const { isGuest } = useAuth();
  if (isGuest) return <GuestReminderSettings />;
  return <AuthReminderSettings />;
}

// ── Auth version ──────────────────────────────────────────────────────────────
function AuthReminderSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });

  useEffect(() => {
    async function init() {
      if (!user?.id) { setLoading(false); return; }

      // Pull UI-only toggles from localStorage (notify_*, device_notifications_enabled).
      // These aren't in the DB yet — see DB_COLUMNS below + pending SQL migration.
      let localOnly = {};
      try { localOnly = JSON.parse(localStorage.getItem('reminder_settings_local') || '{}') || {}; } catch {}

      try {
        let rows = await db.reminder_settings.filter({ user_id: user.id });
        if (rows.length === 0) {
          // Create default settings — only with columns the DB knows about.
          const dbDefaults = {};
          ['remind_test_days_before','remind_insurance_days_before','remind_document_days_before',
           'remind_maintenance_days_before','overdue_repeat_every_days','daily_job_hour',
           'email_enabled','whatsapp_enabled'].forEach(k => {
            if (DEFAULT_FORM[k] !== undefined) dbDefaults[k] = DEFAULT_FORM[k];
          });
          const created = await db.reminder_settings.create({ user_id: user.id, ...dbDefaults });
          rows = [created];
        }
        const s = rows[0];
        setSettingsId(s.id);
        setForm({ ...DEFAULT_FORM, ...localOnly, ...s });
      } catch (e) {
        console.warn('Failed to load reminder settings:', e);
        // Still apply any local-only preferences so the user's toggles don't reset
        setForm({ ...DEFAULT_FORM, ...localOnly });
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [user?.id]);

  // Columns that actually exist in the 'reminder_settings' table today.
  // The `notify_*` booleans and `device_notifications_enabled` are UI-level
  // toggles that we persist locally until a DB migration adds them — that
  // way saving doesn't 500 on an unknown column.
  // TODO: after running supabase-add-reminder-notify-columns.sql, this list
  // can be expanded to include the notify_* + device_notifications_enabled fields.
  const DB_COLUMNS = [
    'remind_test_days_before',
    'remind_insurance_days_before',
    'remind_document_days_before',
    'remind_maintenance_days_before',
    'overdue_repeat_every_days',
    'daily_job_hour',
    'email_enabled',
    'whatsapp_enabled',
  ];
  const LOCAL_ONLY_KEY = 'reminder_settings_local';

  const handleSave = async () => {
    setSaving(true);
    try {
      const dbPayload = {};
      DB_COLUMNS.forEach(k => {
        if (DEFAULT_FORM[k] === undefined) return;
        if (typeof DEFAULT_FORM[k] === 'boolean') {
          dbPayload[k] = !!form[k];
        } else {
          dbPayload[k] = Number(form[k]) || 0;
        }
      });

      // Persist UI-level toggles locally so the user's choices don't vanish
      // on refresh even though the DB doesn't know about them yet.
      try {
        const localOnly = {};
        Object.keys(DEFAULT_FORM).forEach(k => {
          if (!DB_COLUMNS.includes(k)) localOnly[k] = form[k];
        });
        localStorage.setItem(LOCAL_ONLY_KEY, JSON.stringify(localOnly));
      } catch {}

      if (settingsId) {
        await db.reminder_settings.update(settingsId, dbPayload);
      } else {
        const created = await db.reminder_settings.create({ user_id: user.id, ...dbPayload });
        setSettingsId(created.id);
      }
      toast.success('ההגדרות נשמרו');
    } catch (e) {
      toast.error('שגיאה בשמירה: ' + (e?.message?.slice(0, 80) || ''));
      console.error('reminder_settings save error', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="px-4 pb-20" dir="rtl">
      <SettingsUI form={form} setForm={setForm} onSave={handleSave} saving={saving} isGuest={false} />
    </div>
  );
}

// ── Shared Settings UI ────────────────────────────────────────────────────────
function SettingsUI({ form, setForm, onSave, saving, isGuest }) {
  const [devicePermission, setDevicePermission] = useState(null);

  useEffect(() => {
    if (isNative) {
      checkNotificationPermission().then(setDevicePermission);
    }
  }, []);

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setDevicePermission(granted);
    if (granted) toast.success('התראות הופעלו');
    else toast.error('ההרשאה נדחתה - ניתן להפעיל בהגדרות המכשיר');
  };

  const toggleType = (key) => {
    setForm(f => ({ ...f, [key]: !f[key] }));
  };

  return (
    <>
      {/* Header */}
      <div className="rounded-3xl p-5 mb-6 relative overflow-hidden"
        style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
            <Bell className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-black text-xl text-white">הגדרות התראות</h1>
            <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
              בחר מה ומתי לקבל התראות
            </p>
          </div>
        </div>
      </div>

      {/* ── Device notifications permission ── */}
      {isNative && (
        <div className="rounded-2xl p-4 mb-5 flex items-center justify-between"
          style={{
            background: devicePermission ? '#F0FDF4' : '#FEF3C7',
            border: `1.5px solid ${devicePermission ? '#BBF7D0' : '#FDE68A'}`,
          }}>
          <div className="flex items-center gap-3">
            <Smartphone className="w-5 h-5" style={{ color: devicePermission ? '#16A34A' : '#D97706' }} />
            <div>
              <p className="font-bold text-sm" style={{ color: devicePermission ? '#166534' : '#92400E' }}>
                {devicePermission ? 'התראות במכשיר פעילות' : 'התראות במכשיר כבויות'}
              </p>
              <p className="text-xs" style={{ color: devicePermission ? '#16A34A' : '#D97706' }}>
                {devicePermission ? 'תקבל התראות push למכשיר' : 'לחץ להפעיל'}
              </p>
            </div>
          </div>
          {!devicePermission && (
            <Button onClick={handleRequestPermission} size="sm"
              className="rounded-xl font-bold" style={{ background: '#D97706', color: 'white' }}>
              הפעל
            </Button>
          )}
        </div>
      )}

      {/* ── Which notifications to receive ── */}
      <div className="mb-5">
        <h2 className="font-bold text-base text-gray-900 mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: C.primary }} />
          איזה התראות לקבל?
        </h2>
        <div className="space-y-2">
          {NOTIFICATION_TYPES.map(nt => {
            const active = !!form[nt.key];
            return (
              <div key={nt.key}
                className="rounded-2xl p-3.5 flex items-center justify-between transition-all"
                style={{
                  background: active ? '#F0FDF4' : '#FAFAFA',
                  border: `1.5px solid ${active ? '#BBF7D0' : '#E5E7EB'}`,
                }}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{nt.emoji}</span>
                  <div>
                    <p className="font-bold text-sm" style={{ color: active ? '#166534' : '#6B7280' }}>{nt.label}</p>
                    <p className="text-xs" style={{ color: '#9CA3AF' }}>{nt.description}</p>
                  </div>
                </div>
                <Switch checked={active} onCheckedChange={() => toggleType(nt.key)} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Timing: how many days before ── */}
      <div className="mb-5">
        <h2 className="font-bold text-base text-gray-900 mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" style={{ color: C.primary }} />
          כמה ימים מראש?
        </h2>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1.5px solid #E5E7EB' }}>
          {TIMING_FIELDS.map((field, i) => (
            <div key={field.key}
              className="flex items-center justify-between gap-3 px-4 py-3.5"
              style={{ borderTop: i > 0 ? '1px solid #F3F4F6' : 'none' }}>
              <div className="flex items-center gap-2.5">
                <span className="text-base">{field.icon}</span>
                <span className="font-bold text-sm text-gray-800">{field.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={0}
                  max={field.max}
                  className="w-14 h-10 text-center font-black text-base rounded-xl outline-none transition-all focus:ring-2 focus:ring-[#3A7D44]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  style={{ background: '#F0F4F1', color: '#2D5233', border: '1.5px solid #D8E5D9' }}
                  value={form[field.key] ?? ''}
                  onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                  dir="ltr"
                />
                <span className="text-xs text-gray-500 font-bold">{field.suffix}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Notification time ── */}
      <div className="mb-5">
        <h2 className="font-bold text-base text-gray-900 mb-3">שעת שליחת התראות</h2>
        <div className="rounded-2xl p-4 flex items-center justify-between"
          style={{ border: '1.5px solid #E5E7EB' }}>
          <div className="flex items-center gap-2.5">
            <span className="text-base">⏰</span>
            <span className="font-bold text-sm text-gray-800">בכל בוקר בשעה</span>
          </div>
          <Select
            value={String(form.daily_job_hour ?? 8)}
            onValueChange={v => setForm(f => ({ ...f, daily_job_hour: Number(v) }))}
          >
            <SelectTrigger className="w-24 font-bold text-center h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Future channels ── */}
      {!isGuest && (
        <div className="mb-5">
          <h2 className="font-bold text-base text-gray-900 mb-3">ערוצי התראה נוספים</h2>
          <div className="space-y-2">
            {/* Email - coming soon */}
            <div className="rounded-2xl p-3.5 flex items-center justify-between"
              style={{ background: '#F9FAFB', border: '1.5px solid #E5E7EB', opacity: 0.6 }}>
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="font-bold text-sm text-gray-500">התראות באימייל</p>
                  <p className="text-xs text-gray-400">בקרוב</p>
                </div>
              </div>
              <Switch disabled checked={false} />
            </div>
            {/* WhatsApp - coming soon */}
            <div className="rounded-2xl p-3.5 flex items-center justify-between"
              style={{ background: '#F9FAFB', border: '1.5px solid #E5E7EB', opacity: 0.6 }}>
              <div className="flex items-center gap-3">
                <MessageCircle className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="font-bold text-sm text-gray-500">התראות ב-WhatsApp</p>
                  <p className="text-xs text-gray-400">בקרוב</p>
                </div>
              </div>
              <Switch disabled checked={false} />
            </div>
          </div>
        </div>
      )}

      {/* Save button */}
      <Button onClick={onSave} disabled={saving}
        className="w-full h-14 rounded-2xl font-bold text-base gap-2 mb-4"
        style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <>
            <Save className="h-5 w-5" />
            שמור הגדרות
          </>
        )}
      </Button>

      {/* PIN lock */}
      {!isGuest && <PinLockSection />}

      {/* Test notification — lets the user confirm push is wired end-to-end */}
      {!isGuest && isNative && <TestNotificationButton />}

      {/* Replay tour */}
      <ReplayTourButton />
    </>
  );
}

function PinLockSection() {
  const [enabled, setEnabled] = useState(() => isPinEnabled());
  const [setupOpen, setSetupOpen] = useState(false);

  const handleToggle = () => {
    if (enabled) {
      if (!confirm('לבטל את נעילת הקוד? בפעם הבאה תיכנס ישר בלי קוד.')) return;
      clearPin();
      setEnabled(false);
      toast.success('נעילת הקוד בוטלה');
    } else {
      setSetupOpen(true);
    }
  };

  return (
    <>
      <div className="mb-3 rounded-2xl p-4" style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: enabled ? '#E8F2EA' : '#F3F4F6' }}>
              <Lock className="w-5 h-5" style={{ color: enabled ? '#2D5233' : '#9CA3AF' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm" style={{ color: '#1C2E20' }}>נעילת קוד</p>
              <p className="text-xs mt-0.5" style={{ color: '#6B7280' }}>
                {enabled ? 'מופעל. קוד 4 ספרות בכניסה' : 'הזן קוד בכל פתיחה של האפליקציה'}
              </p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} aria-label="נעילת קוד" />
        </div>
        {enabled && (
          <button onClick={() => setSetupOpen(true)}
            className="w-full mt-3 py-2 text-xs font-bold rounded-lg transition-colors"
            style={{ background: '#F9FAFB', color: '#2D5233', border: '1px solid #E5E7EB' }}>
            החלף קוד
          </button>
        )}
      </div>
      {setupOpen && (
        <PinLock mode="setup"
          onSuccess={() => { setEnabled(true); setSetupOpen(false); }}
          onCancel={() => setSetupOpen(false)} />
      )}
    </>
  );
}

function TestNotificationButton() {
  const [sending, setSending] = useState(false);

  const handleTest = async () => {
    setSending(true);
    try {
      const res = await sendTestNotification();
      if (res.ok) {
        toast.success('נשלחה התראת בדיקה. תגיע בעוד כ-5 שניות');
      } else if (res.reason === 'permission_denied') {
        toast.error('אין הרשאת התראות. אפשר בהגדרות המכשיר');
      } else {
        toast.error('שליחה נכשלה');
      }
    } catch {
      toast.error('שליחה נכשלה');
    } finally {
      setSending(false);
    }
  };

  return (
    <button onClick={handleTest} disabled={sending}
      className="w-full mb-3 py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60"
      style={{ background: '#fff', color: '#2D5233', border: '1.5px solid #E5E7EB' }}>
      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      שלח התראת בדיקה
    </button>
  );
}

function ReplayTourButton() {
  const navigate = useNavigate();
  const handleReplay = () => {
    resetOnboarding();
    toast.success('ההדרכה תופיע שוב במסך הראשי');
    setTimeout(() => navigate('/Dashboard'), 600);
  };
  return (
    <button onClick={handleReplay}
      className="w-full rounded-2xl py-3 flex items-center justify-center gap-2 text-sm font-bold transition-all active:scale-[0.98] mb-8"
      style={{ background: '#F3F4F6', color: '#374151', border: '1.5px solid #E5E7EB' }}>
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
      הצג שוב את מסך ההדרכה
    </button>
  );
}
