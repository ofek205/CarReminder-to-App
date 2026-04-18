import React, { useState, useEffect } from 'react';
import { Car, Bell, Sparkles, ShieldCheck, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { hapticFeedback } from '@/lib/capacitor';

const STORAGE_KEY = 'cr_onboarding_completed_v1';

const SLIDES = [
  {
    icon: Car,
    color: '#2D5233',
    bg: '#E8F2EA',
    title: 'ברוך הבא ל-CarReminder',
    subtitle: 'ניהול חכם לרכב שלך',
    body: 'הוסף את הרכב שלך פעם אחת ואנחנו נזכור בשבילך את הטסט, הביטוח, הטיפולים והמסמכים החשובים.',
  },
  {
    icon: Bell,
    color: '#D97706',
    bg: '#FFF8E1',
    title: 'תזכורות בזמן אמת',
    subtitle: 'בלי להישאר עם טסט שפג',
    body: 'נתריע לך ימים ספורים לפני פקיעת טסט, ביטוח ומסמכים. תקבל התראה למכשיר או במייל.',
  },
  {
    icon: Sparkles,
    color: '#D97706',
    bg: '#FFFBEB',
    title: 'ברוך ויוסי — מומחי ה-AI',
    subtitle: 'שאלה על הרכב? פשוט תשאל',
    body: 'ברוך המוסכניק עם 25 שנות ניסיון ברכב, ויוסי טכנאי כלי שייט מומחה. תן להם לענות לך על תקלות, טיפולים ומחירים.',
  },
  {
    icon: ShieldCheck,
    color: '#0C7B93',
    bg: '#E0F7FA',
    title: 'הנתונים שלך מוגנים',
    subtitle: 'פרטיות מלאה',
    body: 'כל הנתונים שמורים בחשבון האישי שלך. אתה יכול לשתף עם בני משפחה או למחוק בלחיצה.',
  },
];

/**
 * First-run onboarding tour — 4 slides shown on first login/visit only.
 * User can skip at any time. Uses localStorage to track completion.
 */
export default function OnboardingTour({ onComplete }) {
  const [slide, setSlide] = useState(0);
  const total = SLIDES.length;
  const current = SLIDES[slide];
  const Icon = current.icon;

  useEffect(() => {
    // Prevent body scroll while tour is open
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const next = () => {
    hapticFeedback('light');
    if (slide < total - 1) setSlide(s => s + 1);
    else finish();
  };
  const prev = () => {
    hapticFeedback('light');
    if (slide > 0) setSlide(s => s - 1);
  };
  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
    hapticFeedback('medium');
    onComplete?.();
  };
  const skip = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch {}
    onComplete?.();
  };

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-[10050] flex items-center justify-center p-5"
      style={{ background: 'rgba(17, 24, 39, 0.75)', backdropFilter: 'blur(8px)' }}>
      <div
        className="w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl"
        style={{ background: '#fff' }}>
        {/* Skip button */}
        <div className="flex justify-between items-center px-5 pt-4">
          <button onClick={skip}
            aria-label="דלג על ההדרכה"
            className="text-xs font-bold px-3 py-1.5 rounded-full transition-colors"
            style={{ color: '#6B7280', background: '#F3F4F6' }}>
            דלג
          </button>
          <button onClick={skip}
            aria-label="סגור הדרכה"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ background: '#F3F4F6' }}>
            <X className="w-4 h-4" style={{ color: '#6B7280' }} aria-hidden="true" />
          </button>
        </div>

        {/* Icon + content */}
        <div className="px-6 pt-4 pb-6 text-center">
          <div className="mx-auto mb-5 w-24 h-24 rounded-3xl flex items-center justify-center"
            style={{ background: current.bg }}>
            <Icon className="w-12 h-12" style={{ color: current.color }} aria-hidden="true" />
          </div>
          <h2 id="onboarding-title" className="text-xl font-black mb-1" style={{ color: '#1C2E20' }}>
            {current.title}
          </h2>
          <p className="text-xs font-bold mb-4" style={{ color: current.color }}>
            {current.subtitle}
          </p>
          <p className="text-sm leading-relaxed" style={{ color: '#6B7280' }}>
            {current.body}
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 py-3" role="tablist" aria-label="התקדמות הדרכה">
          {SLIDES.map((_, i) => (
            <button key={i}
              onClick={() => { hapticFeedback('light'); setSlide(i); }}
              role="tab"
              aria-selected={i === slide}
              aria-label={`שקופית ${i + 1} מתוך ${total}`}
              className="transition-all rounded-full"
              style={{
                width: i === slide ? 24 : 8,
                height: 8,
                background: i === slide ? current.color : '#E5E7EB',
              }} />
          ))}
        </div>

        {/* Navigation */}
        <div className="flex gap-2 p-4 pt-2" style={{ background: '#FAFBFA' }}>
          {slide > 0 && (
            <button onClick={prev}
              aria-label="שקופית קודמת"
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all active:scale-[0.95]"
              style={{ background: '#fff', border: '1.5px solid #E5E7EB' }}>
              <ChevronRight className="w-5 h-5" style={{ color: '#6B7280' }} aria-hidden="true" />
            </button>
          )}
          <button onClick={next}
            className="flex-1 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{
              background: `linear-gradient(135deg, ${current.color} 0%, ${current.color}dd 100%)`,
              color: '#fff',
              boxShadow: `0 6px 20px ${current.color}40`,
              height: 48,
            }}>
            {slide === total - 1 ? 'בואו נתחיל!' : 'הבא'}
            {slide < total - 1 && <ChevronLeft className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Check whether the user has completed (or dismissed) the onboarding. */
export function hasCompletedOnboarding() {
  try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

/** Force the onboarding to show again (exposed for Settings > "Replay tour"). */
export function resetOnboarding() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
