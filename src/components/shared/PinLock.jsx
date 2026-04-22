import React, { useEffect, useRef, useState } from 'react';
import { Lock, Delete, ShieldCheck, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { tryUnlock, clearPin, isPinEnabled, isStillUnlocked, setPin, lockNow } from '@/lib/pinLock';
import { hapticFeedback } from '@/lib/capacitor';
import { supabase } from '@/lib/supabase';
import logo from '@/assets/logo.png';

const PIN_LENGTH = 4;

//  Keypad row 
function KeypadBtn({ value, onPress, icon, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onPress(value)}
      disabled={disabled}
      aria-label={icon ? (value === 'del' ? 'מחק ספרה' : '') : `הזן ${value}`}
      className="h-16 rounded-2xl font-black text-2xl transition-all active:scale-95 disabled:opacity-30"
      style={{
        background: icon ? 'transparent' : '#F3F4F6',
        color: '#1C2E20',
        border: icon ? 'none' : '1px solid #E5E7EB',
      }}>
      {icon ? icon : value}
    </button>
  );
}

//  Dot indicator 
function Dots({ length, total, shake }) {
  return (
    <div
      className={`flex justify-center gap-3 ${shake ? 'animate-shake' : ''}`}
      aria-label={`${length} מתוך ${total} ספרות הוזנו`}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="rounded-full transition-all"
          style={{
            width: 14, height: 14,
            background: i < length ? '#2D5233' : 'transparent',
            border: '2px solid ' + (i < length ? '#2D5233' : '#D1D5DB'),
          }} />
      ))}
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
          toast.error('הקודים לא תואמים, נסה שוב');
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
      toast.error('יותר מדי ניסיונות כושלים. יש להתחבר מחדש');
      try { await supabase.auth.signOut(); } catch {}
      onCancel?.();
      return;
    }
    if (res.reason === 'locked_out') {
      const sec = Math.ceil((res.lockoutMsRemaining || 30000) / 1000);
      setLockoutSec(sec);
      toast.error(`יותר מדי ניסיונות. המתן ${sec} שניות`);
      return;
    }
    if (res.attemptsRemaining !== undefined) {
      toast.error(`קוד שגוי. ${res.attemptsRemaining} ניסיונות נותרו`);
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
      style={{ background: 'linear-gradient(180deg, #2D5233 0%, #1C3620 100%)' }}>
      {/* Logo + title */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-2xl overflow-hidden mb-4" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
          <img src={logo} alt="CarReminder" className="w-full h-full object-contain" />
        </div>
        <h1 id="pin-title" className="text-xl font-black text-white mb-1">{title}</h1>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>{subtitle}</p>
      </div>

      {/* Dots */}
      <div className="mb-8">
        <Dots length={entered.length} total={PIN_LENGTH} shake={shake} />
        {lockoutSec > 0 && (
          <p className="text-center text-xs font-bold mt-3" style={{ color: '#FCA5A5' }}>
            חסום לעוד {lockoutSec} שניות
          </p>
        )}
      </div>

      {/* Keypad */}
      <div className="w-full max-w-[260px] grid grid-cols-3 gap-2.5 mb-6">
        {keys.map(k => <KeypadBtn key={k} value={k} onPress={onPress} disabled={lockoutSec > 0} />)}
        <div />
        <KeypadBtn value="0" onPress={onPress} disabled={lockoutSec > 0} />
        <KeypadBtn value="del" onPress={onPress} disabled={lockoutSec > 0}
          icon={<Delete className="w-5 h-5 mx-auto" style={{ color: '#fff' }} aria-hidden="true" />} />
      </div>

      {/* Actions */}
      {mode === 'unlock' ? (
        <button onClick={handleForgot}
          className="text-sm font-bold transition-colors px-4 py-2"
          style={{ color: 'rgba(255,255,255,0.85)' }}>
          שכחתי קוד
        </button>
      ) : (
        <button onClick={onCancel}
          className="text-sm font-bold transition-colors px-4 py-2"
          style={{ color: 'rgba(255,255,255,0.85)' }}>
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
    // Re-check on app foreground (native + web)
    const check = () => {
      if (document.visibilityState === 'visible' && isPinEnabled() && !isStillUnlocked()) {
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);

    // Lock when the app goes to background on native
    let capCleanup = null;
    import('@capacitor/core').then(({ Capacitor }) => {
      if (!Capacitor.isNativePlatform()) return;
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
