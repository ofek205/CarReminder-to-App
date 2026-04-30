import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, BadgeCheck, CalendarDays, Car, CheckCircle2,
  ChevronLeft, Download, Gauge, Info, Loader2, LockKeyhole, RotateCcw, Save,
  Search, ShieldCheck, Sparkles, UserPlus, Wrench, XCircle,
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
import { OwnershipHistoryPanel } from '@/components/vehicle/VehicleInfoSection';
import VehicleCheckPlateInput from '@/components/shared/VehicleCheckPlateInput';

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

const reportDisclaimer = 'המידע בדוח נמשך ממאגרי משרד התחבורה וממקורות מידע ציבוריים זמינים. ייתכנו פערים, עיכובים או חוסרים בנתונים, ולכן יש לקחת את המידע בערבון מוגבל ולא להסתמך עליו כתחליף לבדיקה מקצועית או משפטית.';
const QUICK_CHECK_PREFILL_KEY = 'vehicle_quick_check_prefill_plate';

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
  const [reportMode, setReportMode] = useState(null);
  const [autoSearchQueued, setAutoSearchQueued] = useState(false);

  const isBusy = status === 'loading';
  const isPublicVisitor = !authLoading && !isAuthenticated;
  const validation = useMemo(() => validateQuickCheckPlate(plate), [plate]);

  useEffect(() => {
    try {
      const prefilledPlate = sessionStorage.getItem(QUICK_CHECK_PREFILL_KEY);
      if (prefilledPlate) {
        setPlate(normalizeQuickCheckPlate(prefilledPlate).slice(0, 8));
        sessionStorage.removeItem(QUICK_CHECK_PREFILL_KEY);
        setAutoSearchQueued(true);
        return;
      }
    } catch {}

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

  useEffect(() => {
    if (!autoSearchQueued || isBusy) return;
    const v = validateQuickCheckPlate(plate);
    if (!v.ok) {
      setAutoSearchQueued(false);
      return;
    }
    setAutoSearchQueued(false);
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearchQueued, plate, isBusy]);

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

  const resetCheck = () => {
    setPlate('');
    setResult(null);
    setStatus('idle');
    setError('');
    setLimitLocked(false);
    setSaved(false);
    setLoadingIndex(0);
    setReportMode(null);
  };

  const openReportOptions = () => {
    if (!result) return;
    setReportMode('options');
  };

  const downloadReport = () => {
    if (!result) return;
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <div dir="rtl" className="vehicle-check-root min-h-screen -m-4 lg:-m-8 px-4 py-6 sm:px-6 lg:px-10"
      style={{ background: 'linear-gradient(180deg, #F5FAF6 0%, #FFFFFF 52%)' }}>
      <PrintStyles />
      <div className="vehicle-check-screen max-w-5xl mx-auto">
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
                <VehicleCheckPlateInput
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
            <MarketAnecdote result={result} />
            <ResultActions onExport={openReportOptions} onReset={resetCheck} />
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
      {result && status === 'success' && <VehiclePrintReport result={result} />}
      {result && reportMode && (
        <ReportModal
          mode={reportMode}
          result={result}
          onClose={() => setReportMode(null)}
          onPreview={() => setReportMode('preview')}
          onDownload={downloadReport}
        />
      )}
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
  const registration = result.registration || {};
  const ownership = result.ownership || {};
  const stats = [
    { label: 'יצרן', value: b.manufacturer },
    { label: 'דגם', value: b.model },
    { label: 'שנה', value: b.year },
    { label: 'קילומטראז׳', value: formatKm(registration.currentKm) },
    { label: 'יד', value: ownership.hand ? `יד ${ownership.hand}` : '' },
    { label: 'בעלות', value: ownership.current },
    { label: 'סוג', value: b.detectedTypeLabel || b.vehicleType },
    { label: 'אספנות', value: b.isVintage ? 'כן' : '' },
  ].filter(item => hasDisplayValue(item.value));
  const typeLine = formatUniqueList([b.vehicleType, b.detectedTypeLabel]);

  return (
    <section className="bg-white border border-gray-100 rounded-3xl p-4 sm:p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center gap-4 sm:gap-5">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-3xl flex items-center justify-center bg-[#E8F2EA] text-[#2D5233] shrink-0 mx-auto md:mx-0">
          <Car className="h-8 w-8" />
        </div>
        <div className="flex-1 min-w-0 text-center md:text-right">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-2">
            <LicensePlate value={b.licensePlate || result.plate} size="lg" />
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${b.status === 'פעיל' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {b.status || 'סטטוס לא ידוע'}
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-gray-900 md:truncate">
            {b.displayName || 'רכב'}
          </h2>
          {typeLine && <p className="text-sm text-gray-500">{typeLine}</p>}
        </div>
        {stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:min-w-[300px]">
            {stats.map(item => <MiniStat key={item.label} label={item.label} value={item.value} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function ResultActions({ onExport, onReset }) {
  return (
    <section className="bg-white border border-gray-100 rounded-3xl p-3 shadow-sm">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <p className="text-xs sm:text-sm text-gray-500 font-bold text-center sm:text-right">
          אפשר לשמור דוח מסודר או לאפס את הבדיקה ולהזין מספר אחר.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button type="button" onClick={onExport} className="rounded-2xl font-black" style={{ background: C.primary }}>
            <Download className="h-4 w-4 ml-2" />
            ייצוא דוח
          </Button>
          <Button type="button" variant="outline" onClick={onReset} className="rounded-2xl font-bold">
            <RotateCcw className="h-4 w-4 ml-2" />
            איפוס לבדיקה נוספת
          </Button>
        </div>
      </div>
    </section>
  );
}

function MarketAnecdote({ result }) {
  const a = result?.additional || {};
  const modelCount = Number(a.activeSameModelCount);
  const modelColorCount = Number(a.activeSameModelColorCount);
  const colorName = a.activeSameModelColorName;
  const hasModel = Number.isFinite(modelCount) && modelCount > 0;
  const hasModelColor = Number.isFinite(modelColorCount) && modelColorCount >= 0;
  if (!hasModel && !hasModelColor) return null;

  return (
    <section className="rounded-3xl border border-[#D8E5D9] bg-[#F7FBF8] p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-2xl bg-[#E8F2EA] text-[#2D5233] flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-black text-[#1C2E20] mb-1">אנקדוטה מהמאגר הארצי</p>
          {hasModel && (
            <p className="text-sm text-gray-700">
              כרגע רשומים בישראל בערך <strong>{modelCount.toLocaleString('he-IL')}</strong> רכבים פעילים מאותו דגם.
            </p>
          )}
          {hasModelColor && (
            <p className="text-sm text-gray-600 mt-1">
              מתוכם <strong>{modelColorCount.toLocaleString('he-IL')}</strong>
              {colorName ? ` באותו צבע (${colorName})` : ' באותו צבע'}.
            </p>
          )}
          <p className="text-[11px] text-gray-400 mt-2">
            נתון אינדיקטיבי מתוך מאגר הרכבים הפעילים של משרד התחבורה.
          </p>
        </div>
      </div>
    </section>
  );
}

function ReportModal({ mode, result, onClose, onPreview, onDownload }) {
  const isPreview = mode === 'preview';
  return (
    <div className="report-modal-backdrop fixed inset-0 z-50 bg-black/45 p-3 sm:p-6 overflow-y-auto">
      <div className={`bg-white rounded-3xl shadow-2xl mx-auto ${isPreview ? 'max-w-4xl' : 'max-w-lg'} overflow-hidden`}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div>
            <p className="text-base font-black text-gray-900">
              {isPreview ? 'צפייה בדוח' : 'ייצוא דוח בדיקת רכב'}
            </p>
            <p className="text-xs text-gray-500">
              הדוח כולל נתונים יבשים בלבד, ללא תובנות או המלצות.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600"
          >
            סגור
          </button>
        </div>

        {isPreview ? (
          <div>
            <div className="flex flex-col sm:flex-row gap-2 p-3 border-b border-gray-100 bg-gray-50">
              <Button type="button" onClick={onDownload} className="rounded-2xl font-black" style={{ background: C.primary }}>
                <Download className="h-4 w-4 ml-2" />
                הורדה
              </Button>
              <Button type="button" variant="outline" onClick={onClose} className="rounded-2xl font-bold">
                חזרה למסך
              </Button>
            </div>
            <div className="max-h-[75vh] overflow-auto bg-gray-100 p-3 sm:p-5">
              <VehiclePrintReport result={result} variant="preview" />
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-3">
            <button
              type="button"
              onClick={onPreview}
              className="w-full text-right rounded-3xl border border-[#D8E5D9] bg-[#F5FAF6] p-4 hover:border-[#2D5233] transition-colors"
            >
              <p className="text-sm font-black text-[#1C2E20] mb-1">צפייה בדוח</p>
              <p className="text-xs leading-relaxed text-gray-600">
                פותח תצוגה מקדימה נקייה בתוך האפליקציה. מתוך התצוגה אפשר גם להוריד.
              </p>
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="w-full text-right rounded-3xl border border-gray-200 bg-white p-4 hover:border-[#2D5233] transition-colors"
            >
              <p className="text-sm font-black text-gray-900 mb-1">הורדה כקובץ</p>
              <p className="text-xs leading-relaxed text-gray-600">
                פותח את חלון השמירה של הדפדפן. בוחרים שמירה כקובץ.
              </p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-gray-50 border border-gray-100 p-3">
      <p className="text-[10px] font-bold text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-black text-gray-900 break-words">{formatSpecValue(value)}</p>
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
    { icon: Gauge, label: 'קילומטראז׳ אחרון', value: formatKm(r.currentKm) },
    { icon: Gauge, label: 'נפח מנוע', value: t.engineCc },
    { icon: Wrench, label: 'סוג דלק', value: t.fuelType },
    { icon: ShieldCheck, label: 'תיבת הילוכים', value: t.transmission },
    { icon: BadgeCheck, label: 'סוג בעלות', value: o.current },
    { icon: CalendarDays, label: 'עלייה לכביש', value: r.firstRegistrationDate },
    { icon: CalendarDays, label: 'תוקף בדיקה', value: r.testDueDate || r.inspectionReportExpiryDate },
  ].filter(item => hasDisplayValue(item.value));
  if (!items.length) return null;
  return (
    <section>
      <SectionTitle icon={<Info className="h-4 w-4" />} title="מידע מרכזי" subtitle="הפרטים החשובים לסינון ראשוני" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
              <Icon className="h-4 w-4 text-[#2D5233] mb-2" />
              <p className="text-[11px] font-bold text-gray-400">{item.label}</p>
              <p className="text-sm font-black text-gray-900 mt-1 break-words">{formatSpecValue(item.value)}</p>
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
  ].map(section => ({
    ...section,
    hasData: Object.values(section.data || {}).some(hasDisplayValue),
  })).filter(section => section.hasData);
  if (!sections.length) return null;
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
              <SpecRows data={section.data} sectionId={section.id} />
              {section.id === 'ownership' && <OwnershipBreakdown ownership={section.data} />}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

// Per-section keys that SpecRows should NEVER render in the generic
// key-value grid because a richer component owns that data below.
//   ownership.history → OwnershipBreakdown (numbered timeline of every
//                       baalut episode with date and "current" badge —
//                       same component the technical-spec page uses, so
//                       the two views match exactly).
const SPEC_ROWS_HIDDEN = {
  ownership: new Set(['history']),
};

function SpecRows({ data = {}, sectionId }) {
  const hidden = SPEC_ROWS_HIDDEN[sectionId];
  const entries = Object.entries(data || {}).filter(([key, value]) => {
    if (hidden && hidden.has(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    return hasDisplayValue(value);
  });
  if (!entries.length) return null;
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

// "פירוט בעלים קודמים" — chronological list of every ownership episode
// for the plate. Same component (OwnershipHistoryPanel) the technical-
// spec card on VehicleDetail renders, kept identical so the public
// quick-check page and the owned-vehicle detail page stay visually
// consistent.
//
// Rules of engagement:
//   - Only renders when the gov.il enrichment actually returned an
//     ownership_history array. If the lookup was skipped (commercial
//     plate, plate not found, etc) we silently render nothing — never
//     show an empty "previous owners" header that would imply a
//     missing record.
//   - Renders even when there's only ONE episode, because seeing
//     "1 בעלים פרטי, 2024-12-01" is meaningful even for first-hand
//     cars (verifies the registration date, confirms the type).
//   - Reuses C (the default green design tokens) as the theme. The
//     panel's own internal styling adapts to whatever palette is
//     passed; future per-vehicle theming (e.g. marine teal for boats)
//     would just need a getTheme() call here.
function OwnershipBreakdown({ ownership }) {
  const history = Array.isArray(ownership?.history) ? ownership.history : [];
  if (!history.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-gray-100 bg-white">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <p className="text-[11px] font-black text-gray-700">פירוט בעלים קודמים</p>
        <p className="text-[10px] text-gray-400">{history.length} רשומות</p>
      </div>
      <OwnershipHistoryPanel history={history} theme={C} />
    </div>
  );
}

function formatSpecValue(value) {
  if (Array.isArray(value)) return `${value.length} רשומות`;
  if (typeof value === 'boolean') return value ? 'כן' : 'לא';
  return String(value);
}

function formatUniqueList(values) {
  const seen = new Set();
  return values
    .filter(hasDisplayValue)
    .map(value => String(value).trim())
    .filter((value) => {
      const key = value.replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(' · ');
}

function formatKm(value) {
  if (!hasDisplayValue(value)) return '';
  const n = Number(String(value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return String(value);
  return `${Math.round(n).toLocaleString('he-IL')} ק״מ`;
}

function hasDisplayValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
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

function VehiclePrintReport({ result, variant = 'print' }) {
  const b = result.basicInfo || {};
  const rows = buildReportSections(result);
  return (
    <article className={variant === 'preview' ? 'vehicle-report-preview' : 'vehicle-report-print'} dir="rtl" aria-hidden={variant === 'print'}>
      <header className="report-header">
        <div className="report-brand">
          <BrandMark />
          <div>
            <p className="report-brand-name">CarReminder</p>
            <p className="report-brand-subtitle">דוח בדיקת רכב</p>
          </div>
        </div>
        <div className="report-meta">
          <p>תאריך הפקה: {formatReportDate(result.fetchedAt)}</p>
          <p>מספר רישוי: {b.licensePlate || result.plate}</p>
        </div>
      </header>

      <section className="report-hero">
        <div>
          <p className="report-kicker">סיכום בדיקה</p>
          <h1>{b.displayName || 'רכב'}</h1>
          <p>{formatUniqueList([b.vehicleType, b.detectedTypeLabel]) || 'סוג כלי לא זמין'}</p>
        </div>
        <div className="report-plate">{b.licensePlate || result.plate}</div>
      </section>

      {rows.map(section => (
        <section key={section.title} className="report-section">
          <h2>{section.title}</h2>
          <div className="report-grid">
            {section.rows.map(([key, value]) => (
              <div key={`${section.title}-${key}`} className="report-field">
                <span>{labelFor(key)}</span>
                <strong>{formatSpecValue(value)}</strong>
              </div>
            ))}
          </div>
        </section>
      ))}

      <footer className="report-footer">
        <strong>הבהרה חשובה:</strong> {reportDisclaimer}
      </footer>
    </article>
  );
}

function BrandMark() {
  return (
    <div className="report-logo" aria-hidden="true">
      <Car className="h-7 w-7" />
      <Sparkles className="h-3.5 w-3.5 report-logo-spark" />
    </div>
  );
}

function buildReportSections(result) {
  return [
    { title: 'מידע כללי', data: result.basicInfo },
    { title: 'רישוי ובדיקות', data: result.registration },
    { title: 'בעלות והיסטוריה', data: result.ownership, expandHistory: true },
    { title: 'מפרט טכני', data: result.technical },
    { title: 'מידע נוסף', data: result.additional },
  ].map(section => {
    // Standard key/value rows. The 'history' key is intentionally
    // dropped here because the generic formatter would render it as
    // "4 רשומות", which is exactly the bug a printed report should
    // not have. We re-emit it below as a chronological list of rows.
    const rows = Object.entries(section.data || {})
      .filter(([key, value]) => {
        if (section.expandHistory && key === 'history') return false;
        if (Array.isArray(value)) return value.length > 0;
        return hasDisplayValue(value);
      });

    // Ownership: append one row per episode so the printed/viewed
    // report shows the same numbered breakdown the on-screen accordion
    // displays. We label the most-recent entry "בעלות נוכחית" and the
    // rest "בעלים N", matching the on-screen pill that says "נוכחית".
    if (section.expandHistory) {
      const history = Array.isArray(section.data?.history) ? section.data.history : [];
      history.forEach((episode, idx) => {
        const isCurrent = idx === history.length - 1;
        const label = isCurrent ? 'בעלות נוכחית' : `בעלים ${idx + 1}`;
        const date  = episode?.date ? ` · ${episode.date}` : '';
        const baal  = episode?.baalut || 'לא ידוע';
        rows.push([label, `${baal}${date}`]);
      });
    }

    return { title: section.title, rows };
  }).filter(section => section.rows.length > 0);
}

function formatReportDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'לא זמין';
  return date.toLocaleDateString('he-IL');
}

function PrintStyles() {
  return (
    <style>{`
      .vehicle-report-print {
        display: none;
      }

      .vehicle-report-preview {
        width: min(100%, 794px);
        margin: 0 auto;
        padding: 28px;
        background: #fff;
        color: #162117;
        direction: rtl;
        font-family: Arial, sans-serif;
        box-shadow: 0 12px 35px rgba(22, 33, 23, 0.12);
      }

      .vehicle-report-preview .report-header,
      .vehicle-report-preview .report-hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
      }

      .vehicle-report-preview .report-header {
        padding-bottom: 12px;
        border-bottom: 2px solid #2D5233;
      }

      .vehicle-report-preview .report-brand {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .vehicle-report-preview .report-logo {
        position: relative;
        width: 44px;
        height: 44px;
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #2D5233;
        color: #E8B829;
      }

      .vehicle-report-preview .report-logo-spark {
        position: absolute;
        top: 6px;
        left: 7px;
        color: #FFF5CC;
      }

      .vehicle-report-preview .report-brand-name {
        margin: 0;
        font-size: 18px;
        font-weight: 900;
        color: #2D5233;
      }

      .vehicle-report-preview .report-brand-subtitle,
      .vehicle-report-preview .report-meta p,
      .vehicle-report-preview .report-hero p,
      .vehicle-report-preview .report-kicker {
        margin: 0;
        color: #647067;
        font-size: 11px;
        font-weight: 700;
      }

      .vehicle-report-preview .report-meta {
        text-align: left;
      }

      .vehicle-report-preview .report-hero {
        margin: 14px 0;
        padding: 14px;
        border-radius: 18px;
        background: #F5FAF6;
        border: 1px solid #D8E5D9;
      }

      .vehicle-report-preview .report-hero h1 {
        margin: 4px 0;
        font-size: 22px;
        line-height: 1.2;
        color: #162117;
      }

      .vehicle-report-preview .report-plate {
        min-width: 130px;
        padding: 8px 12px;
        border-radius: 10px;
        border: 2px solid #1A3A5C;
        background: #FFBF00;
        color: #111;
        text-align: center;
        font-size: 22px;
        font-weight: 900;
        letter-spacing: 0.08em;
        direction: ltr;
      }

      .vehicle-report-preview .report-section {
        margin-top: 12px;
      }

      .vehicle-report-preview .report-section h2 {
        margin: 0 0 6px;
        font-size: 13px;
        color: #2D5233;
        border-bottom: 1px solid #E5ECE6;
        padding-bottom: 4px;
      }

      .vehicle-report-preview .report-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }

      .vehicle-report-preview .report-field {
        min-height: 38px;
        border-radius: 10px;
        border: 1px solid #E5ECE6;
        background: #FBFCFB;
        padding: 6px 8px;
      }

      .vehicle-report-preview .report-field span {
        display: block;
        font-size: 9px;
        color: #7C887F;
        font-weight: 700;
        margin-bottom: 2px;
      }

      .vehicle-report-preview .report-field strong {
        display: block;
        font-size: 11px;
        line-height: 1.3;
        color: #162117;
        word-break: break-word;
      }

      .vehicle-report-preview .report-footer {
        margin-top: 14px;
        padding-top: 9px;
        border-top: 1px solid #E5ECE6;
        color: #6B766E;
        font-size: 9px;
        line-height: 1.45;
      }

      @media (max-width: 640px) {
        .vehicle-report-preview {
          padding: 16px;
        }

        .vehicle-report-preview .report-header,
        .vehicle-report-preview .report-hero {
          align-items: flex-start;
          flex-direction: column;
        }

        .vehicle-report-preview .report-meta {
          text-align: right;
        }

        .vehicle-report-preview .report-grid {
          grid-template-columns: 1fr;
        }
      }

      @media print {
        @page {
          size: A4;
          margin: 10mm;
        }

        html,
        body {
          background: #fff !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        body * {
          visibility: hidden;
        }

        .vehicle-check-root {
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }

        .vehicle-report-print,
        .vehicle-report-print * {
          visibility: visible;
        }

        .vehicle-check-screen,
        .report-modal-backdrop {
          display: none !important;
        }

        .vehicle-report-print {
          display: block !important;
          position: static !important;
          width: 100%;
          min-height: auto;
          height: auto;
          padding: 0;
          background: #fff;
          color: #162117;
          font-family: Arial, sans-serif;
          direction: rtl;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .report-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding-bottom: 10px;
          border-bottom: 2px solid #2D5233;
        }

        .report-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .report-logo {
          position: relative;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #2D5233;
          color: #E8B829;
        }

        .report-logo-spark {
          position: absolute;
          top: 6px;
          left: 7px;
          color: #FFF5CC;
        }

        .report-brand-name {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
          color: #2D5233;
        }

        .report-brand-subtitle,
        .report-meta p,
        .report-hero p,
        .report-kicker {
          margin: 0;
          color: #647067;
          font-size: 10px;
          font-weight: 700;
        }

        .report-meta {
          text-align: left;
        }

        .report-hero {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin: 12px 0;
          padding: 12px;
          border-radius: 18px;
          background: #F5FAF6;
          border: 1px solid #D8E5D9;
        }

        .report-hero h1 {
          margin: 3px 0;
          font-size: 20px;
          line-height: 1.2;
          color: #162117;
        }

        .report-plate {
          min-width: 130px;
          padding: 8px 12px;
          border-radius: 10px;
          border: 2px solid #1A3A5C;
          background: #FFBF00;
          color: #111;
          text-align: center;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: 0.08em;
          direction: ltr;
        }

        .report-section {
          break-inside: avoid;
          margin-top: 9px;
        }

        .report-section h2 {
          margin: 0 0 5px;
          font-size: 12px;
          color: #2D5233;
          border-bottom: 1px solid #E5ECE6;
          padding-bottom: 3px;
        }

        .report-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 4px;
        }

        .report-field {
          min-height: 31px;
          border-radius: 8px;
          border: 1px solid #E5ECE6;
          background: #FBFCFB;
          padding: 4px 6px;
        }

        .report-field span {
          display: block;
          font-size: 7.5px;
          color: #7C887F;
          font-weight: 700;
          margin-bottom: 1px;
        }

        .report-field strong {
          display: block;
          font-size: 9px;
          line-height: 1.25;
          color: #162117;
          word-break: break-word;
        }

        .report-footer {
          margin-top: 10px;
          padding-top: 7px;
          border-top: 1px solid #E5ECE6;
          color: #6B766E;
          font-size: 7.8px;
          line-height: 1.35;
        }
      }
    `}</style>
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
    fuelTypeSpec: 'סוג דלק לפי מפרט',
    transmission: 'תיבת הילוכים',
    horsepower: 'כוח סוס',
    drivetrain: 'הנעה',
    vehicleClass: 'קבוצת רכב',
    bodyType: 'מרכב',
    engineModel: 'דגם מנוע',
    engineNumber: 'מספר מנוע',
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
    emptyWeight: 'משקל עצמי',
    payloadCapacity: 'כושר העמסה',
    countryOfOrigin: 'ארץ ייצור',
    co2: 'פליטת פחמן',
    greenIndex: 'מדד ירוק',
    towCapacity: 'כושר גרירה',
    hasTowHitch: 'וו גרירה',
    euClass: 'סיווג אירופי',
    ac: 'מזגן',
    abs: 'מערכת בלימה',
    current: 'בעלות נוכחית',
    hand: 'יד',
    history: 'היסטוריית בעלות',
    isPersonalImport: 'יבוא אישי',
    personalImportType: 'סוג יבוא אישי',
    activeSameModelCount: 'פעילים מאותו דגם בישראל',
    activeSameModelColorCount: 'פעילים מאותו דגם וצבע',
    activeSameModelColorName: 'צבע בדיקה',
    marina: 'מרינה',
    flagCountry: 'דגל',
    offroadUsageType: 'שימוש שטח',
  })[key] || key;
}
