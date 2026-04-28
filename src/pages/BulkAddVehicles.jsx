/**
 * Phase 9, Step 11 — Bulk vehicle import (manager only).
 *
 * 3 step wizard for importing many vehicles in one go:
 *   1. Input  — paste plate numbers OR upload an Excel/CSV file.
 *   2. Review — shows MoT lookup + duplicate detection results in
 *      three categorized sections. Manager picks what to import.
 *   3. Result — summary + manual list of plates that need
 *      hand-entry because MoT had no record.
 *
 * Uses the SAME enrichment path as the manual AddVehicle flow
 * (lookupVehicleByPlate from vehicleLookup.js), and the SAME column
 * set on insert (via bulk_add_vehicles RPC). This guarantees imported
 * vehicles are byte-equivalent to manually-added ones.
 */
import React, { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, ClipboardList, ArrowLeft, ArrowRight, Loader2,
  CheckCircle2, AlertTriangle, X, Copy, FileWarning, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { lookupVehicleByPlate } from '@/services/vehicleLookup';
import { createPageUrl } from '@/utils';

const LOOKUP_CONCURRENCY = 5;

// ---------- helpers ---------------------------------------------------

function normalizePlate(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

function parsePastedText(text) {
  return Array.from(new Set(
    text
      .split(/[\r\n]+/)
      .map(line => line.split(/[\t,;]/)[0])
      .map(normalizePlate)
      .filter(Boolean)
  ));
}

async function parseXlsxFile(file) {
  // Lazy load to keep bundle out of the main chunk.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  return Array.from(new Set(
    rows
      .map(row => Array.isArray(row) ? row[0] : null)
      .map(normalizePlate)
      .filter(Boolean)
  ));
}

async function lookupAll(plates, onProgress) {
  const results = [];
  let done = 0;
  for (let i = 0; i < plates.length; i += LOOKUP_CONCURRENCY) {
    const chunk = plates.slice(i, i + LOOKUP_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (plate) => {
        try {
          const data = await lookupVehicleByPlate(plate);
          return { plate, data, error: null };
        } catch (err) {
          return { plate, data: null, error: err?.message || 'lookup_failed' };
        } finally {
          done++;
          onProgress(done, plates.length);
        }
      })
    );
    results.push(...chunkResults);
  }
  return results;
}

// ---------- main component -------------------------------------------

export default function BulkAddVehicles() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, isLoading: roleLoading } = useWorkspaceRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep]     = useState('input'); // 'input' | 'review' | 'result'
  const [plates, setPlates] = useState([]);      // array of normalized plate strings
  const [rows, setRows]     = useState([]);      // [{plate, data, error, status, included}]
  const [progress, setProgress]     = useState({ done: 0, total: 0 });
  const [importResult, setImportResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Existing fleet plates — used to detect duplicates client-side
  // before submission. The RPC also rechecks server-side.
  const { data: existingPlates = new Set() } = useQuery({
    queryKey: ['bulk-add-existing-plates', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('license_plate')
        .eq('account_id', accountId);
      if (error) throw error;
      return new Set((data || []).map(v => normalizePlate(v.license_plate)).filter(Boolean));
    },
    enabled: !!accountId && canManageRoutes && isBusiness,
    staleTime: 60 * 1000,
  });

  // ---------- guards ------------------------------------------------

  if (authLoading || roleLoading) {
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;
  }
  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לייבא רכבים." />;
  }
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="ייבוא מרובה זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון."
      />
    );
  }
  if (!canManageRoutes) {
    return (
      <Empty
        icon={<Upload className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לייבוא רכבים"
        text="ייבוא מרובה שמור לבעלים ולמנהלי החשבון."
      />
    );
  }

  // ---------- handlers ----------------------------------------------

  const startReview = async () => {
    if (plates.length === 0) { toast.error('הוסף לפחות מספר רישוי אחד'); return; }
    setStep('review');
    setProgress({ done: 0, total: plates.length });

    const results = await lookupAll(plates, (done, total) => setProgress({ done, total }));

    const enriched = results.map(r => {
      let status;
      if (existingPlates.has(r.plate)) status = 'duplicate';
      else if (r.error) status = 'error';
      else if (!r.data)  status = 'not_found';
      else               status = 'found';
      return { ...r, status, included: status === 'found' };
    });

    setRows(enriched);
  };

  const submitImport = async () => {
    const toImport = rows.filter(r => r.included && r.status === 'found');
    if (toImport.length === 0) { toast.error('אין רכבים להוסיף'); return; }

    setSubmitting(true);
    try {
      const payload = toImport.map(r => ({
        license_plate: r.plate,
        ...sanitizeFromMoT(r.data),
      }));

      const { data, error } = await supabase.rpc('bulk_add_vehicles', {
        p_account_id: accountId,
        p_vehicles:   payload,
      });
      if (error) throw error;

      setImportResult({
        ...data,
        notFoundPlates: rows.filter(r => r.status === 'not_found').map(r => r.plate),
      });
      setStep('result');
      // Invalidate the cached vehicle lists so the Fleet table, dashboards
      // and the in-page duplicate check (existingPlates) all reflect the
      // newly added vehicles immediately. Without this, "ייבא עוד" right
      // after a successful import would let the user re-submit the same
      // plates because the dedupe Set is still the pre-import snapshot.
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles-list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['bulk-add-existing-plates', accountId] });
      toast.success(`${data.added_count} רכבים נוספו לצי`);
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_manager')) toast.error('אין לך הרשאת מנהל');
      else if (msg.includes('invalid_input'))         toast.error('קלט לא תקין');
      else                                             toast.error('הייבוא נכשל. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('bulk_add_vehicles failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep('input');
    setPlates([]);
    setRows([]);
    setProgress({ done: 0, total: 0 });
    setImportResult(null);
  };

  // ---------- render ------------------------------------------------

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">ייבוא מרובה רכבים</h1>
        <p className="text-xs text-gray-500">העלה קובץ אקסל או הדבק רשימת מספרי רישוי. המערכת תאתר את הרכבים אצל משרד התחבורה ותוסיף אותם אוטומטית.</p>
      </div>

      <Stepper current={step} />

      {step === 'input' && (
        <InputStep
          onPlatesParsed={(p) => setPlates(p)}
          onContinue={startReview}
          plates={plates}
        />
      )}

      {step === 'review' && (
        <ReviewStep
          rows={rows}
          progress={progress}
          submitting={submitting}
          onChangeIncluded={(plate, included) => {
            setRows(prev => prev.map(r => r.plate === plate ? { ...r, included } : r));
          }}
          onSubmit={submitImport}
          onBack={() => { setStep('input'); setRows([]); }}
        />
      )}

      {step === 'result' && (
        <ResultStep
          result={importResult}
          onDone={() => navigate(createPageUrl('Fleet'))}
          onRestart={reset}
        />
      )}
    </div>
  );
}

// ---------- Stepper ---------------------------------------------------

function Stepper({ current }) {
  const steps = [
    { key: 'input',  label: '1. בחירת רכבים' },
    { key: 'review', label: '2. בדיקה ואישור' },
    { key: 'result', label: '3. סיום' },
  ];
  const idx = steps.findIndex(s => s.key === current);
  return (
    <ol className="flex gap-2 mb-5">
      {steps.map((s, i) => {
        const isCurrent = i === idx;
        const isPast    = i < idx;
        return (
          <li key={s.key} className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-center ${
            isCurrent ? 'bg-[#2D5233] text-white'
                      : isPast ? 'bg-[#E8F2EA] text-[#2D5233]'
                               : 'bg-gray-100 text-gray-400'
          }`}>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Step 1: Input --------------------------------------------

function InputStep({ onPlatesParsed, onContinue, plates }) {
  const [mode, setMode]   = useState('paste');
  const [text, setText]   = useState('');
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing]   = useState(false);
  const fileRef = useRef(null);

  const handleTextChange = (v) => {
    setText(v);
    onPlatesParsed(parsePastedText(v));
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    try {
      const parsed = await parseXlsxFile(file);
      onPlatesParsed(parsed);
      if (parsed.length === 0) toast.error('לא נמצאו מספרי רישוי תקינים בקובץ');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('xlsx parse failed:', err);
      toast.error('הקריאה מהקובץ נכשלה. ודא שזה קובץ אקסל תקין.');
    } finally {
      setParsing(false);
    }
  };

  return (
    <section>
      {/* Mode tabs */}
      <div className="flex gap-1 mb-4 bg-gray-50 rounded-xl p-1">
        <TabBtn active={mode === 'paste'} onClick={() => setMode('paste')}>
          <ClipboardList className="h-3.5 w-3.5" /> הדבק רשימה
        </TabBtn>
        <TabBtn active={mode === 'file'}  onClick={() => setMode('file')}>
          <FileSpreadsheet className="h-3.5 w-3.5" /> העלה קובץ אקסל
        </TabBtn>
      </div>

      {mode === 'paste' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            רשימת מספרי רישוי
          </label>
          <textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            rows={10}
            placeholder={'לדוגמה:\n1234567\n89-012-34\n5566778\n\nאפשר גם להעתיק עמודה ישירות מאקסל. מספר רישוי בעמודה הראשונה.'}
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white font-mono"
          />
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
            שורה אחת לכל רכב. ספרות בלבד. אם יש טאבים או פסיקים, רק העמודה הראשונה תיקח. הסטטוסים שנמצאו במאגר משרד התחבורה יציגו בשלב הבא.
          </p>
        </div>
      )}

      {mode === 'file' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <label className="block text-xs font-bold text-gray-700 mb-2">קובץ אקסל</label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full py-8 rounded-xl border-2 border-dashed border-gray-200 hover:border-[#2D5233] active:bg-gray-50 flex flex-col items-center gap-2 transition-colors"
          >
            <Upload className="h-7 w-7 text-gray-400" />
            <p className="text-sm font-bold text-gray-700">לחץ לבחירת קובץ</p>
            <p className="text-[11px] text-gray-500">תומך ב xlsx, xls, csv</p>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {parsing && (
            <p className="text-xs text-gray-500 mt-3 flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> מנתח את הקובץ...
            </p>
          )}
          {!parsing && fileName && (
            <p className="text-[11px] text-gray-600 mt-3 truncate">
              קובץ: <span className="font-bold">{fileName}</span>
            </p>
          )}
          <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
            המערכת קוראת את העמודה הראשונה בגיליון הראשון. ספרות בלבד יחשבו כמספר רישוי.
          </p>
        </div>
      )}

      {/* Summary + continue */}
      <div className="flex items-center justify-between mt-4 px-1">
        <p className="text-xs text-gray-600">
          {plates.length === 0
            ? 'עוד לא הוזנו מספרי רישוי'
            : <><span className="font-bold text-gray-900">{plates.length}</span> מספרי רישוי תקינים זוהו</>}
        </p>
        <button
          type="button"
          onClick={onContinue}
          disabled={plates.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98] disabled:opacity-50"
        >
          המשך לבדיקה
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}

function TabBtn({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
        active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
      }`}
    >
      {children}
    </button>
  );
}

// ---------- Step 2: Review ------------------------------------------

function ReviewStep({ rows, progress, submitting, onChangeIncluded, onSubmit, onBack }) {
  const found     = rows.filter(r => r.status === 'found');
  const duplicate = rows.filter(r => r.status === 'duplicate');
  const notFound  = rows.filter(r => r.status === 'not_found');
  const errored   = rows.filter(r => r.status === 'error');

  const isLookingUp = progress.total > 0 && progress.done < progress.total;
  const includedCount = found.filter(r => r.included).length;

  return (
    <section className="space-y-4">

      {isLookingUp ? (
        <ProgressCard done={progress.done} total={progress.total} />
      ) : (
        <SummaryCounts
          found={found.length}
          duplicate={duplicate.length}
          notFound={notFound.length}
          errored={errored.length}
        />
      )}

      {!isLookingUp && found.length > 0 && (
        <Group
          tone="green"
          icon={<CheckCircle2 className="h-4 w-4 text-green-700" />}
          title={`מוכנים לייבוא (${found.length})`}
          subtitle="בטל סימון של רכב שאתה לא רוצה להוסיף עכשיו."
        >
          <ul className="space-y-1.5">
            {found.map(r => (
              <FoundRow key={r.plate} row={r} onToggle={onChangeIncluded} />
            ))}
          </ul>
        </Group>
      )}

      {!isLookingUp && duplicate.length > 0 && (
        <Group
          tone="gray"
          icon={<FileWarning className="h-4 w-4 text-gray-500" />}
          title={`כבר בצי (${duplicate.length})`}
          subtitle="הרכבים האלה כבר קיימים בחשבון העסקי הזה. דולגים."
        >
          <ul className="space-y-1.5">
            {duplicate.map(r => (
              <SimpleRow key={r.plate} plate={r.plate} note="כבר קיים בצי" />
            ))}
          </ul>
        </Group>
      )}

      {!isLookingUp && notFound.length > 0 && (
        <Group
          tone="yellow"
          icon={<AlertTriangle className="h-4 w-4 text-yellow-700" />}
          title={`לא נמצאו במשרד התחבורה (${notFound.length})`}
          subtitle="אלה מספרים שאין עליהם מידע במאגר. אפשר להוסיף אותם ידנית עם הפרטים שיש לך."
        >
          <ul className="space-y-1.5">
            {notFound.map(r => (
              <SimpleRow
                key={r.plate}
                plate={r.plate}
                note="אין נתונים במאגר"
                action={
                  <Link
                    to={createPageUrl('AddVehicle') + `?plate=${r.plate}`}
                    className="text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5 shrink-0"
                  >
                    הוסף ידנית
                    <ArrowLeft className="h-3 w-3" />
                  </Link>
                }
              />
            ))}
          </ul>
          <CopyPlatesButton plates={notFound.map(r => r.plate)} />
        </Group>
      )}

      {!isLookingUp && errored.length > 0 && (
        <Group
          tone="red"
          icon={<X className="h-4 w-4 text-red-700" />}
          title={`שגיאת חיפוש (${errored.length})`}
          subtitle="חיפוש המידע נכשל. אפשר לנסות שוב או להוסיף ידנית."
        >
          <ul className="space-y-1.5">
            {errored.map(r => (
              <SimpleRow key={r.plate} plate={r.plate} note={r.error} />
            ))}
          </ul>
        </Group>
      )}

      {/* Footer actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold disabled:opacity-60"
        >
          חזרה
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || isLookingUp || includedCount === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98] disabled:opacity-50"
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> מייבא...</>
            : <>ייבא {includedCount} רכבים <ArrowRight className="h-3.5 w-3.5 rotate-180" /></>}
        </button>
      </div>
    </section>
  );
}

function ProgressCard({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="font-bold text-gray-900">בודק את המספרים מול משרד התחבורה</span>
        <span className="text-gray-500 tabular-nums">{done} מתוך {total}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-[#2D5233] transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[10px] text-gray-400 mt-2">חיפוש מקבילי, עד 5 בו זמנית. לוקח כדקה ל 100 רכבים.</p>
    </div>
  );
}

function SummaryCounts({ found, duplicate, notFound, errored }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Stat color="green"  value={found}     label="נמצאו" />
      <Stat color="gray"   value={duplicate} label="כפילויות" />
      <Stat color="yellow" value={notFound}  label="לא במאגר" />
      <Stat color="red"    value={errored}   label="שגיאות" />
    </div>
  );
}

function Stat({ color, value, label }) {
  const cls = {
    green:  'text-green-700 bg-green-50',
    gray:   'text-gray-700 bg-gray-100',
    yellow: 'text-yellow-700 bg-yellow-50',
    red:    'text-red-700 bg-red-50',
  }[color] || 'text-gray-700 bg-gray-100';
  return (
    <div className={`rounded-xl p-3 ${cls}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] font-bold opacity-80">{label}</p>
    </div>
  );
}

function Group({ tone, icon, title, subtitle, children }) {
  const borderCls = {
    green:  'border-green-100',
    gray:   'border-gray-100',
    yellow: 'border-yellow-100',
    red:    'border-red-100',
  }[tone] || 'border-gray-100';
  return (
    <div className={`bg-white border ${borderCls} rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      </div>
      {subtitle && <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">{subtitle}</p>}
      {children}
    </div>
  );
}

function FoundRow({ row, onToggle }) {
  const d = row.data || {};
  const label = [d.manufacturer, d.model].filter(Boolean).join(' ') || 'רכב';
  return (
    <li className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
      <input
        type="checkbox"
        checked={row.included}
        onChange={(e) => onToggle(row.plate, e.target.checked)}
        className="shrink-0 h-4 w-4 accent-[#2D5233]"
        aria-label={`כלול את ${row.plate}`}
      />
      <span className="text-[11px] font-mono px-2 py-0.5 bg-gray-50 rounded shrink-0">{row.plate}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 truncate">{label}</p>
        <p className="text-[11px] text-gray-500 truncate">
          {[d.year, d.vehicle_type].filter(Boolean).join(' · ')}
        </p>
      </div>
    </li>
  );
}

function SimpleRow({ plate, note, action }) {
  return (
    <li className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-[11px] font-mono px-2 py-0.5 bg-gray-50 rounded shrink-0">{plate}</span>
      <p className="flex-1 text-[11px] text-gray-500 truncate">{note}</p>
      {action}
    </li>
  );
}

function CopyPlatesButton({ plates }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plates.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('הההעתקה נכשלה');
    }
  };
  if (plates.length === 0) return null;
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-100 text-yellow-800 text-[11px] font-bold"
    >
      <Copy className="h-3 w-3" />
      {copied ? 'הועתק' : 'העתק רשימה'}
    </button>
  );
}

// ---------- Step 3: Result ------------------------------------------

function ResultStep({ result, onDone, onRestart }) {
  // Errors expand by default when present, so the user sees the cause
  // without an extra click.
  const [showErrors, setShowErrors] = useState(true);
  if (!result) return null;
  const { added_count = 0, skipped_count = 0, error_count = 0, errors = [], notFoundPlates = [] } = result;

  return (
    <section className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{added_count}</p>
        <p className="text-sm text-gray-600">רכבים נוספו לצי</p>
      </div>

      {(skipped_count > 0 || error_count > 0 || notFoundPlates.length > 0) && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-3">מה לא נכנס</h3>
          <ul className="space-y-2 text-xs">
            {skipped_count > 0 && (
              <li className="flex items-start gap-2">
                <FileWarning className="h-4 w-4 text-gray-500 shrink-0 mt-0.5" />
                <span><span className="font-bold">{skipped_count}</span> כפילויות. הרכבים האלה כבר היו בצי.</span>
              </li>
            )}
            {error_count > 0 && (
              <li className="flex items-start gap-2">
                <X className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowErrors(s => !s)}
                    className="text-right w-full"
                  >
                    <span className="font-bold">{error_count}</span> נכשלו עם שגיאה.{' '}
                    <span className="text-[#2D5233] font-bold">{showErrors ? 'הסתר פרטים' : 'הצג פרטים'}</span>
                  </button>
                  {showErrors && errors.length > 0 && (
                    <ul className="mt-2 space-y-1 bg-red-50 rounded-lg p-2 text-[10px]">
                      {errors.slice(0, 50).map((e, i) => (
                        <li key={i} className="text-red-900 break-all">
                          <span className="font-mono font-bold">{e.plate || 'ללא מספר'}</span>
                          <span className="text-red-700">{`: ${e.reason || 'שגיאה לא מזוהה'}`}</span>
                        </li>
                      ))}
                      {errors.length > 50 && (
                        <li className="text-red-700 text-center pt-1">
                          ... עוד {errors.length - 50} שגיאות
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </li>
            )}
            {notFoundPlates.length > 0 && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="mb-1">
                    <span className="font-bold">{notFoundPlates.length}</span> מספרי רישוי לא נמצאו במאגר משרד התחבורה.
                    יש להוסיף אותם ידנית.
                  </p>
                  <ul className="space-y-0.5 mt-2">
                    {notFoundPlates.map(p => (
                      <li key={p} className="flex items-center justify-between bg-yellow-50 rounded px-2 py-1">
                        <span className="font-mono">{p}</span>
                        <Link
                          to={createPageUrl('AddVehicle') + `?plate=${p}`}
                          className="text-[11px] font-bold text-[#2D5233] flex items-center gap-0.5"
                        >
                          הוסף ידנית
                          <ArrowLeft className="h-3 w-3" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <CopyPlatesButton plates={notFoundPlates} />
                </div>
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold"
        >
          ייבא עוד
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex-1 py-2.5 rounded-xl bg-[#2D5233] text-white text-xs font-bold"
        >
          לצי הרכבים
        </button>
      </div>
    </section>
  );
}

// ---------- Sanitize MoT data ----------------------------------------

// Whitelist of MoT fields safe to forward to bulk_add_vehicles.
// Excludes fields with non-scalar DB types (text[], jsonb objects)
// that are user-managed via the manual form and not provided by MoT
// in a useful way. Bulk import covers the registry-derived fields;
// user can edit each vehicle later for manual fields.
const ALLOWED_COLUMNS = new Set([
  'vehicle_type','manufacturer','model','year','nickname',
  'test_due_date','insurance_due_date','insurance_company',
  'current_km','current_engine_hours','fuel_type',
  'flag_country','engine_manufacturer',
  'front_tire','rear_tire','engine_model','color','last_test_date',
  'first_registration_date','ownership','model_code','trim_level','vin',
  'pollution_group','vehicle_class','safety_rating','horsepower','engine_cc',
  'drivetrain','total_weight','doors','seats','airbags','transmission',
  'body_type','country_of_origin','co2','green_index','tow_capacity',
  'inspection_report_expiry_date',
]);

function sanitizeFromMoT(data) {
  if (!data) return {};
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (!ALLOWED_COLUMNS.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    // Only forward scalar primitives (string / number / boolean).
    // Arrays and objects are dropped — they belong to user-managed
    // form sections (e.g. offroad_equipment checkboxes) that aren't
    // populated from the MoT registry.
    if (Array.isArray(v)) continue;
    if (typeof v === 'object') continue;
    out[k] = v;
  }
  return out;
}

// ---------- Empty -----------------------------------------------------

function Empty({ icon, title, text }) {
  return (
    <div dir="rtl" className="max-w-md mx-auto py-16">
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
