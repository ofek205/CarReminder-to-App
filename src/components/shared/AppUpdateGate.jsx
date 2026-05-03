/**
 * AppUpdateGate — full-screen gate that blocks the app when the
 * installed native version is older than the server-defined minimum.
 *
 * Wraps the rest of the app:
 *   <AppUpdateGate>
 *     <App />
 *   </AppUpdateGate>
 *
 * Behavior:
 *   • Web              → never blocks (children render).
 *   • Native, up-to-date → never blocks.
 *   • Native, outdated → renders the gate; children stay hidden.
 *
 * The app is currently in closed beta on Google Play / TestFlight, so
 * a public store search won't surface it. The link still works for
 * users in the testing track (they get the update directly), and a
 * "צור קשר" fallback is offered for anyone outside the track who
 * needs a manual APK.
 */
import React from 'react';
import useAppUpdateGate from '@/hooks/useAppUpdateGate';

// Where to send users to update. Override these once the app is in a
// public production track on the stores.
const ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.carreminder.app';
const IOS_STORE_URL =
  'https://apps.apple.com/app/carreminder/id000000000';
const SUPPORT_URL =
  'mailto:support@car-reminder.app?subject=%D7%91%D7%A7%D7%A9%D7%AA%20%D7%92%D7%A8%D7%A1%D7%94%20%D7%A2%D7%93%D7%9B%D7%A0%D7%99%D7%AA';

export default function AppUpdateGate({ children }) {
  const { checked, needsUpdate, currentVersion, minVersion, platform } = useAppUpdateGate();

  // While the first check is in flight, render children so the splash
  // doesn't flicker. The gate kicks in only after a confirmed mismatch.
  if (!checked || !needsUpdate) return children;

  const storeUrl = platform === 'ios' ? IOS_STORE_URL : ANDROID_STORE_URL;
  const storeName = platform === 'ios' ? 'App Store' : 'Google Play';

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
      style={{
        background: `
          radial-gradient(ellipse at 70% -10%, rgba(16,185,129,0.10) 0%, transparent 50%),
          linear-gradient(180deg, #F0F7F4 0%, #FFFFFF 60%)
        `,
      }}
    >
      <div className="max-w-sm w-full">
        {/* Decorative refresh icon */}
        <div className="flex justify-center mb-6">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
              boxShadow: '0 12px 28px -8px rgba(16,185,129,0.4)',
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <polyline points="21 3 21 8 16 8" />
            </svg>
          </div>
        </div>

        <h1
          className="text-2xl font-black text-center mb-2"
          style={{ color: '#0B2912', letterSpacing: '-0.02em' }}
        >
          נדרש עדכון לאפליקציה
        </h1>
        <p className="text-sm text-center leading-relaxed mb-1" style={{ color: '#4B5D52' }}>
          הגרסה המותקנת אצלך ישנה מדי כדי להמשיך לעבוד.
        </p>
        <p className="text-sm text-center leading-relaxed mb-6" style={{ color: '#4B5D52' }}>
          כדי להמשיך, נא לעדכן לגרסה חדשה.
        </p>

        {/* Version detail */}
        <div
          className="rounded-2xl p-3 mb-6 text-center"
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5EDE8',
            boxShadow: '0 4px 12px rgba(15,40,28,0.04)',
          }}
        >
          <div className="flex items-center justify-around text-xs">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#7A6E58' }}>
                הגרסה שלך
              </p>
              <p className="font-black tabular-nums mt-1" style={{ color: '#B91C1C', fontSize: '1.1rem' }} dir="ltr">
                {currentVersion || '—'}
              </p>
            </div>
            <div className="h-8 w-px" style={{ background: '#E5EDE8' }} />
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#7A6E58' }}>
                הנדרשת
              </p>
              <p className="font-black tabular-nums mt-1" style={{ color: '#047857', fontSize: '1.1rem' }} dir="ltr">
                {minVersion || '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Beta-aware notice */}
        <div
          className="rounded-xl p-3 mb-4 text-[12px] leading-relaxed"
          style={{
            background: '#FFFBEB',
            border: '1px solid #FCD34D',
            color: '#78350F',
          }}
        >
          האפליקציה בשלב בדיקות סגורות. הקישור לחנות זמין רק למשתמשים שכבר
          רשומים בתוכנית הטסטים. אם החנות לא מציגה את האפליקציה, פנה
          אלינו לקבלת קובץ התקנה ידני.
        </div>

        {/* Primary CTA — store update */}
        <a
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block py-3.5 rounded-2xl font-bold text-center transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
            color: '#FFFFFF',
            boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
          }}
        >
          פתח את {storeName}
        </a>

        {/* Secondary CTA — manual support contact for anyone not in
            the testing track. mailto link opens the user's default
            email client with a pre-filled subject. */}
        <a
          href={SUPPORT_URL}
          className="block mt-3 py-3 rounded-2xl text-center text-sm font-bold transition-colors"
          style={{
            background: '#FFFFFF',
            color: '#10B981',
            border: '1.5px solid #D1FAE5',
          }}
        >
          צור קשר לקבלת התקנה ידנית
        </a>
      </div>
    </div>
  );
}
