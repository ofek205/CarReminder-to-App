import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Phone, Calendar, ArrowLeft, User, Loader2 } from 'lucide-react';
import { db } from '@/lib/supabaseEntities';

const COMPLETE_PROFILE_KEY = 'profile_completed';

/**
 * Check if the user has already completed (or dismissed) the profile screen.
 */
export function hasCompletedProfile() {
  return localStorage.getItem(COMPLETE_PROFILE_KEY) === '1';
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
      // Don't block — save what we can
    }
    localStorage.setItem(COMPLETE_PROFILE_KEY, '1');
    window.dispatchEvent(new Event('profileSaved'));
    setSaving(false);
    onDone();
  };

  const handleSkip = () => {
    localStorage.setItem(COMPLETE_PROFILE_KEY, '1');
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
            {fullName ? `שלום ${fullName}!` : 'ברוך הבא!'}
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6B7280' }}>
            רק עוד רגע — כדי שנוכל לשלוח לך תזכורות
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
              לקבלת תזכורות לטסט וביטוח
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
              dir="ltr"
              className="text-center"
            />
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
            דלג, אמלא אחר כך
          </button>
        </div>

        <p className="text-center text-[10px] mt-4" style={{ color: '#9CA3AF' }}>
          ניתן תמיד לעדכן באזור האישי
        </p>
      </div>
    </div>
  );
}
