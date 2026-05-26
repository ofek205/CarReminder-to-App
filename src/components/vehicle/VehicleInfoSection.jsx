import React, { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StatusBadge from "../shared/StatusBadge";
import { getDateStatus, formatDateHe, isVessel, isOffroad, getVehicleLabels } from "../shared/DateStatusUtils";
import { OFFROAD_EQUIPMENT, OFFROAD_USAGE_TYPES } from "../vehicle/VehicleTypeSelector";
import { COUNTRIES } from "../vehicle/CountryFlagSelect";
import { Calendar, Shield, Download, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle, MinusCircle, ClipboardList, Cog, ExternalLink, Camera, Loader2, Upload, AlertTriangle, Zap, Leaf, Hash, Paperclip, ArrowRight, Sparkles, Info } from "lucide-react";
import { Input } from '@/components/ui/input';
import { db } from '@/lib/supabaseEntities';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '../shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import { C, getTheme } from '@/lib/designTokens';
import { useQueryClient } from '@tanstack/react-query';
import { aiRequest } from '@/lib/aiProxy';
import { isAiScanEnabled } from '@/lib/aiScanGate';
import { compressImage } from '@/lib/imageCompress';

// Israeli marinas
const ISRAEL_MARINAS = [
  'מרינה הרצליה', 'מרינה אשקלון', 'מרינה אשדוד', 'מרינה יפו',
  'מרינה עתלית', 'מרינה חיפה', 'מרינה עכו', 'מרינה אילת',
  'מרינה קיסריה', 'מרינה נתניה',
];
import MileageUpdateWidget from "./MileageUpdateWidget";

//  Renewal Dialog - update expiry date (with optional document attach + AI scan)
//
//  Flow (post 2026-05-17 refactor — see ux + designer specs in commit body):
//   1. step='upload'  → user picks: צלם / העלה / "המשך להזנה ידנית"
//        Picking a file does NOT auto-trigger AI. It attaches the file
//        and moves to 'manual'. This was the user-facing change request:
//        AI scan must be an EXTRA action, not the default path.
//   2. step='manual'  → date picker (HERO) + title (optional) + attached
//        chip if a file was picked. An optional "✨ סרוק עם AI" button
//        appears here only when the global `scan_extraction_enabled`
//        flag is true AND a file is attached.
//   3. step='scanning' → spinner during AI extraction.
//   4. step='confirm' → AI's parse, with same fields editable.
//   5. step='done'    → success card, auto-close after 800ms.
function RenewalDialog({ open, onClose, dateField, vehicle, vesselMode, T }) {
  const fileRef = useRef(null);
  // upload | manual | scanning | confirm | done
  const [step, setStep] = useState('upload');
  // AI-extracted fields, populated only via scanDocument().
  const [aiResult, setAiResult] = useState(null);
  // Snapshot of the uploaded file so the user can scan-with-AI later
  // OR continue manually without re-picking. Cleared on reset().
  const [uploadedDoc, setUploadedDoc] = useState(null); // { dataUrl, mimeType, name }
  // Manual form state — used when the user enters values themselves.
  const [manualForm, setManualForm] = useState({ title: '', expiry_date: '', issue_date: '' });
  // Mirror of app_config.scan_extraction_enabled. Defaults TRUE during
  // the load window so users on slow networks don't see the AI button
  // flash in-out. Refreshed every time the dialog opens.
  const [aiScanAllowed, setAiScanAllowed] = useState(false);
  const [error, setError] = useState('');
  const { isGuest, updateGuestVehicle, addGuestDocument } = useAuth();
  // Active-workspace account so the renewal document is filed under
  // the same workspace the user is currently in. Pre-fix this routed
  // every renewal upload to the user's first membership and could file
  // a business vehicle's renewal under the personal account.
  const { accountId } = useAccountRole();
  const queryClient = useQueryClient();

  const currentDate = vehicle[dateField];
  const isTest = dateField === 'test_due_date';
  const docLabel = isTest
    ? (vesselMode ? 'כושר שייט' : 'רישיון רכב')
    : (vesselMode ? 'ביטוח ימי' : 'ביטוח');

  // Refresh gate state every time the dialog opens. The admin can flip
  // the flag any time; we don't cache across opens to avoid showing
  // the "AI scan" button when it would just fail.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    isAiScanEnabled().then(v => { if (!cancelled) setAiScanAllowed(!!v); });
    return () => { cancelled = true; };
  }, [open]);

  const reset = () => {
    setStep('upload');
    setAiResult(null);
    setUploadedDoc(null);
    setManualForm({ title: '', expiry_date: '', issue_date: '' });
    setError('');
  };

  // Pick a file and ATTACH it (no auto-scan). Moves to 'manual' so the
  // user sees their attachment + the date picker right away.
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // Compress images before base64 to stay well under the ai-proxy
    // 8MB payload cap. PDFs and non-image files pass through unchanged.
    const ready = await compressImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedDoc({
        dataUrl:  ev.target.result,
        mimeType: ready?.type || file.type || 'image/jpeg',
        name:     file.name || 'מסמך',
      });
      setError('');
      setStep('manual');
    };
    reader.readAsDataURL(ready);
  };

  const scanDocument = async () => {
    if (!uploadedDoc?.dataUrl) return;
    setStep('scanning');
    setError('');
    try {
      const base64 = uploadedDoc.dataUrl;
      const mediaType = uploadedDoc.mimeType || 'image/jpeg';
      const imageData = base64.split(',')[1];
      const isPdf = mediaType === 'application/pdf';
      const sourcePart = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: imageData } }
        : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: imageData } };

      const json = await aiRequest({
        // Tags this call as a scan so the global gate (`app_config.
        // scan_extraction_enabled`) can short-circuit it. When the gate
        // is off aiRequest throws SCAN_EXTRACTION_DISABLED and we route
        // back to 'manual' with the file still attached.
        feature: 'scan_extraction',
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            sourcePart,
            { type: 'text', text: `סרוק מסמך זה וחלץ את הפרטים. החזר JSON בלבד:
{"document_type":"סוג (רישיון רכב/כושר שייט/ביטוח חובה/ביטוח מקיף/ביטוח צד ג/ביטוח ימי חובה/ביטוח ימי מקיף)", "title":"שם החברה או הגוף המנפיק", "issue_date":"YYYY-MM-DD", "expiry_date":"YYYY-MM-DD"}.
אם לא ניתן לזהות שדה - השאר ריק.` },
          ],
        }],
      });

      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        // Validate dates
        const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime());
        setAiResult({
          document_type: parsed.document_type || docLabel,
          title: (parsed.title || '').replace(/<[^>]*>/g, '').slice(0, 100),
          issue_date: validDate(parsed.issue_date) ? parsed.issue_date : '',
          expiry_date: validDate(parsed.expiry_date) ? parsed.expiry_date : '',
        });
        setStep('confirm');
      } else {
        // AI replied but couldn't read the doc. Don't trap the user on
        // upload — drop them into manual entry with the file still
        // attached. Their effort isn't lost.
        setError('הסריקה לא חילצה פרטים. אפשר להזין ידנית.');
        setStep('manual');
      }
    } catch (err) {
      console.error('Document scan error:', err?.code, err?.message);
      // When the global gate is off, route silently to manual — the
      // AiScanUnavailableDialog (mounted at Layout level) already
      // explains the situation, no need for an inline error too.
      if (err?.code === 'SCAN_EXTRACTION_DISABLED') {
        setAiScanAllowed(false);
        setStep('manual');
        return;
      }
      let msg;
      switch (err?.code) {
        case 'TIMEOUT':              msg = 'התשובה מהשרת מאחרת. אפשר להזין ידנית.'; break;
        case 'NETWORK':              msg = 'אין חיבור לאינטרנט. אפשר להזין ידנית.'; break;
        case 'RATE_LIMIT':           msg = 'יותר מדי סריקות. נסה בעוד דקה או הזן ידנית.'; break;
        case 'UNAUTHORIZED':
        case 'NO_SESSION':           msg = 'ההתחברות פגה. יש להתחבר מחדש.'; break;
        case 'PROVIDER_UNAVAILABLE':
        case 'AI_UNAVAILABLE':       msg = 'שירות הסריקה לא זמין כרגע. אפשר להזין ידנית.'; break;
        default:                     msg = 'הסריקה לא הצליחה. אפשר להזין ידנית.';
      }
      setError(msg);
      // Failed scans drop into manual entry, not back to upload. The
      // user's effort (the file) is preserved; they just continue
      // typing what they need.
      setStep('manual');
    }
  };

  // Whichever expiry_date is currently being shown (confirm uses
  // aiResult, manual uses manualForm). Drives the "not-newer-than-
  // current" warning chip.
  const stagedExpiry = step === 'confirm' ? aiResult?.expiry_date : manualForm.expiry_date;
  const isNewer = stagedExpiry && currentDate
    ? new Date(stagedExpiry) > new Date(currentDate)
    : true;

  // Unified save — works for both 'confirm' (AI flow) and 'manual'
  // (typed entry). Document save is best-effort and skipped when no
  // file is attached (a pure date update is fully valid).
  const handleSave = async () => {
    const fromAi = step === 'confirm';
    const expiry = fromAi ? aiResult?.expiry_date : manualForm.expiry_date;
    if (!expiry) { setError('חסר תאריך תוקף'); return; }
    const title        = (fromAi ? aiResult?.title : manualForm.title) || docLabel;
    const issue        = fromAi ? aiResult?.issue_date : manualForm.issue_date;
    const documentType = fromAi ? aiResult?.document_type : docLabel;

    setStep('done');
    try {
      // 1. Save document — only when a file is attached. A user who
      // just wants to update the expiry date (no doc on hand) is fully
      // supported and we don't fabricate an empty document row.
      if (uploadedDoc?.dataUrl) {
        const doc = {
          document_type: documentType,
          title,
          issue_date: issue || null,
          expiry_date: expiry,
          vehicle_id: vehicle.id,
        };
        if (isGuest) {
          addGuestDocument(doc);
        } else if (accountId) {
          // Auth: file under the active workspace. Skip silently if
          // accountId hasn't resolved yet — the date update on the
          // vehicle is the main action and survives that miss.
          try {
            await db.documents.create({ ...doc, account_id: accountId });
          } catch (saveErr) {
            console.warn('Document save skipped:', saveErr?.message);
          }
        }
      }

      // 2. Update vehicle date — always.
      const update = { [dateField]: expiry };
      if (isGuest) {
        updateGuestVehicle(vehicle.id, update);
      } else {
        await db.vehicles.update(vehicle.id, update);
        await queryClient.invalidateQueries({ queryKey: ['vehicle'] });
        await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
        await queryClient.refetchQueries({ queryKey: ['vehicle', vehicle.id] });
      }
      setTimeout(() => { onClose(); reset(); }, 800);
    } catch (err) {
      console.error('Renewal save error:', err);
      setError('שגיאה בשמירה. נסה שוב.');
      setStep(fromAi ? 'confirm' : 'manual');
    }
  };

  const canSaveManual = !!manualForm.expiry_date;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-sm mx-4" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">{step === 'done' ? '✅ עודכן!' : `חידוש ${docLabel}`}</DialogTitle>
        </DialogHeader>

        {/* Upload step — three actions: camera / upload / continue-without-doc.
            Per UX spec, picking a file ATTACHES it and routes to manual;
            it no longer auto-triggers AI extraction. */}
        {step === 'upload' && (
          <div className="space-y-3 pt-1">
            <p className="text-sm" style={{ color: C.gray500 }}>
              עדכן את תוקף {docLabel}. אפשר לצרף מסמך לתיוק או להמשיך ישר להזנת תאריך.
            </p>
            {error && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-xs font-bold text-red-700">{error}</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <div className="flex gap-2">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.97]"
                style={{ background: T.light, color: T.primary, border: `1.5px solid ${T.border}` }}>
                <Upload className="w-5 h-5" />
                <span>העלה קובץ</span>
              </button>
              <label className="flex-1 flex flex-col items-center justify-center gap-1 py-3 rounded-xl font-bold text-sm cursor-pointer transition-all active:scale-[0.97]"
                style={{ background: T.light, color: T.primary, border: `1.5px solid ${T.border}` }}>
                <Camera className="w-5 h-5" />
                <span>צלם מסמך</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
              </label>
            </div>

            {/* Or-divider + direct path to manual entry — the primary
                action for users who only want to update the date. */}
            <div className="flex items-center gap-2 py-1">
              <div className="flex-1 h-px" style={{ background: C.gray200 }} />
              <span className="text-xs" style={{ color: C.gray400 }}>או</span>
              <div className="flex-1 h-px" style={{ background: C.gray200 }} />
            </div>
            <button type="button" onClick={() => setStep('manual')}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.97]"
              style={{ background: T.primary, color: '#fff' }}>
              <ArrowRight className="w-4 h-4" />
              <span>המשך להזנת תאריך ידנית</span>
            </button>

            {/* AI-disabled chip — quiet info, not an alarm. Appears only
                when the admin has flipped scan_extraction off. */}
            {!aiScanAllowed && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <Info className="w-3 h-3" style={{ color: C.warnDark }} />
                <span className="text-[11px] font-bold" style={{ color: C.warnDark }}>
                  סריקה אוטומטית כרגע לא פעילה
                </span>
              </div>
            )}
          </div>
        )}

        {/* Manual entry step — date is the hero, title is optional, the
            attached file (if any) is shown as a chip. An "AI scan" button
            appears here when both (a) a file is attached and (b) the
            global gate is on. */}
        {step === 'manual' && (
          <div className="space-y-3 pt-1">
            {/* Attached doc chip */}
            {uploadedDoc && (
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl"
                style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                <span className="flex items-center gap-1.5 min-w-0">
                  <Paperclip className="w-3.5 h-3.5 shrink-0" style={{ color: '#16A34A' }} />
                  <span className="text-xs font-bold truncate" style={{ color: '#15803D' }}>
                    {uploadedDoc.name}
                  </span>
                </span>
                <button type="button" onClick={() => setUploadedDoc(null)}
                  className="text-[11px] font-bold shrink-0" style={{ color: C.gray400 }}>
                  הסר
                </button>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <span className="text-xs font-bold text-red-700">{error}</span>
              </div>
            )}

            {/* HERO field — expiry date */}
            <div>
              <label className="block text-sm font-bold mb-1.5" style={{ color: T.primary }}>
                תוקף חדש <span className="text-red-500">*</span>
              </label>
              <Input type="date" dir="ltr"
                value={manualForm.expiry_date}
                onChange={e => setManualForm(f => ({ ...f, expiry_date: e.target.value }))}
                className="h-12 text-base font-bold tabular-nums" />
              {!isNewer && manualForm.expiry_date && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: C.warn }} />
                  <span className="text-[11px]" style={{ color: C.warnDark }}>
                    התאריך זהה או ישן יותר מהקיים ({formatDateHe(currentDate)})
                  </span>
                </div>
              )}
            </div>

            {/* Optional title */}
            <div>
              <label className="block text-xs mb-1" style={{ color: C.gray500 }}>
                כותרת המסמך
              </label>
              <Input type="text"
                placeholder={docLabel}
                value={manualForm.title}
                onChange={e => setManualForm(f => ({ ...f, title: e.target.value }))}
                className="h-10 text-sm" />
            </div>

            {/* Optional AI scan — visible only with file + gate on */}
            {uploadedDoc && aiScanAllowed && (
              <button type="button" onClick={scanDocument}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-[0.97]"
                style={{ background: C.warnSubtle, color: C.warnDark, border: `1px solid ${C.warnBorder}` }}>
                <Sparkles className="w-3.5 h-3.5" />
                <span>נסה סריקה אוטומטית עם AI</span>
              </button>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={handleSave} disabled={!canSaveManual}
                className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: T.primary, color: '#fff' }}>
                <CheckCircle2 className="w-4 h-4 inline ml-1" /> שמור ועדכן
              </button>
              <button onClick={() => { setError(''); setStep('upload'); }}
                className="px-4 py-3 rounded-xl font-bold text-sm" style={{ color: C.gray400 }}>
                חזור
              </button>
            </div>
          </div>
        )}

        {/* Scanning step */}
        {step === 'scanning' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.primary }} />
            <p className="text-sm font-bold" style={{ color: T.text }}>סורק את המסמך...</p>
            <p className="text-xs" style={{ color: C.gray400 }}>מחלץ תאריכים ופרטים</p>
          </div>
        )}

        {/* Confirm step */}
        {step === 'confirm' && aiResult && (
          <div className="space-y-3 pt-1">
            {/* Extracted info */}
            <div className="rounded-xl p-3 space-y-2" style={{ background: T.light, border: `1px solid ${T.border}` }}>
              <div className="flex justify-between text-xs">
                <span style={{ color: T.muted }}>סוג מסמך</span>
                <span className="font-bold" style={{ color: T.text }}>{aiResult.document_type}</span>
              </div>
              {aiResult.title && (
                <div className="flex justify-between text-xs">
                  <span style={{ color: T.muted }}>מנפיק</span>
                  <span className="font-bold" style={{ color: T.text }}>{aiResult.title}</span>
                </div>
              )}
              {aiResult.issue_date && (
                <div className="flex justify-between text-xs">
                  <span style={{ color: T.muted }}>תאריך הנפקה</span>
                  <span className="font-bold" style={{ color: T.text }}>{formatDateHe(aiResult.issue_date)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span style={{ color: T.muted }}>תוקף</span>
                <Input type="date" dir="ltr" className="w-36 h-7 text-xs"
                  value={aiResult.expiry_date}
                  onChange={e => setAiResult(r => ({ ...r, expiry_date: e.target.value }))} />
              </div>
            </div>

            {/* Warning if not newer */}
            {!isNewer && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="text-xs font-bold text-amber-700">
                  התאריך שזוהה ({formatDateHe(aiResult.expiry_date)}) אינו חדש יותר מהקיים ({formatDateHe(currentDate)}). בדוק שוב.
                </span>
              </div>
            )}

            {error && <p className="text-xs font-bold text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button onClick={handleSave}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-[0.97]"
                style={{ background: T.primary, color: '#fff' }}>
                <CheckCircle2 className="w-4 h-4 inline ml-1" /> שמור ועדכן
              </button>
              <button onClick={() => { reset(); }}
                className="px-4 py-2.5 rounded-xl font-bold text-sm" style={{ color: C.gray400 }}>
                ביטול
              </button>
            </div>
          </div>
        )}

        {/* Done step */}
        {step === 'done' && (
          <div className="flex flex-col items-center py-6 gap-2">
            <CheckCircle2 className="w-12 h-12" style={{ color: C.successBright }} />
            <p className="text-sm font-bold" style={{ color: T.text }}>{docLabel} עודכן בהצלחה!</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
import { format, parseISO } from 'date-fns';
import { toast } from "sonner";

function generateICS(title, description, eventDate, reminderDays) {
  const date = parseISO(eventDate);
  const startDateTime = format(date, "yyyyMMdd'T'080000");
  const endDateTime = format(date, "yyyyMMdd'T'090000");

  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vehicle Manager//Reminder//HE',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `DTSTART;TZID=Asia/Jerusalem:${startDateTime}`,
    `DTEND;TZID=Asia/Jerusalem:${endDateTime}`,
    `SUMMARY:${title}`, `DESCRIPTION:${description}`,
    'BEGIN:VALARM', `TRIGGER:-P${reminderDays}D`, 'ACTION:DISPLAY',
    `DESCRIPTION:${title}`, 'END:VALARM',
    'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function downloadICS(filename, icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function generateGoogleCalendarLink(title, description, eventDate) {
  const date = parseISO(eventDate);
  const startDateTime = format(date, "yyyyMMdd'T'080000");
  const endDateTime = format(date, "yyyyMMdd'T'090000");
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: title, details: description,
    dates: `${startDateTime}/${endDateTime}`, ctz: 'Asia/Jerusalem',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function AddToCalendarButton({ dateField, vehicle, T }) {
  const [open, setOpen] = useState(false);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);

  const handleAddToCalendar = (eventType) => {
    if (!vehicle[dateField]) return;
    const isTest = dateField === 'test_due_date';
    const titlePrefix = isTest ? labels.testWord : 'חידוש ביטוח';
    const reminderDays = 14;
    const title = `${titlePrefix} ל${labels.vehicleWord} ${vehicle.nickname || vehicle.license_plate}`;
    let description = `תזכורת ${titlePrefix} ל${labels.vehicleWord} ${vehicle.manufacturer} ${vehicle.model} (${vehicle.license_plate}).`;
    if (!isTest && vehicle.insurance_company) description += ` חברת ביטוח: ${vehicle.insurance_company}.`;
    description += ' נוצר מהאפליקציה.';

    if (eventType === 'ics') {
      const icsContent = generateICS(title, description, vehicle[dateField], reminderDays);
      downloadICS(`${isTest ? 'test' : 'insurance'}-reminder-${vehicle.license_plate}.ics`, icsContent);
    } else {
      window.open(generateGoogleCalendarLink(title, description, vehicle[dateField]), '_blank', 'noopener,noreferrer');
    }
    toast.success('אירוע נוסף ליומן');
    setOpen(false);
  };

  if (!vehicle[dateField]) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all active:scale-[0.97]"
          style={{ background: T.light, color: T.primary, border: `1px solid ${T.border}` }}>
          <Calendar className="h-3 w-3" />
          הוסף ליומן
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-2" align="start">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="justify-end gap-2 text-sm"
            style={{ '--hover-bg': T.light }}
            onClick={() => handleAddToCalendar('google')}>
            <Calendar className="h-4 w-4" /> Google Calendar
          </Button>
          <Button variant="ghost" size="sm" className="justify-end gap-2 text-sm"
            onClick={() => handleAddToCalendar('ics')}>
            <Download className="h-4 w-4" /> הורד קובץ ICS
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

//  Status Card (clean, white-based with colored accent) 
const GOV_RENEWAL_URLS = {
  car: 'https://www.gov.il/he/service/car_licence_renewal',
  vessel: 'https://www.gov.il/he/service/renewing_vessel_license',
};

function StatusCard({ icon: Icon, label, status, dateField, vehicle, T, vesselMode, subtitle, onRenewed }) {
  const isMissing = !vehicle[dateField];

  const STATUS_ACCENT = {
    ok:      { color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
    warn:    { color: C.warn, bg: C.warnSubtle, border: C.warnBorder },
    danger:  { color: C.error, bg: C.errorBg, border: C.errorBorder },
    missing: { color: C.gray400, bg: C.gray50, border: C.gray200 },
  };

  const st = isMissing ? 'missing' : (status.status || 'missing');
  const accent = STATUS_ACCENT[st] || STATUS_ACCENT.missing;

  return (
    <div className="rounded-2xl p-4 space-y-2.5"
      style={{ background: '#FFFFFF', border: `1.5px solid ${accent.border}`, borderRight: `4px solid ${accent.color}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: accent.color }} />
        <span className="text-sm font-bold" style={{ color: C.gray700 }}>{label}</span>
      </div>
      {subtitle && (
        <p className="text-xs font-medium" style={{ color: C.gray400 }}>{subtitle}</p>
      )}

      {isMissing ? (
        <Link to={`${createPageUrl('EditVehicle')}?id=${vehicle.id}&field=${dateField}`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all active:scale-[0.97]"
          style={{ background: C.orangeBg, border: '1px solid #FFEDD5' }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: C.orange }} />
          <span className="text-xs font-bold" style={{ color: C.orange }}>לא הוזן - לחץ להוספה</span>
        </Link>
      ) : (
        <>
          <StatusBadge status={status.status} label={status.label} />
          <AddToCalendarButton dateField={dateField} vehicle={vehicle} T={T} />
        </>
      )}
      {/* Renewal actions. 2-color palette: solid primary CTA + outline secondary.
          Keeps the card calm: status color on the border, app primary on actions. */}
      {(dateField === 'test_due_date' || dateField === 'insurance_due_date') && (
        <div className="space-y-1.5 mt-1.5">
          {/* Primary CTA. gov.il external renewal (test only) */}
          {dateField === 'test_due_date' && (
            <a href={vesselMode ? GOV_RENEWAL_URLS.vessel : GOV_RENEWAL_URLS.car}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[10px] font-bold transition-all active:scale-[0.97]"
              style={{ background: T.primary, color: '#fff', border: `1px solid ${T.primary}` }}>
              <ExternalLink className="w-3 h-3" />
              {vesselMode ? 'חידוש כושר שייט באתר הממשלה' : 'חידוש רישיון באתר הממשלה'}
            </a>
          )}
          {/* Secondary. same color, outline variant */}
          {onRenewed && (
            <button onClick={() => onRenewed(dateField)}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-[10px] font-bold transition-all active:scale-[0.97]"
              style={{ background: '#fff', color: T.primary, border: `1px solid ${T.primary}40` }}>
              <Upload className="w-3 h-3" />
              {dateField === 'test_due_date'
                ? (vesselMode ? 'חידשתי כושר שייט - העלה מסמך' : 'חידשתי רישיון - העלה מסמך')
                : (vesselMode ? 'חידשתי ביטוח ימי - העלה מסמך' : 'חידשתי ביטוח - העלה מסמך')
              }
            </button>
          )}
        </div>
      )}
    </div>
  );
}

//  Info Row 
// Pill colors for known categorical values. Each entry: {bg, text}.
// Adding a new term is one line; unknown values render as a neutral
// gray pill so the layout stays consistent regardless of dataset
// surprises.
const PILL_PALETTE = {
  // Transmission
  'אוטומטי':  { bg: 'bg-blue-50',     text: 'text-blue-700' },
  'ידני':      { bg: 'bg-slate-100',   text: 'text-slate-700' },
  // Fuel
  'בנזין':     { bg: 'bg-orange-50',   text: 'text-orange-700' },
  'דיזל':      { bg: 'bg-amber-50',    text: 'text-amber-800' },
  'חשמל':      { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  'היברידי':   { bg: 'bg-emerald-50',  text: 'text-emerald-700' },
  'גז':        { bg: 'bg-purple-50',   text: 'text-purple-700' },
  // Ownership
  'פרטי':      { bg: 'bg-indigo-50',   text: 'text-indigo-700' },
  'ליסינג':    { bg: 'bg-yellow-50',   text: 'text-yellow-800' },
  'השכרה':     { bg: 'bg-pink-50',     text: 'text-pink-700' },
  'מסחרי':     { bg: 'bg-teal-50',     text: 'text-teal-700' },
  // Tow hitch
  'כן':        { bg: 'bg-green-50',    text: 'text-green-700' },
};

// Split a "number unit" string into its components so we can render
// the digit large + bold and the unit smaller + muted. Falls back to
// returning null when the value doesn't match the pattern (free-text,
// already pure number, etc.) — caller renders it as plain text.
//
//   "125 כ\"ס"  → { num: '125',  unit: 'כ"ס' }
//   "1395 סמ\"ק" → { num: '1395', unit: 'סמ"ק' }
//   "1400 / 640 ק\"ג (עם/בלי בלמים)" → { num: '1400 / 640', unit: 'ק"ג (עם/בלי בלמים)' }
function splitValueUnit(raw) {
  if (typeof raw !== 'string') return null;
  // Match [digits + optional separators (/ , .)] then whitespace then rest.
  const m = raw.match(/^([\d.,/\s-]+)\s+(\D.+)$/);
  if (!m) return null;
  const num  = m[1].trim();
  const unit = m[2].trim();
  if (!num || !unit) return null;
  return { num, unit };
}

// SpecRow — visual workhorse for any group that isn't `dense`.
// Two-tone layout: muted label on the right, bold value on the left.
// When item.pill is true and the value matches the pill palette, it
// renders as a colored chip; otherwise as plain bold text. Numeric
// values with units get a split treatment (number large, unit small).
function SpecRow({ item, theme }) {
  const T = theme;
  const palette = item.pill ? (PILL_PALETTE[item.value] || { bg: 'bg-gray-100', text: 'text-gray-700' }) : null;
  const split   = !palette && splitValueUnit(item.value);
  return (
    <div className="flex items-center justify-between px-2.5 py-2.5 rounded-lg hover:bg-gray-50/60 transition-colors">
      <span className="text-[12.5px] font-medium" style={{ color: T.muted }}>{item.label}</span>
      {palette ? (
        <span className={`px-2.5 py-0.5 rounded-md text-[12px] font-bold ${palette.bg} ${palette.text}`}>
          {item.value}
        </span>
      ) : split ? (
        <span className="flex items-baseline gap-1" dir={item.ltr ? 'ltr' : 'rtl'}>
          <span className="text-[14px] font-bold text-gray-900 tabular-nums">{split.num}</span>
          <span className="text-[10.5px] font-medium text-gray-500">{split.unit}</span>
        </span>
      ) : (
        <span className="text-[13px] font-bold text-gray-900" dir={item.ltr ? 'ltr' : 'rtl'}>
          {item.value}
        </span>
      )}
    </div>
  );
}

// Hand label for the "יד" spec row. Two parts joined by " · ":
//
//   1. Hebrew ordinal — through 4 ("ראשונה / שנייה / שלישית /
//      רביעית"); from 5 onwards we just use the digit ("יד 5") because
//      that's how Israelis write it anyway.
//   2. Registration code — the same number expressed in the format
//      that appears on the physical vehicle license. Israeli licenses
//      list it zero-based and zero-padded to 2 digits: 00 = first
//      hand, 01 = second, 02 = third, etc. Showing both forms lets
//      the user cross-reference what they see on their license card
//      against what we display.
function formatHandLabel(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '';
  const words = { 1: 'ראשונה', 2: 'שנייה', 3: 'שלישית', 4: 'רביעית' };
  const word  = words[num] || String(num);
  const code  = String(num - 1).padStart(2, '0');   // 1→"00", 2→"01", 3→"02", ...
  return `${word} · ${code}`;
}

// ExpandableSpecRow — drop-in replacement for the standard spec row
// (label + value layout) that gains a chevron and an inline-revealing
// sub-panel. Used today only for "יד" → "היסטוריית בעלויות"; the
// pattern is generic so the next expandable spec we want (warranty
// history, accident summary, etc.) can ride on the same component.
function ExpandableSpecRow({ item, theme }) {
  const [open, setOpen] = useState(false);
  const T = theme;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-2.5 py-2.5 rounded-lg text-right hover:bg-gray-50/60 active:bg-gray-100 transition-colors"
      >
        <span className="text-[12.5px] font-medium flex items-center gap-1" style={{ color: T.muted }}>
          {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {item.label}
        </span>
        <span className="flex items-center gap-2">
          <span
            className="text-[10.5px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: T.light, color: T.primary }}
          >
            {open ? 'הסתר' : 'הצג היסטוריה'}
          </span>
          <span className="text-[13px] font-bold text-gray-900">
            {item.value}
          </span>
        </span>
      </button>
      {open && item.expandedContent}
    </div>
  );
}

// OwnershipHistoryPanel — the actual content rendered inside the
// expanded "יד" row. Pure: takes the history array and renders the
// numbered timeline.
//
// Exported so other consumers (e.g. VehicleCheck — the public quick
// vehicle-lookup page) can render the same breakdown without duplicating
// the markup or theme handling. The `theme` prop is the same shape as
// the InfoCard's local theme: { primary, light, border, muted }.
export function OwnershipHistoryPanel({ history, theme }) {
  const T = theme;
  return (
    <ol className="px-4 pb-3 pt-1 space-y-1.5">
      {history.map((h, i) => {
        const isCurrent = i === history.length - 1;
        return (
          <li
            key={i}
            className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
            style={{
              background: isCurrent ? T.light : C.gray50,
              border: `1px solid ${isCurrent ? T.border : C.gray100}`,
            }}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: isCurrent ? T.primary : C.gray300, color: '#fff' }}
              >
                {i + 1}
              </span>
              <span className="text-[12px] font-semibold text-gray-900 truncate">
                {h.baalut || 'לא ידוע'}
              </span>
              {isCurrent && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded font-bold shrink-0"
                  style={{ background: T.primary, color: '#fff' }}
                >
                  נוכחית
                </span>
              )}
            </span>
            {h.date && (
              <span className="text-[10px] text-gray-500 font-mono shrink-0" dir="ltr">
                {h.date}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function InfoRow({ label, value, T }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2.5 px-1"
      style={{ borderBottom: `1px solid ${T.border}40` }}>
      <span className="text-xs font-medium" style={{ color: T.muted }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: T.text }}>{value}</span>
    </div>
  );
}

//  Vessel Inspection Readiness Checklist 
function statusIcon(status) {
  if (status === 'ok')     return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
  if (status === 'danger') return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (status === 'warn')   return <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <MinusCircle className="h-4 w-4 text-gray-300 shrink-0" />;
}

function statusLabel(status, label, fieldMissing) {
  if (fieldMissing) return <span className="text-gray-400 text-xs">לא הוזן</span>;
  const color = status === 'ok' ? 'text-emerald-600' : status === 'danger' ? 'text-red-600' : status === 'warn' ? 'text-amber-600' : 'text-gray-400';
  return <span className={`text-xs font-medium ${color}`}>{label}</span>;
}

// Map checklist keys to EditVehicle field names
const CHECKLIST_FIELD_MAP = {
  test: 'test_due_date',
  ins: 'insurance_due_date',
  pyro: 'pyrotechnics_expiry_date',
  ext: 'fire_extinguisher_expiry_date',
  raft: 'life_raft_expiry_date',
};

function VesselInspectionChecklist({ vehicle, T }) {
  const [open, setOpen] = useState(false);

  const testSt  = getDateStatus(vehicle.test_due_date);
  const insSt   = getDateStatus(vehicle.insurance_due_date);
  const pyroSt  = getDateStatus(vehicle.pyrotechnics_expiry_date);
  const extSt   = getDateStatus(vehicle.fire_extinguisher_expiry_date);
  const raftSt  = getDateStatus(vehicle.life_raft_expiry_date);

  // Build extinguisher entries - support multiple
  const extinguishers = vehicle.fire_extinguishers
    ? vehicle.fire_extinguishers.filter(e => e.date)
    : vehicle.fire_extinguisher_expiry_date
      ? [{ date: vehicle.fire_extinguisher_expiry_date }]
      : [];
  const extEntries = extinguishers.map((e, i) => ({
    label: extinguishers.length > 1 ? `מטף ${i + 1} בתוקף` : 'מטף כיבוי בתוקף',
    st: getDateStatus(e.date), has: true, key: `ext_${i}`, fieldKey: 'ext',
  }));

  const tracked = [
    { label: 'רישיון כושר שייט בתוקף',      st: testSt, has: !!vehicle.test_due_date, key: 'test', fieldKey: 'test' },
    { label: 'ביטוח צד ג׳ תוספת 14 בתוקף', st: insSt,  has: !!vehicle.insurance_due_date, key: 'ins', fieldKey: 'ins' },
    { label: 'פירוטכניקה בתוקף',             st: pyroSt, has: !!vehicle.pyrotechnics_expiry_date, key: 'pyro', fieldKey: 'pyro' },
    ...extEntries,
    { label: 'אסדת הצלה בתוקף',              st: raftSt, has: !!vehicle.life_raft_expiry_date, key: 'raft', fieldKey: 'raft' },
  ];

  const readyCount  = tracked.filter(i => i.has && i.st.status === 'ok').length;
  const warnCount   = tracked.filter(i => i.has && (i.st.status === 'warn' || i.st.status === 'danger')).length;
  const totalTracked = tracked.filter(i => i.has).length;

  const headerBg = warnCount > 0
    ? { bg: C.warnBg, border: C.warnBorder, text: C.warnDark }
    : readyCount === tracked.length
    ? { bg: T.light, border: T.border, text: T.primary }
    : { bg: T.light, border: T.border, text: T.primary };

  return (
    <div className="rounded-2xl overflow-hidden" dir="rtl"
      style={{ background: headerBg.bg, border: `1.5px solid ${headerBg.border}` }}>
      <button className="w-full flex items-center justify-between px-4 py-3.5 gap-3"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0" style={{ color: headerBg.text }} />
          <span className="text-sm font-bold" style={{ color: headerBg.text }}>מוכנות לבדיקת כושר שייט</span>
        </div>
        <div className="flex items-center gap-2">
          {totalTracked > 0 && (
            <span className="text-xs font-bold tabular-nums" style={{ color: headerBg.text }}>
              {readyCount}/{tracked.length}
            </span>
          )}
          {open
            ? <ChevronUp className="h-4 w-4" style={{ color: headerBg.text }} />
            : <ChevronDown className="h-4 w-4" style={{ color: headerBg.text }} />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="space-y-2">
            {tracked.map(item => {
              const fieldName = CHECKLIST_FIELD_MAP[item.fieldKey];
              const isMissing = !item.has;
              const Wrapper = isMissing ? Link : 'div';
              const wrapperProps = isMissing
                ? { to: `${createPageUrl('EditVehicle')}?id=${vehicle.id}&field=${fieldName}` }
                : {};
              return (
              <Wrapper key={item.key} {...wrapperProps}
                className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-all"
                style={{ background: isMissing ? C.orangeBg : '#FFFFFF', border: `1px solid ${isMissing ? '#FFEDD5' : T.border}`, display: 'flex' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(item.has ? item.st.status : 'neutral')}
                  <span className="text-xs font-medium truncate" style={{ color: T.text }}>{item.label}</span>
                </div>
                <div className="shrink-0 mr-2">
                  {isMissing
                    ? <span className="text-xs font-bold" style={{ color: C.orange }}>לחץ להוספה</span>
                    : statusLabel(item.st.status, item.st.label, false)}
                </div>
              </Wrapper>
              );
            })}
          </div>

          <div className="rounded-xl p-3" style={{ background: '#FFFFFF', border: `1.5px dashed ${T.border}` }}>
            <p className="text-[11px] font-bold mb-2 flex items-center gap-1" style={{ color: T.primary }}>
              📌 נדרש גם להביא לבדיקה:
            </p>
            <ul className="space-y-1.5 text-xs" style={{ color: T.muted }}>
              {['תעודת רישום - לכלי שייט שאורכם מעל 7 מטר',
                'בדיקת מערכות - מנוע, הגה, ציוד ניווט',
                '3 צילומי השייט - מדופן שמאל · מדופן ימין · ירכתיים',
                'רישיון השייט - לאחר תשלום ואישור בנק הדואר (ללא נספח עליון)']
                .map((text, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0" style={{ color: T.primary }}>•</span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5 text-[11px] pt-3" style={{ color: T.muted, borderTop: `1px solid ${T.border}` }}>
            <p>⚠️ <span className="font-semibold">מומלץ לבצע לפני פקיעת הרישיון הקודם</span></p>
            <p>💡 כלי שייט <span className="font-semibold">פרטיים ומסחריים</span> - תדירות שנתית.</p>
            <p>🔁 בדיקה חוזרת כרוכה בתשלום אגרה נוספת.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// 
export default function VehicleInfoSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const testStatus = getDateStatus(vehicle.test_due_date);
  const insuranceStatus = getDateStatus(vehicle.insurance_due_date);
  const vesselMode = isVessel(vehicle.vehicle_type, vehicle.nickname);
  const offroadMode = isOffroad(vehicle.vehicle_type);
  const [renewalDialog, setRenewalDialog] = useState({ open: false, dateField: null });
  const [specOpen, setSpecOpen] = useState(false);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);
  const pyroStatus     = vesselMode ? getDateStatus(vehicle.pyrotechnics_expiry_date) : null;
  const extStatus      = vesselMode ? getDateStatus(vehicle.fire_extinguisher_expiry_date) : null;
  const lifeRaftStatus = vesselMode ? getDateStatus(vehicle.life_raft_expiry_date) : null;

  return (
    <div className="space-y-4" dir="rtl">

      {/*  Vintage badge  */}
      {!vesselMode && (vehicle.is_vintage || (vehicle.year && new Date().getFullYear() - Number(vehicle.year) >= 30) || vehicle.vehicle_type === 'רכב אספנות') && (
        <div className="rounded-2xl px-4 py-3 flex items-center gap-2.5"
          style={{ background: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)', border: '1.5px solid #DDD6FE' }}>
          <span className="text-lg">🏛️</span>
          <span className="text-sm font-bold" style={{ color: '#7C3AED' }}>כלי רכב אספנות - טסט כל חצי שנה</span>
        </div>
      )}

      {/*  Personal-import badge — informational only, no logic effect.
          Sourced from gov.il's "כלי רכב ביבוא אישי" registry. Sky/cyan
          palette to differentiate from vintage's purple. Subtitle shows
          the variant ("יבוא אישי-משומש" / "יבוא אישי-חדש"). */}
      {vehicle.is_personal_import && (
        <div className="rounded-2xl px-4 py-3 flex items-center gap-2.5"
          style={{ background: 'linear-gradient(135deg, #ECFEFF 0%, #CFFAFE 100%)', border: '1.5px solid #A5F3FC' }}>
          <span className="text-lg">🌍</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold leading-tight" style={{ color: '#0E7490' }}>
              רכב ביבוא אישי
            </p>
            {vehicle.personal_import_type && (
              <p className="text-[11px] font-medium leading-tight mt-0.5" style={{ color: '#0891B2' }}>
                {vehicle.personal_import_type}
              </p>
            )}
          </div>
        </div>
      )}

      {/*  Mileage / Engine hours  */}
      <MileageUpdateWidget vehicle={vehicle} />

      {/*  Test & Insurance Status  */}
      <div className="grid grid-cols-2 gap-3">
        <StatusCard
          icon={Calendar}
          label={labels.testWord}
          status={testStatus}
          dateField="test_due_date"
          vehicle={vehicle}
          T={T}
          vesselMode={vesselMode}
          onRenewed={(df) => setRenewalDialog({ open: true, dateField: df })}
        />
        <StatusCard
          icon={Shield}
          label={vesselMode ? 'ביטוח ימי' : 'ביטוח'}
          subtitle={vehicle.insurance_company}
          status={insuranceStatus}
          dateField="insurance_due_date"
          vehicle={vehicle}
          T={T}
          vesselMode={vesselMode}
          onRenewed={(df) => setRenewalDialog({ open: true, dateField: df })}
        />
      </div>

      {/*  Technical Spec - grouped  */}
      {(() => {
        const groups = [
          { title: 'פרטי רישום', icon: ClipboardList, items: [
            vehicle.vehicle_class && { label: 'סיווג', value: vehicle.vehicle_class },
            vehicle.country_of_origin && { label: 'ארץ ייצור', value: vehicle.country_of_origin },
            vehicle.body_type && { label: 'סוג מרכב', value: vehicle.body_type },
            vehicle.color && { label: 'צבע', value: vehicle.color },
            vehicle.trim_level && { label: 'רמת גימור', value: vehicle.trim_level },
            vehicle.ownership && { label: 'בעלות', value: vehicle.ownership, pill: true },
            // "יד" — sourced from gov.il's ownership-history dataset.
            // The count of episodes IS the hand number; we render
            // "ראשונה / שנייה / שלישית / רביעית" up to 4 and fall back
            // to a numeric string for ≥5.
            //
            // When ownership_history has more than one entry, the row
            // becomes clickable — tapping it unfolds the chronological
            // list of episodes inline (right under the row, inside the
            // same registration group). Single-hand cars have nothing
            // extra to show, so the row stays a plain spec.
            vehicle.ownership_hand && {
              label:    'יד',
              value:    formatHandLabel(vehicle.ownership_hand),
              expandable: Array.isArray(vehicle.ownership_history) && vehicle.ownership_history.length > 1,
              expandedContent: <OwnershipHistoryPanel history={vehicle.ownership_history} theme={T} />,
            },
            vehicle.first_registration_date && { label: 'עלייה לכביש', value: formatDateHe(vehicle.first_registration_date) },
          ].filter(Boolean) },
          { title: 'מנוע וביצועים', icon: Zap, items: [
            vehicle.horsepower && { label: 'כוח', value: vehicle.horsepower },
            vehicle.engine_cc && { label: 'נפח', value: vehicle.engine_cc },
            vehicle.engine_model && { label: 'דגם מנוע', value: vehicle.engine_model, ltr: true },
            vehicle.fuel_type && { label: 'דלק', value: vehicle.fuel_type, pill: true },
            vehicle.transmission && { label: 'תיבת הילוכים', value: vehicle.transmission, pill: true },
            vehicle.drivetrain && { label: 'כונן', value: vehicle.drivetrain },
            vehicle.total_weight && { label: 'משקל כולל', value: vehicle.total_weight },
            vehicle.tow_capacity && { label: 'כושר גרירה', value: vehicle.tow_capacity },
            vehicle.has_tow_hitch && { label: 'וו גרירה', value: vehicle.has_tow_hitch, pill: true },
          ].filter(Boolean) },
          { title: 'בטיחות ונוחות', icon: Shield, dense: true, items: [
            vehicle.doors && { label: 'דלתות', value: vehicle.doors },
            vehicle.seats && { label: 'מושבים', value: vehicle.seats },
            vehicle.airbags && { label: 'כריות אוויר', value: vehicle.airbags },
          ].filter(Boolean) },
          { title: 'סביבה ופליטות', icon: Leaf, dense: true, items: [
            vehicle.co2 && { label: 'פליטת CO₂', value: vehicle.co2 },
            vehicle.green_index && { label: 'מדד ירוק', value: vehicle.green_index },
            vehicle.pollution_group && { label: 'קבוצת זיהום', value: vehicle.pollution_group },
          ].filter(Boolean) },
          { title: 'זיהוי', icon: Hash, items: [
            // Tire display logic:
            //   - Both reported AND identical → single "צמיגים" row (most cars).
            //   - Both reported AND different → two rows — essential for SUVs,
            //     trucks, and performance cars where the axles have different
            //     sizes. Combining them on one line misleads the user when
            //     ordering parts.
            //   - Only one reported → show just that one, labeled by position.
            ...(vehicle.front_tire && vehicle.rear_tire
              ? (vehicle.front_tire === vehicle.rear_tire
                  ? [{ label: 'צמיגים', value: vehicle.front_tire, ltr: true }]
                  : [
                      { label: 'צמיג קדמי', value: vehicle.front_tire, ltr: true },
                      { label: 'צמיג אחורי', value: vehicle.rear_tire, ltr: true },
                    ])
              : vehicle.front_tire
                ? [{ label: 'צמיג קדמי', value: vehicle.front_tire, ltr: true }]
                : vehicle.rear_tire
                  ? [{ label: 'צמיג אחורי', value: vehicle.rear_tire, ltr: true }]
                  : []),
            vehicle.vin && { label: 'מספר שלדה (VIN)', value: vehicle.vin, ltr: true },
            vehicle.model_code && { label: 'קוד דגם', value: vehicle.model_code, ltr: true },
          ].filter(Boolean) },
        ].filter(g => g.items.length > 0);

        if (groups.length === 0) return null;

        return (
          <div className="rounded-2xl overflow-hidden bg-white" style={{ border: `1.5px solid ${T.border}` }} dir="rtl">
            {/* Card header — opens/closes the whole spec panel.
                Slightly bolder typography than the inner group headers
                so the user reads "section → groups → rows" hierarchy. */}
            <button type="button" onClick={() => setSpecOpen(!specOpen)}
              className="w-full flex items-center justify-between px-4 py-3 active:scale-[0.99] transition-transform"
              style={{ background: T.light }}>
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#fff', border: `1px solid ${T.border}` }}>
                  <Cog className="w-3.5 h-3.5" style={{ color: T.primary }} />
                </span>
                <span className="text-sm font-bold" style={{ color: T.text }}>מפרט טכני</span>
              </div>
              {specOpen ? <ChevronUp className="w-4 h-4" style={{ color: T.primary }} /> : <ChevronDown className="w-4 h-4" style={{ color: T.primary }} />}
            </button>

            {specOpen && (
              <div>
                {groups.map((group, gi) => {
                  const GroupIcon = group.icon;
                  return (
                    <div
                      key={gi}
                      className="border-t"
                      style={{ borderColor: `${T.border}30` }}
                    >
                      {/* Group header — accent bar on the right (RTL),
                          icon disc, bold heading. Significantly more
                          presence than the previous tiny uppercase
                          line, while still reading as a sub-section
                          rather than a competing card. */}
                      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
                        <span
                          className="block w-1 h-5 rounded-full shrink-0"
                          style={{ background: T.primary }}
                          aria-hidden="true"
                        />
                        {GroupIcon && (
                          <span
                            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                            style={{ background: T.light }}
                            aria-hidden="true"
                          >
                            <GroupIcon className="w-3.5 h-3.5" style={{ color: T.primary }} />
                          </span>
                        )}
                        <h3 className="text-[13px] font-bold tracking-tight" style={{ color: T.text }}>
                          {group.title}
                        </h3>
                      </div>

                      {/* Body — two layouts, picked per-group:
                          • dense=true → single inline meta-strip for
                            light secondary stats (doors / seats / airbags,
                            CO2 / pollution / green index). User feedback:
                            those values aren't important enough to warrant
                            a 3-card grid; we collapse to a single line of
                            "value label · value label · …" so they're
                            present but not screaming.
                          • default     → row list for varied content. */}
                      {group.dense ? (
                        <div className="px-4 pb-4">
                          <p className="text-[11px] leading-relaxed flex items-center flex-wrap gap-x-1.5 gap-y-1">
                            {group.items.map((item, ii) => (
                              <React.Fragment key={ii}>
                                {ii > 0 && <span className="text-gray-300">·</span>}
                                <span>
                                  <span className="font-bold text-gray-900 tabular-nums">{item.value}</span>
                                  <span className="text-gray-500 mr-1">{item.label}</span>
                                </span>
                              </React.Fragment>
                            ))}
                          </p>
                        </div>
                      ) : (
                        <div className="px-2 pb-2">
                          {group.items.map((item, ii) => {
                            if (item.expandable) {
                              return (
                                <ExpandableSpecRow
                                  key={ii}
                                  item={item}
                                  theme={T}
                                  borderStyle="none"
                                />
                              );
                            }
                            return <SpecRow key={ii} item={item} theme={T} />;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/*  Vessel-specific sections  */}
      {vesselMode && (
        <>
          {/* Flag + engine + marina info */}
          {(vehicle.flag_country || vehicle.engine_manufacturer || vehicle.marina) && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: '#fff', border: `1.5px solid ${T.border}` }}>
              {vehicle.flag_country && (() => {
                const country = COUNTRIES.find(c => c.code === vehicle.flag_country);
                return country ? (
                  <div className="flex items-center justify-between" dir="rtl">
                    <span className="text-sm font-medium" style={{ color: T.muted }}>דגל רישום</span>
                    <span className="text-sm font-bold" style={{ color: T.text }}>{country.flag} {country.name}</span>
                  </div>
                ) : null;
              })()}
              {vehicle.engine_manufacturer && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>יצרן מנוע</span>
                  <span className="text-sm font-bold" style={{ color: T.text }}>{vehicle.engine_manufacturer}</span>
                </div>
              )}
              {vehicle.marina && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>מרינת עגינה</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold" style={{ color: T.text }}>{vehicle.marina}</span>
                    {vehicle.marina_abroad && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: T.light, color: T.primary }}>חו"ל</span>}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Safety equipment */}
          {(vehicle.pyrotechnics_expiry_date || vehicle.fire_extinguisher_expiry_date || vehicle.fire_extinguishers?.length || vehicle.life_raft_expiry_date) && (
            <div className="rounded-2xl p-4" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-sm">⚓</span>
                <span className="text-sm font-bold" style={{ color: T.text }}>ציוד בטיחות</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {vehicle.pyrotechnics_expiry_date && (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                    <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>🔴 פירוטכניקה</span>
                    <StatusBadge status={pyroStatus.status} label={pyroStatus.label} />
                  </div>
                )}
                {/* מטפי כיבוי - support multiple */}
                {(() => {
                  const extinguishers = vehicle.fire_extinguishers
                    ? vehicle.fire_extinguishers.filter(e => e.date)
                    : vehicle.fire_extinguisher_expiry_date
                      ? [{ date: vehicle.fire_extinguisher_expiry_date }]
                      : [];
                  return extinguishers.map((ext, i) => {
                    const st = getDateStatus(ext.date);
                    return (
                      <div key={i} className="rounded-xl p-3 space-y-2" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                        <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>
                          🧯 {extinguishers.length > 1 ? `מטף ${i + 1}` : 'מטף כיבוי'}
                        </span>
                        <StatusBadge status={st.status} label={st.label} />
                      </div>
                    );
                  });
                })()}
                {vehicle.life_raft_expiry_date && (
                  <div className="rounded-xl p-3 space-y-2" style={{ background: T.card, border: `1px solid ${T.border}` }}>
                    <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>🛟 אסדת הצלה</span>
                    <StatusBadge status={lifeRaftStatus.status} label={lifeRaftStatus.label} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inspection checklist */}
          <VesselInspectionChecklist vehicle={vehicle} T={T} />
        </>
      )}

      {/*  Off-road equipment display  */}
      {(offroadMode || vehicle.offroad_equipment?.length > 0) && (
        <>
          {vehicle.offroad_equipment?.length > 0 && (
            <div className="rounded-2xl p-4" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-1.5 mb-3">
                <span className="text-sm">🏔️</span>
                <span className="text-sm font-bold" style={{ color: T.text }}>ציוד שטח</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {vehicle.offroad_equipment.map(key => {
                  const eq = OFFROAD_EQUIPMENT.find(e => e.key === key);
                  return eq ? (
                    <span key={key} className="px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: '#fff', color: T.primary, border: `1px solid ${T.border}` }}>
                      {eq.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}
          {(vehicle.offroad_usage_type || vehicle.last_offroad_service_date) && (
            <div className="rounded-2xl p-4 space-y-2" style={{ background: '#fff', border: `1.5px solid ${T.border}` }}>
              {vehicle.offroad_usage_type && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>סוג שימוש</span>
                  <span className="text-sm font-bold" style={{ color: T.text }}>
                    {OFFROAD_USAGE_TYPES.find(t => t.value === vehicle.offroad_usage_type)?.label || vehicle.offroad_usage_type}
                  </span>
                </div>
              )}
              {vehicle.last_offroad_service_date && (
                <div className="flex items-center justify-between" dir="rtl">
                  <span className="text-sm font-medium" style={{ color: T.muted }}>טיפול שטח אחרון</span>
                  <span className="text-sm font-bold" style={{ color: T.text }}>{formatDateHe(vehicle.last_offroad_service_date)}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Renewal dialog */}
      <RenewalDialog
        open={renewalDialog.open}
        onClose={() => setRenewalDialog({ open: false, dateField: null })}
        dateField={renewalDialog.dateField}
        vehicle={vehicle}
        vesselMode={vesselMode}
        T={T}
      />
    </div>
  );
}
