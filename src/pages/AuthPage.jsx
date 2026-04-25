import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { isNative } from '@/lib/capacitor';
import logo from '@/assets/logo.png';
import { ChevronLeft, Mail, Lock, User, Eye, EyeOff, ArrowRight } from 'lucide-react';

//  Design tokens 
const C = {
  green:     '#4B7A53',
  greenDark: '#2D5233',
  greenLight:'#E8F2EA',
  yellow:    '#FFBF00',
  yellowSoft:'#FFF8E1',
  card:      '#FFFFFF',
  muted:     '#7A8A7C',
  border:    '#D8E5D9',
  text:      '#1C2E20',
  error:     '#DC2626',
  errorBg:   '#FEF2F2',
  success:   '#16A34A',
  successBg: '#F0FDF4',
};

//  Google icon 
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

//  Floating input with icon 
function AuthInput({ icon: Icon, label, type: initialType, value, onChange, placeholder, dir, required, autoComplete }) {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = initialType === 'password';
  const type = isPassword && showPassword ? 'text' : initialType;

  return (
    <div className="relative">
      <label className="block text-xs font-bold mb-2" style={{ color: C.text }}>{label}</label>
      <div className="relative">
        <div className="absolute top-1/2 -translate-y-1/2 z-10"
          style={{ [dir === 'ltr' ? 'left' : 'right']: '14px' }}>
          <Icon className="w-4.5 h-4.5" style={{ color: focused ? C.green : C.muted, transition: 'color 0.2s' }} />
        </div>
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          dir={dir || 'rtl'}
          autoComplete={autoComplete}
          className="w-full rounded-2xl text-sm transition-all duration-200"
          style={{
            padding: '14px 44px',
            border: `2px solid ${focused ? C.green : C.border}`,
            background: focused ? '#FAFFFE' : '#F8FAF8',
            outline: 'none',
            boxShadow: focused ? `0 0 0 4px ${C.green}15` : 'none',
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {isPassword && (
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            className="absolute top-1/2 -translate-y-1/2 p-1 z-10"
            style={{ [dir === 'ltr' ? 'right' : 'left']: '10px' }}
            tabIndex={-1}>
            {showPassword
              ? <EyeOff className="w-4 h-4" style={{ color: C.muted }} />
              : <Eye className="w-4 h-4" style={{ color: C.muted }} />
            }
          </button>
        )}
      </div>
    </div>
  );
}

//  Main component 
export default function AuthPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const [showForm, setShowForm] = useState(false);
  // Modes:
  //   login, signup, reset  — email-based flows.
  //   update-password        — user clicked a password-reset email link.
  //                            Supabase has already consumed the recovery
  //                            token into a session by the time we mount,
  //                            so we just need the user to pick a new pwd.
  const [mode, setMode] = useState(() => {
    try {
      const u = new URL(window.location.href);
      const m = u.searchParams.get('mode');
      if (m === 'update-password') return 'update-password';
    } catch {}
    return 'login';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // "Remember me". default true. Persisted across sessions so the user
  // doesn't need to re-tick every time. When false, the Supabase session
  // still survives tab close (Supabase JS default), but we log the user
  // out of their OTHER tabs on close via BroadcastChannel (see handleSubmit).
  const [rememberMe, setRememberMe] = useState(() => {
    try { return localStorage.getItem('cr_remember_me_v1') !== '0'; } catch { return true; }
  });
  const formRef = useRef(null);

  useEffect(() => {
    if (isAuthenticated) navigate(createPageUrl('Dashboard'), { replace: true });
  }, [isAuthenticated, navigate]);

  // Auto-focus first input when form opens
  useEffect(() => {
    if (showForm && formRef.current) {
      const firstInput = formRef.current.querySelector('input');
      if (firstInput) setTimeout(() => firstInput.focus(), 300);
    }
  }, [showForm, mode]);

  const handleGuest = () => {
    sessionStorage.setItem('guest_confirmed', '1');
    import('@/lib/analytics').then(({ trackEvent, EVENTS }) => trackEvent(EVENTS.GUEST_SESSION));
    navigate(createPageUrl('Dashboard'));
  };

  const handleOAuth = async (provider) => {
    setOauthLoading(provider);
    setError('');

    if (isNative) {
      // Native: PKCE OAuth flow.
      // The redirect target MUST be our custom scheme (registered in
      // AndroidManifest.xml) — `window.location.origin` on Capacitor is
      // `http://localhost`, which the system browser cannot return to
      // the app. The previous code did exactly that, leaving Google to
      // redirect to a localhost page outside the app and the PKCE code
      // never being exchanged → user had to tap "Sign in" twice.
      //
      // The actual code-for-session swap happens in capacitor.js
      // `initDeepLinks` once Android delivers `appUrlOpen`, and the
      // GuestContext auth listener navigates to /Dashboard. We just
      // kick off the OAuth handshake here and surface errors.
      try {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: 'carreminder://auth/callback',
            skipBrowserRedirect: true,
          },
        });
        if (error) { setError(error.message); setOauthLoading(''); return; }

        // Custom Tabs (windowName: '_blank') keeps the OAuth flow inside
        // the app shell rather than launching a separate Chrome tab —
        // matches the WhatsApp/Gmail UX expectation.
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: data.url, windowName: '_blank' });

        // No appStateChange polling: initDeepLinks handles the deep-link
        // delivery + code exchange + navigation. We clear the loading
        // spinner once the deep link arrives (covered by the navigation
        // unmounting this page); for the cancel-flow we drop the spinner
        // after a generous timeout so the user can retry.
        setTimeout(() => setOauthLoading(''), 60_000);
      } catch (e) {
        setError(e.message || 'שגיאה בהתחברות');
        setOauthLoading('');
      }
    } else {
      // Web: normal redirect flow
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + createPageUrl('Dashboard') },
      });
      if (error) setError(error.message);
      setOauthLoading('');
    }
  };

  // Basic email validation. before hitting Supabase
  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    // Dev bypass: "00/00" skips client-side email + length checks; real
    // validation happens in the auth handler once the env creds swap in.
    const isDevBypass = mode === 'login' && email === '00' && password === '00';
    // Client-side validation. fast feedback, no network round-trip
    if (!isDevBypass && !isValidEmail(email)) {
      setError('כתובת אימייל לא תקינה');
      return;
    }
    if (!isDevBypass && mode !== 'reset' && password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים');
      return;
    }
    if (mode === 'signup' && !fullName.trim()) {
      setError('יש להזין שם מלא');
      return;
    }
    setLoading(true);
    // Persist the checkbox choice so it's remembered between visits.
    try { localStorage.setItem('cr_remember_me_v1', rememberMe ? '1' : '0'); } catch {}
    // When the user unchecks "remember me", mark the session as
    // tab-scoped. A Layout-level listener reads this flag and signs the
    // user out when the tab/app is closed (see initSessionKeepAlive).
    // Native apps ignore the "remember me" toggle entirely — sessions
    // are indefinite there per PM-defined acceptance criteria — so we
    // skip the write to keep sessionStorage clean and avoid future
    // dev confusion about whether the value is authoritative on native.
    if (!isNative) {
      try { sessionStorage.setItem('cr_session_scope', rememberMe ? 'persistent' : 'tab'); } catch {}
    }
    try {
      if (mode === 'reset') {
        if (!email.trim()) { setError('יש להזין כתובת אימייל'); setLoading(false); return; }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/Auth?mode=update-password',
        });
        if (error) {
          setError(error.message);
        } else {
          setSuccess('נשלח אימייל לאיפוס סיסמה. בדוק את תיבת הדואר שלך.');
          setTimeout(() => setMode('login'), 3000);
        }
        setLoading(false);
        return;
      }
      if (mode === 'update-password') {
        // User followed a recovery email link; Supabase converted the
        // fragment token into an active session on page load. All we need
        // is a new password.
        if (password.length < 8)            { setError('הסיסמה חייבת להכיל לפחות 8 תווים'); setLoading(false); return; }
        if (!/[A-Za-z]/.test(password))     { setError('הסיסמה חייבת לכלול אות'); setLoading(false); return; }
        if (!/[0-9]/.test(password))        { setError('הסיסמה חייבת לכלול ספרה'); setLoading(false); return; }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          setError(error.message || 'עדכון הסיסמה נכשל');
        } else {
          setSuccess('הסיסמה עודכנה. מעביר לאפליקציה...');
          setTimeout(() => { window.location.href = '/'; }, 1200);
        }
        setLoading(false);
        return;
      }
      if (mode === 'login') {
        // Dev bypass: typing "00" in both fields signs in with the dev
        // credentials from .env.local. Wrapped in import.meta.env.DEV so
        // Vite dead-code-eliminates the whole block (including any literal
        // env values) from production bundles. Prod users who type "00/00"
        // just see the normal invalid-credentials message.
        let effectiveEmail = email;
        let effectivePassword = password;
        if (import.meta.env.DEV && email === '00' && password === '00') {
          const devEmail = import.meta.env.VITE_DEV_EMAIL;
          const devPass = import.meta.env.VITE_DEV_PASSWORD;
          if (!devEmail || !devPass) {
            setError('מצב בדיקה לא מוגדר. הגדר VITE_DEV_EMAIL ו-VITE_DEV_PASSWORD ב-.env.local.');
            setLoading(false);
            return;
          }
          effectiveEmail = devEmail;
          effectivePassword = devPass;
        }
        const { error } = await supabase.auth.signInWithPassword({ email: effectiveEmail, password: effectivePassword });
        if (error) setError(error.message.includes('Invalid login credentials') ? 'אימייל או סיסמה שגויים' : error.message);
        else import('@/lib/analytics').then(({ trackEvent, EVENTS }) => trackEvent(EVENTS.AUTH_LOGIN));
      } else {
        if (password.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); setLoading(false); return; }
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName } },
        });
        if (error) {
          setError(error.message.includes('already registered') ? 'האימייל הזה כבר רשום. נסה להתחבר.' : error.message);
        } else {
          setSuccess('נשלח אימייל אימות. אנא אשר ואז התחבר.');
          import('@/lib/analytics').then(({ trackEvent, EVENTS }) => trackEvent(EVENTS.AUTH_SIGNUP));
          setMode('login');
        }
      }
    } catch {
      setError('אירעה שגיאה. נסה שוב.');
    } finally {
      setLoading(false);
    }
  };

  //  Loading 
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#ffffff' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl overflow-hidden">
            <img src={logo} alt="" className="w-full h-full object-contain" />
          </div>
          <div className="h-8 w-8 border-3 rounded-full animate-spin"
            style={{ borderColor: C.border, borderTopColor: C.green }} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" dir="rtl"
      style={{ background: '#ffffff', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/*  Hero  */}
      <div className="relative w-full overflow-hidden"
        style={{ height: showForm ? '160px' : '280px', transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)' }}>

        {/* Green gradient */}
        <div className="absolute inset-0"
          style={{ background: `linear-gradient(160deg, ${C.greenDark} 0%, #3B6D43 45%, ${C.green} 100%)` }} />

        {/* Car image - very subtle texture */}
        <img src="/hero-car.jpg" alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0.45, mixBlendMode: 'normal' }}
          onError={e => { e.target.style.display = 'none'; }} />

        {/* Yellow accent circles */}
        <div className="absolute -top-12 -right-12 w-52 h-52 rounded-full"
          style={{ background: `radial-gradient(circle, rgba(255,191,0,0.18) 0%, transparent 70%)` }} />
        <div className="absolute top-4 left-8 w-16 h-16 rounded-full"
          style={{ background: 'rgba(255,191,0,0.12)' }} />

        {/* Smooth fade to white */}
        <div className="absolute bottom-0 left-0 right-0" style={{ height: '50%', background: 'linear-gradient(to bottom, transparent, #ffffff)' }} />

        {/* Logo */}
        <div className="absolute inset-0 flex flex-col items-center z-10"
          style={{ justifyContent: showForm ? 'center' : 'center', paddingBottom: showForm ? '16px' : '32px', transition: 'padding 0.4s ease' }}>
          <div className="rounded-2xl overflow-hidden"
            style={{
              width: showForm ? '52px' : '72px',
              height: showForm ? '52px' : '72px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)',
            }}>
            <img src={logo} alt="CarReminder" className="w-full h-full object-contain" />
          </div>
          {!showForm && (
            <p className="text-white font-semibold text-sm tracking-[0.15em] mt-3" style={{ opacity: 0.8 }}>
              CarReminder
            </p>
          )}
        </div>
      </div>

      {/*  Content  */}
      <div className="flex-1 px-5 pb-10 flex flex-col items-center max-w-md mx-auto w-full">

        {/*  Main view (buttons)  */}
        {!showForm ? (
          <div className="w-full" style={{ marginTop: '4px' }}>
            {/* Headline + subtitle */}
            <div className="text-center mb-8">
              <h1 className="font-black leading-tight mb-2" style={{ fontSize: '1.65rem', color: C.text, letterSpacing: '-0.02em' }}>
                נהל את הרכב שלך<br />בלי לשכוח דבר
              </h1>
              <div className="w-14 h-1.5 mx-auto rounded-full mb-3" style={{ background: C.yellow }} />
              <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
                תזכורות טסט, ביטוח וטיפולים הכל במקום אחד
              </p>
            </div>

            {/* CTA buttons */}
            <div className="space-y-3">
              {/* Primary - Email login */}
              <button onClick={() => setShowForm(true)}
                className="w-full py-4 rounded-2xl font-bold text-base transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2"
                style={{
                  background: `linear-gradient(135deg, ${C.greenDark} 0%, ${C.green} 100%)`,
                  color: 'white',
                  boxShadow: '0 6px 24px rgba(45,82,51,0.30)',
                }}>
                <Mail className="w-5 h-5" style={{ opacity: 0.85 }} />
                <span>התחברות / הרשמה</span>
              </button>

              {/* Divider */}
              <div className="flex items-center gap-4 py-1">
                <div className="flex-1 h-px" style={{ background: C.border }} />
                <span className="text-xs font-bold" style={{ color: C.muted }}>או</span>
                <div className="flex-1 h-px" style={{ background: C.border }} />
              </div>

              {/* Google */}
              <button onClick={() => handleOAuth('google')} disabled={oauthLoading === 'google'}
                className="w-full py-4 rounded-2xl font-bold text-sm transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-3"
                style={{ background: '#fff', color: C.text, border: `1.5px solid ${C.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <GoogleIcon />
                <span>{oauthLoading === 'google' ? 'מתחבר...' : 'המשך עם Google'}</span>
              </button>

              {/* Guest */}
              <div className="mt-4 pt-3" style={{ borderTop: '1px solid #E5E7EB' }}>
                <button onClick={handleGuest}
                  className="w-full py-3.5 text-sm font-bold rounded-2xl transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2"
                  style={{ color: '#374151', background: '#F9FAFB', border: '1.5px solid #D1D5DB', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <span>👋</span>
                  <span>כניסה כאורח - בלי הרשמה</span>
                </button>
              </div>
            </div>

            {/* Trust signal */}
            <div className="flex items-center justify-center gap-2 mt-6">
              <Lock className="w-3.5 h-3.5" style={{ color: C.muted }} />
              <span className="text-xs" style={{ color: C.muted }}>הנתונים שלך מוגנים ומאובטחים</span>
            </div>
          </div>

        ) : (
          /*  Form view  */
          <div className="w-full" style={{ marginTop: '4px' }}>

            {/* Back button - context-aware: reset → login, otherwise → main view */}
            <button onClick={() => {
                if (mode === 'reset') { setMode('login'); setError(''); setSuccess(''); }
                else { setShowForm(false); setError(''); setSuccess(''); }
              }}
              className="flex items-center gap-1.5 mb-5 py-2 px-1 rounded-lg transition-colors"
              style={{ color: C.green }}>
              <ArrowRight className="w-4 h-4" />
              <span className="text-sm font-bold">
                {mode === 'reset' ? 'חזרה להתחברות' : 'חזרה'}
              </span>
            </button>

            {/* Form card */}
            <div ref={formRef} className="w-full rounded-3xl p-6"
              style={{ background: C.card, boxShadow: '0 4px 32px rgba(45,82,51,0.10)', border: `1px solid ${C.border}` }}>

              {/* Mode toggle — hidden in the recovery-landing flow; the
                  user arrives here from an email link and should not be
                  able to switch modes until the new password is set. */}
              {mode === 'update-password' ? (
                <div className="text-center mb-6">
                  <h2 className="text-lg font-black" style={{ color: C.greenDark }}>בחירת סיסמה חדשה</h2>
                  <p className="text-xs mt-1" style={{ color: C.muted }}>
                    לפחות 8 תווים, עם אות וספרה.
                  </p>
                </div>
              ) : (
              <div className="flex rounded-2xl overflow-hidden mb-6" style={{ background: '#F1F5F1' }}>
                {(mode === 'reset' ? ['reset'] : ['login', 'signup']).map(m => (
                  <button key={m}
                    onClick={() => { setMode(m); setError(''); setSuccess(''); }}
                    className="flex-1 py-3 text-sm font-bold transition-all duration-200 rounded-2xl"
                    style={{
                      background: mode === m ? C.greenDark : 'transparent',
                      color: mode === m ? 'white' : C.muted,
                      boxShadow: mode === m ? '0 2px 8px rgba(45,82,51,0.2)' : 'none',
                    }}>
                    {m === 'login' ? 'כניסה' : m === 'signup' ? 'הרשמה' : 'איפוס סיסמה'}
                  </button>
                ))}
              </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {mode === 'signup' && (
                  <AuthInput
                    icon={User}
                    label="שם מלא"
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="ישראל ישראלי"
                    required
                    autoComplete="name"
                  />
                )}

                {mode !== 'update-password' && (
                  <AuthInput
                    icon={Mail}
                    label="אימייל"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="example@email.com"
                    dir="ltr"
                    required
                    autoComplete="email"
                  />
                )}

                {(mode !== 'reset') && (
                  <AuthInput
                    icon={Lock}
                    label={mode === 'update-password' ? 'סיסמה חדשה' : 'סיסמה'}
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={mode === 'signup' || mode === 'update-password' ? 'לפחות 8 תווים, אות וספרה' : 'הזן סיסמה'}
                    dir="ltr"
                    required
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                )}

                {mode === 'login' && (
                  <div className="flex items-center justify-between mt-1">
                    {/* "Remember me". defaults to on; lets the user drop the
                        session on tab close if they're on a shared device. */}
                    <label className="flex items-center gap-2 cursor-pointer select-none"
                      style={{ color: C.text }}>
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="w-4 h-4 rounded cursor-pointer"
                        style={{ accentColor: C.green }}
                      />
                      <span className="text-xs font-bold">זכור אותי</span>
                    </label>
                    <button type="button" onClick={() => { setMode('reset'); setError(''); setSuccess(''); }}
                      className="text-xs font-bold transition-colors"
                      style={{ color: C.green }}>
                      שכחתי סיסמה
                    </button>
                  </div>
                )}

                {mode === 'reset' && (
                  <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
                    הזן את כתובת האימייל שלך ונשלח לך קישור לאיפוס הסיסמה
                  </p>
                )}

                {/* Error message */}
                {error && (
                  <div className="flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold"
                    style={{ background: C.errorBg, color: C.error, border: '1px solid #FECACA' }}>
                    <span className="shrink-0 mt-0.5">⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                {/* Success message */}
                {success && (
                  <div className="flex items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold"
                    style={{ background: C.successBg, color: C.success, border: '1px solid #BBF7D0' }}>
                    <span className="shrink-0 mt-0.5">✓</span>
                    <span>{success}</span>
                  </div>
                )}

                {/* Submit button */}
                <button type="submit" disabled={loading}
                  className="w-full py-4 rounded-2xl font-bold text-base transition-all duration-200 active:scale-[0.98] mt-2"
                  style={{
                    background: loading ? '#9CA3AF' : `linear-gradient(135deg, ${C.greenDark} 0%, ${C.green} 100%)`,
                    color: 'white',
                    boxShadow: loading ? 'none' : '0 4px 16px rgba(45,82,51,0.25)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}>
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>רגע...</span>
                    </span>
                  ) : mode === 'login' ? 'כניסה' : mode === 'signup' ? 'הרשמה' : 'שלח קישור איפוס'}
                </button>

                {mode === 'reset' && (
                  <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                    className="w-full text-center py-3 text-sm font-bold transition-colors mt-2"
                    style={{ color: C.green }}>
                    חזרה להתחברות
                  </button>
                )}
              </form>

              {/* Separator + Google in form */}
              <div className="flex items-center gap-4 py-4 mt-2">
                <div className="flex-1 h-px" style={{ background: C.border }} />
                <span className="text-xs font-bold" style={{ color: C.muted }}>או</span>
                <div className="flex-1 h-px" style={{ background: C.border }} />
              </div>

              <button onClick={() => handleOAuth('google')} disabled={oauthLoading === 'google'}
                className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-3"
                style={{ background: '#fff', color: C.text, border: `1.5px solid ${C.border}` }}>
                <GoogleIcon />
                <span>{oauthLoading === 'google' ? 'מתחבר...' : 'המשך עם Google'}</span>
              </button>
            </div>

            {/* Trust signal */}
            <div className="flex items-center justify-center gap-2 mt-5">
              <Lock className="w-3.5 h-3.5" style={{ color: C.muted }} />
              <span className="text-xs" style={{ color: C.muted }}>הנתונים שלך מוגנים ומאובטחים</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom accent */}
      <div className="fixed bottom-0 left-0 right-0 h-1"
        style={{ background: `linear-gradient(to left, ${C.greenDark}, ${C.yellow}, ${C.greenDark})`, opacity: 0.25 }} />
    </div>
  );
}
