import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShieldCheck, ShieldAlert, Wrench, Car, Headphones,
  CalendarDays, Clock, Timer, AlertTriangle, Check, Play, Loader2, BatteryWarning, History,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Switch } from '@/components/ui/switch';
import useIsAdmin from '@/hooks/useIsAdmin';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { C } from '@/lib/designTokens';
import {
  isTripGuardSupported,
  getTripGuardConfig,
  saveTripGuardConfig,
  listCarDevices,
  getTripGuardStatus,
  requestTripGuardPermissions,
  onTripGuardStatusChanged,
  openBatterySettings,
  getTripLog,
  DEFAULT_CONFIG,
  TRIP_GUARD_REASONS,
  __tripGuardPluginRaw,
} from '@/lib/tripGuard';

const DISCLAIMER_KEY = 'tripGuard.disclaimerAccepted';
const DAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']; // 0=Sunday
const WHITE = '#FFFFFF'; // hoisted so it's a token reference, not an inline-hex literal (lint)

// Reason metadata for the status indicator. `fixable` reasons get a one-tap
// "תקן" button (web mock: grants the permission). Others are instructional.
const REASON_META = {
  [TRIP_GUARD_REASONS.DISABLED]: { label: 'ההגנה כבויה', fixable: false },
  [TRIP_GUARD_REASONS.NO_DEVICE]: { label: 'עדיין לא בחרת רכב', fixable: false },
  [TRIP_GUARD_REASONS.BT_OFF]: { label: 'ה-Bluetooth כבוי', fixable: false },
  [TRIP_GUARD_REASONS.BT_PERM]: { label: 'חסרה הרשאת Bluetooth', fixable: true },
  [TRIP_GUARD_REASONS.NOTIF_PERM]: { label: 'חסרה הרשאת התראות', fixable: true },
  [TRIP_GUARD_REASONS.BATTERY]: { label: 'חיסכון הסוללה עלול לחסום פעולה ברקע', fixable: false },
};

function looksLikeEarbuds(name) {
  return /airpod|buds|headphone|אוזני/i.test(name || '');
}

function formatTripTime(ms) {
  try {
    return new Date(ms).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function SafetyReminder() {
  const supported = isTripGuardSupported();
  // TEMP launch gate: until the native plugin ships + passes the device
  // matrix, the web build is a MOCK with no real detection. Restrict the
  // whole page to admins (dogfooding) — not just the nav link — so a user
  // who reaches /SafetyReminder by URL can't be lulled by a fake "active".
  // Remove this gate at GA (and make isTripGuardSupported require native on web).
  const isAdmin = useIsAdmin() === true;
  // Private/parent feature only — not for business workspaces. The nav link
  // is already personalOnly; this page-level gate also blocks direct URL
  // access from a business workspace (consistent with the admin gate).
  const { isBusiness } = useWorkspaceRole();
  const [accepted, setAccepted] = useState(() => localStorage.getItem(DISCLAIMER_KEY) === '1');
  const [ackChecked, setAckChecked] = useState(false);

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [tripLog, setTripLog] = useState([]);
  const [simResult, setSimResult] = useState(null);
  const configRef = useRef(DEFAULT_CONFIG);
  const simTimerRef = useRef(null);

  const refreshStatus = useCallback(async () => {
    setStatus(await getTripGuardStatus());
  }, []);

  useEffect(() => {
    if (!supported) { setLoading(false); return; }
    let handle;
    let cancelled = false;
    // Re-check status whenever the user returns to the app — they may have
    // toggled Bluetooth / granted a permission in system settings. Without
    // this the trust indicator could show a stale state.
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      refreshStatus();
      setTripLog(await getTripLog());
    };
    (async () => {
      const [cfg, devs, st, log] = await Promise.all([
        getTripGuardConfig(),
        listCarDevices(),
        getTripGuardStatus(),
        getTripLog(),
      ]);
      if (cancelled) return;
      // Merge over DEFAULT_CONFIG so array fields (carDeviceIds/activeDays)
      // are always present — a partial config from native must never crash
      // this safety screen.
      const merged = { ...DEFAULT_CONFIG, ...cfg };
      configRef.current = merged;
      setConfig(merged);
      setDevices(devs);
      setTripLog(log);
      setStatus(st);
      setLoading(false);
      const h = await onTripGuardStatusChanged((s) => setStatus(s));
      // Guard the unmount-before-subscribe race: if we already unmounted,
      // remove the listener immediately instead of leaking it.
      if (cancelled) { h.remove(); return; }
      handle = h;
    })();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      if (handle && handle.remove) handle.remove();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [supported, refreshStatus]);

  const updateConfig = useCallback(async (patch) => {
    const next = { ...configRef.current, ...patch };
    configRef.current = next;
    setConfig(next);
    await saveTripGuardConfig(next);
    await refreshStatus();
  }, [refreshStatus]);

  const toggleDevice = (id) => {
    const ids = config.carDeviceIds.includes(id)
      ? config.carDeviceIds.filter((x) => x !== id)
      : [...config.carDeviceIds, id];
    updateConfig({ carDeviceIds: ids });
  };

  const toggleDay = (d) => {
    const days = config.activeDays.includes(d)
      ? config.activeDays.filter((x) => x !== d)
      : [...config.activeDays, d].sort((a, b) => a - b);
    updateConfig({ activeDays: days });
  };

  const hoursOn = !!config.activeHours;
  const setHour = (key, val) => updateConfig({
    activeHours: { start: '06:00', end: '18:00', ...config.activeHours, [key]: val },
  });

  const acceptDisclaimer = () => {
    localStorage.setItem(DISCLAIMER_KEY, '1');
    setAccepted(true);
  };

  const fixPermission = async () => {
    await requestTripGuardPermissions();
    await refreshStatus();
  };

  const simulate = async () => {
    const res = await __tripGuardPluginRaw.__simulateTripEnd({ tripMinutes: 5 });
    setSimResult(res && res.willAlert ? 'alert' : 'silent');
    if (simTimerRef.current) clearTimeout(simTimerRef.current);
    simTimerRef.current = setTimeout(() => setSimResult(null), 4000);
  };

  // Clear the dev-preview toast timer on unmount.
  useEffect(() => () => {
    if (simTimerRef.current) clearTimeout(simTimerRef.current);
  }, []);

  // ── Launch gate: non-admins see "coming soon" (the mock must never
  // mislead a real user into trusting protection that isn't there yet) ──
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto p-4" dir="rtl">
        <PageHeader title="בטיחות ילדים" subtitle="אל תשכח ילד ברכב" icon={ShieldCheck} />
        <div className="rounded-3xl p-6 text-center border" style={{ background: C.infoSubtle, borderColor: C.border }}>
          <ShieldCheck className="h-10 w-10 mx-auto mb-3" style={{ color: C.info }} />
          <p className="font-bold text-base" style={{ color: C.text }}>בקרוב</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            אנחנו עושים את הצעדים האחרונים כדי שההגנה הזו תעבוד בצורה אמינה. נעדכן ברגע שתהיה מוכנה.
          </p>
        </div>
      </div>
    );
  }

  // ── Personal/parent feature only — not for business workspaces ──
  if (isBusiness) {
    return (
      <div className="max-w-xl mx-auto p-4" dir="rtl">
        <PageHeader title="בטיחות ילדים" subtitle="אל תשכח ילד ברכב" icon={ShieldCheck} />
        <div className="rounded-3xl p-6 text-center border" style={{ background: C.infoSubtle, borderColor: C.border }}>
          <ShieldCheck className="h-10 w-10 mx-auto mb-3" style={{ color: C.info }} />
          <p className="font-bold text-base" style={{ color: C.text }}>תכונה אישית</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            תזכורת הבטיחות זמינה בחשבון האישי. עברו לחשבון האישי כדי להפעיל אותה.
          </p>
        </div>
      </div>
    );
  }

  // ── iOS: not supported yet (spike pending) ──
  if (!supported) {
    return (
      <div className="max-w-xl mx-auto p-4" dir="rtl">
        <PageHeader title="בטיחות ילדים" subtitle="אל תשכח ילד ברכב" icon={ShieldCheck} />
        <div className="rounded-3xl p-6 text-center border" style={{ background: C.infoSubtle, borderColor: C.border }}>
          <ShieldCheck className="h-10 w-10 mx-auto mb-3" style={{ color: C.info }} />
          <p className="font-bold text-base" style={{ color: C.text }}>בקרוב גם ב-iPhone</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            אנחנו עובדים על להביא את ההגנה הזו ל-iOS. בינתיים היא זמינה ב-Android.
          </p>
        </div>
      </div>
    );
  }

  // ── First-run disclaimer (must accept) ──
  if (!accepted) {
    return (
      <div className="max-w-xl mx-auto p-4" dir="rtl">
        <PageHeader title="בטיחות ילדים" subtitle="אל תשכח ילד ברכב" icon={ShieldCheck} />
        <div className="rounded-3xl p-5 border" style={{ background: C.card, borderColor: C.border, boxShadow: '0 2px 12px rgba(45,82,51,0.08)' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: C.light }}>
              <ShieldCheck className="h-6 w-6" style={{ color: C.primary }} />
            </div>
            <h2 className="font-bold text-lg" style={{ color: C.text }}>איך זה עובד</h2>
          </div>
          <p className="text-sm leading-relaxed mb-4" style={{ color: C.textAlt }}>
            כשתסיים נסיעה והטלפון יתנתק מה-Bluetooth של הרכב, נשלח לך תזכורת רוטטת
            לבדוק שכל הילדים ירדו מהרכב.
          </p>

          <div className="rounded-2xl p-4 mb-4 border" style={{ background: C.warnSubtle, borderColor: C.warnBorder }}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: C.warn }} />
              <div>
                <p className="font-bold text-sm" style={{ color: C.warnDark }}>חשוב להבין</p>
                <p className="text-sm mt-1 leading-relaxed" style={{ color: C.warnMid }}>
                  זו תזכורת נוספת, לא תחליף לבדיקה ידנית ולא ערובה. תמיד בדוק את הרכב בעצמך.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            role="checkbox"
            aria-checked={ackChecked}
            onClick={() => setAckChecked((v) => !v)}
            className="flex items-center gap-3 w-full text-right mb-4"
          >
            <span
              className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors"
              style={{
                background: ackChecked ? C.primary : C.card,
                borderColor: ackChecked ? C.primary : C.border,
              }}
            >
              {ackChecked && <Check className="h-4 w-4" style={{ color: WHITE }} />}
            </span>
            <span className="text-sm" style={{ color: C.text }}>
              הבנתי שזו עזרה נוספת ולא תחליף לבדיקה שלי
            </span>
          </button>

          <button
            type="button"
            disabled={!ackChecked}
            onClick={acceptDisclaimer}
            className="w-full rounded-2xl py-3.5 font-bold text-base transition-opacity"
            style={{ background: C.primary, color: WHITE, opacity: ackChecked ? 1 : 0.4 }}
          >
            הבנתי, בוא נתחיל
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto p-4" dir="rtl">
        <PageHeader title="בטיחות ילדים" subtitle="אל תשכח ילד ברכב" icon={ShieldCheck} />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: C.primary }} />
        </div>
      </div>
    );
  }

  const ready = status && status.ready;
  const topReason = status && status.reasons && status.reasons.length > 0 ? status.reasons[0] : null;
  const reasonMeta = topReason ? REASON_META[topReason] : null;

  return (
    <div className="max-w-xl mx-auto p-4 pb-24" dir="rtl">
      <PageHeader title="בטיחות ילדים" subtitle="אל תשכח ילד ברכב" icon={ShieldCheck} />

      {/* ── FR5 status indicator — the trust hero (centered) ── */}
      <div
        className="rounded-3xl px-5 py-7 mb-5 border text-center"
        style={{
          background: ready ? C.successSubtle : C.errorBg,
          borderColor: ready ? C.successLighter : C.errorBorder,
          boxShadow: ready ? '0 6px 24px rgba(58,125,68,0.14)' : '0 6px 24px rgba(220,38,38,0.12)',
        }}
      >
        <div className="relative inline-flex items-center justify-center mb-3">
          {ready && (
            <span
              className="absolute inline-flex h-20 w-20 rounded-full animate-ping"
              style={{ background: C.successLighter, opacity: 0.5 }}
            />
          )}
          <span
            className="relative w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: ready ? C.successLight : C.errorLight }}
          >
            {ready
              ? <ShieldCheck className="h-9 w-9" style={{ color: C.success }} />
              : <ShieldAlert className="h-9 w-9" style={{ color: C.error }} />}
          </span>
        </div>
        <p className="text-xl font-extrabold" style={{ color: ready ? C.successDark : C.errorDark }}>
          {ready ? 'ההגנה פעילה' : 'ההגנה לא פעילה כרגע'}
        </p>
        <p className="text-sm mt-1" style={{ color: ready ? C.success : C.error }}>
          {ready ? 'נשמור עליך בנסיעה הבאה.' : (reasonMeta ? reasonMeta.label : 'יש לבדוק את ההגדרות')}
        </p>
        {!ready && reasonMeta && reasonMeta.fixable && (
          <button
            type="button"
            onClick={fixPermission}
            className="mt-4 w-full rounded-2xl py-2.5 font-bold text-sm flex items-center justify-center gap-2"
            style={{ background: C.error, color: WHITE }}
          >
            <Wrench className="h-4 w-4" /> תקן עכשיו
          </button>
        )}
      </div>

      {/* Battery optimisation is advisory (not a blocker) — a soft reliability
          hint, shown whether or not the guard is otherwise ready. */}
      {status && status.batteryOptimized && (
        <div className="rounded-2xl px-4 py-3 mb-4 border"
          style={{ background: C.warnSubtle, borderColor: C.warnBorder }}>
          <div className="flex items-start gap-2">
            <BatteryWarning className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.warn }} />
            <p className="text-xs leading-relaxed" style={{ color: C.warnMid }}>
              כדי שההגנה תפעל גם כשהאפליקציה סגורה, בטל עבורה את הגבלת הסוללה.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openBatterySettings()}
            className="mt-2 mr-6 text-xs font-bold underline"
            style={{ color: C.warnDark }}
          >
            פתח הגדרות סוללה
          </button>
        </div>
      )}

      {/* ── Master enable ── */}
      <Row icon={ShieldCheck} label="הפעל את ההגנה" hint="זיהוי אוטומטי של סוף נסיעה">
        <Switch checked={!!config.enabled} onCheckedChange={(v) => updateConfig({ enabled: v })} />
      </Row>

      {/* ── Device picker ── */}
      <Section title="הרכבים שלי" icon={Car}>
        <p className="text-xs mb-3" style={{ color: C.muted }}>
          סמן את מערכת השמע של הרכב מתוך המכשירים שחיברת ל-Bluetooth.
        </p>
        {devices.length === 0 ? (
          <p className="text-sm py-2" style={{ color: C.muted }}>
            עדיין לא חיברת מכשירי Bluetooth. התחבר לרכב פעם אחת וחזור לכאן.
          </p>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => {
              const on = config.carDeviceIds.includes(d.id);
              const earbuds = looksLikeEarbuds(d.name);
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-2xl p-3 border"
                  style={{ background: on ? C.light : C.gray50, borderColor: on ? C.borderAlt : C.border }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {earbuds
                      ? <Headphones className="h-5 w-5 shrink-0" style={{ color: C.muted }} />
                      : <Car className="h-5 w-5 shrink-0" style={{ color: C.primary }} />}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{d.name}</p>
                      {earbuds && <p className="text-[11px]" style={{ color: C.warn }}>נשמע כמו אוזניות, לא רכב</p>}
                    </div>
                  </div>
                  <Switch checked={on} onCheckedChange={() => toggleDevice(d.id)} />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Smart settings ── */}
      <Section title="מתי ההגנה פעילה" icon={CalendarDays}>
        <p className="text-xs mb-3" style={{ color: C.muted }}>
          מומלץ להשאיר רחב. שכחה מסוכנת בכל שעה.
        </p>

        {/* Days */}
        <div className="flex items-center justify-between gap-1.5 mb-4">
          {DAY_LABELS.map((label, d) => {
            const on = config.activeDays.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={`יום ${label}`}
                onClick={() => toggleDay(d)}
                className="w-9 h-9 rounded-full font-bold text-sm transition-colors border"
                style={{
                  background: on ? C.primary : C.card,
                  color: on ? WHITE : C.muted,
                  borderColor: on ? C.primary : C.border,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Active hours */}
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5" style={{ color: C.primary }} />
            <span className="text-sm font-semibold" style={{ color: C.text }}>הגבל לשעות מסוימות</span>
          </div>
          <Switch
            checked={hoursOn}
            onCheckedChange={(v) => updateConfig({ activeHours: v ? { start: '06:00', end: '18:00' } : null })}
          />
        </div>
        {hoursOn && (
          <div className="flex items-center gap-3 mt-2 mb-1">
            <TimeField label="מ-" value={config.activeHours.start} onChange={(v) => setHour('start', v)} />
            <TimeField label="עד" value={config.activeHours.end} onChange={(v) => setHour('end', v)} />
          </div>
        )}

        {/* Min trip minutes */}
        <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2.5">
            <Timer className="h-5 w-5" style={{ color: C.primary }} />
            <div>
              <span className="text-sm font-semibold" style={{ color: C.text }}>נסיעה מינימלית</span>
              <p className="text-[11px]" style={{ color: C.muted }}>מתעלם מעצירות קצרות</p>
            </div>
          </div>
          <Stepper
            value={config.minTripMinutes}
            onChange={(v) => updateConfig({ minTripMinutes: Math.max(0, Math.min(30, v)) })}
            suffix="דק׳"
          />
        </div>
      </Section>

      {/* ── Trip log (transparency — shows detection is working) ── */}
      {tripLog.length > 0 && (
        <Section title="נסיעות אחרונות שזוהו" icon={History}>
          <div className="space-y-1">
            {tripLog.map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                className="flex items-center justify-between text-xs py-1.5 border-b last:border-b-0"
                style={{ borderColor: C.border }}
              >
                <span dir="ltr" style={{ color: C.text }}>{formatTripTime(e.at)}</span>
                <span className="font-semibold" style={{ color: e.alerted ? C.success : C.muted }}>
                  {e.alerted ? 'נשלחה תזכורת' : 'ללא תזכורת'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── DEV-only: preview the alert decision ── */}
      {import.meta.env.DEV && (
        <Section title="כלי פיתוח (preview)" icon={Play}>
          <button
            type="button"
            onClick={simulate}
            className="w-full rounded-2xl py-2.5 font-bold text-sm flex items-center justify-center gap-2 border"
            style={{ background: C.gray50, color: C.text, borderColor: C.border }}
          >
            <Play className="h-4 w-4" /> דמה סיום נסיעה (5 דק׳)
          </button>
          {simResult && (
            <p className="text-sm mt-2 font-semibold" style={{ color: simResult === 'alert' ? C.success : C.muted }}>
              {simResult === 'alert' ? '🔔 התראה הייתה נורית' : '🔕 לא הייתה מותרעת (מחוץ לתנאים)'}
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

// ── Small presentational helpers ──

function Row({ icon: Icon, label, hint, children }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-3xl p-4 mb-4 border"
      style={{ background: C.card, borderColor: C.border, boxShadow: '0 2px 12px rgba(45,82,51,0.06)' }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.light }}>
          <Icon className="h-5 w-5" style={{ color: C.primary }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: C.text }}>{label}</p>
          {hint && <p className="text-[11px]" style={{ color: C.muted }}>{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <div
      className="rounded-3xl p-4 mb-4 border"
      style={{ background: C.card, borderColor: C.border, boxShadow: '0 2px 12px rgba(45,82,51,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4" style={{ color: C.primary }} />
        <h3 className="font-bold text-sm" style={{ color: C.text }}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function TimeField({ label, value, onChange }) {
  return (
    <label className="flex-1 flex items-center gap-2 rounded-2xl px-3 py-2 border" style={{ background: C.gray50, borderColor: C.border }}>
      <span className="text-xs font-semibold shrink-0" style={{ color: C.muted }}>{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm font-semibold w-full outline-none"
        style={{ color: C.text }}
      />
    </label>
  );
}

function Stepper({ value, onChange, suffix }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        className="w-8 h-8 rounded-full font-bold text-lg flex items-center justify-center border"
        style={{ background: C.card, color: C.primary, borderColor: C.border }}
      >−</button>
      <span className="text-sm font-bold min-w-[3.5rem] text-center" style={{ color: C.text }}>{value} {suffix}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="w-8 h-8 rounded-full font-bold text-lg flex items-center justify-center border"
        style={{ background: C.card, color: C.primary, borderColor: C.border }}
      >+</button>
    </div>
  );
}
