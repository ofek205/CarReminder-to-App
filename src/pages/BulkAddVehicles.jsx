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
import React, { useState, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, FileSpreadsheet, ClipboardList, ArrowLeft, ArrowRight, Loader2,
  CheckCircle2, AlertTriangle, X, Copy, FileWarning, Briefcase, HelpCircle, Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { lookupVehicleByPlate } from '@/services/vehicleLookup';
import { LEASING_COMPANIES, canonicalizeLeasingCompany } from '@/constants/leasingCompanies';
import { COPY_FEEDBACK_DURATION_MS } from '@/lib/timingConstants';
import { createPageUrl } from '@/utils';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import MultipleMatchDialog from '@/components/vehicle/MultipleMatchDialog';
import { C } from '@/lib/designTokens';

const LOOKUP_CONCURRENCY = 3;   // gentler on gov.il — each plate fans out to several registry queries

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One plate, retried on TRANSIENT failures only. lookupVehicleByPlate
// THROWS on fetch error / timeout (which we retry) but returns null for
// "not found" (a real result — never retried). Exponential backoff +
// jitter spreads retries so we don't immediately re-burst the server.
async function lookupOne(plate, attempts = 3) {
  let lastErr;
  for (let a = 0; a < attempts; a++) {
    try {
      return await lookupVehicleByPlate(plate);
    } catch (err) {
      lastErr = err;
      if (a < attempts - 1) await sleep(400 * 2 ** a + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

// ---------- helpers ---------------------------------------------------

function normalizePlate(raw) {
  const s = String(raw ?? '').trim();
  // A plate is digits with optional spaces / dashes — nothing else.
  // Reject URLs ("…/browse/GR-669"), codes, and free text so a pasted link
  // or sentence isn't mistaken for a plate just because a 4-8 digit run
  // happens to sit somewhere inside it.
  if (!s || !/^[\d\s-]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

// ── Multi-column parsing ────────────────────────────────────────────
// Input may carry up to 3 columns: license plate (required), nickname,
// and current km — in ANY order. We parse to a raw matrix of trimmed
// string cells, auto-detect which column is which (detectColumns), and
// derive typed rows (rowsFromMatrix). The detected mapping is shown to
// the user and can be overridden manually.

// Split one pasted/CSV line into cells. Tab and comma/semicolon are the
// only separators — SPACE never is (Hebrew names like "ישראל ישראלי"
// and "רכב מכירות" contain spaces). When a tab exists we split on tab
// only (Excel copy uses tabs) so a name containing a comma survives.
function splitCells(line) {
  const sep = line.includes('\t') ? /\t/ : /[,;]/;
  return line.split(sep).map(c => c.trim());
}

function parsePastedMatrix(text) {
  return String(text || '')
    .split(/[\r\n]+/)
    .filter(line => line.trim() !== '')
    .map(splitCells);
}

// Lenient km parser: strips thousands separators / units ("84,000",
// "84000 ק\"מ"), floors decimals, rejects out-of-range. Returns a
// number or null.
function parseKm(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[,\s]/g, '');
  s = s.replace(/[^\d.].*$/, '');            // cut at first non-digit (drops units)
  if (!s) return null;
  const n = Math.floor(Number(s));
  if (!Number.isFinite(n) || n < 0 || n > 9999999) return null;
  return n;
}

const _hasText      = (v) => /[^\d.,\s]/.test(String(v || ''));
const _isNumericCell = (v) => /^\s*\d[\d.,\s]*$/.test(String(v || ''));
// How plate-like a value is, by digit length. Canonical IL plates are
// 7-8 digits; 4-6 digits are CME/vintage but ALSO the typical km range,
// so they score lower. This disambiguates a numeric plate column from a
// km column when both pass the 4-8 digit plate check.
const _plateStrength = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 7 || d.length === 8) return 1;
  if (d.length >= 4 && d.length <= 6)   return 0.35;
  return 0;
};

// Decide which column is plate / nickname / km purely from CONTENT so
// column order doesn't matter. Also flags a leading header row (first
// row with no valid plate in any cell).
function detectColumns(matrix) {
  const empty = { plateCol: 0, nicknameCol: -1, kmCol: -1, leasingCol: -1, hasHeader: false };
  if (!matrix || matrix.length === 0) return empty;
  const ncols = Math.max(...matrix.map(r => r.length));
  const firstRowHasPlate = matrix[0].some(c => normalizePlate(c));
  const hasHeader = !firstRowHasPlate && matrix.length > 1;
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  const score = [];
  for (let c = 0; c < ncols; c++) {
    const vals = dataRows.map(r => (r[c] ?? '').trim()).filter(Boolean);
    const n = vals.length || 1;
    score.push({
      c,
      // Weighted plate-likeness: canonical 7-8 digit plates beat a 4-6
      // digit numeric column (usually km, even though it also passes the
      // 4-8 digit plate check). Disambiguates the common plate+km pair.
      plateW: vals.reduce((s, v) => s + _plateStrength(v), 0) / n,
      plateR: vals.filter(v => normalizePlate(v)).length / n,
      num:   vals.filter(_isNumericCell).length / n,
      text:  vals.filter(_hasText).length / n,
      lease: vals.filter(v => LEASING_COMPANIES.includes(canonicalizeLeasingCompany(v))).length / n,
    });
  }
  const anyPlates = score.some(s => s.plateR >= 0.5);
  const byPlate = [...score].sort((a, b) => b.plateW - a.plateW || b.plateR - a.plateR || a.c - b.c);
  const plateCol = anyPlates ? byPlate[0].c : (score[0]?.c ?? 0);

  const rest = score.filter(s => s.c !== plateCol);
  // Leasing first (most specific — values that match known company names).
  // A column filled with "אחר" companies not in the list won't auto-detect;
  // the user remaps it via the mapping banner.
  const byLease = [...rest].sort((a, b) => b.lease - a.lease || a.c - b.c);
  const leasingCol = byLease[0] && byLease[0].lease >= 0.3 ? byLease[0].c : -1;

  const byText = rest.filter(s => s.c !== leasingCol).sort((a, b) => b.text - a.text || a.c - b.c);
  const nicknameCol = byText[0] && byText[0].text >= 0.5 ? byText[0].c : -1;

  const byNum = rest.filter(s => s.c !== nicknameCol && s.c !== leasingCol).sort((a, b) => b.num - a.num || a.c - b.c);
  const kmCol = byNum[0] && byNum[0].num >= 0.5 ? byNum[0].c : -1;

  return { plateCol, nicknameCol, kmCol, leasingCol, hasHeader };
}

// Build typed, de-duplicated rows from the matrix + a column mapping.
function rowsFromMatrix(matrix, mapping) {
  if (!matrix || !mapping) return [];
  const { plateCol, nicknameCol, kmCol, leasingCol, hasHeader } = mapping;
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  const seen = new Set();
  const rows = [];
  for (const r of dataRows) {
    const plate = normalizePlate(r[plateCol]);
    if (!plate || seen.has(plate)) continue;
    seen.add(plate);
    const nickname = nicknameCol >= 0 ? String(r[nicknameCol] || '').trim().slice(0, 60) : '';
    const km = kmCol >= 0 ? parseKm(r[kmCol]) : null;
    const leasing = leasingCol >= 0 ? canonicalizeLeasingCompany(r[leasingCol]).slice(0, 60) : '';
    rows.push({ plate, nickname, km, leasing });
  }
  return rows;
}

// Defense-in-depth wrappers around spreadsheet parsing.
//
// Migrated from xlsx@0.18.5 (two unpatched CVEs) to exceljs which has
// no known vulnerabilities. The hardening guards remain as belt-and-
// suspenders:
//   1. Reject files larger than 5 MB or with an unexpected extension.
//   2. Race the parse against a 10-second timeout.
//   3. CSV files are parsed with a simple manual splitter (no library).
//   4. Downstream normalisation to digit-only plate strings (4-8 chars)
//      keeps the data surface tiny regardless.
//
// NOTE: .xls (old binary Excel format) is no longer supported — exceljs
// only handles the modern XML-based .xlsx/.xlsm. Users with .xls files
// get a friendly message to re-save as .xlsx.
const MAX_XLSX_BYTES   = 5 * 1024 * 1024;       // 5 MB
const PARSE_TIMEOUT_MS = 10_000;
const ALLOWED_EXTS     = new Set(['xlsx', 'csv', 'xlsm']);

function _parseCsvBuffer(buffer) {
  const text = new TextDecoder('utf-8').decode(buffer);
  return parsePastedMatrix(text);
}

async function parseXlsxFile(file) {
  // 1. Cheap pre-checks before we hand the buffer to exceljs.
  const name = (file?.name || '').toLowerCase();
  const ext  = name.split('.').pop() || '';
  if (ext === 'xls') throw new Error('פורמט .xls ישן לא נתמך — שמור את הקובץ מחדש כ-.xlsx ונסה שוב');
  if (!ALLOWED_EXTS.has(ext)) throw new Error('סוג קובץ לא נתמך — צריך xlsx, xlsm או csv');
  if (file.size > MAX_XLSX_BYTES) throw new Error('הקובץ גדול מדי (מקסימום 5MB)');

  const buffer = await file.arrayBuffer();

  // CSV — simple manual parse, no library needed.
  if (ext === 'csv') return _parseCsvBuffer(buffer);

  // XLSX / XLSM — use exceljs (lazy-loaded).
  const ExcelJS = await import('exceljs');

  const workbook = await Promise.race([
    new ExcelJS.Workbook().xlsx.load(buffer),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('עיבוד הקובץ ארך יותר מדי — נסה קובץ אחר')),
      PARSE_TIMEOUT_MS,
    )),
  ]);

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const matrix = [];
  sheet.eachRow((row) => {
    // row.values is 1-indexed (index 0 is undefined). Collect every cell
    // as a trimmed string, unwrapping exceljs rich-text / formula objects.
    const cells = [];
    for (let i = 1; i < row.values.length; i++) {
      const v = row.values[i];
      let s = '';
      if (v != null) {
        if (typeof v === 'object') s = v.text ?? v.result ?? v.hyperlink ?? '';
        else s = v;
      }
      cells.push(String(s).trim());
    }
    if (cells.some(c => c !== '')) matrix.push(cells);
  });
  return matrix;
}

async function lookupAll(inputRows, onProgress, opts = {}) {
  const { concurrency = LOOKUP_CONCURRENCY, delayMs = 200, attempts = 3 } = opts;
  const results = [];
  let done = 0;
  for (let i = 0; i < inputRows.length; i += concurrency) {
    const chunk = inputRows.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        // item = { plate, nickname, km } from the parsed input — carried
        // through so the review can pre-fill nickname + km per row.
        try {
          const raw = await lookupOne(item.plate, attempts);
          // Dual-registry collision (same plate in two MoT registries).
          // Do NOT auto-pick — carry the candidates so the user resolves
          // them per-row in the review step, exactly like the private flow.
          if (raw && raw._multipleMatches) {
            return { ...item, data: null, matches: raw.matches, error: null };
          }
          return { ...item, data: raw, matches: null, error: null };
        } catch (err) {
          return { ...item, data: null, matches: null, error: err?.message || 'lookup_failed' };
        } finally {
          done++;
          onProgress(done, inputRows.length);
        }
      })
    );
    results.push(...chunkResults);
    if (i + concurrency < inputRows.length && delayMs) await sleep(delayMs);
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

  const [step, setStep]       = useState('input'); // 'input' | 'review' | 'result'
  const [matrix, setMatrix]   = useState([]);      // raw parsed cells (rows × columns)
  const [mapping, setMapping] = useState(null);    // { plateCol, nicknameCol, kmCol, hasHeader }
  const [rows, setRows]       = useState([]);      // [{plate, nickname, current_km, data, status, included, ...}]
  // Typed input rows derived from the matrix + current column mapping.
  // Recomputed when the user pastes/uploads or remaps columns.
  const inputRows = useMemo(() => rowsFromMatrix(matrix, mapping), [matrix, mapping]);
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
    if (inputRows.length === 0) { toastError('הוסף לפחות מספר רישוי אחד', { action: 'bulk_add_no_plates' }); return; }
    setStep('review');
    setProgress({ done: 0, total: inputRows.length, phase: 'lookup' });

    let results = await lookupAll(
      inputRows,
      (done, total) => setProgress({ done, total, phase: 'lookup' }),
      { concurrency: 3, delayMs: 200, attempts: 3 },
    );

    // Auto-sweep transient failures (Failed to fetch / timeout). "Not found"
    // rows carry error:null and are never swept. Up to 2 extra passes with
    // lower concurrency + longer delay so the gov server has room to recover.
    for (let sweep = 0; sweep < 2; sweep++) {
      const failed = results.filter(r => r.error);
      if (failed.length === 0) break;
      await sleep(800);
      const retried = await lookupAll(
        failed,
        (done, total) => setProgress({ done, total, phase: 'retry' }),
        { concurrency: 2, delayMs: 400, attempts: 2 },
      );
      const byPlate = new Map(retried.map(r => [r.plate, r]));
      results = results.map(r => (r.error && byPlate.has(r.plate)) ? byPlate.get(r.plate) : r);
    }

    const enriched = results.map(r => {
      let status;
      if (existingPlates.has(r.plate)) status = 'duplicate';
      else if (r.error)    status = 'error';
      else if (r.matches)  status = 'needs_choice';
      else if (!r.data)    status = 'not_found';
      else                 status = 'found';
      // KM precedence: the manager's input km → MoT last-test odometer
      // (data.current_km, best-effort) → empty for manual entry.
      const km = r.km != null ? r.km : (r.data?.current_km ?? '');
      return {
        ...r,
        status,
        included: status === 'found',
        nickname: r.nickname || '',
        current_km: (km === null || km === undefined) ? '' : km,
        leasing_company: r.leasing || '',
      };
    });

    setRows(enriched);
  };

  const submitImport = async () => {
    const toImport = rows.filter(r => r.included && r.status === 'found');
    if (toImport.length === 0) { toastError('אין רכבים להוסיף', { action: 'bulk_add_nothing_to_import' }); return; }

    setSubmitting(true);
    try {
      const payload = toImport.map(r => {
        const cleaned = sanitizeFromMoT(r.data);
        const nick = (r.nickname || '').trim();
        // Match the manual AddVehicle sanitiser: integer 0–9,999,999.
        // Anything outside that drops the field rather than sending a
        // bogus value. The bulk RPC also strips empty strings so this
        // is belt-and-suspenders.
        const kmRaw = r.current_km;
        const kmNum = (kmRaw === '' || kmRaw == null) ? null : Number(kmRaw);
        const kmValid = Number.isFinite(kmNum) && kmNum >= 0 && kmNum <= 9999999;
        return {
          license_plate: r.plate,
          ...cleaned,
          // User-typed nickname overrides whatever MoT returned
          // (registry rarely sets one anyway). Empty string is dropped.
          ...(nick ? { nickname: nick.slice(0, 60) } : {}),
          ...(kmValid ? { current_km: kmNum } : {}),
          ...((r.leasing_company || '').trim() ? { leasing_company: (r.leasing_company || '').trim().slice(0, 60) } : {}),
        };
      });

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
      if      (msg.includes('forbidden_not_manager')) toastError('אין לך הרשאת מנהל', { action: 'bulk_add_forbidden', err });
      else if (msg.includes('invalid_input'))         toastError('קלט לא תקין', { action: 'bulk_add_invalid_input', err });
      else                                             toastError('הייבוא נכשל. נסה שוב.', { action: 'bulk_add_import', err });
       
      console.error('bulk_add_vehicles failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setStep('input');
    setMatrix([]);
    setMapping(null);
    setRows([]);
    setProgress({ done: 0, total: 0 });
    setImportResult(null);
  };

  // ---------- render ------------------------------------------------

  return (
    <PageShell
      backTo="Fleet"
      title="ייבוא מרובה רכבים"
      subtitle="העלה קובץ אקסל או הדבק רשימת מספרי רישוי. המערכת תאתר את הרכבים אצל משרד התחבורה ותוסיף אותם אוטומטית."
    >
      <Stepper current={step} />

      {step === 'input' && (
        <InputStep
          onMatrixParsed={(m) => { setMatrix(m); setMapping(detectColumns(m)); }}
          onMappingChange={setMapping}
          onContinue={startReview}
          matrix={matrix}
          mapping={mapping}
          inputRows={inputRows}
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
          onChangeNickname={(plate, nickname) => {
            setRows(prev => prev.map(r => r.plate === plate ? { ...r, nickname } : r));
          }}
          onChangeKm={(plate, km) => {
            setRows(prev => prev.map(r => r.plate === plate ? { ...r, current_km: km } : r));
          }}
          onResolveMatch={(plate, chosenFields) => {
            setRows(prev => prev.map(r => {
              if (r.plate !== plate) return r;
              // Keep the km already on the row (from input); otherwise adopt
              // the chosen candidate's MoT odometer if it has one.
              const km = (r.current_km !== '' && r.current_km != null)
                ? r.current_km
                : (chosenFields?.current_km ?? '');
              return {
                ...r, data: chosenFields, matches: null, status: 'found', included: true,
                current_km: (km === null || km === undefined) ? '' : km,
              };
            }));
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
    </PageShell>
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
        // Tone vocabulary:
        //   current → emerald gradient (active focal point)
        //   past    → emerald soft (visited, done)
        //   future  → mint outline (pending)
        const style = isCurrent
          ? {
              background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(16,185,129,0.32)',
            }
          : isPast
            ? { background: C.successLight, color: C.successDark }
            : { background: '#FFFFFF', color: C.borderAlt, border: `1px dashed ${C.successLight}` };
        return (
          <li
            key={s.key}
            className="flex-1 px-3 py-2 rounded-xl text-[11px] font-bold text-center transition-all"
            style={style}
          >
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Step 1: Input --------------------------------------------

function InputStep({ onMatrixParsed, onMappingChange, onContinue, matrix, mapping, inputRows }) {
  const [mode, setMode]   = useState('paste');
  const [text, setText]   = useState('');
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing]   = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const fileRef = useRef(null);

  const handleTextChange = (v) => {
    setText(v);
    onMatrixParsed(parsePastedMatrix(v));
  };

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    try {
      const parsed = await parseXlsxFile(file);
      onMatrixParsed(parsed);
      if (parsed.length === 0) toastError('לא נמצאו מספרי רישוי תקינים בקובץ', { action: 'bulk_add_no_plates_in_file' });
    } catch (err) {
       
      console.error('xlsx parse failed:', err);
      toastError('הקריאה מהקובץ נכשלה. ודא שזה קובץ אקסל תקין.', { action: 'bulk_add_xlsx_parse', err });
    } finally {
      setParsing(false);
    }
  };

  return (
    <section>
      {/* Mode tabs + format guide */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-1 flex-1 bg-gray-50 rounded-xl p-1">
          <TabBtn active={mode === 'paste'} onClick={() => setMode('paste')}>
            <ClipboardList className="h-3.5 w-3.5" /> הדבק רשימה
          </TabBtn>
          <TabBtn active={mode === 'file'}  onClick={() => setMode('file')}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> העלה קובץ אקסל
          </TabBtn>
        </div>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className="shrink-0 flex items-center gap-1 px-3 h-9 rounded-xl text-xs font-bold text-[#2D5233] bg-[#2D5233]/10 hover:bg-[#2D5233]/20 transition-colors"
          aria-label="מדריך: איך מכינים את הרשימה"
        >
          <HelpCircle className="h-4 w-4" />
          מדריך
        </button>
      </div>

      {mode === 'paste' && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <label className="block text-xs font-bold text-gray-700 mb-1.5">
            רשימת רכבים
          </label>
          <Textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            rows={10}
            placeholder={'לדוגמה (אפשר להעתיק ישר מאקסל):\n12-345-67\tיוסי כהן\t84000\n7654321\tרכב מכירות\t51200'}
            className="rounded-xl text-sm font-mono"
            dir="rtl"
          />
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
            שורה לכל רכב. אפשר להדביק כמה עמודות — מספר רישוי, כינוי וק״מ — ונזהה כל אחת.{' '}
            <button type="button" onClick={() => setShowGuide(true)} className="font-bold text-[#2D5233] underline">צריך עזרה עם הפורמט?</button>
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
            <p className="text-[11px] text-gray-500">תומך ב xlsx, csv</p>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.csv"
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
            עד 3 עמודות: מספר רישוי (חובה), כינוי וק״מ — בכל סדר. שורת כותרת? נדלג עליה.{' '}
            <button type="button" onClick={() => setShowGuide(true)} className="font-bold text-[#2D5233] underline">מדריך הפורמט</button>
          </p>
        </div>
      )}

      {/* Column mapping — appears once something is parsed, so the user can
          correct detection if it guessed wrong (the "many options" safety net). */}
      {matrix.length > 0 && mapping && (
        <ColumnMappingBanner matrix={matrix} mapping={mapping} onChange={onMappingChange} />
      )}

      {/* Summary + continue */}
      <div className="flex items-center justify-between mt-4 px-1">
        <p className="text-xs text-gray-600">
          {inputRows.length === 0
            ? (matrix && matrix.length > 0
                ? 'לא זוהו מספרי רישוי תקינים — נדרשות 4-8 ספרות (ללא אותיות או קישורים)'
                : 'עוד לא הוזנו מספרי רישוי')
            : (<>
                <span className="font-bold text-gray-900">{inputRows.length}</span> רכבים זוהו
                {inputRows.filter(r => r.nickname).length > 0 && <> · {inputRows.filter(r => r.nickname).length} עם כינוי</>}
                {inputRows.filter(r => r.km != null).length > 0 && <> · {inputRows.filter(r => r.km != null).length} עם ק״מ</>}
              </>)}
        </p>
        <button
          type="button"
          onClick={onContinue}
          disabled={inputRows.length === 0}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
            color: '#FFFFFF',
            boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
          }}
        >
          המשך לבדיקה
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <FormatGuideModal open={showGuide} onClose={() => setShowGuide(false)} />
    </section>
  );
}

// ── Column mapping banner ───────────────────────────────────────────
// Shows the auto-detected role of each column with a dropdown to change
// it — the user's escape hatch when detection guesses wrong.
function roleOfColumn(mapping, c) {
  if (mapping.plateCol === c)    return 'plate';
  if (mapping.nicknameCol === c) return 'nickname';
  if (mapping.kmCol === c)       return 'km';
  if (mapping.leasingCol === c)  return 'leasing';
  return 'ignore';
}

function setColumnRole(mapping, col, role) {
  const m = { ...mapping };
  // Drop col from whatever role it currently holds.
  if (m.plateCol === col)    m.plateCol = -1;
  if (m.nicknameCol === col) m.nicknameCol = -1;
  if (m.kmCol === col)       m.kmCol = -1;
  if (m.leasingCol === col)  m.leasingCol = -1;
  // Assign the new role (each role field holds a single column → uniqueness).
  if (role === 'plate')    m.plateCol = col;
  else if (role === 'nickname') m.nicknameCol = col;
  else if (role === 'km')  m.kmCol = col;
  else if (role === 'leasing') m.leasingCol = col;
  return m;
}

function ColumnMappingBanner({ matrix, mapping, onChange }) {
  const ncols = Math.max(...matrix.map(r => r.length), 0);
  const sampleRow = (mapping.hasHeader ? matrix[1] : matrix[0]) || [];
  const noPlate = mapping.plateCol == null || mapping.plateCol < 0;
  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Info className="h-4 w-4 text-blue-600 shrink-0" />
        <p className="text-[12px] font-bold text-blue-900">זיהינו את העמודות כך — אפשר לשנות</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: ncols }).map((_, c) => {
          const role = roleOfColumn(mapping, c);
          const ignored = role === 'ignore';
          return (
            <div key={c} className={`relative flex flex-col gap-1 rounded-lg border px-2 py-1.5 min-w-[108px] ${ignored ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-blue-100'}`}>
              {/* Inclusion is a separate action from role: ✕ drops the column,
                  "כלול" brings it back. Keeps the role dropdown purely semantic. */}
              {!ignored && (
                <button
                  type="button"
                  onClick={() => onChange(setColumnRole(mapping, c, 'ignore'))}
                  aria-label={`אל תייבא עמודה ${c + 1}`}
                  className="absolute -top-1.5 -left-1.5 h-5 w-5 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <span dir="ltr" className="text-[10px] font-mono text-gray-500 truncate text-left">{sampleRow[c] || '—'}</span>
              {ignored ? (
                <button
                  type="button"
                  onClick={() => onChange(setColumnRole(mapping, c, 'nickname'))}
                  className="text-[11px] font-bold text-blue-700 hover:underline py-1 text-right"
                >
                  + כלול עמודה
                </button>
              ) : (
                <select
                  value={role}
                  onChange={(e) => onChange(setColumnRole(mapping, c, e.target.value))}
                  className="text-[11px] font-bold rounded-md border border-gray-200 px-1 py-1 bg-white"
                  aria-label={`תפקיד עמודה ${c + 1}`}
                >
                  <option value="plate">מספר רישוי</option>
                  <option value="nickname">כינוי</option>
                  <option value="km">ק״מ</option>
                  <option value="leasing">חברת ליסינג</option>
                </select>
              )}
            </div>
          );
        })}
      </div>
      {noPlate && (
        <p className="text-[11px] text-red-600 font-medium mt-2">בחר עמודה אחת בתור "מספר רישוי" — זו עמודת חובה.</p>
      )}
    </div>
  );
}

// ── Format guide modal ──────────────────────────────────────────────
function GuideWhy() {
  return (
    <div className="rounded-lg bg-[#2D5233]/5 border border-[#2D5233]/10 p-2.5">
      <p className="text-[12px] font-bold text-[#2D5233] mb-0.5">למה כדאי?</p>
      <p className="text-[12px] text-gray-600 leading-relaxed">כינוי, ק״מ וחברת ליסינג שתכלול ייכנסו אוטומטית — פחות הקלדה. והק״מ שלך גובר על מה שרשום במשרד התחבורה.</p>
    </div>
  );
}

function FormatGuideModal({ open, onClose }) {
  const [tab, setTab] = useState('paste');
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5 shadow-2xl">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">איך מכינים את הרשימה?</h2>
          <button onClick={onClose} aria-label="סגור" className="p-1 -m-1 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-xs text-gray-500 mb-4">כדי שהשמות והק״מ ייכנסו אוטומטית — בלי להקליד כל רכב ביד.</p>

        <div className="flex gap-1 mb-4 bg-gray-50 rounded-xl p-1">
          <button type="button" onClick={() => setTab('paste')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${tab === 'paste' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>הדבקה</button>
          <button type="button" onClick={() => setTab('file')}  className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${tab === 'file'  ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>אקסל</button>
        </div>

        {tab === 'paste' ? (
          <div className="space-y-3 text-[13px] text-gray-700">
            <ul className="space-y-1.5 list-disc pr-4">
              <li>שורה אחת לכל רכב.</li>
              <li>אפשר להעתיק ישר מאקסל — העמודות יישמרו.</li>
              <li>עד 4 עמודות: <b>מספר רישוי</b> (חובה), <b>כינוי</b>, <b>ק״מ</b>, <b>חברת ליסינג</b> — בכל סדר, נזהה לבד.</li>
            </ul>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-2.5 font-mono text-[11px] text-gray-700 space-y-0.5">
              <div><span dir="ltr">12-345-67</span> · יוסי כהן · <span dir="ltr">84000</span> · שלמה SIXT</div>
              <div><span dir="ltr">7654321</span> · רכב מכירות · <span dir="ltr">51200</span> · אלבר</div>
            </div>
            <GuideWhy />
          </div>
        ) : (
          <div className="space-y-3 text-[13px] text-gray-700">
            <ul className="space-y-1.5 list-disc pr-4">
              <li>קובץ <span dir="ltr" className="font-mono">xlsx</span> או <span dir="ltr" className="font-mono">csv</span>, עד 5MB.</li>
              <li>עד 4 עמודות: <b>מספר רישוי</b> (חובה), <b>כינוי</b>, <b>ק״מ</b>, <b>חברת ליסינג</b>.</li>
              <li>יש שורת כותרת? אין בעיה — נדלג עליה.</li>
              <li>הסדר גמיש — נזהה כל עמודה לפי התוכן.</li>
            </ul>
            <GuideWhy />
          </div>
        )}

        <button type="button" onClick={onClose} className="w-full mt-5 py-2.5 rounded-xl bg-[#2D5233] text-white text-sm font-bold">הבנתי</button>
      </div>
    </div>
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

function ReviewStep({ rows, progress, submitting, onChangeIncluded, onChangeNickname, onChangeKm, onResolveMatch, onSubmit, onBack }) {
  const found       = rows.filter(r => r.status === 'found');
  const needsChoice = rows.filter(r => r.status === 'needs_choice');
  const duplicate   = rows.filter(r => r.status === 'duplicate');
  const notFound    = rows.filter(r => r.status === 'not_found');
  const errored     = rows.filter(r => r.status === 'error');

  // Which needs_choice row is currently open in the multi-match dialog.
  const [choosingPlate, setChoosingPlate] = useState(null);
  const choosingRow = rows.find(r => r.plate === choosingPlate) || null;

  const isLookingUp = progress.total > 0 && progress.done < progress.total;
  const includedCount = found.filter(r => r.included).length;

  return (
    <section className="space-y-4">

      {isLookingUp ? (
        <ProgressCard done={progress.done} total={progress.total} phase={progress.phase} />
      ) : (
        <SummaryCounts
          found={found.length}
          needsChoice={needsChoice.length}
          duplicate={duplicate.length}
          notFound={notFound.length}
          errored={errored.length}
        />
      )}

      {!isLookingUp && needsChoice.length > 0 && (
        <Group
          tone="orange"
          icon={<HelpCircle className="h-4 w-4 text-orange-600" />}
          title={`דרושה בחירה (${needsChoice.length})`}
          subtitle="המספרים האלה רשומים במשרד התחבורה כיותר מרכב אחד. בחר את הרכב הנכון כדי לכלול אותו בייבוא — מה שלא ייבחר לא ייובא."
        >
          <ul className="space-y-1.5">
            {needsChoice.map(r => (
              <NeedsChoiceRow key={r.plate} row={r} onChoose={() => setChoosingPlate(r.plate)} />
            ))}
          </ul>
        </Group>
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
              <FoundRow key={r.plate} row={r} onToggle={onChangeIncluded} onNicknameChange={onChangeNickname} onKmChange={onChangeKm} />
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

      <MultipleMatchDialog
        open={!!choosingRow}
        plate={choosingRow?.plate}
        matches={choosingRow?.matches || []}
        questionCopy="איזה מהם הרכב שברצונך להוסיף לצי?"
        cancelCopy="סגור — אבחר אחר כך"
        titleId="bulk-multimatch-title"
        onChoose={(idx) => {
          const fields = choosingRow?.matches?.[idx]?.fields || null;
          if (choosingRow) onResolveMatch(choosingRow.plate, fields);
          setChoosingPlate(null);
        }}
        onCancel={() => setChoosingPlate(null)}
      />

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
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
            color: '#FFFFFF',
            boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
          }}
        >
          {submitting
            ? <><Loader2 className="h-4 w-4 animate-spin" /> מייבא...</>
            : <>ייבא {includedCount} רכבים <ArrowRight className="h-3.5 w-3.5 rotate-180" /></>}
        </button>
      </div>
    </section>
  );
}

function ProgressCard({ done, total, phase }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <Card accent="emerald">
      <div className="flex items-center justify-between mb-2 text-xs">
        <span className="font-bold" style={{ color: C.primaryDark }}>{phase === 'retry' ? 'מנסה שוב את מי שלא נענה' : 'בודק את המספרים מול משרד התחבורה'}</span>
        <span className="tabular-nums" style={{ color: C.textAlt }} dir="ltr">{done} מתוך {total}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: C.bgSubtle }}>
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
          }}
        />
      </div>
      <p className="text-[10px] mt-2" style={{ color: C.borderAlt }}>חיפוש מקבילי, עד 5 בו זמנית. לוקח כדקה ל-100 רכבים.</p>
    </Card>
  );
}

function SummaryCounts({ found, needsChoice, duplicate, notFound, errored }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <Stat color="green"  value={found}      label="נמצאו" />
      <Stat color="orange" value={needsChoice} label="דרושה בחירה" />
      <Stat color="gray"   value={duplicate}  label="כפילויות" />
      <Stat color="yellow" value={notFound}   label="לא במאגר" />
      <Stat color="red"    value={errored}    label="שגיאות" />
    </div>
  );
}

function Stat({ color, value, label }) {
  const cls = {
    green:  'text-green-700 bg-green-50',
    orange: 'text-orange-700 bg-orange-50',
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
    orange: 'border-orange-200',
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

function FoundRow({ row, onToggle, onNicknameChange, onKmChange }) {
  const d = row.data || {};
  const label = [d.manufacturer, d.model].filter(Boolean).join(' ') || 'רכב';
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 border-b border-gray-50 last:border-0">
      <input
        type="checkbox"
        checked={row.included}
        onChange={(e) => onToggle(row.plate, e.target.checked)}
        className="shrink-0 h-4 w-4 accent-[#2D5233]"
        aria-label={`כלול את ${row.plate}`}
      />
      <span className="text-[11px] font-mono px-2 py-0.5 bg-gray-50 rounded shrink-0">{row.plate}</span>
      <div className="flex-1 min-w-[140px]">
        <p className="text-sm font-bold text-gray-900 truncate">{label}</p>
        <p className="text-[11px] text-gray-500 truncate">
          {[d.year, d.vehicle_type].filter(Boolean).join(' · ')}
        </p>
      </div>
      {/* Optional nickname — empty by default. Saved with the vehicle on
          import; users who don't fill it just get the plate-based label
          on the dashboard, exactly like before. Limited to 60 chars to
          match the manual AddVehicle form. */}
      <Input
        type="text"
        value={row.nickname || ''}
        onChange={(e) => onNicknameChange(row.plate, e.target.value.slice(0, 60))}
        placeholder="כינוי (לא חובה)"
        disabled={!row.included}
        dir="rtl"
        className="shrink-0 h-8 w-28 sm:w-36 rounded-lg px-2 text-[11px] disabled:bg-gray-50 disabled:text-gray-400"
        aria-label={`כינוי לרכב ${row.plate}`}
      />
      {/* Optional current km — same role as the field on the manual
          AddVehicle form. Plain integer, 0–9,999,999 to match the
          manual flow's sanitiser. */}
      <Input
        type="number"
        min="0"
        max="9999999"
        inputMode="numeric"
        value={row.current_km ?? ''}
        onChange={(e) => onKmChange(row.plate, e.target.value)}
        placeholder='ק"מ נוכחי'
        disabled={!row.included}
        dir="ltr"
        className="shrink-0 h-8 w-24 sm:w-28 rounded-lg px-2 text-[11px] disabled:bg-gray-50 disabled:text-gray-400"
        aria-label={`קילומטראז' נוכחי לרכב ${row.plate}`}
      />
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

// A plate whose number resolved to MORE than one MoT vehicle. We do not
// auto-pick — the manager taps "בחר" to open MultipleMatchDialog and
// choose the right one. Until chosen, the row is excluded from import.
function NeedsChoiceRow({ row, onChoose }) {
  const count = row.matches?.length || 0;
  return (
    <li className="border-b border-gray-50 last:border-0 py-1">
      {/* The WHOLE row is the tap target — big, obvious, thumb-friendly.
          A solid orange CTA on the leading (left/RTL-forward) edge makes
          "this is the action" unmissable, vs the old pale help-pill. */}
      <button
        type="button"
        onClick={onChoose}
        aria-label={`בחר את הרכב הנכון עבור ${row.plate} — נמצאו ${count} רכבים`}
        className="w-full flex items-center gap-3 px-2 py-2.5 -mx-2 rounded-xl text-right transition-colors hover:bg-orange-50 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-orange-400"
      >
        <span dir="ltr" className="text-[11px] font-mono px-2 py-0.5 bg-orange-50 text-orange-900 rounded shrink-0">{row.plate}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-bold text-orange-900">
            נמצאו {count} רכבים עם מספר זה
          </span>
          <span className="block text-[11px] text-orange-700/80">לחץ לבחירת הרכב הנכון</span>
        </span>
        <span className="shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-lg text-[13px] font-bold text-white bg-orange-600 shadow-sm">
          בחר רכב
          <ArrowLeft className="h-4 w-4" />
        </span>
      </button>
    </li>
  );
}

function CopyPlatesButton({ plates }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plates.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
    } catch (err) {
      toastError('הההעתקה נכשלה', { action: 'bulk_add_copy', err });
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
  const { added_count = 0, skipped_count = 0, error_count = 0, errors = [], notFoundPlates = [], needsChoicePlates = [] } = result;

  return (
    <section className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-2xl p-5 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-2" />
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{added_count}</p>
        <p className="text-sm text-gray-600">רכבים נוספו לצי</p>
      </div>

      {(skipped_count > 0 || error_count > 0 || notFoundPlates.length > 0 || needsChoicePlates.length > 0) && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-3">מה לא נכנס</h3>
          <ul className="space-y-2 text-xs">
            {needsChoicePlates.length > 0 && (
              <li className="flex items-start gap-2">
                <HelpCircle className="h-4 w-4 text-orange-500 shrink-0 mt-0.5" />
                <span><span className="font-bold">{needsChoicePlates.length}</span> דרשו בחירה ולא נבחרו, לכן לא יובאו. אפשר לייבא שוב ולבחור את הרכב הנכון.</span>
              </li>
            )}
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
          className="flex-1 py-3 rounded-xl text-xs font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: '#FFFFFF', color: C.successBright, border: `1.5px solid ${C.successLight}` }}
        >
          ייבא עוד
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex-1 py-3 rounded-xl text-xs font-bold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
            color: '#FFFFFF',
            boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
          }}
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
  // Preserve off-road / cancelled status, matching the manual AddVehicle flow
  // (audit ג-11). _cancellationDate is an underscore-prefixed marker on the
  // lookup result (dropped by the whitelist above), so derive the real columns
  // here. Only a FINAL cancellation (ביטול סופי) sets is_road_removed — a
  // merely lapsed test does not, exactly like the manual sanitiser.
  if (data._cancellationDate) {
    out.is_road_removed = true;
    out.road_removed_date = data._cancellationDate;
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
