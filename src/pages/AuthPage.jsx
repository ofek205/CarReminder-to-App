import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase } from '@/lib/supabase';
import { supabaseRecovery } from '@/lib/supabaseRecovery';
import { useAuth } from '@/components/shared/GuestContext';
import { isNative } from '@/lib/capacitor';
import logo from '@/assets/logo.png';
import { Mail, Lock, User, Eye, EyeOff, ArrowRight } from 'lucide-react';

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

const QUICK_CHECK_RETURN_KEY = 'vehicle_quick_check_return';

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

  // Modes:
  //   login, signup, reset  — email-based flows.
  //   update-password        — user clicked a password-reset email link.
  //                            Supabase has already consumed the recovery
  //                            token into a session by the time we mount,
  //                            so we just need the user to pick a new pwd.
  //   verify-email           — user just signed up and a 6-digit OTP was
  //                            emailed to them. They enter it here to
  //                            finalise the account. Persisted across
  //                            tab refreshes via sessionStorage so the
  //                            user can close + return without losing
  //                            context.
  const [mode, setMode] = useState(() => {
    try {
      const u = new URL(window.location.href);
      const m = u.searchParams.get('mode');
      if (m === 'update-password') return 'update-password';
      if (m === 'verify-email') return 'verify-email';
      // Recovery emails sometimes arrive with the marker in the URL
      // fragment (#type=recovery / #access_token=...) instead of the
      // query string — Supabase's default recovery template, certain
      // mail providers, and some PWA shell rewrites strip ?mode= but
      // leave the fragment intact.
      const hash = (window.location.hash || '').replace(/^#/, '');
      if (hash) {
        const hp = new URLSearchParams(hash);
        const t  = hp.get('type');
        if (t === 'recovery') return 'update-password';
        if (hp.get('access_token') && (t === 'recovery' || u.searchParams.get('type') === 'recovery')) {
          return 'update-password';
        }
      }
      if (u.searchParams.get('type') === 'recovery') return 'update-password';

      // PKCE flow + recovery: Supabase redirects the user back to
      // /Auth?code=... and exchangeCodeForSession only fires SIGNED_IN
      // — never PASSWORD_RECOVERY. Without a hint the page can't tell
      // the recovery callback apart from a signup-confirm or oauth
      // callback. We solve this by writing a sessionStorage marker the
      // moment the user submits the reset form (see resetPasswordForEmail
      // call below). If we see ?code= here AND that marker is fresh,
      // treat it as a recovery and open the new-password form. The
      // marker's TTL means a stale tab won't trap a different user.
      if (u.searchParams.get('code')) {
        const at = Number(localStorage.getItem('cr_pending_recovery_at') || 0);
        const TEN_MIN = 10 * 60 * 1000;
        if (at && (Date.now() - at) < TEN_MIN) return 'update-password';
      }

      // Resume a pending verification if the tab was refreshed.
      if (sessionStorage.getItem('cr_pending_verify_email')) return 'verify-email';
    } catch {}
    return 'login';
  });
  // showForm decides whether the user sees the welcome screen
  // (login/signup/google buttons) or the actual form. For email-driven
  // flows (update-password, verify-email) we MUST jump straight into
  // the form — landing on the welcome screen looks like the link is
  // broken. The init function mirrors `mode`'s URL inspection so the
  // first render already shows the right thing; a useEffect below
  // covers later transitions (e.g. PASSWORD_RECOVERY listener flipping
  // mode after a PKCE exchange).
  const [showForm, setShowForm] = useState(() => {
    try {
      const u = new URL(window.location.href);
      const m = u.searchParams.get('mode');
      if (m === 'update-password' || m === 'verify-email') return true;
      const hash = (window.location.hash || '').replace(/^#/, '');
      if (hash) {
        const hp = new URLSearchParams(hash);
        const t  = hp.get('type');
        if (t === 'recovery') return true;
        if (hp.get('access_token') && (t === 'recovery' || u.searchParams.get('type') === 'recovery')) {
          return true;
        }
      }
      if (u.searchParams.get('type') === 'recovery') return true;
      // PKCE recovery callback: ?code=… + fresh marker.
      if (u.searchParams.get('code')) {
        const at = Number(localStorage.getItem('cr_pending_recovery_at') || 0);
        const TEN_MIN = 10 * 60 * 1000;
        if (at && (Date.now() - at) < TEN_MIN) return true;
      }
      // Direct token_hash recovery link from the email template.
      if (u.searchParams.get('token_hash') && u.searchParams.get('type') === 'recovery') {
        return true;
      }
      if (sessionStorage.getItem('cr_pending_verify_email')) return true;
    } catch {}
    return false;
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
  // Email-verification state.
  // pendingEmail: the address signUp() was just called with. We need it
  //   for verifyOtp + resend; the form's `email` field can be cleared
  //   independently, so we keep this separate. Persisted in sessionStorage
  //   so a tab refresh during verification doesn't strand the user.
  const [pendingEmail, setPendingEmail] = useState(() => {
    try { return sessionStorage.getItem('cr_pending_verify_email') || ''; } catch { return ''; }
  });
  const [verificationCode, setVerificationCode] = useState('');
  // Cooldown after a resend so we don't fire-hose Resend (and Supabase's
  // own 60s/email limit). Counts down to 0; button re-enables at 0.
  const [resendCooldown, setResendCooldown] = useState(0);
  const formRef = useRef(null);

  // "We arrived from an auth email link, hold off the auto-redirect
  // until we know which kind." Recovery emails land us on /Auth with
  // either ?code=… (PKCE) or an access_token fragment (legacy implicit).
  // Both make Supabase fire a SIGNED_IN event before PASSWORD_RECOVERY,
  // so a naive isAuthenticated → redirect-to-Dashboard race silently
  // logs the user in without the password form.
  // Cleared once PASSWORD_RECOVERY fires (mode flips to update-password)
  // or after a short fallback so a legitimate already-logged-in visitor
  // who landed on /Auth doesn't get stuck.
  const [holdForRecovery, setHoldForRecovery] = useState(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('code')) return true;
      const hash = (u.hash || '').replace(/^#/, '');
      if (hash) {
        const hp = new URLSearchParams(hash);
        if (hp.get('access_token') || hp.get('type') === 'recovery') return true;
      }
    } catch {}
    return false;
  });
  useEffect(() => {
    if (!holdForRecovery) return;
    const t = setTimeout(() => setHoldForRecovery(false), 800);
    return () => clearTimeout(t);
  }, [holdForRecovery]);

  // Direct token_hash verification path — set when the email template
  // builds /Auth?type=recovery&token_hash=… instead of routing through
  // Supabase's /verify endpoint. /verify wraps the token in a redirect
  // that some configs (Site URL not pointing here, allowlist not
  // including ?mode=update-password) strip before we ever see it.
  //
  // The supabase project is on PKCE flow (flowType: 'pkce' in
  // src/lib/supabase.js), so {{ .TokenHash }} in the email template
  // emits a `pkce_…` prefixed value — verifyOtp does NOT accept those.
  // PKCE tokens go through exchangeCodeForSession instead. We branch
  // on the prefix so the same handler works if the project ever
  // switches back to implicit flow.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const tokenHash = u.searchParams.get('token_hash');
      const type      = u.searchParams.get('type');
      if (!tokenHash || type !== 'recovery') return;
      (async () => {
        try {
          let error;
          if (tokenHash.startsWith('pkce_')) {
            // Legacy PKCE-bound token (from before we switched the
            // recovery flow to implicit). Still works in the originating
            // browser; fails cross-device. Keep the branch so any
            // pending old emails in the wild can still reset.
            const r = await supabase.auth.exchangeCodeForSession(tokenHash);
            error = r.error;
          } else {
            // Implicit-flow token: verifyOtp validates server-side
            // without any browser-local state. Works on any device.
            // We use supabaseRecovery (same storage as `supabase`) so
            // the resulting session is shared with the rest of the app.
            const r = await supabaseRecovery.auth.verifyOtp({
              token_hash: tokenHash,
              type: 'recovery',
            });
            error = r.error;
          }
          if (!error) {
            // Mirror the freshly-verified session into the main
            // `supabase` client. Without this, the main client's
            // in-memory state stays empty until the next page load,
            // and the immediate `updateUser({ password })` call below
            // can fail with "no session". Both clients share the
            // same storage key, so setSession just hydrates the
            // in-memory Session from the same tokens.
            try {
              const { data } = await supabaseRecovery.auth.getSession();
              if (data?.session) {
                await supabase.auth.setSession({
                  access_token:  data.session.access_token,
                  refresh_token: data.session.refresh_token,
                });
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('session mirror failed:', e?.message);
            }
            setMode('update-password');
            setHoldForRecovery(false);
            // Strip the token from the visible URL so a hard refresh
            // after success doesn't try to re-verify a now-consumed
            // token. Keep mode=update-password so the form survives
            // the refresh.
            window.history.replaceState({}, '', '/Auth?mode=update-password');
          } else {
            // Token expired, already used, malformed, or PKCE verifier
            // missing (e.g. user opened the link in a different browser
            // than the one they requested it from). Bounce back to the
            // request-reset form with a clear message so they don't
            // sit confused on a password form whose submit will fail.
            // eslint-disable-next-line no-console
            console.warn('recovery verify failed:', error.message);
            setError('הקישור לאיפוס הסיסמה פג תוקף או כבר נוצל. בקש קישור חדש למטה.');
            setMode('reset');
            setShowForm(true);
            setHoldForRecovery(false);
            // Strip the bad token from the URL so the failure isn't
            // re-attempted on every render.
            window.history.replaceState({}, '', '/Auth?mode=reset');
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('recovery verify threw:', err?.message);
          setError('הקישור לאיפוס הסיסמה פג תוקף או כבר נוצל. בקש קישור חדש למטה.');
          setMode('reset');
          setShowForm(true);
          setHoldForRecovery(false);
        }
      })();
    } catch {}
  }, []);

  // Auto-redirect logged-in users away from /Auth — UNLESS they're
  // mid password-recovery. Critical security fix: when a user clicks
  // a recovery email link, Supabase mints a (scoped) session as part
  // of the verify step. Without the `mode !== 'update-password'`
  // guard the user gets auto-redirected to /Dashboard and never sees
  // the new-password form, effectively turning the recovery link into
  // a one-click login. Anyone with access to the inbox would silently
  // log in without ever proving they know (or set) a password.
  useEffect(() => {
    if (isAuthenticated && mode !== 'update-password' && !holdForRecovery) {
      try {
        if (sessionStorage.getItem(QUICK_CHECK_RETURN_KEY) === '1') {
          sessionStorage.removeItem(QUICK_CHECK_RETURN_KEY);
          navigate('/vehicle-check', { replace: true });
          return;
        }
      } catch {}
      navigate(createPageUrl('Dashboard'), { replace: true });
    }
  }, [isAuthenticated, mode, navigate, holdForRecovery]);

  // Belt-and-suspenders: Supabase fires PASSWORD_RECOVERY when the
  // recovery token has just been exchanged for a session. We force
  // update-password mode here too, so even if the URL got stripped of
  // ?mode=update-password (some email clients rewrite query params,
  // some web previewers strip them, etc.) the user still lands on the
  // password form rather than getting silently logged in.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('update-password');
        // Recovery confirmed — release the redirect-hold so the rest of
        // the page (and the dependent effects) stop waiting on the
        // fallback timeout.
        setHoldForRecovery(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Resend-cooldown ticker. Counts the cooldown second-by-second so the
  // "שלח קוד שוב" button shows live remaining time and re-enables at 0.
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Belt-and-suspenders: any time mode flips into an email-driven flow
  // (update-password from PASSWORD_RECOVERY, verify-email from a fresh
  // signup), force the form to be visible. Without this, a user whose
  // initial URL didn't match the regex (e.g. hash-only fragment that
  // a redirector stripped) but who later receives a PASSWORD_RECOVERY
  // event would stay stuck on the welcome screen.
  useEffect(() => {
    if (mode === 'update-password' || mode === 'verify-email') {
      setShowForm(true);
    }
  }, [mode]);

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

  // Re-send the signup OTP. Same email, fresh token. Cooldown UI
  // (resendCooldown countdown) prevents spam-tapping; Supabase enforces
  // its own 60s/email rate limit server-side as a backstop.
  const handleResendCode = async () => {
    if (!pendingEmail || resendCooldown > 0) return;
    setError('');
    setSuccess('');
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: pendingEmail,
        options: { emailRedirectTo: getEmailRedirectBase() + '/Auth' },
      });
      if (error) {
        console.warn('resend signup OTP error:', error.message);
        setError(localizeAuthError(error.message));
      } else {
        setSuccess('קוד חדש נשלח לאימייל שלך');
        setResendCooldown(60);
      }
    } catch {
      setError('שליחה חוזרת נכשלה. נסה/י שוב.');
    }
  };

  // Cancel verification + return to signup with a fresh form. Used by
  // the "wrong email?" link on the verify screen.
  const handleAbortVerification = () => {
    try { sessionStorage.removeItem('cr_pending_verify_email'); } catch {}
    setPendingEmail('');
    setVerificationCode('');
    setError('');
    setSuccess('');
    setMode('signup');
  };

  // Web origin for email redirect targets. On native (Capacitor) the
  // page is served from `https://localhost`, which is NOT in the
  // Supabase Auth redirect-URL allowlist — so passing it as `redirectTo`
  // makes Supabase reject the request with "Error sending recovery
  // email" *before* the SMTP send. Production web URL works for both
  // surfaces: native users open the recovery link in the system
  // browser, complete the password change there, and sign in on the
  // app after.
  const getEmailRedirectBase = () => isNative
    ? 'https://car-reminder.app'
    : window.location.origin;

  // Map common Supabase auth errors to user-friendly Hebrew. Anything
  // unrecognized falls through to a generic Hebrew message rather than
  // surfacing raw English text.
  const localizeAuthError = (msg) => {
    const m = (msg || '').toLowerCase();
    if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes'))
      return 'נשלחו יותר מדי אימיילים. נסה/י שוב בעוד מספר דקות.';
    if (m.includes('redirect') && (m.includes('not allowed') || m.includes('invalid')))
      return 'שגיאת תצורה זמנית. אם הבעיה ממשיכה, פנה/י לתמיכה.';
    if (m.includes('user not found') || m.includes('not registered') || m.includes('no user'))
      return 'לא נמצא משתמש עם האימייל הזה.';
    if (m.includes('invalid login credentials')) return 'אימייל או סיסמה שגויים';
    if (m.includes('already registered')) return 'האימייל הזה כבר רשום. נסה להתחבר.';
    if (m.includes('network') || m.includes('fetch'))
      return 'בעיית רשת. בדוק/י את החיבור ונסה/י שוב.';
    return 'שליחת האימייל נכשלה. נסה/י שוב או פנה/י לתמיכה.';
  };

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
      if (mode === 'verify-email') {
        // 6-digit OTP verification. Supabase's verifyOtp({type:'signup'})
        // both confirms the email and creates a real session, so a
        // successful call drops us straight into Dashboard via the
        // isAuthenticated useEffect above. No manual navigate needed.
        const code = (verificationCode || '').trim();
        if (!/^\d{6}$/.test(code)) {
          setError('הזן/י קוד בן 6 ספרות');
          setLoading(false);
          return;
        }
        if (!pendingEmail) {
          setError('פג תוקף תהליך האימות. יש להתחיל מחדש.');
          setMode('signup');
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.verifyOtp({
          email: pendingEmail,
          token: code,
          type: 'signup',
        });
        if (error) {
          console.warn('verifyOtp error:', error.message);
          const m = (error.message || '').toLowerCase();
          if (m.includes('expired') || m.includes('invalid') || m.includes('token'))
            setError('הקוד שגוי או שפג תוקפו. נסה/י שוב או שלח/י קוד חדש.');
          else
            setError(localizeAuthError(error.message));
        } else {
          try { sessionStorage.removeItem('cr_pending_verify_email'); } catch {}
          setSuccess('האימייל אומת! מעביר לאפליקציה...');
          import('@/lib/analytics').then(({ trackEvent, EVENTS }) => trackEvent(EVENTS.AUTH_SIGNUP));
        }
        setLoading(false);
        return;
      }
      if (mode === 'reset') {
        if (!email.trim()) { setError('יש להזין כתובת אימייל'); setLoading(false); return; }
        // Routed through `supabaseRecovery` (implicit flow) so the
        // email's token isn't PKCE-bound to this browser's
        // localStorage. The user can open the link on a different
        // device/browser/incognito and verifyOtp will succeed. See
        // src/lib/supabaseRecovery.js for the rationale.
        const { error } = await supabaseRecovery.auth.resetPasswordForEmail(email, {
          redirectTo: getEmailRedirectBase() + '/Auth?mode=update-password',
        });
        if (error) {
          // Log the raw message so we can diagnose new failure modes
          // from Sentry/console without exposing the user to English.
          console.warn('resetPasswordForEmail error:', error.message);
          setError(localizeAuthError(error.message));
        } else {
          // Drop a session-scoped marker so the return trip can recognise
          // this tab/device as the one that asked for the reset. PKCE
          // recovery hits us as /Auth?code=... and Supabase fires
          // SIGNED_IN (not PASSWORD_RECOVERY), so without a marker we
          // can't tell a recovery callback apart from a signup-confirm
          // or any other code-bearing redirect. Stored with a timestamp
          // so the AuthPage init can age it out (10 min TTL) instead of
          // trapping a future visitor.
          try {
            // localStorage (not sessionStorage) because email clients
            // open the recovery link in a new browser tab, which has its
            // own sessionStorage namespace. localStorage is shared across
            // all tabs of the same origin so the return trip can read
            // the marker.
            localStorage.setItem('cr_pending_recovery_at', String(Date.now()));
            localStorage.setItem('cr_pending_recovery_email', email.trim());
          } catch {}
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
          // Clear the recovery-flow marker so a future tab on the same
          // browser doesn't get re-trapped into update-password mode.
          try {
            localStorage.removeItem('cr_pending_recovery_at');
            localStorage.removeItem('cr_pending_recovery_email');
          } catch {}
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
          options: {
            data: { full_name: fullName },
            // Same native-vs-web branching as resetPasswordForEmail —
            // see getEmailRedirectBase() above. Without this, the
            // signup confirmation email on native fails the same way
            // the recovery email did.
            emailRedirectTo: getEmailRedirectBase() + '/Auth',
          },
        });
        if (error) {
          console.warn('signUp error:', error.message);
          setError(localizeAuthError(error.message));
        } else {
          // Persist pendingEmail across refresh and switch to the OTP
          // entry screen. Don't track AUTH_SIGNUP here — that fires on
          // verifyOtp success so the funnel reflects fully-confirmed
          // accounts, not abandoned-mid-verification ones.
          try { sessionStorage.setItem('cr_pending_verify_email', email); } catch {}
          setPendingEmail(email);
          setVerificationCode('');
          setResendCooldown(60);
          setSuccess('שלחנו אליך קוד אימות. בדוק/י את האימייל.');
          setMode('verify-email');
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
              <h1 className="font-bold leading-tight mb-2" style={{ fontSize: '1.65rem', color: C.text, letterSpacing: '-0.02em' }}>
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

              {/* Header — three branches:
                  • update-password: arrived from a recovery link, hide tabs
                  • verify-email:    show "we sent you a code" header
                  • everything else: normal login/signup/reset tab toggle */}
              {mode === 'update-password' ? (
                <div className="text-center mb-6">
                  <h2 className="text-lg font-bold" style={{ color: C.greenDark }}>בחירת סיסמה חדשה</h2>
                  <p className="text-xs mt-1" style={{ color: C.muted }}>
                    לפחות 8 תווים, עם אות וספרה.
                  </p>
                </div>
              ) : mode === 'verify-email' ? (
                <div className="text-center mb-6">
                  <h2 className="text-lg font-bold" style={{ color: C.greenDark }}>אימות האימייל</h2>
                  <p className="text-xs mt-2 leading-relaxed" style={{ color: C.muted }}>
                    שלחנו קוד בן 6 ספרות אל
                  </p>
                  <p className="text-sm font-bold mt-1" dir="ltr" style={{ color: C.text }}>
                    {pendingEmail}
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
                {mode === 'verify-email' && (
                  <>
                    {/* 6-digit OTP input. inputMode=numeric brings up the
                        digit keyboard on mobile; pattern + maxLength keep
                        accidental letters/long pastes from polluting the
                        token. autoComplete="one-time-code" lets iOS/Android
                        offer the just-arrived SMS/email code as a suggest. */}
                    <div>
                      <label className="text-xs font-bold mb-1.5 block" style={{ color: C.text }}>
                        קוד אימות
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        value={verificationCode}
                        onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="123456"
                        autoComplete="one-time-code"
                        autoFocus
                        dir="ltr"
                        className="w-full text-center text-2xl font-bold tracking-[0.5em] py-4 rounded-2xl outline-none transition-all"
                        style={{
                          background: '#FAFDF6',
                          border: `2px solid ${verificationCode.length === 6 ? C.green : C.border}`,
                          color: C.greenDark,
                          letterSpacing: '0.5em',
                        }}
                      />
                      <p className="text-[11px] mt-2 text-center" style={{ color: C.muted }}>
                        הקוד תקף ל-60 דקות
                      </p>
                    </div>
                  </>
                )}
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

                {mode !== 'update-password' && mode !== 'verify-email' && (
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

                {(mode !== 'reset' && mode !== 'verify-email') && (
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
                  ) : mode === 'login' ? 'כניסה'
                    : mode === 'signup' ? 'הרשמה'
                    : mode === 'verify-email' ? 'אימות'
                    : mode === 'update-password' ? 'עדכון סיסמה'
                    : 'שלח קישור איפוס'}
                </button>

                {mode === 'reset' && (
                  <button type="button" onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                    className="w-full text-center py-3 text-sm font-bold transition-colors mt-2"
                    style={{ color: C.green }}>
                    חזרה להתחברות
                  </button>
                )}

                {mode === 'verify-email' && (
                  <div className="flex flex-col items-center gap-2 mt-2">
                    {/* Resend with live cooldown countdown. The button is
                        visually muted (not just disabled) during cooldown
                        so users understand the wait is intentional, not a
                        broken link. */}
                    <button type="button"
                      onClick={handleResendCode}
                      disabled={resendCooldown > 0}
                      className="text-xs font-bold py-2 px-3 transition-colors"
                      style={{
                        color: resendCooldown > 0 ? C.muted : C.green,
                        cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
                      }}>
                      {resendCooldown > 0
                        ? `שלח קוד חדש (${resendCooldown})`
                        : 'לא קיבלת? שלח קוד חדש'}
                    </button>
                    <button type="button"
                      onClick={handleAbortVerification}
                      className="text-xs font-bold py-1.5 px-3 transition-colors"
                      style={{ color: C.muted }}>
                      אימייל שגוי? התחל מחדש
                    </button>
                  </div>
                )}
              </form>

              {/* Separator + Google in form. hidden during verify-email
                  to keep the OTP screen focused on a single action. */}
              {mode !== 'verify-email' && (<>
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
              </>)}
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
