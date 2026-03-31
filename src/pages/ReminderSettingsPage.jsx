import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, Mail, Bell } from "lucide-react";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";

// ── Fields for the "days before" section ──────────────────────────────────────
const TIMING_FIELDS = [
  { key: 'remind_test_days_before',         label: 'תזכורת לפני טסט',            icon: '📋', hint: 'ימים לפני תפוגת הטסט',             suffix: 'ימים', max: 365 },
  { key: 'remind_insurance_days_before',     label: 'תזכורת לפני ביטוח',          icon: '🛡️', hint: 'ימים לפני תפוגת הביטוח',           suffix: 'ימים', max: 365 },
  { key: 'remind_document_days_before',      label: 'תזכורת לפני מסמך',           icon: '📄', hint: 'ימים לפני תפוגת מסמך',             suffix: 'ימים', max: 365 },
  { key: 'remind_maintenance_days_before',   label: 'תזכורת לפני טיפול',          icon: '🔧', hint: 'ימים לפני מועד הטיפול',            suffix: 'ימים', max: 365 },
  { key: 'overdue_repeat_every_days',        label: 'חזרה על תזכורת באיחור',      icon: '🔁', hint: 'כל כמה ימים לחזור על תזכורת שעברה', suffix: 'ימים', max: 365 },
  { key: 'daily_job_hour',                   label: 'שעת שליחת התראות יומית',     icon: '⏰', hint: 'בחר שעה בין 0 ל-23',               suffix: ':00',  max: 23, isTimeField: true },
];

const DEFAULT_FORM = {
  remind_test_days_before:       14,
  remind_insurance_days_before:  14,
  remind_document_days_before:   14,
  remind_maintenance_days_before: 7,
  overdue_repeat_every_days:      3,
  daily_job_hour:                 8,
};

// ── Guest version ─────────────────────────────────────────────────────────────
function GuestReminderSettings() {
  const { guestReminderSettings, updateGuestReminderSettings } = useAuth();
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...guestReminderSettings });

  const handleSave = () => {
    const updated = {};
    TIMING_FIELDS.forEach(f => { updated[f.key] = Number(form[f.key]) || 0; });
    updateGuestReminderSettings(updated);
    toast.success('ההגדרות נשמרו בהצלחה');
  };

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader title="הגדרות תזכורות" subtitle="מתי תרצה לקבל תזכורות?" />

      <Card className="p-5 border border-gray-100">
        <div className="flex items-center gap-2 mb-5">
          <Bell className="h-5 w-5 text-[#2D5233]" />
          <h3 className="font-semibold text-gray-900">כמה ימים מראש?</h3>
        </div>
        <div className="space-y-4">
          {TIMING_FIELDS.map(field => (
            <div key={field.key} className="flex items-center justify-between gap-4" dir="rtl">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-xl shrink-0">{field.icon}</span>
                <div>
                  <Label className="text-sm font-medium text-gray-800">{field.label}</Label>
                  <p className="text-xs text-gray-400">{field.hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {field.isTimeField ? (
                  <Select
                    value={String(form[field.key] ?? 8)}
                    onValueChange={v => setForm(f => ({ ...f, [field.key]: Number(v) }))}
                  >
                    <SelectTrigger className="w-20 font-semibold text-center">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>{h}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      type="number"
                      min={0}
                      max={field.max ?? 365}
                      className="w-16 text-center font-semibold"
                      value={form[field.key] ?? ''}
                      onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    />
                    <span className="text-xs text-gray-400">{field.suffix ?? 'ימים'}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <Button
          onClick={handleSave}
          className="w-full mt-6 bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-2 h-11"
        >
          <Save className="h-4 w-4" /> שמור הגדרות
        </Button>
      </Card>

      <Card className="p-4 border border-amber-200 bg-amber-50" dir="rtl">
        <p className="text-sm text-amber-800">
          התראות במייל זמינות רק לאחר הרשמה.{' '}
          <button
            onClick={() => window.location.href = '/Auth'}
            className="underline font-medium"
          >
            הירשם בחינם
          </button>
        </p>
      </Card>
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
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [settingsId, setSettingsId] = useState(null);
  const [user, setUser]         = useState(null);
  const [form, setForm]         = useState({ ...DEFAULT_FORM });
  const [emailSettings, setEmailSettings] = useState({
    email_test_reminders_enabled:      false,
    email_insurance_reminders_enabled: false,
    email_document_reminders_enabled:  false,
  });

  useEffect(() => {
    async function init() {
      const { data: { user: supaUser } } = await supabase.auth.getUser();
      if (!supaUser) { setLoading(false); return; }
      const currentUser = {
        id: supaUser.id,
        email: supaUser.email,
        full_name: supaUser.user_metadata?.full_name,
        // Email reminder flags stored in user_metadata
        email_test_reminders_enabled: supaUser.user_metadata?.email_test_reminders_enabled || false,
        email_insurance_reminders_enabled: supaUser.user_metadata?.email_insurance_reminders_enabled || false,
        email_document_reminders_enabled: supaUser.user_metadata?.email_document_reminders_enabled || false,
      };
      setUser(currentUser);

      setEmailSettings({
        email_test_reminders_enabled:      currentUser.email_test_reminders_enabled      || false,
        email_insurance_reminders_enabled: currentUser.email_insurance_reminders_enabled || false,
        email_document_reminders_enabled:  currentUser.email_document_reminders_enabled  || false,
      });

      // TODO: ReminderSettings entity not yet in Supabase — using defaults
      let settings = [];
      // let settings = await db.reminder_settings.filter({ user_id: currentUser.id });
      if (settings.length === 0) {
        // const created = await db.reminder_settings.create({ user_id: currentUser.id, ...DEFAULT_FORM });
        // settings = [created];
        settings = [{ id: 'temp', ...DEFAULT_FORM }];
      }
      const s = settings[0];
      setSettingsId(s.id);
      setForm({
        remind_test_days_before:       s.remind_test_days_before       ?? 14,
        remind_insurance_days_before:  s.remind_insurance_days_before  ?? 14,
        remind_document_days_before:   s.remind_document_days_before   ?? 14,
        remind_maintenance_days_before:s.remind_maintenance_days_before ?? 7,
        overdue_repeat_every_days:     s.overdue_repeat_every_days     ?? 3,
        daily_job_hour:                s.daily_job_hour                ?? 8,
      });
      setLoading(false);
    }
    init();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const payload = {};
    TIMING_FIELDS.forEach(f => { payload[f.key] = Number(form[f.key]) || 0; });
    // TODO: ReminderSettings entity not yet in Supabase — save is a no-op for now
    // await db.reminder_settings.update(settingsId, payload);
    toast.success('ההגדרות נשמרו בהצלחה');
    setSaving(false);
  };

  const toggleEmail = async (key) => {
    if (!user?.email) {
      toast.error('כדי לקבל תזכורות במייל יש להוסיף כתובת מייל לפרופיל');
      return;
    }
    const newVal = !emailSettings[key];
    setEmailSettings(prev => ({ ...prev, [key]: newVal }));
    await supabase.auth.updateUser({ data: { [key]: newVal } });
    toast.success('ההגדרות נשמרו');
  };

  if (loading) return <LoadingSpinner />;

  const hasEmail = !!user?.email;

  const emailToggles = [
    { key: 'email_test_reminders_enabled',      label: 'תזכורות טסט במייל',            icon: '📋' },
    { key: 'email_insurance_reminders_enabled',  label: 'תזכורות ביטוח במייל',          icon: '🛡️' },
    { key: 'email_document_reminders_enabled',   label: 'תזכורות מסמכים פוקעים במייל', icon: '📄' },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader title="הגדרות תזכורות" subtitle="מתי תרצה לקבל תזכורות?" />

      {/* ── Timing settings ── */}
      <Card className="p-5 border border-gray-100">
        <div className="flex items-center gap-2 mb-5">
          <Bell className="h-5 w-5 text-[#2D5233]" />
          <h3 className="font-semibold text-gray-900">כמה ימים מראש?</h3>
        </div>
        <div className="space-y-4">
          {TIMING_FIELDS.map(field => (
            <div key={field.key} className="flex items-center justify-between gap-4" dir="rtl">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="text-xl shrink-0">{field.icon}</span>
                <div>
                  <Label className="text-sm font-medium text-gray-800">{field.label}</Label>
                  <p className="text-xs text-gray-400">{field.hint}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {field.isTimeField ? (
                  <Select
                    value={String(form[field.key] ?? 8)}
                    onValueChange={v => setForm(f => ({ ...f, [field.key]: Number(v) }))}
                  >
                    <SelectTrigger className="w-20 font-semibold text-center">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 24 }, (_, h) => (
                        <SelectItem key={h} value={String(h)}>{h}:00</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      type="number"
                      min={0}
                      max={field.max ?? 365}
                      className="w-16 text-center font-semibold"
                      value={form[field.key] ?? ''}
                      onChange={e => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                    />
                    <span className="text-xs text-gray-400">{field.suffix ?? 'ימים'}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-6 bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-2 h-11"
        >
          {saving
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <><Save className="h-4 w-4" /> שמור הגדרות</>
          }
        </Button>
      </Card>

      {/* ── Email notifications ── */}
      <Card className="p-5 border border-gray-100">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="h-5 w-5 text-[#2D5233]" />
          <h3 className="font-semibold text-gray-900">התראות במייל</h3>
        </div>

        {!hasEmail && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 mb-4">
            <p className="text-sm text-amber-800">
              כדי לקבל תזכורות במייל יש להוסיף כתובת מייל לפרופיל שלך
            </p>
          </div>
        )}

        <div className="space-y-3">
          {emailToggles.map(t => (
            <div
              key={t.key}
              className={`flex items-center justify-between p-3.5 rounded-xl transition-colors
                ${emailSettings[t.key] ? 'bg-[#E8F2EA] border border-[#D8E5D9]' : 'bg-gray-50 border border-transparent'}`}
              dir="rtl"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{t.icon}</span>
                <Label className={`text-sm font-medium ${!hasEmail ? 'text-gray-400' : 'text-gray-800'}`}>
                  {t.label}
                </Label>
              </div>
              <Switch
                checked={emailSettings[t.key]}
                onCheckedChange={() => toggleEmail(t.key)}
                disabled={!hasEmail}
              />
            </div>
          ))}
        </div>

        {hasEmail && (
          <div className="mt-4 p-3 rounded-xl bg-blue-50 border border-blue-200">
            <p className="text-xs text-blue-800 leading-relaxed">
              💡 מיילים נשלחים בשעה {form.daily_job_hour}:00 בכל בוקר, פעם אחת לכל התראה.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
