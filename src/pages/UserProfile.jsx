import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
// Living Dashboard system — shared with the B2B pages so the embedded
// profile inside Settings.jsx visually matches BusinessSettings,
// /Drivers, etc. The previous shadcn `Card` import was a flat styled
// div; the system Card adds an accent stripe + the project's standard
// shadow/radius/border so this surface no longer looks generic.
import { Card } from '@/components/business/system';
import { User, ScanLine, CheckCircle, AlertTriangle, XCircle, Loader2, Save, UserPlus, Phone, Calendar, Star, Trash2 } from "lucide-react";
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import DriverLicenseScanDialog from "../components/profile/DriverLicenseScanDialog";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import useFormValidation from '@/hooks/useFormValidation';
import FieldError from '../components/shared/FieldError';
import SystemErrorBanner from '../components/shared/SystemErrorBanner';
import PinLockCard from '../components/shared/PinLockCard';
import ChangePasswordCard from '../components/profile/ChangePasswordCard';

const MIN_AGE_YEARS = 12;

/** Latest valid birth date so the user is at least MIN_AGE_YEARS old. */
function maxBirthDateForMinAge() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE_YEARS);
  return d.toISOString().slice(0, 10);
}

function isOldEnough(birthDateStr, minAge = MIN_AGE_YEARS) {
  if (!birthDateStr) return true;
  const b = new Date(birthDateStr);
  if (isNaN(b.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age >= minAge;
}

function calcAge(birthDate) {
  if (!birthDate) return null;
  // Ensure we parse date-only string correctly (avoid timezone issues)
  const dateStr = String(birthDate).split('T')[0];
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const bd = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(bd.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const m = today.getMonth() - bd.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
  return age >= 0 && age < 150 ? age : null;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const GOV_LICENSE_RENEWAL_URL = 'https://www.gov.il/he/service/renew_driving_license';

function LicenseStatus({ expDate }) {
  if (!expDate) return null;
  const days = daysUntil(expDate);
  const formatted = format(parseISO(expDate), 'dd/MM/yyyy');
  if (days < 0) return (
    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700" dir="rtl">
      <div className="flex items-center gap-2">
        <XCircle className="h-4 w-4 shrink-0" />
        <span>רישיון הנהיגה אינו בתוקף</span>
      </div>
      <a href={GOV_LICENSE_RENEWAL_URL} target="_blank" rel="noopener noreferrer"
        className="inline-block mt-2 text-xs font-bold underline text-red-800 hover:text-red-900">
        חדש עכשיו באתר משרד התחבורה ←
      </a>
    </div>
  );
  if (days <= 30) return (
    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800" dir="rtl">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>הרישיון יפוג ב-{formatted}</span>
      </div>
      <a href={GOV_LICENSE_RENEWAL_URL} target="_blank" rel="noopener noreferrer"
        className="inline-block mt-2 text-xs font-bold underline text-yellow-900 hover:text-yellow-950">
        חדש באתר משרד התחבורה ←
      </a>
    </div>
  );
  return (
    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
      <CheckCircle className="h-4 w-4 shrink-0" />
      <span>רישיון בתוקף עד: {formatted}</span>
    </div>
  );
}

// Shows how many of the 3 key fields are filled
function ProfileCompletionBanner({ fullName, phone, birthDate }) {
  const fields = [
    { label: 'שם מלא', filled: !!fullName?.trim(), icon: User },
    { label: 'טלפון', filled: !!phone?.trim(), icon: Phone },
    { label: 'תאריך לידה', filled: !!birthDate, icon: Calendar },
  ];
  const filledCount = fields.filter(f => f.filled).length;
  if (filledCount === 3) return null;

  const missing = fields.filter(f => !f.filled);

  return (
    <Card accent="amber" className="bg-[#FFFBEB]">
      <div className="flex items-start gap-3" dir="rtl">
        <div
          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: 'linear-gradient(135deg, #92400E 0%, #F59E0B 80%, #FCD34D 100%)',
            color: '#FFFFFF',
            boxShadow: '0 4px 12px rgba(245,158,11,0.32)',
          }}
        >
          <Star className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>
            השלם את הפרופיל שלך ({filledCount}/3)
          </p>
          <p className="text-xs leading-relaxed mb-2" style={{ color: '#92400E' }}>
            פרטים אלו עוזרים לנו לתת לך שירות טוב יותר ולזהות אותך בכל מקום באפליקציה.
          </p>
          <div className="flex flex-wrap gap-2">
            {missing.map(({ label, icon: Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-bold"
                style={{ background: '#FFFFFF', color: '#92400E', border: '1px solid #FCD34D' }}
              >
                <Icon className="h-3 w-3" />
                {label} חסר
              </span>
            ))}
          </div>
        </div>
        {/* Progress bar — amber gradient matches the rest of the system's
            "warning / nudge" tone. The percentage sits on top of a
            slim filled track so progress is readable at a glance. */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <span className="text-lg font-black tabular-nums" style={{ color: '#92400E' }} dir="ltr">
            {Math.round((filledCount / 3) * 100)}%
          </span>
          <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: '#FEF3C7' }}>
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${(filledCount / 3) * 100}%`,
                background: 'linear-gradient(90deg, #92400E 0%, #F59E0B 80%, #FCD34D 100%)',
              }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function UserProfilePage({ embedded = false }) {
  const { isGuest } = useAuth();
  if (isGuest) {
    return (
      <div dir="rtl">
        {!embedded && <PageHeader title="אזור אישי" subtitle="פרטים אישיים ורישיון נהיגה" />}
        <Card accent="emerald" className="text-center space-y-4 py-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.32)',
            }}
          >
            <UserPlus className="h-8 w-8" />
          </div>
          <h2 className="font-bold text-lg" style={{ color: '#0B2912' }}>
            הירשם כדי לנהל את הפרופיל שלך
          </h2>
          <p className="text-sm" style={{ color: '#6B7C72' }}>
            האזור האישי כולל פרטי רישיון נהיגה, תוקף הרישיון ועוד. זמין לאחר הרשמה.
          </p>
          <Button
            onClick={() => window.location.href = '/Auth'}
            className="gap-2"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              color: '#FFFFFF',
              fontWeight: 700,
              boxShadow: '0 8px 20px rgba(16,185,129,0.32)',
            }}
          >
            <UserPlus className="h-4 w-4" />
            הירשם בחינם
          </Button>
        </Card>
      </div>
    );
  }

  return <AuthUserProfile embedded={embedded} />;
}

function AuthUserProfile({ embedded = false }) {
  const { refreshUser } = useAuth();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [form, setForm] = useState({
    phone: '', birth_date: '', driver_license_number: '', license_expiration_date: '', license_image_url: '',
  });
  const [fullName, setFullName] = useState('');
  const [showScan, setShowScan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const { errors, validate, clearError } = useFormValidation();
  const [systemError, setSystemError] = useState(null);

  useEffect(() => {
    async function init() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { setLoading(false); return; }
      const normalized = { ...u, full_name: u.user_metadata?.full_name || u.email, email: u.email, id: u.id };
      setUser(normalized);
      setFullName(normalized.full_name || '');
      // Load profile from Supabase
      try {
        const profiles = await db.user_profiles.filter({ user_id: u.id });
        if (profiles.length > 0) {
          const p = profiles[0];
          setProfileId(p.id);
          setProfile(p);
          setForm({
            phone: p.phone || '',
            birth_date: p.birth_date || '',
            driver_license_number: p.driver_license_number || '',
            license_expiration_date: p.license_expiration_date || '',
            license_image_url: p.license_image_url || '',
          });
        }
      } catch (err) {
        console.error('Profile load error:', err);
      }
      setLoading(false);
    }
    init();
  }, []);

  const handleChange = (field, value) => setForm(p => ({ ...p, [field]: value }));

  const handleScanSave = async (extracted) => {
    if (extracted.full_name) {
      await supabase.auth.updateUser({ data: { full_name: extracted.full_name } });
      setUser(prev => ({ ...prev, full_name: extracted.full_name }));
      setFullName(extracted.full_name);
    }

    const newForm = {
      ...form,
      birth_date: extracted.birth_date || form.birth_date,
      driver_license_number: extracted.driver_license_number || form.driver_license_number,
      license_expiration_date: extracted.license_expiration_date || form.license_expiration_date,
      license_image_url: extracted.license_image_url || form.license_image_url,
    };
    setForm(newForm);

    // Save scan results to Supabase
    const data = { ...newForm, user_id: user.id };
    Object.keys(data).forEach(k => { if (data[k] === '' || data[k] === undefined) delete data[k]; });
    try {
      if (profileId) {
        await db.user_profiles.update(profileId, data);
      } else {
        const created = await db.user_profiles.create(data);
        setProfileId(created.id);
      }
    } catch (err) {
      console.error('Profile scan save error:', err);
    }
    toast.success('פרטי רישיון הנהיגה עודכנו בהצלחה');
  };

  const handleSave = async () => {
    setSystemError(null);
    if (!validate(form, {
      phone: { pattern: [/^0\d{9}$/, 'מספר טלפון לא תקין (לדוגמה: 0501234567)'] },
      driver_license_number: { pattern: [/^\d{7,8}$/, 'מספר רישיון לא תקין (7-8 ספרות)'] },
    })) return;

    if (form.birth_date && !isOldEnough(form.birth_date)) {
      toast.error(`תאריך הלידה חייב להיות לפני גיל ${MIN_AGE_YEARS} לפחות`);
      return;
    }

    setSaving(true);
    try {
      // Save full_name to auth user
      await supabase.auth.updateUser({ data: { full_name: fullName.trim() } });

      // Refresh user everywhere in the app
      const updated = await refreshUser();
      if (updated) {
        setUser(updated);
        setFullName(updated.full_name || fullName.trim());
      }
      window.dispatchEvent(new CustomEvent('userProfileUpdated', {
        detail: { full_name: updated?.full_name || fullName.trim() }
      }));

      // Save profile fields to Supabase
      const profileData = {
        user_id: user.id,
        phone: form.phone?.replace(/[-\s]/g, '') || null,
        birth_date: form.birth_date || null,
        driver_license_number: form.driver_license_number?.replace(/[-\s]/g, '') || null,
        license_expiration_date: form.license_expiration_date || null,
        license_image_url: form.license_image_url || null,
      };
      try {
        if (profileId) {
          await db.user_profiles.update(profileId, profileData);
        } else {
          const created = await db.user_profiles.create(profileData);
          setProfileId(created.id);
        }
      } catch (err) {
        console.error('Profile save error:', err);
        // Don't fail - auth name was already saved
      }
      toast.success('הפרופיל נשמר בהצלחה');
      // Notify bell to refresh (remove profile-incomplete notification)
      window.dispatchEvent(new Event('profileSaved'));
    } catch {
      setSystemError('אירעה שגיאה בשמירת הפרופיל');
    } finally {
      setSaving(false);
    }
  };

  const age = calcAge(form.birth_date);

  if (loading || !user) return <LoadingSpinner />;

  return (
    <div dir="rtl">
      {!embedded && <PageHeader title="אזור אישי" subtitle="פרטים אישיים ורישיון נהיגה" />}

      <DriverLicenseScanDialog
        open={showScan}
        onClose={() => setShowScan(false)}
        onSave={handleScanSave}
      />

      <div className="space-y-4">
        {/* Completion banner */}
        <ProfileCompletionBanner
          fullName={fullName}
          phone={form.phone}
          birthDate={form.birth_date}
        />

        {/* Personal Info */}
        <Card accent="emerald">
          {systemError && <SystemErrorBanner message={systemError} onRetry={() => { setSystemError(null); handleSave(); }} />}

          <div className="flex items-center gap-3 mb-5">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: '#D1FAE5', color: '#065F46' }}
            >
              <User className="h-5 w-5" />
            </div>
            <h2 className="font-bold text-base" style={{ color: '#0B2912' }}>פרטים אישיים</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full name - key field */}
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 mb-1">
                <Label className="mb-0">שם מלא</Label>
                {!fullName?.trim() && (
                  <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">חשוב למלא</span>
                )}
              </div>
              <Input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="שם פרטי ומשפחה"
                className={!fullName?.trim() ? 'border-amber-300 focus:border-amber-500 bg-amber-50/30' : ''}
              />
            </div>

            <div>
              <Label>אימייל</Label>
              <Input value={user.email || ''} readOnly dir="ltr" className="bg-gray-50 text-gray-500" />
            </div>

            {/* Phone - key field */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label className="mb-0">מספר טלפון</Label>
                {!form.phone?.trim() && (
                  <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">חשוב למלא</span>
                )}
              </div>
              <Input
                value={form.phone}
                onChange={e => { handleChange('phone', e.target.value); clearError('phone'); }}
                placeholder="05X-XXXXXXX"
                dir="ltr"
                error={!!errors.phone}
                className={!form.phone?.trim() && !errors.phone ? 'border-amber-300 focus:border-amber-500 bg-amber-50/30' : ''}
              />
              <FieldError message={errors.phone} />
            </div>

            {/* Birth date - key field */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Label className="mb-0">תאריך לידה</Label>
                {!form.birth_date && (
                  <span className="text-xs bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">חשוב למלא</span>
                )}
              </div>
              <DateInput
                value={form.birth_date}
                onChange={e => handleChange('birth_date', e.target.value)}
                max={maxBirthDateForMinAge()}
                className={!form.birth_date ? 'border-amber-300 focus:border-amber-500 bg-amber-50/30' : ''}
              />
            </div>

            {age !== null && (
              <div>
                <Label>גיל</Label>
                <div className="flex items-center h-9 px-3 border border-input rounded-2xl bg-gray-50">
                  <span className="text-sm text-gray-700">{age} שנים</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Driver License */}
        <Card accent="blue">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center relative shrink-0"
                style={{ background: '#DBEAFE', color: '#1E40AF' }}
              >
                <ScanLine className="h-5 w-5" />
                <span
                  className="absolute -top-1 -left-1 text-[8px] font-black px-1 rounded-full"
                  style={{
                    background: 'linear-gradient(135deg, #065F46 0%, #10B981 100%)',
                    color: '#FFFFFF',
                    boxShadow: '0 2px 4px rgba(16,185,129,0.32)',
                  }}
                >
                  AI
                </span>
              </div>
              <h2 className="font-bold text-base" style={{ color: '#0B2912' }}>רישיון נהיגה</h2>
            </div>
            <Button
              onClick={() => setShowScan(true)}
              variant="outline"
              className="gap-2 text-sm w-full sm:w-auto"
              style={{ borderColor: '#10B981', color: '#10B981', background: '#FFFFFF' }}
            >
              <ScanLine className="h-4 w-4" />
              סרוק רישיון נהיגה (AI)
            </Button>
          </div>

          {form.license_expiration_date && (
            <div className="mb-4">
              <LicenseStatus expDate={form.license_expiration_date} />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>מספר רישיון נהיגה</Label>
              <Input value={form.driver_license_number} onChange={e => { handleChange('driver_license_number', e.target.value); clearError('driver_license_number'); }} placeholder="מספר רישיון" dir="ltr" error={!!errors.driver_license_number} />
              <FieldError message={errors.driver_license_number} />
            </div>
            <div>
              <Label>תוקף רישיון</Label>
              <DateInput value={form.license_expiration_date} onChange={e => handleChange('license_expiration_date', e.target.value)} />
            </div>
          </div>

          {form.license_image_url && (
            <div className="mt-4">
              <Label>תמונת רישיון</Label>
              <img src={form.license_image_url} alt="רישיון נהיגה" className="mt-1 max-w-xs rounded-xl border border-gray-200 object-cover" />
            </div>
          )}
        </Card>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-12 text-base font-bold transition-all hover:scale-[1.01] active:scale-[0.98]"
          style={{
            background: saving
              ? '#9CA3AF'
              : 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
            color: '#FFFFFF',
            boxShadow: saving
              ? 'none'
              : '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
          }}
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Save className="h-4 w-4 ml-2" />שמור פרופיל</>}
        </Button>

        {/*  Security section
            PIN lock + password change live here together. Both are
            authentication concerns rather than notification ones. */}
        <div className="mt-8 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3 px-1" style={{ color: '#9CA3AF' }}>
            אבטחה
          </h3>
          <PinLockCard />
          <ChangePasswordCard />
        </div>

        {/* Delete account link */}
        <div className="mt-6 pt-6" style={{ borderTop: '1px solid #F3F4F6' }}>
          <Link to={createPageUrl('DeleteAccount')}
            className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
            style={{ color: '#9CA3AF' }}>
            <Trash2 className="w-4 h-4" />
            מחיקת חשבון ונתונים
          </Link>
        </div>

        {/* Version footer — sourced from package.json via the
            __APP_VERSION__ define in vite.config.js. Rendered as a
            quiet trailing line, not as a card, because it's a "what
            am I running?" reference and shouldn't compete with
            actionable items above. Updates automatically on the next
            build whenever `version` is bumped in package.json. */}
        <p className="text-center text-[11px] mt-4 mb-2" style={{ color: '#9CA3AF' }}>
          CarReminder &middot; גרסה {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '—'}
        </p>
      </div>
    </div>
  );
}
