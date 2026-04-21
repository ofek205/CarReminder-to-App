import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Phone, Calendar, ArrowLeft, User, Loader2 } from 'lucide-react';
import { db } from '@/lib/supabaseEntities';
import { toast } from 'sonner';

const MIN_AGE_YEARS = 12;

/** Latest valid birth date for a user to be at least MIN_AGE_YEARS old. */
function maxBirthDateForMinAge() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE_YEARS);
  return d.toISOString().slice(0, 10);
}

function isOldEnough(birthDateStr, minAge = MIN_AGE_YEARS) {
  if (!birthDateStr) return true; // empty is allowed (optional field)
  const b = new Date(birthDateStr);
  if (isNaN(b.getTime())) return false;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age >= minAge;
}

const COMPLETE_PROFILE_KEY = 'profile_completed';
const SKIP_UNTIL_KEY = 'profile_skip_until';
const SKIP_COOLDOWN_DAYS = 3; // reshow the popup 3 days after "דלג"

/**
 * Check if the user explicitly completed the profile in a prior session.
 * Kept for backwards-compat with older callers; the source of truth is
 * the DB (profiles.phone). Dashboard now reads DB directly and only uses
 * the skip-cooldown flag below.
 */
export function hasCompletedProfile() {
  return localStorage.getItem(COMPLETE_PROFILE_KEY) === '1';
}

/**
 * Returns true if the user dismissed the popup recently (cooldown active).
 * Use this to avoid re-popping on every mount inside the same session /
 * within N days. Notifications page still shows the pending task card.
 */
export function isProfileSkipActive() {
  try {
    const ts = Number(localStorage.getItem(SKIP_UNTIL_KEY) || 0);
    return Date.now() < ts;
  } catch { return false; }
}

/**
 * One-time profile completion screen shown after first registration.
 * Asks for phone + birth date. Can be skipped.
 */
export default function CompleteProfileScreen({ user, onDone }) {
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [saving, setSaving] = useState(false);

  const fullName = user?.user_metadata?.full_name || '';

  const handleSave = async () => {
    if (birthDate && !isOldEnough(birthDate)) {
      toast.error(`תאריך הלידה חייב להיות לפני גיל ${MIN_AGE_YEARS} לפחות`);
      return;
    }
    setSaving(true);
    try {
      // Try to create profile row (upsert pattern)
      const profileData = {
        user_id: user.id,
        phone: phone.trim() || null,
        birth_date: birthDate || null,
      };
      // Check if profile exists
      const existing = await db.user_profiles.filter({ user_id: user.id });
      if (existing.length > 0) {
        await db.user_profiles.update(existing[0].id, profileData);
      } else {
        await db.user_profiles.create(profileData);
      }
    } catch (err) {
      console.error('Profile save error:', err);
      // Don't block - save what we can
    }
    // Real completion — mark done AND clear any active skip cooldown.
    localStorage.setItem(COMPLETE_PROFILE_KEY, '1');
    localStorage.removeItem(SKIP_UNTIL_KEY);
    window.dispatchEvent(new Event('profileSaved'));
    setSaving(false);
    onDone();
  };

  const handleSkip = () => {
    // Don't mark as completed — only set a short cooldown so the popup
    // doesn't re-appear within the same session. It will resurface after
    // SKIP_COOLDOWN_DAYS days, and stays visible in Notifications forever
    // until the user actually fills phone in DB.
    const until = Date.now() + SKIP_COOLDOWN_DAYS * 86400000;
    localStorage.setItem(SKIP_UNTIL_KEY, String(until));
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 50%, #F0F9FF 100%)' }}>
      <div className="w-full max-w-sm" dir="rtl">
        {/* Welcome header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: '#2D5233' }}>
            <User className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-black" style={{ color: '#1C2E20' }}>
            {fullName ? `שלום ${fullName}` : 'ברוך הבא'}
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
            רגע קצר, ונוכל להתחיל לשלוח לך תזכורות.
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl p-5 space-y-4"
          style={{ background: '#fff', border: '1.5px solid #D8E5D9', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>

          {/* Phone */}
          <div>
            <label className="text-xs font-bold mb-1.5 block" style={{ color: '#374151' }}>
              <Phone className="w-3.5 h-3.5 inline ml-1" style={{ color: '#2D5233' }} />
              מספר טלפון
            </label>
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/[^0-9\-+\s]/g, ''))}
              placeholder="050-1234567"
              dir="ltr"
              className="text-center text-base"
              maxLength={15}
            />
            <p className="text-[10px] mt-1" style={{ color: '#9CA3AF' }}>
              כדי שנוכל להתריע לפני טסט וביטוח
            </p>
          </div>

          {/* Birth date */}
          <div>
            <label className="text-xs font-bold mb-1.5 block" style={{ color: '#374151' }}>
              <Calendar className="w-3.5 h-3.5 inline ml-1" style={{ color: '#2D5233' }} />
              תאריך לידה
            </label>
            <Input
              type="date"
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
              max={maxBirthDateForMinAge()}
              dir="ltr"
              className="text-center"
            />
            {birthDate && !isOldEnough(birthDate) && (
              <p className="text-[10px] mt-1 text-red-600">
                גיל מינימלי לשימוש: {MIN_AGE_YEARS}
              </p>
            )}
          </div>

          {/* Save button */}
          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-2xl font-bold text-base transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: '#2D5233', color: '#fff', boxShadow: '0 4px 16px rgba(45,82,51,0.3)' }}>
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <>
                המשך <ArrowLeft className="w-4 h-4" />
              </>
            )}
          </button>

          {/* Skip */}
          <button onClick={handleSkip}
            className="w-full py-2 text-sm font-medium transition-all"
            style={{ color: '#9CA3AF' }}>
            אמלא אחר כך
          </button>
        </div>

        <p className="text-center text-[10px] mt-4" style={{ color: '#9CA3AF' }}>
          אפשר לשנות בכל עת באזור האישי
        </p>
      </div>
    </div>
  );
}
