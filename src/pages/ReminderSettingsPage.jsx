import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/lib/supabaseEntities';
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Mail, Bell, Smartphone, MessageCircle, Send } from "lucide-react";
import { sendTestNotification } from "@/lib/notificationService";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import { isNative } from "@/lib/capacitor";
import { requestNotificationPermission, checkNotificationPermission } from "@/lib/notificationChannels";
import { C } from '@/lib/designTokens';

//  Reminder categories. merged toggle + timing 
// Each row now controls (a) whether the type fires at all, and (b) how many
// days before the due date the push goes out. The old two-section layout
// (toggle list + timing list) repeated the same 5 rows twice.
const REMINDER_CATEGORIES = [
  {
    key:     'notify_test',
    timing:  'remind_test_days_before',
    label:   'טסט שנתי / כושר שייט',
    emoji:   '📋',
    description: 'טסט רכב, כושר שייט. התרעה לפני שהרישיון פג.',
  },
  {
    key:     'notify_insurance',
    timing:  'remind_insurance_days_before',
    label:   'ביטוח',
    emoji:   '🛡️',
    description: 'חובה, מקיף, צד ג׳, ביטוח ימי',
  },
  {
    key:     'notify_maintenance',
    timing:  'remind_maintenance_days_before',
    label:   'טיפולים ותיקונים',
    emoji:   '🔧',
    description: 'טיפול תקופתי, שמן, צמיגים, בלמים',
  },
  {
    key:     'notify_document',
    timing:  'remind_document_days_before',
    label:   'מסמכים',
    emoji:   '📄',
    description: 'רישיון רכב, רישיון נהיגה, אישורי חניה',
  },
  {
    key:     'notify_safety',
    // Safety has no dedicated "days before" in DB yet. it re-uses document.
    timing:  'remind_document_days_before',
    label:   'ציוד בטיחות וחירום',
    emoji:   '🛟',
    description: 'פירוטכניקה, מטף, אסדת הצלה, גלגל הצלה',
  },
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
  // Quiet hours. suppress pushes outside of user's active window.
  // Default off (00→00 meaning "no quiet hours applied").
  quiet_hours_enabled: false,
  quiet_hours_start:   22,
  quiet_hours_end:      7,
};

//  Guest version 
function GuestReminderSettings({ embedded = false }) {
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
          <p className="text-sm font-bold" style={{ color: '#92400E' }}>הגדרות זמניות</p>
          <p className="text-xs" style={{ color: '#B45309' }}>
            נשמרות במכשיר בלבד.{' '}
            <button onClick={() => window.location.href = '/Auth'} className="underline font-bold">הירשם לשמירה קבועה</button>
          </p>
        </div>
      </div>
      <SettingsUI form={form} setForm={setForm} onSave={handleSave} saving={false} isGuest={true} embedded={embedded} />

      {/* Guest signup prompt */}
      {showGuestSignup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center" style={{ background: '#FFF8E1' }}>
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900">הירשם כדי לשמור</h2>
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

//  Main export 
export default function ReminderSettingsPage({ embedded = false }) {
  const { isGuest } = useAuth();
  if (isGuest) return <GuestReminderSettings embedded={embedded} />;
  return <AuthReminderSettings embedded={embedded} />;
}

//  Auth version 
function AuthReminderSettings({ embedded = false }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState(null);
  const [form, setForm] = useState({ ...DEFAULT_FORM });

  useEffect(() => {
    async function init() {
      if (!user?.id) { setLoading(false); return; }

      // Pull UI-only toggles from localStorage (notify_*, device_notifications_enabled).
      // These aren't in the DB yet. see DB_COLUMNS below + pending SQL migration.
      let localOnly = {};
      try { localOnly = JSON.parse(localStorage.getItem('reminder_settings_local') || '{}') || {}; } catch {}

      try {
        let rows = await db.reminder_settings.filter({ user_id: user.id });
        if (rows.length === 0) {
          // Create default settings. only with columns the DB knows about.
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
  // toggles that we persist locally until a DB migration adds them. that
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
      <SettingsUI form={form} setForm={setForm} onSave={handleSave} saving={saving} isGuest={false} embedded={embedded} />
    </div>
  );
}

//  Shared Settings UI 
function SettingsUI({ form, setForm, onSave, saving, isGuest, embedded = false }) {
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
      {/* Header. skip when embedded inside the Settings hub. */}
      {!embedded && (
        <div className="rounded-3xl p-5 mb-6 relative overflow-hidden"
          style={{ background: C.grad, boxShadow: `0 8px 32px ${C.primary}40` }}>
          <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="relative z-10 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <Bell className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl text-white">הגדרות התראות</h1>
              <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                בחר מה ומתי לקבל התראות
              </p>
            </div>
          </div>
        </div>
      )}

      {/*  Device notifications permission  */}
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

      {/*  Reminder categories. toggle + timing merged per row  */}
      <div className="mb-5">
        <h2 className="font-bold text-base text-gray-900 mb-1 flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: C.primary }} />
          מה ומתי לקבל
        </h2>
        <p className="text-[11px] text-gray-500 mb-3">
          הפעל או כבה כל סוג, והגדר כמה ימים מראש להזכיר.
        </p>
        <div className="space-y-2">
          {REMINDER_CATEGORIES.map(cat => {
            const active = !!form[cat.key];
            return (
              <div key={cat.key}
                className="rounded-2xl p-3.5 transition-all"
                style={{
                  background: active ? '#F0FDF4' : '#FAFAFA',
                  border: `1.5px solid ${active ? '#BBF7D0' : '#E5E7EB'}`,
                }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className="text-lg leading-none mt-0.5">{cat.emoji}</span>
                    <div className="min-w-0">
                      <p className="font-bold text-sm" style={{ color: active ? '#166534' : '#6B7280' }}>{cat.label}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: '#9CA3AF' }}>{cat.description}</p>
                    </div>
                  </div>
                  <Switch checked={active} onCheckedChange={() => toggleType(cat.key)} />
                </div>
                {active && (
                  <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3"
                    style={{ borderColor: '#D1FAE5' }}>
                    <span className="text-[11px] font-bold" style={{ color: '#166534' }}>
                      להזכיר מראש:
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={365}
                        value={form[cat.timing] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [cat.timing]: e.target.value }))}
                        dir="ltr"
                        className="w-14 h-9 text-center font-bold text-sm rounded-lg outline-none focus:ring-2 focus:ring-[#3A7D44]/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        style={{ background: '#fff', color: '#2D5233', border: '1.5px solid #BBF7D0' }}
                      />
                      <span className="text-[11px] font-bold" style={{ color: '#166534' }}>ימים לפני</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/*  Overdue repeat  */}
      <div className="mb-5 rounded-2xl p-3.5 flex items-center justify-between gap-3"
        style={{ background: '#FFF7ED', border: '1.5px solid #FED7AA' }}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-lg">🔁</span>
          <div>
            <p className="font-bold text-sm" style={{ color: '#9A3412' }}>חזרה על איחור</p>
            <p className="text-[11px]" style={{ color: '#C2410C' }}>כל כמה ימים להזכיר אם פג תוקף</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min={0}
            max={30}
            value={form.overdue_repeat_every_days ?? ''}
            onChange={e => setForm(f => ({ ...f, overdue_repeat_every_days: e.target.value }))}
            dir="ltr"
            className="w-14 h-10 text-center font-bold text-base rounded-xl outline-none focus:ring-2 focus:ring-orange-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ background: '#fff', color: '#9A3412', border: '1.5px solid #FED7AA' }}
          />
          <span className="text-xs font-bold" style={{ color: '#9A3412' }}>ימים</span>
        </div>
      </div>

      {/*  Notification time + quiet hours  */}
      <div className="mb-5">
        <h2 className="font-bold text-base text-gray-900 mb-3">תזמון</h2>
        <div className="rounded-2xl overflow-hidden" style={{ border: '1.5px solid #E5E7EB' }}>
          {/* Daily push hour */}
          <div className="flex items-center justify-between px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="text-base">⏰</span>
              <div>
                <p className="font-bold text-sm text-gray-800">שעת שליחה יומית</p>
                <p className="text-[11px] text-gray-400">כל ההתראות נשלחות בזמן הזה</p>
              </div>
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

          {/* Quiet hours. suppress pushes during sleep */}
          <div className="border-t" style={{ borderColor: '#F3F4F6' }}>
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-base">🌙</span>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-800">שעות שקט</p>
                  <p className="text-[11px] text-gray-400">לא יגיעו התראות בטווח הזה</p>
                </div>
              </div>
              <Switch
                checked={!!form.quiet_hours_enabled}
                onCheckedChange={v => setForm(f => ({ ...f, quiet_hours_enabled: v }))}
                aria-label="הפעל שעות שקט"
              />
            </div>
            {form.quiet_hours_enabled && (
              <div className="px-4 pb-3.5 flex items-center justify-between gap-3 text-xs text-gray-600">
                <span className="font-bold">מ־</span>
                <Select
                  value={String(form.quiet_hours_start ?? 22)}
                  onValueChange={v => setForm(f => ({ ...f, quiet_hours_start: Number(v) }))}>
                  <SelectTrigger className="w-24 font-bold text-center h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="font-bold">עד</span>
                <Select
                  value={String(form.quiet_hours_end ?? 7)}
                  onValueChange={v => setForm(f => ({ ...f, quiet_hours_end: Number(v) }))}>
                  <SelectTrigger className="w-24 font-bold text-center h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, h) => (
                      <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/*  History link  */}
      {!isGuest && (
        <Link to="/Notifications"
          className="mb-5 rounded-2xl p-3.5 flex items-center justify-between transition-all hover:bg-gray-50"
          style={{ border: '1.5px solid #E5E7EB', background: '#fff' }}>
          <div className="flex items-center gap-3">
            <span className="text-lg">📬</span>
            <div>
              <p className="font-bold text-sm text-gray-800">היסטוריית התראות</p>
              <p className="text-[11px] text-gray-400">כל ההתראות שנשלחו ב-30 הימים האחרונים</p>
            </div>
          </div>
          <span className="text-gray-300">‹</span>
        </Link>
      )}

      {/*  Future channels  */}
      {!isGuest && (
        <div className="mb-5">
          <h2 className="font-bold text-base text-gray-900 mb-3">ערוצי התראה נוספים</h2>
          <div className="space-y-2">
            {/* Email reminders. UI is live; the dispatcher ships in Phase 2
                (pg_cron → Edge Function). Until then the toggle just
                persists the user's preference so we can honour it the
                moment the dispatcher goes live. */}
            <div className="rounded-2xl p-3.5 flex items-center justify-between"
              style={{ background: '#FFFFFF', border: '1.5px solid #E5E7EB' }}>
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5" style={{ color: form.email_enabled ? C.primary : '#9CA3AF' }} />
                <div>
                  <p className="font-bold text-sm text-gray-900">התראות באימייל</p>
                  <p className="text-xs text-gray-500">
                    {form.email_enabled
                      ? 'נשלחות לכתובת המייל שרשומה בחשבון'
                      : 'קבל תזכורות גם במייל, נוסף ל-push באפליקציה'}
                  </p>
                </div>
              </div>
              <Switch
                checked={!!form.email_enabled}
                onCheckedChange={(v) => setForm(f => ({ ...f, email_enabled: v }))}
              />
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

      {/* Test notification. lets the user confirm push is wired end-to-end.
          PIN lock used to live here, but security ≠ notifications. it's now
          in the Profile tab. */}
      {!isGuest && isNative && <TestNotificationButton />}
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

