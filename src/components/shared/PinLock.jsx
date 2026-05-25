import React, { useEffect, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { tryUnlock, clearPin, isPinEnabled, isStillUnlocked, setPin, lockNow } from '@/lib/pinLock';
import { hapticFeedback } from '@/lib/capacitor';
import { supabase } from '@/lib/supabase';
import logo from '@/assets/logo.png';

const PIN_LENGTH = 4;

//  Keypad row
// Glass-morphism button on the dark PIN background. Light surface gives
// the premium "iOS lock screen" feel that the user explicitly asked
// for — neutral grays on a brand-green page used to read as a default
// component dump.
function KeypadBtn({ value, onPress, icon, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onPress(value)}
      disabled={disabled}
      aria-label={icon ? (value === 'del' ? 'מחק ספרה' : '') : `הזן ${value}`}
      className="h-[68px] rounded-2xl font-semibold text-[26px] transition-all active:scale-95 disabled:opacity-30"
      style={{
        // Frosted-glass surface. Subtle white tint sits readably over
        // the dark gradient and uses backdrop-filter to pick up the
        // bg, giving the keypad a premium depth instead of looking
        // like a flat overlay. Icon ('del') stays transparent so the
        // delete affordance reads as ghost rather than a button —
        // matches Apple's lock-screen conventions.
        background: icon ? 'transparent' : 'rgba(255,255,255,0.08)',
        color: '#fff',
        border: icon ? 'none' : '1px solid rgba(255,255,255,0.14)',
        backdropFilter: icon ? 'none' : 'blur(10px)',
        WebkitBackdropFilter: icon ? 'none' : 'blur(10px)',
        boxShadow: icon ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.08)',
      }}>
      {icon ? icon : value}
    </button>
  );
}

//  Dot indicator
// Larger (18px) than before for stronger visual rhythm on the dark BG,
// with a soft inner glow when filled so the user gets a satisfying
// "tick" feeling per digit press.
function Dots({ length, total, shake }) {
  return (
    <div
      className={`flex justify-center gap-3.5 ${shake ? 'animate-shake' : ''}`}
      aria-label={`${length} מתוך ${total} ספרות הוזנו`}>
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < length;
        return (
          <div key={i} className="rounded-full transition-all duration-200"
            style={{
              width: 18, height: 18,
              background: filled ? '#fff' : 'transparent',
              border: '2px solid ' + (filled ? '#fff' : 'rgba(255,255,255,0.35)'),
              boxShadow: filled ? '0 0 12px rgba(255,255,255,0.45)' : 'none',
              transform: filled ? 'scale(1)' : 'scale(0.9)',
            }} />
        );
      })}
    </div>
  );
}

//  Shake CSS injected once 
function injectShakeCSS() {
  if (document.getElementById('pin-shake-css')) return;
  const style = document.createElement('style');
  style.id = 'pin-shake-css';
  style.textContent = `
    @keyframes pinShake { 0%,100% {transform:translateX(0);} 20% {transform:translateX(-8px);} 40% {transform:translateX(8px);} 60% {transform:translateX(-6px);} 80% {transform:translateX(6px);} }
    .animate-shake { animation: pinShake 0.5s; }
  `;
  document.head.appendChild(style);
}

/**
 * Lock screen. Renders a numeric keypad + PIN dots.
 * In "setup" mode: user enters a new PIN twice to confirm.
 * In "unlock" mode: user enters PIN to pass the gate.
 */
export default function PinLock({ mode = 'unlock', onSuccess, onForgot, onCancel }) {
  const [entered, setEntered] = useState('');
  const [step, setStep] = useState('first'); // setup: first | confirm
  const [firstPin, setFirstPin] = useState('');
  const [shake, setShake] = useState(false);
  const [lockoutSec, setLockoutSec] = useState(0);
  const lockoutTimer = useRef(null);

  useEffect(() => { injectShakeCSS(); }, []);

  // Lockout countdown
  useEffect(() => {
    if (lockoutSec <= 0) return;
    lockoutTimer.current = setTimeout(() => setLockoutSec(s => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(lockoutTimer.current);
  }, [lockoutSec]);

  const trigger = async (nextEntered) => {
    if (mode === 'setup') {
      if (step === 'first') {
        setFirstPin(nextEntered);
        setEntered('');
        setStep('confirm');
      } else {
        if (nextEntered === firstPin) {
          await setPin(nextEntered);
          hapticFeedback('medium');
          toast.success('הקוד נקבע בהצלחה');
          onSuccess?.();
        } else {
          hapticFeedback('heavy');
          setShake(true);
          setTimeout(() => setShake(false), 500);
          toastError('הקודים לא תואמים, נסה שוב', { action: 'pin_mismatch' });
          setEntered('');
          setFirstPin('');
          setStep('first');
        }
      }
      return;
    }

    // unlock mode
    const res = await tryUnlock(nextEntered);
    if (res.ok) {
      hapticFeedback('light');
      onSuccess?.();
      return;
    }
    hapticFeedback('heavy');
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setEntered('');

    if (res.reason === 'too_many_failures') {
      toastError('יותר מדי ניסיונות כושלים. יש להתחבר מחדש', { action: 'pin_too_many_failures' });
      try { await supabase.auth.signOut(); } catch {}
      onCancel?.();
      return;
    }
    if (res.reason === 'locked_out') {
      const sec = Math.ceil((res.lockoutMsRemaining || 30000) / 1000);
      setLockoutSec(sec);
      toastError(`יותר מדי ניסיונות. המתן ${sec} שניות`, { action: 'pin_lockout' });
      return;
    }
    if (res.attemptsRemaining !== undefined) {
      toastError(`קוד שגוי. ${res.attemptsRemaining} ניסיונות נותרו`, { action: 'pin_wrong' });
    }
  };

  const onPress = (v) => {
    if (lockoutSec > 0) return;
    if (v === 'del') {
      hapticFeedback('light');
      setEntered(e => e.slice(0, -1));
      return;
    }
    if (entered.length >= PIN_LENGTH) return;
    hapticFeedback('light');
    const next = entered + v;
    setEntered(next);
    if (next.length === PIN_LENGTH) {
      setTimeout(() => trigger(next), 120); // small delay so the user sees the dot fill
    }
  };

  const handleForgot = async () => {
    if (!confirm('שכחת קוד? זה יבטל את הנעילה ויחזיר אותך למסך ההתחברות.')) return;
    clearPin();
    try { await supabase.auth.signOut(); } catch {}
    onCancel?.();
  };

  const title =
    mode === 'setup' && step === 'first' ? 'בחר קוד נעילה'
    : mode === 'setup' && step === 'confirm' ? 'אשר קוד'
    : 'הזן קוד נעילה';
  const subtitle =
    mode === 'setup' && step === 'first' ? 'זה יקרה בעת פתיחת האפליקציה'
    : mode === 'setup' && step === 'confirm' ? 'הזן שוב את הקוד לוודא התאמה'
    : 'לכניסה מהירה לאפליקציה';

  const keys = ['1','2','3','4','5','6','7','8','9'];

  return (
    <div dir="rtl" role="dialog" aria-modal="true" aria-labelledby="pin-title"
      className="fixed inset-0 z-[10060] flex flex-col items-center justify-center p-6"
      style={{
        // Premium deep-green gradient. Replaces the flatter
        // #2D5233 → #1C3620 ramp — the new stops (#0F1F12 →
        // #1B2E1F → #0A1A0E) deepen the dark side of the gradient
        // and add a third color stop so the page reads as a true
        // dark surface rather than a slightly-shaded brand panel.
        // env(safe-area-inset-*) on the padding keeps the logo +
        // close button clear of the iPhone notch and the home
        // indicator.
        background: 'radial-gradient(circle at 50% 30%, #1B2E1F 0%, #102015 55%, #060E08 100%)',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
      }}>
      {/* Logo + title block. The glow ring around the logo is the
          single "personality moment" of the screen — gives a focal
          point on an otherwise restrained surface. Width sized to
          ~72px so it stays a recognizable affordance without
          dominating on a small phone. */}
      <div className="flex flex-col items-center mb-10">
        <div
          className="relative w-[72px] h-[72px] rounded-2xl overflow-hidden mb-5"
          style={{
            boxShadow: '0 0 60px rgba(118,196,138,0.18), 0 12px 32px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}>
          <img src={logo} alt="CarReminder" className="w-full h-full object-contain" />
        </div>
        <h1 id="pin-title" className="text-[22px] font-bold text-white mb-1.5 tracking-tight">{title}</h1>
        <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.55)' }}>{subtitle}</p>
      </div>

      {/* Dots — kept in their own block with explicit margin so the
          lockout warning doesn't push the keypad around when it
          appears/disappears (inline-block with min-height reservation
          would also work; min-height here is simpler). */}
      <div className="mb-10" style={{ minHeight: 44 }}>
        <Dots length={entered.length} total={PIN_LENGTH} shake={shake} />
        {lockoutSec > 0 && (
          <p className="text-center text-xs font-bold mt-3" style={{ color: '#FCA5A5' }}>
            חסום לעוד {lockoutSec} שניות
          </p>
        )}
      </div>

      {/* Keypad. Slightly wider than before (288 vs 260) so each
          button is a more comfortable 56-58px wide on iPhone SE,
          well above the 44px tap-target minimum. */}
      <div className="w-full max-w-[288px] grid grid-cols-3 gap-3 mb-8">
        {keys.map(k => <KeypadBtn key={k} value={k} onPress={onPress} disabled={lockoutSec > 0} />)}
        <div />
        <KeypadBtn value="0" onPress={onPress} disabled={lockoutSec > 0} />
        <KeypadBtn value="del" onPress={onPress} disabled={lockoutSec > 0}
          icon={<Delete className="w-6 h-6 mx-auto" style={{ color: 'rgba(255,255,255,0.85)' }} aria-hidden="true" />} />
      </div>

      {/* Actions — visually quieter than before (60% white) so they
          read as secondary affordances; the primary action is the
          PIN entry itself. */}
      {mode === 'unlock' ? (
        <button onClick={handleForgot}
          className="text-[13px] font-semibold transition-colors px-4 py-2 hover:text-white"
          style={{ color: 'rgba(255,255,255,0.6)' }}>
          שכחתי קוד
        </button>
      ) : (
        <button onClick={onCancel}
          className="text-[13px] font-semibold transition-colors px-4 py-2 hover:text-white"
          style={{ color: 'rgba(255,255,255,0.6)' }}>
          ביטול
        </button>
      )}
    </div>
  );
}

//  Gate wrapper: shows PinLock if needed, else renders children 
export function PinGate({ children }) {
  const [locked, setLocked] = useState(() => isPinEnabled() && !isStillUnlocked());

  useEffect(() => {
    let isNative = false;
    let capCleanup = null;

    // Re-check on app foreground. Web-only path — on native we
    // DELIBERATELY skip `visibilitychange` + `focus` and rely solely
    // on Capacitor's `appStateChange`. Reason: on Android, pulling
    // down the notification shade temporarily marks the WebView as
    // hidden + dispatches visibilitychange — without the native
    // gating below, the PIN screen would trigger every time the
    // user swiped down to check a notification. `appStateChange`
    // only fires when the OS actually backgrounds the process,
    // which is what we want.
    const check = () => {
      if (isNative) return;  // native path is owned by appStateChange
      if (document.visibilityState === 'visible' && isPinEnabled() && !isStillUnlocked()) {
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);

    // Lock when the app goes to background on native, unlock-check
    // when it comes back. Setting isNative=true above neutralises
    // the web listeners so they don't double-fire.
    import('@capacitor/core').then(({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return;
      isNative = true;
      import('@capacitor/app').then(({ App }) => {
        const p = App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) {
            lockNow();
          } else if (isPinEnabled() && !isStillUnlocked()) {
            setLocked(true);
          }
        });
        capCleanup = () => p.then(l => l.remove());
      }).catch(() => {});
    }).catch(() => {});

    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      if (capCleanup) try { capCleanup(); } catch {}
    };
  }, []);

  if (locked) {
    return <PinLock mode="unlock" onSuccess={() => setLocked(false)} onCancel={() => setLocked(false)} />;
  }
  return children;
}
