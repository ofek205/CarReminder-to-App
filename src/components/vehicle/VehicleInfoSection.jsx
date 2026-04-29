import React, { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StatusBadge from "../shared/StatusBadge";
import { getDateStatus, formatDateHe, isVessel, isOffroad, getVehicleLabels } from "../shared/DateStatusUtils";
import { OFFROAD_EQUIPMENT, OFFROAD_USAGE_TYPES } from "../vehicle/VehicleTypeSelector";
import { COUNTRIES } from "../vehicle/CountryFlagSelect";
import { Calendar, Shield, Download, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle, MinusCircle, ClipboardList, Cog, ExternalLink, Camera, Loader2, Upload, AlertTriangle, Zap, Leaf, Hash } from "lucide-react";
import { Input } from '@/components/ui/input';
import { db } from '@/lib/supabaseEntities';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useAuth } from '../shared/GuestContext';
import { useQueryClient } from '@tanstack/react-query';
import { aiRequest } from '@/lib/aiProxy';
import { compressImage } from '@/lib/imageCompress';

// Israeli marinas
const ISRAEL_MARINAS = [
  'מרינה הרצליה', 'מרינה אשקלון', 'מרינה אשדוד', 'מרינה יפו',
  'מרינה עתלית', 'מרינה חיפה', 'מרינה עכו', 'מרינה אילת',
  'מרינה קיסריה', 'מרינה נתניה',
];
import MileageUpdateWidget from "./MileageUpdateWidget";

//  Renewal Dialog - scan document + update dates 
function RenewalDialog({ open, onClose, dateField, vehicle, vesselMode, T }) {
  const fileRef = useRef(null);
  const [step, setStep] = useState('upload'); // upload | scanning | confirm | done
  const [aiResult, setAiResult] = useState(null);
  const [error, setError] = useState('');
  const { isGuest, updateGuestVehicle, addGuestDocument } = useAuth();
  const queryClient = useQueryClient();

  const currentDate = vehicle[dateField];
  const isTest = dateField === 'test_due_date';
  const docLabel = isTest
    ? (vesselMode ? 'כושר שייט' : 'רישיון רכב')
    : (vesselMode ? 'ביטוח ימי' : 'ביטוח');

  const reset = () => { setStep('upload'); setAiResult(null); setError(''); };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // Compress images before base64 to stay well under the ai-proxy
    // 8MB payload cap. PDFs and non-image files pass through unchanged.
    const ready = await compressImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => scanDocument(ev.target.result, ready?.type);
    reader.readAsDataURL(ready);
  };

  const scanDocument = async (base64, fileType) => {
    setStep('scanning');
    setError('');
    try {
      // Detect actual MIME from the data URL prefix (was hardcoded to
      // PNG/JPEG which mis-tagged WEBP and PDF uploads).
      const mimeMatch = base64.match(/^data:([^;]+);base64,/);
      const mediaType = mimeMatch?.[1] || fileType || 'image/jpeg';
      const imageData = base64.split(',')[1];
      const isPdf = mediaType === 'application/pdf';
      const sourcePart = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: imageData } }
        : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: imageData } };

      const json = await aiRequest({
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
        setError('לא הצלחתי לקרוא את המסמך. נסה תמונה ברורה יותר.');
        setStep('upload');
      }
    } catch (err) {
      console.error('Document scan error:', err?.code, err?.message);
      // Surface the actual failure cause instead of the generic
      // "שגיאה בסריקה". Network/auth/quota issues each have their
      // own remediation.
      let msg;
      switch (err?.code) {
        case 'TIMEOUT':              msg = 'התשובה מהשרת מאחרת. נסה ברשת יציבה יותר.'; break;
        case 'NETWORK':              msg = 'אין חיבור לאינטרנט. בדוק את הרשת.'; break;
        case 'RATE_LIMIT':           msg = 'יותר מדי סריקות. נסה בעוד דקה.'; break;
        case 'UNAUTHORIZED':
        case 'NO_SESSION':           msg = 'ההתחברות פגה. יש להתחבר מחדש.'; break;
        case 'PROVIDER_UNAVAILABLE':
        case 'AI_UNAVAILABLE':       msg = 'שירות AI לא זמין כרגע. נסה בעוד רגע.'; break;
        default:                     msg = 'שגיאה בסריקה. נסה שוב או תמונה ברורה יותר.';
      }
      setError(msg);
      setStep('upload');
    }
  };

  const isNewer = aiResult?.expiry_date && currentDate
    ? new Date(aiResult.expiry_date) > new Date(currentDate)
    : true; // If no current date, anything is fine

  const handleSave = async () => {
    if (!aiResult?.expiry_date) { setError('חסר תאריך תוקף'); return; }
    setStep('done');
    try {
      // 1. Save document
      const doc = {
        document_type: aiResult.document_type,
        title: aiResult.title || docLabel,
        issue_date: aiResult.issue_date || null,
        expiry_date: aiResult.expiry_date,
        vehicle_id: vehicle.id,
      };
      if (isGuest) {
        addGuestDocument(doc);
      } else {
        // Auth: try to save document to Supabase (if documents table exists)
        try {
          // Get user's account_id for the document
          const { supabase } = await import('@/lib/supabase');
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
            if (members.length > 0) {
              await db.documents.create({ ...doc, account_id: members[0].account_id });
            }
          }
        } catch (err) {
          // Silently fail - vehicle date update is the main action
          console.warn('Document save skipped:', err?.message);
        }
      }

      // 2. Update vehicle date
      const update = { [dateField]: aiResult.expiry_date };
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
      setStep('confirm');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-sm mx-4" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-base font-black">{step === 'done' ? '✅ עודכן!' : `חידוש ${docLabel}`}</DialogTitle>
        </DialogHeader>

        {/* Upload step */}
        {step === 'upload' && (
          <div className="space-y-3 pt-1">
            <p className="text-sm" style={{ color: '#6B7280' }}>
              אם חידשת {docLabel} - העלה את המסמך כדי שנעדכן את הפרטים אוטומטית
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
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all active:scale-[0.97]"
                style={{ background: T.light, color: T.primary, border: `1.5px solid ${T.border}` }}>
                <Upload className="w-4 h-4" /> העלה תמונה
              </button>
              <label className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer transition-all active:scale-[0.97]"
                style={{ background: T.primary, color: '#fff' }}>
                <Camera className="w-4 h-4" /> צלם
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
              </label>
            </div>
          </div>
        )}

        {/* Scanning step */}
        {step === 'scanning' && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: T.primary }} />
            <p className="text-sm font-bold" style={{ color: T.text }}>סורק את המסמך...</p>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>מחלץ תאריכים ופרטים</p>
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
                className="px-4 py-2.5 rounded-xl font-bold text-sm" style={{ color: '#9CA3AF' }}>
                ביטול
              </button>
            </div>
          </div>
        )}

        {/* Done step */}
        {step === 'done' && (
          <div className="flex flex-col items-center py-6 gap-2">
            <CheckCircle2 className="w-12 h-12" style={{ color: '#10B981' }} />
            <p className="text-sm font-bold" style={{ color: T.text }}>{docLabel} עודכן בהצלחה!</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
import { getTheme } from '@/lib/designTokens';
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
    warn:    { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
    danger:  { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
    missing: { color: '#9CA3AF', bg: '#F9FAFB', border: '#E5E7EB' },
  };

  const st = isMissing ? 'missing' : (status.status || 'missing');
  const accent = STATUS_ACCENT[st] || STATUS_ACCENT.missing;

  return (
    <div className="rounded-2xl p-4 space-y-2.5"
      style={{ background: '#FFFFFF', border: `1.5px solid ${accent.border}`, borderRight: `4px solid ${accent.color}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: accent.color }} />
        <span className="text-sm font-bold" style={{ color: '#374151' }}>{label}</span>
      </div>
      {subtitle && (
        <p className="text-xs font-medium" style={{ color: '#9CA3AF' }}>{subtitle}</p>
      )}

      {isMissing ? (
        <Link to={`${createPageUrl('EditVehicle')}?id=${vehicle.id}&field=${dateField}`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all active:scale-[0.97]"
          style={{ background: '#FFF7ED', border: '1px solid #FFEDD5' }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#EA580C' }} />
          <span className="text-xs font-bold" style={{ color: '#EA580C' }}>לא הוזן - לחץ להוספה</span>
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
          <span className="text-[14px] font-black text-gray-900 tabular-nums">{split.num}</span>
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
function OwnershipHistoryPanel({ history, theme }) {
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
              background: isCurrent ? T.light : '#F9FAFB',
              border: `1px solid ${isCurrent ? T.border : '#F3F4F6'}`,
            }}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: isCurrent ? T.primary : '#D1D5DB', color: '#fff' }}
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
    ? { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' }
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
                style={{ background: isMissing ? '#FFF7ED' : '#FFFFFF', border: `1px solid ${isMissing ? '#FFEDD5' : T.border}`, display: 'flex' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(item.has ? item.st.status : 'neutral')}
                  <span className="text-xs font-medium truncate" style={{ color: T.text }}>{item.label}</span>
                </div>
                <div className="shrink-0 mr-2">
                  {isMissing
                    ? <span className="text-xs font-bold" style={{ color: '#EA580C' }}>לחץ להוספה</span>
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
                <span className="text-sm font-black" style={{ color: T.text }}>מפרט טכני</span>
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
                        <h3 className="text-[13px] font-black tracking-tight" style={{ color: T.text }}>
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
                                  <span className="font-black text-gray-900 tabular-nums">{item.value}</span>
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
