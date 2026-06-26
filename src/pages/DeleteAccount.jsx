import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '../components/shared/GuestContext';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { AlertTriangle, Trash2, FileX, Loader2, CheckCircle, ArrowRight } from 'lucide-react';
import { C } from '@/lib/designTokens';

export default function DeleteAccount() {
  const { isAuthenticated, user, isGuest } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('choose'); // choose | confirm | deleting | done
  const [mode, setMode] = useState(null); // 'account' | 'data'
  const [error, setError] = useState('');
  // Re-auth state. Mandatory before any destructive operation so a
  // hijacked session can't delete the user's data without the password.
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reauthPending, setReauthPending] = useState(false);

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

  const handleDelete = async () => {
    setError('');
    // Require a fresh password check. If the user opened this page from a
    // stale or stolen session we still force them to prove possession of the
    // password before anything is deleted.
    if (!confirmPassword) {
      setError('יש להזין סיסמה לאישור');
      return;
    }
    setReauthPending(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: confirmPassword,
      });
      if (reauthError) {
        setReauthPending(false);
        setError('סיסמה שגויה');
        return;
      }
    } catch {
      setReauthPending(false);
      setError('שגיאה באימות הסיסמה');
      return;
    }
    setReauthPending(false);
    setStep('deleting');
    try {
      // Single atomic server-side call. The old client-side loop had two
      // problems: (a) `.eq('vehicle_id', vehicles.map(...))` silently did
      // nothing when passed an array, leaving cork_notes orphaned; and
      // (b) running ~20 DELETEs serially with no transaction meant a
      // mid-flight failure could leave partial state. The RPC does
      // everything in one BEGIN/COMMIT and returns counts.
      const { error: rpcErr } = await supabase.rpc('delete_my_account', { mode });
      if (rpcErr) throw rpcErr;

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
        // members) first. (Transfer UI ships in a later wave.)
        setError('אתה הבעלים של חשבון עסקי עם חברים פעילים. כדי למחוק או לעזוב, יש קודם להעביר את הבעלות לחבר אחר או להסיר את החברים מהחשבון.');
      } else {
        setError('אירעה שגיאה. נסה שוב או פנה לתמיכה.');
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
              CarReminder מאפשרת לך למחוק את הנתונים שלך בכל עת.
              <br />בחר מה ברצונך לעשות:
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
              מוחק את החשבון, כל הנתונים, הרכבים, המסמכים והפוסטים. לא ניתן לשחזר. תנותק מהמערכת.
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
              {mode === 'account' ? 'בטוח שברצונך למחוק את החשבון?' : 'בטוח שברצונך למחוק את כל הנתונים?'}
            </h2>
            <p className="text-sm" style={{ color: C.gray500 }}>
              {mode === 'account'
                ? 'כל הנתונים שלך יימחקו לצמיתות. לא ניתן לשחזר.'
                : 'כל הרכבים, המסמכים, הטיפולים והפוסטים שלך יימחקו. החשבון ישאר פעיל.'}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl text-center text-sm font-bold" style={{ background: C.errorBg, color: C.error }}>
              {error}
            </div>
          )}

          {/* Re-auth gate. Deletion is destructive and irreversible; require
              the account password every time, even if the session is fresh. */}
          <div className="space-y-2">
            <label className="text-xs font-bold block" style={{ color: C.gray500 }}>
              הזן סיסמה לאישור
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm font-bold border"
              style={{ borderColor: C.gray200, background: C.gray50 }}
              placeholder="הסיסמה שלך"
              dir="ltr"
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold" style={{ color: C.gray500 }}>הנתונים הבאים יימחקו:</p>
            <ul className="text-xs space-y-1" style={{ color: C.gray400 }}>
              <li>- כל כלי הרכב וכלי השייט</li>
              <li>- מסמכים (ביטוח, רישיון, וכו')</li>
              <li>- טיפולים ותיקונים</li>
              <li>- פוסטים ותגובות בקהילה</li>
              <li>- לייקים ושמירות</li>
              <li>- פרופיל אישי ורישיון נהיגה</li>
              {mode === 'account' && <li className="font-bold text-red-500">- החשבון עצמו (ייסגר)</li>}
            </ul>
          </div>

          <div className="flex gap-3">
            <button onClick={handleDelete}
              disabled={reauthPending || !confirmPassword}
              className="flex-1 py-3.5 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: mode === 'account' ? C.error : C.warn }}>
              {reauthPending ? (
                <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> מאמת...</span>
              ) : (
                mode === 'account' ? 'מחק חשבון לצמיתות' : 'מחק את כל הנתונים'
              )}
            </button>
            <button onClick={() => { setStep('choose'); setMode(null); setError(''); setConfirmPassword(''); }}
              className="px-6 py-3.5 rounded-2xl font-bold text-sm" style={{ color: C.gray500, background: C.gray100 }}>
              ביטול
            </button>
          </div>
        </div>
      )}

      {step === 'deleting' && (
        <div className="text-center py-16">
          <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin" style={{ color: C.error }} />
          <p className="text-base font-bold" style={{ color: C.gray800 }}>מוחק נתונים...</p>
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
