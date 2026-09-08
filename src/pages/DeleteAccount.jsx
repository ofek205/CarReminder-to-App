import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { dal } from '@/lib/dal';
import { clearPersistedCache } from '@/lib/query-persister';
import { useAuth } from '../components/shared/GuestContext';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { AlertTriangle, Trash2, FileX, Loader2, CheckCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { isIOS } from '@/lib/capacitor';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { reportError } from '@/lib/crashReporter';
import { resolveReauthMode } from '@/lib/reauthMode';

// Last-resort gate for a user we have no way to actually verify: typing this
// proves INTENT, not identity. See resolveReauthMode for when it applies.
const CONFIRM_WORD = 'מחק';


export default function DeleteAccount() {
  const { isAuthenticated, user, isGuest } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('choose'); // choose | confirm | deleting | done
  const [mode, setMode] = useState(null); // 'account' | 'data'
  const [error, setError] = useState('');
  // Set when the server blocks deletion because the user owns a business
  // account with other active members. Replaces the whole re-auth gate:
  // showing a form the server will reject is an invitation to frustration.
  const [ownershipBlocked, setOwnershipBlocked] = useState(false);
  // Re-auth state. Mandatory before any destructive operation so a
  // hijacked session can't delete the user's data.
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [reauthPending, setReauthPending] = useState(false);
  // OTP branch: the code is emailed, so the gate is two steps (send, then
  // enter). `otpSent` drives which of the two the gate shows.
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);

  const reauthMode = resolveReauthMode(user, isIOS);

  // Not logged in
  if (!isAuthenticated || isGuest) {
    return (
      <div dir="rtl" className="max-w-md mx-auto py-16 px-4 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-4" style={{ color: C.warn }} />
        <h1 className="text-xl font-bold mb-2">נדרשת התחברות</h1>
        <p className="text-sm mb-6" style={{ color: C.gray500 }}>כדי למחוק חשבון או נתונים, יש להתחבר קודם</p>
        <button onClick={() => navigate(createPageUrl('Auth'))}
          className="px-6 py-3 rounded-2xl font-bold text-white" style={{ background: C.primary }}>
          התחבר
        </button>
      </div>
    );
  }

  /**
   * Proves the person at the keyboard is the account owner, by whichever
   * means this user actually has. Returns { ok } on success, plus
   * `appleCode` on the Apple branch so the caller can revoke the token
   * after the delete succeeds.
   *
   * `{ ok: false }` with no message means "user backed out" (closed the
   * Apple sheet) — the caller stays silent rather than showing red text.
   */
  const runReauth = async () => {
    if (reauthMode === 'password') {
      if (!confirmPassword) return { ok: false, message: 'יש להזין את הסיסמה כדי להמשיך' };
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: confirmPassword,
      });
      if (reauthError) return { ok: false, message: 'הסיסמה לא נכונה. בדוק ונסה שוב.' };
      return { ok: true };
    }

    if (reauthMode === 'otp') {
      // Real proof of identity for an OAuth user with no password: they
      // must control the mailbox. Chosen over a typed word because a typed
      // word proves nothing, and over a full OAuth redirect because that
      // destroys `mode`/`step` mid-flow on a destructive screen.
      if (!otpSent) return { ok: false, message: 'יש לשלוח קוד אימות ולהזין אותו' };
      const code = otpCode.trim();
      if (!code) return { ok: false, message: 'יש להזין את הקוד שנשלח למייל' };
      const { error: otpErr } = await supabase.auth.verifyOtp({
        email: user.email,
        token: code,
        type: 'email',
      });
      if (otpErr) return { ok: false, message: 'הקוד לא נכון או שפג תוקפו. אפשר לשלוח קוד חדש.' };
      return { ok: true };
    }

    if (reauthMode === 'word') {
      if (!confirmWord.trim()) return { ok: false, message: `יש להקליד את המילה ${CONFIRM_WORD}` };
      if (confirmWord.trim() !== CONFIRM_WORD) {
        return { ok: false, message: `המילה לא תואמת. הקלד ${CONFIRM_WORD} בדיוק כפי שמופיע.` };
      }
      return { ok: true };
    }

    if (reauthMode === 'unverifiable') {
      // Fail closed. We could not identify a single way to verify this
      // account, so we refuse rather than fall back to something weaker.
      return { ok: false, message: 'לא הצלחנו לאמת את החשבון. כתוב לנו ל-support@car-reminder.app ונטפל בזה.' };
    }

    // Apple: the native sheet both proves identity (via signInWithIdToken,
    // exactly as the login screen does) and hands back the authorizationCode
    // we need for the revoke call.
    let result;
    try {
      result = await SignInWithApple.authorize({
        clientId: 'com.carreminders.app',
        redirectURI: 'https://zuqvolqapwcxomuzoodu.supabase.co/auth/v1/callback',
        scopes: 'email name',
      });
    } catch {
      // Dismissing the sheet lands here too, and that is not a failure —
      // the user simply changed their mind.
      return { ok: false };
    }
    const idToken = result?.response?.identityToken;
    if (!idToken) return { ok: false, message: 'ההזדהות מול Apple לא הושלמה. נסה שוב.' };
    const { error: idErr } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: idToken });
    if (idErr) return { ok: false, message: 'ההזדהות מול Apple לא הושלמה. נסה שוב.' };
    return { ok: true, appleCode: result?.response?.authorizationCode || null };
  };

  /**
   * Best-effort Apple token revocation. Guideline 5.1.1(v) requires it, but
   * a failure here must NOT block the deletion the user asked for — and it
   * must not be surfaced either: "we couldn't revoke your Apple token" means
   * nothing to a person and only frightens them. It is logged instead, so a
   * silently broken revoke shows up as a compliance signal rather than
   * disappearing.
   */
  const revokeAppleToken = async (authorizationCode) => {
    if (!authorizationCode) {
      reportError('apple_revoke_missing_code', new Error('no authorizationCode from Apple sheet'));
      return;
    }
    try {
      const { error: fnErr } = await supabase.functions.invoke('apple-revoke', {
        body: { authorizationCode },
      });
      if (fnErr) reportError('apple_revoke_failed', fnErr);
    } catch (e) {
      reportError('apple_revoke_failed', e);
    }
  };

  /** Emails a one-time code. Separate from handleDelete so sending a code
   *  is never a step toward deleting anything by itself. */
  const sendOtp = async () => {
    setError('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('אין חיבור לאינטרנט. שליחת הקוד דורשת חיבור.');
      return;
    }
    setOtpSending(true);
    try {
      // shouldCreateUser:false — this is verification of an existing
      // account, never a signup path.
      const { error: sendErr } = await supabase.auth.signInWithOtp({
        email: user.email,
        options: { shouldCreateUser: false },
      });
      if (sendErr) {
        setError('שליחת הקוד נכשלה. נסה שוב.');
      } else {
        setOtpSent(true);
      }
    } catch {
      setError('שליחת הקוד נכשלה. נסה שוב.');
    }
    setOtpSending(false);
  };

  const handleDelete = async () => {
    setError('');
    setOwnershipBlocked(false);

    // All three branches need the network. Checking up front beats letting
    // the user tap into a failure they can't act on.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('אין חיבור לאינטרנט. ההזדהות דורשת חיבור, נסה שוב כשהוא יחזור.');
      return;
    }

    setReauthPending(true);
    let reauth;
    try {
      reauth = await runReauth();
    } catch {
      setReauthPending(false);
      setError('ההזדהות לא הושלמה. נסה שוב.');
      return;
    }
    setReauthPending(false);
    if (!reauth.ok) {
      if (reauth.message) setError(reauth.message);
      return;
    }

    setStep('deleting');
    try {
      // Single atomic server-side call. The old client-side loop had two
      // problems: (a) `.eq('vehicle_id', vehicles.map(...))` silently did
      // nothing when passed an array, leaving cork_notes orphaned; and
      // (b) running ~20 DELETEs serially with no transaction meant a
      // mid-flight failure could leave partial state. The RPC does
      // everything in one BEGIN/COMMIT and returns counts.
      const { error: rpcErr } = await dal.run('account.deleteMine', { mode });
      if (rpcErr) throw rpcErr;

      // Revoke AFTER the delete succeeded and BEFORE signOut: revoking first
      // would strip the Apple link even when the delete then fails, and
      // revoking after signOut would have no session left to authorize the
      // edge function. Only meaningful when the account itself is going away.
      if (mode === 'account' && reauth.appleCode) {
        await revokeAppleToken(reauth.appleCode);
      }

      // Both modes: the on-disk query snapshot still holds the rows that were
      // just deleted server-side. localStorage.clear() below does NOT touch
      // IndexedDB, so without this the UI would rehydrate ghost vehicles and
      // documents that no longer exist.
      await clearPersistedCache();

      if (mode === 'account') {
        // Account is gone — wipe everything and sign the user out so
        // the app can't keep using a session that no longer maps to a
        // membership row.
        localStorage.clear();
        await supabase.auth.signOut();
      } else {
        // mode='data' — the user is still signed in, the account+
        // membership stay. Wipe only app-local caches so stale
        // vehicle/document/notification ids don't linger; KEEP the
        // supabase auth keys (sb-…-auth-token), otherwise the next
        // page-load thinks the user is logged out and the dashboard
        // hangs on 'not_authenticated' from ensure_user_account.
        try {
          const PRESERVE_PREFIXES = ['sb-', 'cr_remember_me_v1', 'cr_pending_recovery_'];
          const toRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (PRESERVE_PREFIXES.some(p => k.startsWith(p))) continue;
            toRemove.push(k);
          }
          toRemove.forEach(k => localStorage.removeItem(k));
        } catch {}
      }
      setStep('done');
    } catch (err) {
      console.error('Delete error:', err);
      const msg = err?.message || '';
      if (msg.includes('must_transfer_ownership')) {
        // The user owns a business account that still has other active
        // members. Deleting would orphan/destroy a shared fleet, so the
        // server blocks it. They must transfer ownership (or remove the
        // members) first — surface a CTA straight to the transfer screen.
        setError('');
        setOwnershipBlocked(true);
      } else {
        // "לא בוצעה" and not "נכשלה": the RPC is one BEGIN/COMMIT, so
        // nothing partial can survive a failure. Saying so explicitly is
        // what stops a user from panicking on an irreversible screen.
        setError('המחיקה לא בוצעה ולא נמחק דבר. נסה שוב, ואם זה חוזר כתוב לנו ל-support@car-reminder.app');
      }
      setStep('confirm');
    }
  };

  return (
    <div dir="rtl" className="max-w-md mx-auto py-8 px-4">
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-6 text-sm font-bold" style={{ color: C.primary }}>
        <ArrowRight className="w-4 h-4" /> חזרה
      </button>

      {step === 'choose' && (
        <div className="space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2" style={{ color: C.gray800 }}>מחיקת חשבון ונתונים</h1>
            <p className="text-sm" style={{ color: C.gray500 }}>
              אפשר למחוק את הנתונים או את החשבון כולו, בכל עת.
              <br />בחר מה לעשות:
            </p>
          </div>

          {/* Option 1: Delete data only */}
          <button onClick={() => { setMode('data'); setStep('confirm'); }}
            className="w-full rounded-2xl p-5 text-right transition-all active:scale-[0.99]"
            style={{ background: C.yellowSoft, border: `1.5px solid ${C.warnBorder}` }}>
            <div className="flex items-center gap-3 mb-2">
              <FileX className="w-6 h-6" style={{ color: C.warn }} />
              <span className="text-base font-bold" style={{ color: C.warnDark }}>מחק את הנתונים שלי</span>
            </div>
            <p className="text-xs" style={{ color: C.warnMid }}>
              מוחק את כל הרכבים, המסמכים, הטיפולים והפוסטים שלך. החשבון נשאר פעיל ואפשר להתחיל מחדש.
            </p>
          </button>

          {/* Option 2: Delete account */}
          <button onClick={() => { setMode('account'); setStep('confirm'); }}
            className="w-full rounded-2xl p-5 text-right transition-all active:scale-[0.99]"
            style={{ background: C.errorBg, border: `1.5px solid ${C.errorBorder}` }}>
            <div className="flex items-center gap-3 mb-2">
              <Trash2 className="w-6 h-6" style={{ color: C.error }} />
              <span className="text-base font-bold" style={{ color: C.errorDark }}>מחק את החשבון לצמיתות</span>
            </div>
            <p className="text-xs" style={{ color: C.error }}>
              מוחק את החשבון, כל הנתונים, הרכבים, המסמכים והפוסטים. לא ניתן לשחזר, ותנותק מהאפליקציה.
            </p>
          </button>

          <div className="text-center">
            <p className="text-[10px]" style={{ color: C.gray400 }}>
              לשאלות: support@car-reminder.app
            </p>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: mode === 'account' ? C.errorBg : C.yellowSoft }}>
              <AlertTriangle className="w-8 h-8" style={{ color: mode === 'account' ? C.error : C.warn }} />
            </div>
            <h2 className="text-xl font-bold mb-2">
              {mode === 'account' ? 'למחוק את החשבון לצמיתות?' : 'למחוק את כל הנתונים?'}
            </h2>
            <p className="text-sm" style={{ color: C.gray500 }}>
              {mode === 'account'
                ? 'כל הנתונים שלך יימחקו לצמיתות. לא ניתן לשחזר.'
                : 'כל הרכבים, המסמכים, הטיפולים והפוסטים שלך יימחקו. החשבון ישאר פעיל.'}
            </p>
          </div>

          {/* 2. What gets deleted. Deliberately ABOVE the identity gate:
                 asking someone to prove who they are before showing them
                 what they stand to lose gets the order backwards. */}
          <div className="space-y-3">
            <p className="text-xs font-bold" style={{ color: C.gray500 }}>הנתונים הבאים יימחקו:</p>
            <ul className="list-disc text-xs space-y-1 pe-5" style={{ color: C.gray500 }}>
              <li>כל הרכבים וכלי השייט</li>
              <li>מסמכים: ביטוח, רישיון ועוד</li>
              <li>טיפולים ותיקונים</li>
              <li>פוסטים ותגובות בקהילה</li>
              <li>לייקים ופריטים שמורים</li>
              <li>הפרופיל ורישיון הנהיגה</li>
              {mode === 'account' && (
                <li className="font-bold" style={{ color: C.error }}>החשבון עצמו</li>
              )}
            </ul>
          </div>

          {/* 3. Identity gate, OR the blocked state that replaces it. */}
          {ownershipBlocked ? (
            <div className="rounded-2xl p-5 space-y-4" style={{ background: C.warnSubtle, border: `1px solid ${C.warnBorder}` }}>
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-6 h-6 shrink-0" style={{ color: C.warn }} />
                <div className="space-y-1.5">
                  <p className="text-base font-bold" style={{ color: C.warnDark }}>אי-אפשר למחוק כרגע</p>
                  {/* The "why" is the point. Without it the block reads as
                      arbitrary; with it, it reads as protecting other people,
                      which is what it actually is. */}
                  <p className="text-xs leading-relaxed" style={{ color: C.warnMid }}>
                    אתה הבעלים של חשבון עסקי שיש בו אנשי צוות פעילים.
                    מחיקת החשבון שלך תשאיר אותם בלי גישה, ולכן צריך קודם
                    להעביר את הבעלות לאיש צוות אחר, או להסיר את אנשי הצוות.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => navigate(createPageUrl('BusinessSettings'))}
                  className="flex-1 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98]"
                  style={{ background: C.warn, minHeight: 48 }}
                >
                  העבר בעלות
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('choose'); setMode(null); setError(''); setOwnershipBlocked(false); }}
                  className="px-6 rounded-2xl font-bold text-sm"
                  style={{ color: C.gray500, background: C.gray100, minHeight: 48 }}
                >
                  חזרה
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl p-4 space-y-3" style={{ background: C.gray50, border: `1px solid ${C.gray200}` }}>
                <p className="text-sm font-bold" style={{ color: C.gray700 }}>אישור זהות</p>

                {reauthMode === null && (
                  /* Provider not resolved yet. A skeleton beats a button that
                     flickers between branches on a destructive screen. */
                  <div className="h-11 rounded-xl animate-pulse" style={{ background: C.gray200 }} />
                )}

                {reauthMode === 'password' && (
                  <>
                    <p className="text-xs" style={{ color: C.gray500 }}>הזן את הסיסמה שלך כדי להמשיך</p>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                      className="w-full px-4 rounded-xl text-sm font-bold border"
                      style={{ borderColor: C.gray200, background: C.bg, minHeight: 48 }}
                      placeholder="הסיסמה שלך"
                      dir="ltr"
                    />
                  </>
                )}

                {reauthMode === 'apple' && (
                  <>
                    <p className="text-xs" style={{ color: C.gray500 }}>
                      נבקש ממך להזדהות מול Apple, ומיד לאחר מכן נבצע את המחיקה
                    </p>
                    {/* The label must name the destruction, not just the
                        identification: this one tap authenticates AND
                        deletes, and on an irreversible action a control
                        that promises less than it does is a trap. */}
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={reauthPending}
                      className="w-full rounded-xl font-bold text-sm border transition-all active:scale-[0.99] disabled:opacity-60"
                      style={{ background: C.bg, borderColor: C.gray300, color: C.text, minHeight: 48 }}
                    >
                      {reauthPending
                        ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> מזדהה...</span>
                        : (mode === 'account' ? 'הזדהה עם Apple ומחק את החשבון' : 'הזדהה עם Apple ומחק את הנתונים')}
                    </button>
                  </>
                )}

                {reauthMode === 'otp' && (
                  <>
                    {/* Saying WHY there is no password. Without this line a
                        user who expects a password field assumes a bug. */}
                    <p className="text-xs leading-relaxed" style={{ color: C.gray500 }}>
                      אין לך סיסמה באפליקציה, ולכן נאמת אותך בקוד חד-פעמי
                      שיישלח ל־<span dir="ltr" className="font-bold" style={{ color: C.text }}>{user.email}</span>
                    </p>
                    {!otpSent ? (
                      <button
                        type="button"
                        onClick={sendOtp}
                        disabled={otpSending}
                        className="w-full rounded-xl font-bold text-sm border transition-all active:scale-[0.99] disabled:opacity-60"
                        style={{ background: C.bg, borderColor: C.gray300, color: C.text, minHeight: 48 }}
                      >
                        {otpSending
                          ? <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> שולח...</span>
                          : 'שלח קוד אימות'}
                      </button>
                    ) : (
                      <>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={otpCode}
                          onChange={(e) => { setOtpCode(e.target.value); setError(''); }}
                          className="w-full px-4 rounded-xl text-sm font-bold border text-center"
                          style={{ borderColor: C.gray200, background: C.bg, minHeight: 48, letterSpacing: '0.3em' }}
                          placeholder="000000"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          onClick={sendOtp}
                          disabled={otpSending}
                          className="text-xs font-bold underline disabled:opacity-60"
                          style={{ color: C.primary }}
                        >
                          {otpSending ? 'שולח...' : 'שלח קוד חדש'}
                        </button>
                      </>
                    )}
                  </>
                )}

                {reauthMode === 'unverifiable' && (
                  /* Fail-closed. No password, no native Apple sheet, and no
                     address we can reach — we refuse rather than accept a
                     gate that proves nothing. */
                  <p className="text-xs leading-relaxed" style={{ color: C.error }}>
                    לא הצלחנו לזהות דרך לאמת את החשבון הזה.
                    כתוב לנו ל־<span dir="ltr">support@car-reminder.app</span> ונטפל בזה ידנית.
                  </p>
                )}

                {reauthMode === 'word' && (
                  <>
                    {/* Reachable only when there is no deliverable address
                        (an Apple relay in the browser). Typing this proves
                        INTENT, not identity — it is the weakest gate and
                        deliberately the last resort, never a default. */}
                    <p className="text-xs leading-relaxed" style={{ color: C.gray500 }}>
                      אין לך סיסמה באפליקציה, וכתובת המייל שלך מוסתרת דרך Apple
                      ולכן לא נוכל לשלוח אליה קוד.
                      כדי להמשיך, הקלד את המילה <strong style={{ color: C.text }}>{CONFIRM_WORD}</strong>
                    </p>
                    <input
                      type="text"
                      autoComplete="off"
                      value={confirmWord}
                      onChange={(e) => { setConfirmWord(e.target.value); setError(''); }}
                      className="w-full px-4 rounded-xl text-sm font-bold border"
                      style={{ borderColor: C.gray200, background: C.bg, minHeight: 48 }}
                      placeholder={CONFIRM_WORD}
                    />
                  </>
                )}

                {/* Errors live inside the gate, next to what failed. */}
                {error && (
                  <p role="alert" className="text-xs font-bold leading-relaxed" style={{ color: C.error }}>
                    {error}
                  </p>
                )}
              </div>

              {/* 4. The action. On the Apple branch the sheet button above IS
                     the trigger, so a second delete button would be a second
                     way to start the same irreversible thing. */}
              <div className="flex gap-3">
                {reauthMode !== 'apple' && (
                  <button onClick={handleDelete}
                    disabled={reauthPending || reauthMode === null || reauthMode === 'unverifiable'}
                    className="flex-1 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98] disabled:opacity-50"
                    style={{ background: mode === 'account' ? C.error : C.warn, minHeight: 52 }}>
                    {reauthPending ? (
                      <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> מאמת...</span>
                    ) : (
                      mode === 'account' ? 'מחק חשבון לצמיתות' : 'מחק את כל הנתונים'
                    )}
                  </button>
                )}
                <button
                  onClick={() => { setStep('choose'); setMode(null); setError(''); setConfirmPassword(''); setConfirmWord(''); setOtpCode(''); setOtpSent(false); }}
                  className={`${reauthMode === 'apple' ? 'flex-1' : 'px-6'} rounded-2xl font-bold text-sm`}
                  style={{ color: C.gray500, background: C.gray100, minHeight: 52 }}>
                  ביטול
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'deleting' && (
        <div className="text-center py-16">
          <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin" style={{ color: C.error }} />
          <p className="text-base font-bold" style={{ color: C.gray800 }}>{mode === 'account' ? 'מוחק את החשבון...' : 'מוחק את הנתונים...'}</p>
          <p className="text-sm mt-1" style={{ color: C.gray400 }}>זה עשוי לקחת מספר שניות</p>
        </div>
      )}

      {step === 'done' && (
        <div className="text-center py-16">
          <CheckCircle className="w-14 h-14 mx-auto mb-4" style={{ color: C.successBright }} />
          <h2 className="text-xl font-bold mb-2" style={{ color: C.gray800 }}>
            {mode === 'account' ? 'החשבון נמחק' : 'הנתונים נמחקו'}
          </h2>
          <p className="text-sm mb-6" style={{ color: C.gray500 }}>
            {mode === 'account'
              ? 'כל הנתונים שלך נמחקו. אם תרצה, תמיד אפשר ליצור חשבון חדש.'
              : 'כל הנתונים שלך נמחקו. החשבון עדיין פעיל ואפשר להתחיל מחדש.'}
          </p>
          <button onClick={() => {
            if (mode === 'account') window.location.href = '/';
            else navigate(createPageUrl('Dashboard'));
          }}
            className="px-8 py-3 rounded-2xl font-bold text-white" style={{ background: C.primary }}>
            {mode === 'account' ? 'לדף הבית' : 'חזרה למערכת'}
          </button>
        </div>
      )}
    </div>
  );
}
