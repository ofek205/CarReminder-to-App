import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, BadgeCheck, CalendarDays, Car, CheckCircle2,
  ChevronLeft, Gauge, Info, Loader2, LockKeyhole, Save, Search, ShieldCheck,
  Sparkles, UserPlus, Wrench, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import LicensePlate from '@/components/shared/LicensePlate';
import { Button } from '@/components/ui/button';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import {
  QUICK_CHECK_RETURN_KEY,
  hasUsedQuickCheck,
  lookupVehicleQuickCheck,
  markQuickCheckUsed,
  normalizeQuickCheckPlate,
  readLastQuickCheckResult,
  saveLastQuickCheckResult,
  saveQuickCheckVehicle,
  validateQuickCheckPlate,
} from '@/services/vehicleQuickCheck';
import { C } from '@/lib/designTokens';

const loadingMessages = [
  'בודקים נתוני רישוי...',
  'מצליבים מקורות מידע...',
  'מכינים תובנות חכמות...',
  'בונים דוח בדיקה...',
];

const toneClasses = {
  success: 'border-green-100 bg-green-50 text-green-800',
  warning: 'border-yellow-100 bg-yellow-50 text-yellow-900',
  danger: 'border-red-100 bg-red-50 text-red-800',
  info: 'border-blue-100 bg-blue-50 text-blue-800',
};

const toneIcons = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

export default function VehicleCheck() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId, isLoading: accountLoading } = useAccountRole();
  const [plate, setPlate] = useState('');
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [limitLocked, setLimitLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isBusy = status === 'loading';
  const isPublicVisitor = !authLoading && !isAuthenticated;
  const validation = useMemo(() => validateQuickCheckPlate(plate), [plate]);

  useEffect(() => {
    const restored = readLastQuickCheckResult();
    if (restored) {
      setResult(restored);
      setPlate(restored.plate || restored.basicInfo?.licensePlate || '');
      setStatus('success');
    }
  }, []);

  useEffect(() => {
    if (!isBusy) return undefined;
    const id = window.setInterval(() => {
      setLoadingIndex(i => (i + 1) % loadingMessages.length);
    }, 1150);
    return () => window.clearInterval(id);
  }, [isBusy]);

  const handlePlateChange = (value) => {
    const clean = normalizeQuickCheckPlate(value).slice(0, 8);
    setPlate(clean);
    setError('');
    setLimitLocked(false);
    setSaved(false);
  };

  const search = async () => {
    if (isBusy) return;
    setError('');
    setLimitLocked(false);
    setSaved(false);

    const v = validateQuickCheckPlate(plate);
    if (!v.ok) {
      setError(v.message);
      setStatus('idle');
      return;
    }

    if (!isAuthenticated && hasUsedQuickCheck() && (!result || result.plate !== v.plate)) {
      setLimitLocked(true);
      return;
    }

    setStatus('loading');
    setLoadingIndex(0);
    try {
      const data = await lookupVehicleQuickCheck(v.plate);
      if (!isAuthenticated) markQuickCheckUsed();
      if (!data) {
        setResult(null);
        setStatus('not_found');
        return;
      }
      setResult(data);
      saveLastQuickCheckResult(data);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err?.code === 'invalid_plate'
        ? err.message
        : 'לא הצלחנו להשלים את הבדיקה כרגע. נסה שוב בעוד רגע.');
    }
  };

  const goToAuth = () => {
    if (result) saveLastQuickCheckResult(result);
    try { sessionStorage.setItem(QUICK_CHECK_RETURN_KEY, '1'); } catch {}
    navigate(createPageUrl('Auth'));
  };

  const saveVehicle = async () => {
    if (!result) return;
    if (!isAuthenticated) {
      goToAuth();
      return;
    }
    if (accountLoading || !accountId) {
      toast.error('לא נמצא חשבון פעיל לשמירת הרכב');
      return;
    }

    setSaving(true);
    try {
      await saveQuickCheckVehicle(result, accountId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['my-vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['vehicles-list'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] }),
      ]);
      setSaved(true);
      toast.success('הרכב נוסף לרכבים שלך');
    } catch (err) {
      if (err?.code === 'duplicate_vehicle') {
        toast.error('הרכב הזה כבר קיים ברשימת הרכבים שלך');
      } else {
        toast.error('שמירת הרכב נכשלה. נסה שוב.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen -m-4 lg:-m-8 px-4 py-6 sm:px-6 lg:px-10"
      style={{ background: 'linear-gradient(180deg, #F5FAF6 0%, #FFFFFF 52%)' }}>
      <div className="max-w-5xl mx-auto">
        <Header isAuthenticated={isAuthenticated} />

        <section className="bg-white border border-[#D8E5D9] rounded-[2rem] shadow-xl shadow-[#2D5233]/10 p-4 sm:p-6 mb-5">
          <div className="max-w-2xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8F2EA] text-[#2D5233] text-xs font-bold mb-4">
              <Sparkles className="h-3.5 w-3.5" />
              בדיקה חכמה תוך שניות
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-[#1C2E20] mb-2">
              בדיקת רכב לפי מספר רישוי
            </h1>
            <p className="text-sm text-gray-500 leading-relaxed mb-6">
              הזן מספר רישוי וקבל סיכום מובנה, תובנות ומפרט טכני בלי להוסיף את הרכב לחשבון.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
              <div>
                <LicensePlateInput
                  value={plate}
                  onChange={handlePlateChange}
                  onEnter={search}
                  disabled={isBusy}
                />
                {error && <p className="text-xs text-red-600 text-right mt-2">{error}</p>}
              </div>
              <Button
                type="button"
                onClick={search}
                disabled={isBusy || !validation.ok}
                className="h-14 rounded-2xl px-6 font-black shadow-lg shadow-[#2D5233]/20"
                style={{ background: C.primary, color: '#fff' }}
              >
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Search className="h-4 w-4 ml-2" />}
                בדוק רכב
              </Button>
            </div>
          </div>
        </section>

        {limitLocked && <GuestLimitCard onAuth={goToAuth} />}
        {isBusy && <SmartLoading text={loadingMessages[loadingIndex]} />}
        {status === 'not_found' && <StateCard tone="warning" title="לא מצאנו נתונים לרכב הזה" text="בדוק שהמספר הוזן נכון. ייתכן שהרכב שייך למאגר שאינו זמין כרגע." />}
        {status === 'error' && !isBusy && <StateCard tone="danger" title="הבדיקה נכשלה" text="לא נציג שגיאות טכניות. נסה שוב בעוד רגע או בדוק את החיבור לאינטרנט." />}

        {result && status === 'success' && (
          <div className="space-y-5">
            <SummaryCard result={result} />
            <Insights insights={result.insights} />
            <KeyInfoGrid result={result} />
            <SpecsAccordion result={result} />
            <ConversionCta
              isAuthenticated={isAuthenticated}
              saving={saving}
              saved={saved}
              onSave={saveVehicle}
              onAuth={goToAuth}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Header({ isAuthenticated }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <Link to={isAuthenticated ? createPageUrl('Dashboard') : createPageUrl('Auth')}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-[#2D5233]">
        <ChevronLeft className="h-4 w-4" />
        חזרה
      </Link>
      {!isAuthenticated && (
        <button type="button" onClick={() => { window.location.href = createPageUrl('Auth'); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-100 text-xs font-bold text-[#2D5233]">
          <UserPlus className="h-3.5 w-3.5" />
          התחברות / הרשמה
        </button>
      )}
    </div>
  );
}

function LicensePlateInput({ value, onChange, onEnter, disabled }) {
  return (
    <div className="relative rounded-2xl border-2 border-[#1A3A5C] bg-[#FFBF00] shadow-lg overflow-hidden" dir="ltr">
      <div className="absolute inset-y-0 left-0 w-12 bg-[#1A3A5C] flex flex-col items-center justify-center gap-1">
        <span className="text-white text-[10px] font-black">IL</span>
        <span className="w-5 h-3 bg-white rounded-sm" />
      </div>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="12345678"
        aria-label="מספר רישוי"
        className="w-full h-14 pl-14 pr-4 bg-transparent text-center text-2xl font-black tracking-[0.18em] text-[#1A1A1A] placeholder:text-black/25 outline-none disabled:opacity-60"
      />
    </div>
  );
}

function SmartLoading({ text }) {
  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 mb-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="relative w-12 h-12 rounded-2xl bg-[#E8F2EA] flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#2D5233]" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-gray-900">{text}</p>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full w-2/3 rounded-full bg-[#2D5233] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ result }) {
  const b = result.basicInfo || {};
  const ownership = result.ownership || {};
  return (
    <section className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center gap-5">
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center bg-[#E8F2EA] text-[#2D5233] shrink-0">
          <Car className="h-8 w-8" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <LicensePlate value={b.licensePlate || result.plate} size="lg" />
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${b.status === 'פעיל' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {b.status || 'סטטוס לא ידוע'}
            </span>
          </div>
          <h2 className="text-2xl font-black text-gray-900 truncate">
            {b.displayName || 'רכב'}
          </h2>
          <p className="text-sm text-gray-500">
            {[b.vehicleType, b.detectedTypeLabel].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:min-w-[300px]">
          <MiniStat label="יצרן" value={b.manufacturer} />
          <MiniStat label="דגם" value={b.model} />
          <MiniStat label="שנה" value={b.year} />
          <MiniStat label="יד" value={ownership.hand ? `יד ${ownership.hand}` : ''} />
          <MiniStat label="בעלות" value={ownership.current} />
          <MiniStat label="סוג" value={b.detectedTypeLabel || b.vehicleType} />
          <MiniStat label="אספנות" value={b.isVintage ? 'כן' : ''} />
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-gray-50 border border-gray-100 p-3">
      <p className="text-[10px] font-bold text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-black text-gray-900 truncate">{value || 'לא זמין'}</p>
    </div>
  );
}

function Insights({ insights = [] }) {
  if (!insights.length) return null;
  return (
    <section>
      <SectionTitle icon={<Sparkles className="h-4 w-4" />} title="תובנות חכמות" subtitle="מה כדאי לשים לב אליו לפי הנתונים הזמינים" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {insights.map(item => {
          const Icon = toneIcons[item.tone] || Info;
          return (
            <div key={item.id} className={`rounded-2xl border p-4 ${toneClasses[item.tone] || toneClasses.info}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/60">{item.label}</span>
              </div>
              <p className="text-sm font-black mb-1">{item.title}</p>
              <p className="text-xs leading-relaxed opacity-85">{item.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KeyInfoGrid({ result }) {
  const t = result.technical || {};
  const o = result.ownership || {};
  const r = result.registration || {};
  const items = [
    { icon: Gauge, label: 'נפח מנוע', value: t.engineCc },
    { icon: Wrench, label: 'סוג דלק', value: t.fuelType },
    { icon: ShieldCheck, label: 'תיבת הילוכים', value: t.transmission },
    { icon: BadgeCheck, label: 'סוג בעלות', value: o.current },
    { icon: CalendarDays, label: 'עלייה לכביש', value: r.firstRegistrationDate },
    { icon: CalendarDays, label: 'תוקף בדיקה', value: r.testDueDate || r.inspectionReportExpiryDate },
  ];
  return (
    <section>
      <SectionTitle icon={<Info className="h-4 w-4" />} title="מידע מרכזי" subtitle="הפרטים החשובים לסינון ראשוני" />
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <Icon className="h-4 w-4 text-[#2D5233] mb-2" />
              <p className="text-[11px] font-bold text-gray-400">{item.label}</p>
              <p className="text-sm font-black text-gray-900 mt-1">{item.value || 'לא זמין'}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SpecsAccordion({ result }) {
  const sections = [
    { id: 'general', title: 'מידע כללי', data: result.basicInfo },
    { id: 'registration', title: 'רישוי וטסט', data: result.registration },
    { id: 'technical', title: 'מפרט טכני', data: result.technical },
    { id: 'ownership', title: 'בעלות והיסטוריה', data: result.ownership },
    { id: 'additional', title: 'מידע נוסף', data: result.additional },
  ];
  return (
    <section className="bg-white rounded-3xl border border-gray-100 p-4 shadow-sm">
      <SectionTitle icon={<Wrench className="h-4 w-4" />} title="מפרט מלא" subtitle="פתח רק את החלק שמעניין אותך" />
      <Accordion type="single" collapsible className="w-full">
        {sections.map(section => (
          <AccordionItem key={section.id} value={section.id} className="border-gray-100">
            <AccordionTrigger className="text-right font-black hover:no-underline">
              {section.title}
            </AccordionTrigger>
            <AccordionContent>
              <SpecRows data={section.data} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

function SpecRows({ data = {} }) {
  const entries = Object.entries(data || {}).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== '';
  });
  if (!entries.length) {
    return <p className="text-xs text-gray-400">אין מידע זמין בסעיף הזה.</p>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
          <p className="text-[10px] font-bold text-gray-400">{labelFor(key)}</p>
          <p className="text-xs font-bold text-gray-800 break-words">
            {formatSpecValue(value)}
          </p>
        </div>
      ))}
    </div>
  );
}

function formatSpecValue(value) {
  if (Array.isArray(value)) return `${value.length} רשומות`;
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  return String(value);
}

function ConversionCta({ isAuthenticated, saving, saved, onSave, onAuth }) {
  if (saved) {
    return (
      <section className="rounded-3xl border border-green-100 bg-green-50 p-5 text-center">
        <CheckCircle2 className="h-8 w-8 text-green-700 mx-auto mb-2" />
        <p className="text-lg font-black text-green-900">הרכב נשמר בהצלחה</p>
        <Link to={createPageUrl('Vehicles')} className="inline-flex items-center gap-1 mt-3 text-sm font-bold text-green-800">
          לרכבים שלי
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </section>
    );
  }
  return (
    <section className="rounded-3xl border border-[#D8E5D9] p-5 text-center"
      style={{ background: 'linear-gradient(135deg, #E8F2EA 0%, #FFF8E1 100%)' }}>
      <Save className="h-8 w-8 text-[#2D5233] mx-auto mb-2" />
      <p className="text-lg font-black text-[#1C2E20]">רוצה לשמור את הרכב לרכבים שלך?</p>
      <p className="text-sm text-gray-600 mt-1 mb-4">
        שמירה תאפשר לקבל תזכורות, מסמכים ומעקב תחזוקה במקום אחד.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button onClick={onSave} disabled={saving} className="rounded-2xl font-black" style={{ background: C.primary }}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
          {isAuthenticated ? 'הוסף לרכבים שלי' : 'התחבר ושמור רכב'}
        </Button>
        {!isAuthenticated && (
          <Button type="button" variant="outline" onClick={onAuth} className="rounded-2xl font-bold">
            הרשמה / התחברות
          </Button>
        )}
      </div>
    </section>
  );
}

function GuestLimitCard({ onAuth }) {
  return (
    <section className="bg-white border border-yellow-100 rounded-3xl p-5 mb-5 shadow-sm text-center">
      <LockKeyhole className="h-9 w-9 text-yellow-700 mx-auto mb-3" />
      <h2 className="text-lg font-black text-gray-900 mb-1">
        רוצה לבדוק עוד רכבים ולשמור אותם במקום אחד?
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        הרשמה פותחת בדיקות נוספות, שמירה לרכבים שלי ותזכורות חכמות.
      </p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button onClick={onAuth} className="rounded-2xl font-black" style={{ background: C.primary }}>
          הרשמה / התחברות
        </Button>
        <Link to={createPageUrl('Auth')} className="inline-flex items-center justify-center px-4 py-2 rounded-2xl border border-gray-200 text-sm font-bold text-gray-700">
          חזרה לבית
        </Link>
      </div>
    </section>
  );
}

function StateCard({ tone, title, text }) {
  const cls = tone === 'danger' ? 'border-red-100 bg-red-50 text-red-900' : 'border-yellow-100 bg-yellow-50 text-yellow-900';
  return (
    <section className={`rounded-3xl border p-5 mb-5 text-center ${cls}`}>
      <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
      <p className="text-lg font-black">{title}</p>
      <p className="text-sm opacity-80 mt-1">{text}</p>
    </section>
  );
}

function SectionTitle({ icon, title, subtitle }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-black text-gray-900">
          <span className="text-[#2D5233]">{icon}</span>
          {title}
        </h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function labelFor(key) {
  return ({
    licensePlate: 'מספר רישוי',
    manufacturer: 'יצרן',
    model: 'דגם',
    year: 'שנה',
    vehicleType: 'סוג רכב',
    detectedTypeLabel: 'סיווג מזוהה',
    detectedType: 'סוג מאגר',
    status: 'סטטוס',
    isVintage: 'אספנות',
    firstRegistrationDate: 'עלייה לכביש',
    lastTestDate: 'טסט אחרון',
    testDueDate: 'תוקף טסט',
    inspectionReportExpiryDate: 'תוקף תסקיר',
    cancellationDate: 'תאריך ביטול',
    currentKm: 'קילומטראז׳',
    engineCc: 'נפח מנוע',
    fuelType: 'סוג דלק',
    transmission: 'תיבת הילוכים',
    horsepower: 'כוח סוס',
    drivetrain: 'הנעה',
    vehicleClass: 'קבוצת רכב',
    bodyType: 'מרכב',
    engineModel: 'דגם מנוע',
    modelCode: 'קוד דגם',
    trimLevel: 'רמת גימור',
    vin: 'מספר שלדה',
    color: 'צבע',
    safetyRating: 'רמת בטיחות',
    pollutionGroup: 'קבוצת זיהום',
    frontTire: 'צמיג קדמי',
    rearTire: 'צמיג אחורי',
    seats: 'מושבים',
    doors: 'דלתות',
    airbags: 'כריות אוויר',
    totalWeight: 'משקל כולל',
    countryOfOrigin: 'ארץ ייצור',
    co2: 'פליטת פחמן',
    greenIndex: 'מדד ירוק',
    towCapacity: 'כושר גרירה',
    current: 'בעלות נוכחית',
    hand: 'יד',
    history: 'היסטוריית בעלות',
    isPersonalImport: 'יבוא אישי',
    personalImportType: 'סוג יבוא אישי',
    marina: 'מרינה',
    flagCountry: 'דגל',
    offroadUsageType: 'שימוש שטח',
  })[key] || key;
}
