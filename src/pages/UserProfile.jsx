import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { User, ScanLine, CheckCircle, AlertTriangle, XCircle, Loader2, Save, UserPlus, Phone, Calendar, Star } from "lucide-react";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import DriverLicenseScanDialog from "../components/profile/DriverLicenseScanDialog";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";

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

function LicenseStatus({ expDate }) {
  if (!expDate) return null;
  const days = daysUntil(expDate);
  const formatted = format(parseISO(expDate), 'dd/MM/yyyy');
  if (days < 0) return (
    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
      <XCircle className="h-4 w-4 shrink-0" />
      <span>רישיון הנהיגה אינו בתוקף</span>
    </div>
  );
  if (days <= 30) return (
    <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>תוקף הרישיון עומד להסתיים בקרוב ({formatted})</span>
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
    <Card className="p-4 border border-amber-200 bg-amber-50 rounded-2xl">
      <div className="flex items-start gap-3" dir="rtl">
        <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
          <Star className="h-4 w-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 mb-1">
            השלם את הפרופיל שלך ({filledCount}/3)
          </p>
          <p className="text-xs text-amber-700 leading-relaxed mb-2">
            פרטים אלו עוזרים לנו לתת לך שירות טוב יותר ולזהות אותך בכל מקום באפליקציה
          </p>
          <div className="flex flex-wrap gap-2">
            {missing.map(({ label, icon: Icon }) => (
              <span key={label} className="inline-flex items-center gap-1 text-xs bg-white border border-amber-200 text-amber-800 px-2.5 py-1 rounded-full font-medium">
                <Icon className="h-3 w-3" />
                {label} חסר
              </span>
            ))}
          </div>
        </div>
        {/* Progress bar */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <span className="text-lg font-bold text-amber-700">{Math.round((filledCount / 3) * 100)}%</span>
          <div className="w-10 h-1.5 bg-amber-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all"
              style={{ width: `${(filledCount / 3) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function UserProfilePage() {
  const { isGuest } = useAuth();
  if (isGuest) {
    return (
      <div dir="rtl">
        <PageHeader title="אזור אישי" subtitle="פרטים אישיים ורישיון נהיגה" />
        <Card className="p-8 border border-gray-100 shadow-sm rounded-2xl text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-[#FCF9F4] flex items-center justify-center mx-auto">
            <UserPlus className="h-8 w-8 text-[#3E6B45]" />
          </div>
          <h2 className="font-semibold text-gray-900 text-lg">הירשם כדי לנהל את הפרופיל שלך</h2>
          <p className="text-sm text-gray-500">האזור האישי כולל פרטי רישיון נהיגה, תוקף הרישיון ועוד - זמין לאחר הרשמה.</p>
          <Button onClick={() => window.location.href = '/Auth'} className="gap-2" style={{ background: '#FFBF00', color: '#2D5233', fontWeight: 700 }}>
            <UserPlus className="h-4 w-4" />
            הירשם בחינם
          </Button>
        </Card>
      </div>
    );
  }

  return <AuthUserProfile />;
}

function AuthUserProfile() {
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
  const [accountId, setAccountId] = useState(null);

  useEffect(() => {
    async function init() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { setLoading(false); return; }
      const normalized = { ...u, full_name: u.user_metadata?.full_name || u.email, email: u.email, id: u.id };
      setUser(normalized);
      setFullName(normalized.full_name || '');
      const members = await db.account_members.filter({ user_id: u.id, status: 'פעיל' });
      if (members.length > 0) setAccountId(members[0].account_id);
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
    const phoneVal = form.phone?.replace(/[-\s]/g, '');
    if (phoneVal && !/^0[0-9]{9}$/.test(phoneVal)) {
      toast.error('מספר טלפון לא תקין - יש להזין 10 ספרות (לדוגמה: 050-1234567)');
      return;
    }
    const licenseVal = form.driver_license_number?.replace(/[-\s]/g, '');
    if (licenseVal && !/^\d{7,8}$/.test(licenseVal)) {
      toast.error('מספר רישיון נהיגה לא תקין - יש להזין 7-8 ספרות');
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
      toast.error('שגיאה בשמירת הפרופיל');
    } finally {
      setSaving(false);
    }
  };

  const age = calcAge(form.birth_date);

  if (loading || !user) return <LoadingSpinner />;

  return (
    <div dir="rtl">
      <PageHeader title="אזור אישי" subtitle="פרטים אישיים ורישיון נהיגה" />

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
        <Card className="p-6 border border-gray-100 shadow-sm rounded-2xl">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-[#FCF9F4] flex items-center justify-center">
              <User className="h-5 w-5 text-[#3E6B45]" />
            </div>
            <h2 className="font-semibold text-gray-800">פרטים אישיים</h2>
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
                onChange={e => handleChange('phone', e.target.value)}
                placeholder="05X-XXXXXXX"
                dir="ltr"
                className={!form.phone?.trim() ? 'border-amber-300 focus:border-amber-500 bg-amber-50/30' : ''}
              />
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
        <Card className="p-6 border border-gray-100 shadow-sm rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FCF9F4] flex items-center justify-center relative shrink-0">
                <ScanLine className="h-5 w-5 text-[#3E6B45]" />
                <span className="absolute -top-1 -left-1 bg-[#3E6B45] text-white text-[8px] font-bold px-1 rounded-full">AI</span>
              </div>
              <h2 className="font-semibold text-gray-800">רישיון נהיגה</h2>
            </div>
            <Button
              onClick={() => setShowScan(true)}
              variant="outline"
              className="gap-2 text-sm w-full sm:w-auto" style={{ borderColor: '#3E6B45', color: '#3E6B45' }}
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
              <Input value={form.driver_license_number} onChange={e => handleChange('driver_license_number', e.target.value)} placeholder="מספר רישיון" dir="ltr" />
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

        <Button onClick={handleSave} disabled={saving} className="w-full h-12 text-base shadow-md font-bold" style={{ background: saving ? '#9CA3AF' : '#3E6B45', color: 'white' }}>
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Save className="h-4 w-4 ml-2" />שמור פרופיל</>}
        </Button>
      </div>
    </div>
  );
}
