import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { openFileUrlSafely } from '@/lib/securityUtils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, FileText, Upload, Trash2, Eye, Download, Loader2, Sparkles, CheckCircle2, X, ChevronDown, ChevronUp, Camera, Car, Lock, Shield, User, Wrench, Anchor } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import PageHeader from "../components/shared/PageHeader";
import { ListSkeleton } from "../components/shared/Skeletons";
import { hapticFeedback } from "@/lib/capacitor";
import useFileUpload from "@/hooks/useFileUpload";
import { getSignedUrl } from "@/hooks/useSignedUrl";
import EmptyState from "../components/shared/EmptyState";
import { formatDateHe, isVessel } from "../components/shared/DateStatusUtils";
import { daysLabel, daysUntil } from "../components/shared/ReminderEngine";
import { trackUserAction } from "../components/shared/ReviewManager";
import VehicleScanWizard from "../components/vehicle/VehicleScanWizard";
import ConfirmDeleteDialog from "../components/shared/ConfirmDeleteDialog";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useAccountRole from '@/hooks/useAccountRole';
import { canEdit } from '@/lib/permissions';

//  Document category definitions 
const DOC_CATEGORIES = [
  { type: 'ביטוח חובה',   emoji: '🛡️', bg: 'bg-blue-50',    text: 'text-blue-700',   border: 'border-blue-200'  },
  { type: 'ביטוח מקיף',   emoji: '🔒', bg: 'bg-indigo-50',  text: 'text-indigo-700', border: 'border-indigo-200'},
  { type: 'ביטוח צד ג',   emoji: '🤝', bg: 'bg-cyan-50',    text: 'text-cyan-700',   border: 'border-cyan-200'  },
  { type: 'רישיון רכב',   emoji: '🚗', bg: 'bg-green-50',   text: 'text-green-700',  border: 'border-green-200' },
  { type: 'רישיון נהיגה', emoji: '👤', bg: 'bg-yellow-50',  text: 'text-yellow-700', border: 'border-yellow-200'},
  { type: 'טסט',          emoji: '🔧', bg: 'bg-orange-50',  text: 'text-orange-700', border: 'border-orange-200'},
  { type: 'טיפול תקופתי', emoji: '⚙️', bg: 'bg-purple-50',  text: 'text-purple-700', border: 'border-purple-200'},
  { type: 'מסמך אחר',     emoji: '📄', bg: 'bg-gray-50',    text: 'text-gray-600',   border: 'border-gray-200'  },
];

const VESSEL_DOC_CATEGORIES = [
  { type: 'ביטוח ימי חובה', emoji: '🛡️', bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200'  },
  { type: 'ביטוח ימי מקיף', emoji: '🔒', bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200'  },
  { type: 'ביטוח צד ג',     emoji: '🤝', bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200'  },
  { type: 'רישיון כלי שייט', emoji: '⚓', bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200'  },
  { type: 'רישיון שייט',     emoji: '👤', bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200'},
  { type: 'כושר שייט',       emoji: '🔧', bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200'  },
  { type: 'טיפול תקופתי',   emoji: '⚙️', bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200'},
  { type: 'מסמך אחר',       emoji: '📄', bg: 'bg-gray-50',    text: 'text-gray-600',    border: 'border-gray-200'  },
];

function getDocCategories(vehicleType, nickname) {
  return isVessel(vehicleType, nickname) ? VESSEL_DOC_CATEGORIES : DOC_CATEGORIES;
}

const docTypes = DOC_CATEGORIES.map(c => c.type);
const allDocTypes = [...new Set([...DOC_CATEGORIES, ...VESSEL_DOC_CATEGORIES].map(c => c.type))];

function getCat(type) {
  return [...DOC_CATEGORIES, ...VESSEL_DOC_CATEGORIES].find(c => c.type === type)
    || DOC_CATEGORIES[DOC_CATEGORIES.length - 1];
}

function renderDocCategoryIcon(cat) {
  const cls = "w-4 h-4";
  if (cat.type.includes('ביטוח')) {
    return cat.type.includes('מקיף') ? <Lock className={cls} /> : <Shield className={cls} />;
  }
  if (cat.type.includes('רישיון') && cat.type.includes('שייט')) return <Anchor className={cls} />;
  if (cat.type.includes('רישיון') && cat.type.includes('נהיגה')) return <User className={cls} />;
  if (cat.type.includes('רישיון')) return <Car className={cls} />;
  if (cat.type.includes('טיפול') || cat.type.includes('טסט') || cat.type.includes('כושר')) return <Wrench className={cls} />;
  return <FileText className={cls} />;
}

//  Parse DD/MM/YYYY → YYYY-MM-DD 
function parseDocDate(str) {
  if (!str) return '';
  const parts = str.split('/');
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  const fy = y.length === 2 ? '20' + y : y;
  const result = `${fy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isNaN(new Date(result).getTime()) ? '' : result;
}

const EMPTY_FORM = { document_type: 'מסמך אחר', title: '', description: '', vehicle_id: '', issue_date: '', expiry_date: '', file_url: '', storage_path: '' };

//  Upload dialog (shared logic wrapper) 
function DocUploadDialog({ open, onClose, onSave, vehicleIdParam, vehicles, saving, isGuest = false, accountId = null, userId = null }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, vehicle_id: vehicleIdParam || '' });
  // fileDataUrl holds a base64 data: URL ONLY for the AI vision call —
  // never persisted to the DB. The DB sees `form.file_url` (a Storage
  // signed URL) and `form.storage_path` (the bucket key, used to refresh
  // the URL after 7 days). Sprint A.B keeps base64 strictly in-memory.
  const [fileDataUrl, setFileDataUrl] = useState('');
  const [aiScanning, setAiScanning] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [fileName, setFileName] = useState('');

  // Storage upload hook. Wraps validation + (re-)compression + signed
  // URL fetch. We give it mode='doc' (PDF + images) and a 5MB cap that
  // matches the existing UX copy ("PDF / JPG / PNG עד 5MB").
  // accountId is null for guests — guests never call hookUpload, so
  // the hook's "missing accountId" check never fires.
  // Pass current vehicle_id (form or URL param) so the upload lands at
  // {accountId}/{vehicleId}/... — the path the bucket RLS policy
  // expects. Falls back to scans/{userId} when neither vehicle is set.
  const { upload: hookUpload, uploading, error: uploadError, reset: resetUpload } = useFileUpload({
    accountId,
    vehicleId: form.vehicle_id || vehicleIdParam || undefined,
    userId,
    mode: 'doc',
    maxMB: 5,
  });

  // Vehicle-aware document categories
  const selectedVehicle = vehicles?.find(v => v.id === (form.vehicle_id || vehicleIdParam));
  const categories = getDocCategories(selectedVehicle?.vehicle_type, selectedVehicle?.nickname);

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_FORM, vehicle_id: vehicleIdParam || '' });
      setAiResult(null);
      setFileName('');
      setFileDataUrl('');
      resetUpload();
    }
  }, [open, vehicleIdParam, resetUpload]);

  // Surface upload errors as toasts so the user understands why the
  // upload card isn't switching to the green "uploaded" state.
  useEffect(() => {
    if (uploadError) toast.error(uploadError);
  }, [uploadError]);

  // Read a File into a base64 data: URL. ONLY used to feed the AI vision
  // call (handleAiScan). Result is held in component state, never persisted.
  // Kept as a tiny helper because we need it on both the auth and guest
  // paths (auth: AI scan; guest: AI scan + DB-of-localStorage persistence).
  const readAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file); // eslint-disable-line no-restricted-syntax
  });

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // We always run the AI-scan-friendly base64 read against the ORIGINAL
    // file in parallel with the upload — the upload path internally
    // compresses, but for the AI vision payload we want the user's actual
    // photo at the same fidelity the user picked it. Both branches set
    // `fileName` so the green "הקובץ הועלה בהצלחה" card has a name to show.
    if (isGuest) {
      // Guest path is unchanged: their data only ever lives in localStorage,
      // never in our DB or Storage. base64 is the simplest representation.
      try {
        // Validate via the same helper the hook uses, just so guests get
        // identical error copy as auth users.
        const { validateUploadFile } = await import('@/lib/securityUtils');
        const v = validateUploadFile(file, 'doc', 5);
        if (!v.ok) { toast.error(v.error); e.target.value = ''; return; }
        const base64 = await readAsBase64(file);
        setFileName(file.name);
        setFileDataUrl(base64);
        setForm(f => ({ ...f, file_url: base64, storage_path: '' }));
      } catch (err) {
        console.error('Guest file read error:', err);
        toast.error('שגיאה בקריאת הקובץ');
      }
      return;
    }

    // Auth path: upload to Supabase Storage, persist signed URL +
    // storage_path. Validation, compression and the signed-URL fetch are
    // all inside the hook — handleFile just orchestrates state.
    try {
      const [uploadResult, base64] = await Promise.all([
        hookUpload(file),
        readAsBase64(file).catch(() => ''), // AI is optional; don't fail upload
      ]);
      if (!uploadResult) return; // hook already toasted via uploadError effect
      setFileName(file.name);
      setFileDataUrl(base64);
      setForm(f => ({ ...f, file_url: uploadResult.fileUrl, storage_path: uploadResult.storagePath }));
    } catch {
      // hookUpload already pushes the message into uploadError → toast effect.
      // Caught here so a thrown promise doesn't bubble into React's error boundary.
    }
  };

  const handleAiScan = async () => {
    // Read AI source from `fileDataUrl` (in-memory base64), NOT from
    // `form.file_url` (which is a Storage signed URL after Sprint A.B —
    // it would split('') into garbage). Falls back to file_url for the
    // guest path where file_url IS still base64.
    const aiSource = fileDataUrl || form.file_url;
    if (!aiSource || !aiSource.startsWith('data:')) {
      toast.error('הקובץ עדיין נטען. נסה שוב בעוד שנייה.');
      return;
    }
    setAiScanning(true);
    setAiResult(null);
    try {
      const { aiRequest } = await import('@/lib/aiProxy');
      // Detect real MIME type instead of assuming PNG/JPEG — uploads
      // are often PDFs (contracts, vehicle licenses) or WEBP.
      const mimeMatch = aiSource.match(/^data:([^;]+);base64,/);
      const mediaType = mimeMatch?.[1] || 'image/jpeg';
      const imageData = aiSource.split(',')[1];
      if (!imageData) { toast.error('לא ניתן לקרוא את הקובץ'); setAiScanning(false); return; }
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
            { type: 'text', text: `סרוק מסמך זה וחלץ פרטים. סוגי מסמכים אפשריים: ${docTypes.join(' / ')}.
החזר JSON בלבד: {"document_type":"סוג", "title":"כותרת/שם מנפיק", "issue_date":"YYYY-MM-DD", "expiry_date":"YYYY-MM-DD"}.
אם לא ניתן לזהות שדה - השאר ריק.` },
          ],
        }],
      });

      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const raw = JSON.parse(match[0]);
        const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime()) ? d : '';
        setAiResult({
          document_type: docTypes.includes(raw.document_type) ? raw.document_type : '',
          title: (raw.title || '').replace(/<[^>]*>/g, '').slice(0, 100),
          issue_date: validDate(raw.issue_date),
          expiry_date: validDate(raw.expiry_date),
        });
      } else {
        toast.error('לא הצלחתי לקרוא את המסמך - מלא ידנית');
      }
    } catch (err) {
      console.error('Document AI scan error:', err?.code, err?.message);
      let msg;
      switch (err?.code) {
        case 'TIMEOUT':              msg = 'התשובה מהשרת מאחרת. נסה ברשת יציבה יותר.'; break;
        case 'NETWORK':              msg = 'אין חיבור לאינטרנט'; break;
        case 'RATE_LIMIT':           msg = 'יותר מדי סריקות. נסה בעוד דקה'; break;
        case 'UNAUTHORIZED':
        case 'NO_SESSION':           msg = 'ההתחברות פגה. יש להתחבר מחדש'; break;
        case 'PROVIDER_UNAVAILABLE':
        case 'AI_UNAVAILABLE':       msg = 'שירות AI לא זמין כרגע'; break;
        default:                     msg = 'שגיאה בסריקת המסמך';
      }
      toast.error(msg);
    } finally {
      setAiScanning(false);
    }
  };

  const applyAiResult = () => {
    setForm(f => ({
      ...f,
      document_type: aiResult.document_type || f.document_type,
      title: aiResult.title || f.title,
      issue_date: aiResult.issue_date || f.issue_date,
      expiry_date: aiResult.expiry_date || f.expiry_date,
    }));
    setAiResult(null);
    toast.success('הפרטים מולאו אוטומטית');
  };

  // Validation rules:
  //   1. A vehicle MUST be selected so the document is filed against the
  //      right asset. Admins have complained that loose documents end up
  //      hard to find.
  //   2. EITHER a meaningful title OR a specific (non-default) category
  //      must be filled so the document is categorised in some way.
  const titleFilled = (form.title || '').trim().length > 0;
  const categoryPicked = form.document_type && form.document_type !== 'מסמך אחר';
  const vehicleSelected = !!(form.vehicle_id || vehicleIdParam);

  const validationErrors = [];
  if (!vehicleSelected)                    validationErrors.push('יש לבחור כלי רכב');
  if (!titleFilled && !categoryPicked)     validationErrors.push('יש למלא כותרת או לבחור קטגוריה ספציפית');

  const handleSave = () => {
    if (validationErrors.length > 0) return; // button is disabled too, this is a belt-and-suspenders
    onSave(form);
  };

  const baseAllow = isGuest ? (form.title || form.document_type) : form.file_url;
  const canSave = baseAllow && validationErrors.length === 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{isGuest ? 'הוסף מסמך' : 'סרוק / העלה מסמך'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4" dir="rtl">

          {/*  Guest: AI scan requires registration  */}
          {isGuest && (
            <div className="rounded-2xl p-4 flex items-start gap-3"
              style={{ background: '#F3E5F5', border: '1.5px solid #CE93D8' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: '#7B1FA2' }}>
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: '#4A148C' }}>סריקת מסמכים עם AI</p>
                <p className="text-xs mt-0.5" style={{ color: '#7B1FA2' }}>
                  העלאה וסריקה חכמה של מסמכים זמינה לאחר הרשמה. כרגע ניתן להוסיף מסמך ידנית.
                </p>
                <button
                  type="button"
                  onClick={() => window.location.href = '/Auth'}
                  className="mt-2 text-xs font-bold px-3 py-1.5 rounded-lg text-white"
                  style={{ background: '#7B1FA2' }}>
                  הירשם בחינם
                </button>
              </div>
            </div>
          )}

          {/*  Upload zone  */}
          {!isGuest && (
            <div>
              <label
                className={`flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed rounded-2xl cursor-pointer transition-colors
                  ${form.file_url ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-gray-50 hover:border-[#2D5233] hover:bg-[#FDF6F0]'}`}
              >
                {uploading ? (
                  <><Loader2 className="h-8 w-8 text-[#2D5233] animate-spin" /><span className="text-sm text-gray-500">מעלה קובץ...</span></>
                ) : form.file_url ? (
                  <><CheckCircle2 className="h-8 w-8 text-green-600" /><span className="text-sm font-medium text-green-700">{fileName || 'הקובץ הועלה בהצלחה'}</span><span className="text-xs text-green-500">לחץ להחלפה</span></>
                ) : (
                  <><Upload className="h-8 w-8 text-gray-400" /><span className="text-sm font-medium text-gray-600">בחר קובץ להעלאה</span><span className="text-xs text-gray-400">PDF / JPG / PNG עד 5MB</span></>
                )}
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFile} />
              </label>
              {/* Camera capture - separate button below the drop zone */}
              {!uploading && (
                <label className={`${buttonVariants({ variant: "outline" })} mt-2 w-full cursor-pointer gap-2 justify-center border-[#2D5233] text-[#2D5233] hover:bg-[#FDF6F0]`}>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
                  <Camera className="h-4 w-4" />
                  צלם מסמך
                </label>
              )}
            </div>
          )}

          {/*  AI Scan banner  */}
          {!isGuest && form.file_url && !aiResult && (
            <div className="flex items-center justify-between gap-3 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-purple-800 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  סריקה חכמה עם AI
                </p>
                <p className="text-xs text-purple-600 mt-0.5">יזהה סוג, תאריכים וכותרת אוטומטית</p>
              </div>
              <Button
                type="button"
                onClick={handleAiScan}
                disabled={aiScanning}
                className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5 shrink-0"
              >
                {aiScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {aiScanning ? 'סורק...' : 'סרוק'}
              </Button>
            </div>
          )}

          {/*  AI result preview  */}
          {aiResult && (
            <div className="border border-green-300 bg-green-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-green-800 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  AI זיהה את הפרטים הבאים:
                </p>
                <button type="button" onClick={() => setAiResult(null)} className="flex h-7 w-7 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="text-xs text-green-900 space-y-1 pr-1">
                {aiResult.document_type && <p>סוג: <span className="font-semibold">{aiResult.document_type}</span></p>}
                {aiResult.title && <p>כותרת: <span className="font-semibold">{aiResult.title}</span></p>}
                {aiResult.issue_date && <p>תאריך הנפקה: <span className="font-semibold">{aiResult.issue_date.split('-').reverse().join('/')}</span></p>}
                {aiResult.expiry_date && <p>תאריך תפוגה: <span className="font-semibold">{aiResult.expiry_date.split('-').reverse().join('/')}</span></p>}
              </div>
              <Button type="button" onClick={applyAiResult} className="w-full bg-green-700 hover:bg-green-800 text-white gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                מלא פרטים אוטומטית
              </Button>
            </div>
          )}

          {/*  Category  */}
          <div>
            <Label className="text-right block mb-1.5">קטגוריה</Label>
            <div className="grid grid-cols-2 gap-2">
              {categories.map(cat => (
                <button
                  key={cat.type}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, document_type: cat.type }))}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm text-right transition-all
                    ${form.document_type === cat.type
                      ? `${cat.bg} ${cat.border} ${cat.text} border-2 font-semibold`
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                >
                  {renderDocCategoryIcon(cat)}
                  <span className="truncate">{cat.type}</span>
                </button>
              ))}
            </div>
          </div>

          {/*  Title  */}
          <div>
            <Label className="text-right block mb-1.5">
              כותרת / שם המסמך
              {!categoryPicked && <span className="text-red-500 mr-1">*</span>}
            </Label>
            <Input
              dir="rtl"
              placeholder="לדוגמה: מגדל ביטוח פוליסה 12345"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className={!titleFilled && !categoryPicked ? 'border-amber-300 bg-amber-50/30' : ''}
            />
            {!titleFilled && !categoryPicked && (
              <p className="text-[11px] text-amber-700 mt-1">יש למלא כותרת או לבחור קטגוריה ספציפית למעלה</p>
            )}
          </div>

          {/*  Description  */}
          <div>
            <Label className="text-right block mb-1.5">תיאור (אופציונלי)</Label>
            <Textarea
              dir="rtl"
              placeholder="הערות נוספות על המסמך..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="resize-none"
              rows={2}
            />
          </div>

          {/*  Vehicle selector. Required so every doc is filed against a vehicle. */}
          {!vehicleIdParam && vehicles && vehicles.length > 0 && (
            <div>
              <Label className="text-right block mb-1.5">
                רכב <span className="text-red-500 mr-1">*</span>
              </Label>
              <Select value={form.vehicle_id} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
                <SelectTrigger dir="rtl"
                  className={!form.vehicle_id ? 'border-amber-300 bg-amber-50/30' : ''}>
                  <SelectValue placeholder="בחר רכב לשיוך המסמך" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nickname || `${v.manufacturer} ${v.model}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!form.vehicle_id && (
                <p className="text-[11px] text-amber-700 mt-1">כל מסמך חייב להיות משויך לרכב</p>
              )}
            </div>
          )}

          {/*  Dates  */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-right block mb-1.5">תאריך הוצאה</Label>
              <DateInput value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
            </div>
            <div>
              <Label className="text-right block mb-1.5">תאריך תפוגה</Label>
              <DateInput value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </div>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'שמור מסמך'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

//  Expiry pill helper 
function ExpiryPill({ expiryDate }) {
  if (!expiryDate) return null;
  const dl = daysUntil(expiryDate);
  const label = daysLabel(dl);
  const dateStr = formatDateHe(expiryDate);

  let cls;
  if (dl < 0)       cls = 'bg-red-50 text-red-700 border border-red-200';
  else if (dl <= 14) cls = 'bg-amber-50 text-amber-700 border border-amber-200';
  else               cls = 'bg-emerald-50 text-emerald-700 border border-emerald-200';

  return (
    <div className={`inline-flex flex-col items-end rounded-xl px-2.5 py-1.5 ${cls}`}>
      <span className="text-xs font-semibold leading-tight">{label}</span>
      <span className="text-xs opacity-70 leading-tight">תפוגה: {dateStr}</span>
    </div>
  );
}

//  Document card
//
// Both `onOpen` and `onDownload` accept the full doc and resolve the URL
// internally (parent uses storage_path + getSignedUrl to refresh on demand).
// The card just renders buttons and reports clicks. Falls back gracefully
// when `onDownload` isn't provided (guest path) — uses the inline file_url
// link, which for guests is the base64 data: URL stored locally.
function DocCard({ doc, vehicle, onOpen, onDownload, onDelete, openingId }) {
  const cat = getCat(doc.document_type);

  // The card has *some* payload to view/download if either column has it.
  // After Sprint A.B, auth rows have file_url+storage_path; legacy rows
  // and guest rows have file_url only.
  const hasFile = !!(doc.file_url || doc.storage_path);

  const handleDownloadClick = () => {
    if (onDownload) { onDownload(doc); return; }
    // Guest fallback: legacy inline-anchor click on doc.file_url.
    if (!doc.file_url) return;
    const a = document.createElement('a');
    a.href = doc.file_url;
    a.download = doc.title || 'document';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Card className="p-4 border border-gray-100">
      <div className="flex items-start justify-between gap-3" dir="rtl">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`w-10 h-10 rounded-xl ${cat.bg} flex items-center justify-center shrink-0`}>
            {renderDocCategoryIcon(cat)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 truncate">{doc.title || doc.document_type}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span className={`text-xs font-medium ${cat.text}`}>{doc.document_type}</span>
              {vehicle && (
                <span className="text-xs text-gray-400">• {vehicle.nickname || `${vehicle.manufacturer} ${vehicle.model}`}</span>
              )}
            </div>
            {doc.description && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{doc.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {doc.issue_date && (
                <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                  הוצאה: {formatDateHe(doc.issue_date)}
                </span>
              )}
              {doc.expiry_date && <ExpiryPill expiryDate={doc.expiry_date} />}
            </div>
          </div>
        </div>

        <div className="flex gap-1 shrink-0 mt-0.5">
          {hasFile && onOpen && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50 h-8 px-2"
                onClick={() => onOpen(doc)}
                disabled={openingId === doc.id}
              >
                {openingId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                <span className="hidden sm:inline text-xs">צפייה</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-green-600 border-green-200 hover:bg-green-50 h-8 px-2"
                onClick={handleDownloadClick}
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">הורדה</span>
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDelete(doc.id)}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

//  Vehicle-grouped wrapper (used on "all vehicles" view) 
// Wraps GroupedDocList inside a per-vehicle section so the user can scan
// "which docs belong to which vehicle" at a glance, instead of a flat
// category list that mixes all vehicles' docs together.
function VehicleGroupedDocList({ docs, vehicles, onOpen, onDownload, onDelete, openingId }) {
  const [collapsed, setCollapsed] = useState({});

  // Partition docs by vehicle id. "Unassigned" docs (no vehicle_id) fall
  // into a separate trailing section so they don't get lost.
  const byVehicle = new Map();
  const unassigned = [];
  docs.forEach(d => {
    if (d.vehicle_id) {
      if (!byVehicle.has(d.vehicle_id)) byVehicle.set(d.vehicle_id, []);
      byVehicle.get(d.vehicle_id).push(d);
    } else {
      unassigned.push(d);
    }
  });

  // Keep vehicles in the order they appear in the props list.
  const sections = [];
  (vehicles || []).forEach(v => {
    const list = byVehicle.get(v.id);
    if (list && list.length) sections.push({ vehicle: v, docs: list });
  });
  if (unassigned.length) sections.push({ vehicle: null, docs: unassigned });

  if (sections.length === 0) return null;

  return (
    <div className="space-y-5" dir="rtl">
      {sections.map(({ vehicle, docs: vDocs }) => {
        const key = vehicle?.id || '__unassigned';
        const isCollapsed = collapsed[key];
        const name = vehicle
          ? (vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || 'רכב')
          : 'מסמכים ללא רכב משויך';
        const sub = vehicle && vehicle.license_plate ? vehicle.license_plate : null;
        return (
          <div key={key}
            className="rounded-2xl p-3.5"
            style={{ background: '#FAFAFA', border: '1px solid #E5E7EB' }}>
            <button type="button"
              className="w-full flex items-center justify-between gap-2 mb-2"
              onClick={() => setCollapsed(c => ({ ...c, [key]: !c[key] }))}>
              <div className="flex items-center gap-2 min-w-0">
                {vehicle ? <Car className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                <div className="text-right min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: '#1C2E20' }}>{name}</p>
                  {sub && <p className="text-[10px]" dir="ltr" style={{ color: '#9CA3AF' }}>{sub}</p>}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-1"
                  style={{ background: '#E8F2EA', color: '#2D5233' }}>
                  {vDocs.length}
                </span>
              </div>
              {isCollapsed
                ? <ChevronDown className="h-4 w-4 text-gray-400" />
                : <ChevronUp className="h-4 w-4 text-gray-400" />}
            </button>
            {!isCollapsed && (
              <div className="mt-2">
                <GroupedDocList docs={vDocs} vehicles={vehicles}
                  onOpen={onOpen} onDownload={onDownload}
                  onDelete={onDelete} openingId={openingId} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

//  Grouped document list 
function GroupedDocList({ docs, vehicles, onOpen, onDownload, onDelete, openingId }) {
  const [collapsed, setCollapsed] = useState({});

  const allCategories = [...DOC_CATEGORIES, ...VESSEL_DOC_CATEGORIES];
  const seen = new Set();
  const grouped = allCategories.reduce((acc, cat) => {
    if (seen.has(cat.type)) return acc;
    seen.add(cat.type);
    const catDocs = docs.filter(d => d.document_type === cat.type);
    if (catDocs.length > 0) acc.push({ cat, docs: catDocs });
    return acc;
  }, []);

  // Docs with unknown category
  const knownTypes = new Set(allDocTypes);
  const otherDocs = docs.filter(d => !knownTypes.has(d.document_type));
  if (otherDocs.length > 0) {
    grouped.push({ cat: getCat('מסמך אחר'), docs: otherDocs });
  }

  return (
    <div className="space-y-4" dir="rtl">
      {grouped.map(({ cat, docs: catDocs }) => {
        const isCollapsed = collapsed[cat.type];
        return (
          <div key={cat.type}>
            {/* Category header */}
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 mb-2 group"
              onClick={() => setCollapsed(c => ({ ...c, [cat.type]: !c[cat.type] }))}
            >
              <div className="flex items-center gap-2">
                {renderDocCategoryIcon(cat)}
                <span className={`text-sm font-semibold ${cat.text}`}>{cat.type}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${cat.bg} ${cat.text} border ${cat.border}`}>
                  {catDocs.length}
                </span>
              </div>
              {isCollapsed
                ? <ChevronDown className="h-4 w-4 text-gray-400" />
                : <ChevronUp className="h-4 w-4 text-gray-400" />
              }
            </button>

            {!isCollapsed && (() => {
              // Sort by expiry_date descending (newest first), then by created_date
              const sorted = [...catDocs].sort((a, b) => {
                const da = a.expiry_date || a.created_date || '';
                const db2 = b.expiry_date || b.created_date || '';
                return db2.localeCompare(da);
              });
              const latest = sorted[0];
              const older = sorted.slice(1);
              const [showOlder, setShowOlder] = [
                collapsed[`${cat.type}_older`],
                (v) => setCollapsed(c => ({ ...c, [`${cat.type}_older`]: v }))
              ];

              return (
                <div className="space-y-2 pr-1">
                  {/* Latest document - always visible */}
                  {latest && (
                    <DocCard
                      key={latest.id}
                      doc={latest}
                      vehicle={vehicles.find(v => v.id === latest.vehicle_id)}
                      onOpen={onOpen}
                      onDownload={onDownload}
                      onDelete={onDelete}
                      openingId={openingId}
                    />
                  )}
                  {/* Older documents - collapsed by default */}
                  {older.length > 0 && (
                    <>
                      <button type="button" onClick={() => setShowOlder(!showOlder)}
                        className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg transition-all"
                        style={{ color: '#9CA3AF' }}>
                        {showOlder ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        הצג ישנים ({older.length})
                      </button>
                      {showOlder && older.map(doc => (
                        <div key={doc.id} style={{ opacity: 0.6 }}>
                          <DocCard
                            doc={doc}
                            vehicle={vehicles.find(v => v.id === doc.vehicle_id)}
                            onOpen={onOpen}
                            onDownload={onDownload}
                            onDelete={onDelete}
                            openingId={openingId}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

//  Guest Documents 
function GuestDocuments({ vehicleIdParam }) {
  const { guestDocuments, guestVehicles, addGuestDocument, removeGuestDocument } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showGuestSignup, setShowGuestSignup] = useState(false);

  const docs = vehicleIdParam
    ? guestDocuments.filter(d => d.vehicle_id === vehicleIdParam)
    : guestDocuments;

  const handleSave = (formData) => {
    if (formData) {
      const vid = formData.vehicle_id || vehicleIdParam || null;
      // Auto-name: if title is empty, use type + date
      if (!formData.title && formData.expiry_date) {
        formData.title = `${formData.document_type} - ${new Date(formData.expiry_date).toLocaleDateString('he-IL')}`;
      }
      // Check for existing document of same type for this vehicle - mark old as superseded
      const existingDocs = guestDocuments.filter(d => d.vehicle_id === vid && d.document_type === formData.document_type);
      if (existingDocs.length > 0 && formData.expiry_date) {
        // Mark all older docs as not latest
        existingDocs.forEach(old => {
          if (!old.expiry_date || new Date(formData.expiry_date) >= new Date(old.expiry_date)) {
            updateGuestDocument?.(old.id, { _superseded: true });
          }
        });
      }
      addGuestDocument({
        ...formData,
        vehicle_id: vid,
        _superseded: false, // This is the latest
      });
    }
    setShowAdd(false);
    setShowGuestSignup(true);
  };

  return (
    <div>
      <PageHeader
        title="מסמכים"
        backPage={vehicleIdParam ? `VehicleDetail?id=${vehicleIdParam}` : undefined}
        actions={
          <Button onClick={() => setShowAdd(true)} className="gap-2 text-xs sm:text-sm rounded-2xl font-bold" style={{ background: '#FFBF00', color: '#2D5233' }}>
            <Plus className="h-4 w-4" />
            הוסף מסמך
          </Button>
        }
      />

      {/* Guest banner - single combined banner */}
      <div className="mb-4 rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }} dir="rtl">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#FDE68A' }}>
          {docs.some(d => d._isDemo)
            ? <Eye className="w-4 h-4" style={{ color: '#92400E' }} />
            : <Lock className="w-4 h-4" style={{ color: '#92400E' }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{ color: '#92400E' }}>
            {docs.some(d => d._isDemo) ? 'מסמכים לדוגמה' : 'מסמכים זמניים'}
          </p>
          <p className="text-xs" style={{ color: '#B45309' }}>
            נשמרים במכשיר בלבד.{' '}
            <button onClick={() => window.location.href = '/Auth'} className="underline font-bold">
              הירשם כדי לשמור לצמיתות
            </button>
          </p>
        </div>
      </div>

      {docs.length === 0 ? (
        <EmptyState icon={FileText} title="אין מסמכים" description="הוסף מסמכים כמו רישיון רכב, ביטוח ועוד" />
      ) : vehicleIdParam ? (
        // Viewing one specific vehicle. skip the per-vehicle wrapper and
        // just show the category-grouped list.
        <GroupedDocList
          docs={docs}
          vehicles={guestVehicles}
          onDelete={id => setDeleteTarget(id)}
        />
      ) : (
        // "All vehicles" view. group by vehicle first, then by category.
        <VehicleGroupedDocList
          docs={docs}
          vehicles={guestVehicles}
          onDelete={id => setDeleteTarget(id)}
        />
      )}

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onConfirm={() => { removeGuestDocument(deleteTarget); setDeleteTarget(null); toast.success('הפריט נמחק בהצלחה'); }}
        onCancel={() => setDeleteTarget(null)}
      />

      <DocUploadDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={handleSave}
        vehicleIdParam={vehicleIdParam}
        vehicles={guestVehicles}
        saving={saving}
        isGuest
      />

      {/* Guest signup prompt */}
      {showGuestSignup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center" style={{ background: '#FFF8E1' }}>
              <Lock className="w-6 h-6" style={{ color: '#92400E' }} />
            </div>
            <h2 className="text-lg font-bold text-gray-900">הירשם כדי לשמור</h2>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              הרשמה בחינם תוך שניות - ותוכל לשמור מסמכים, לקבל תזכורות ולגשת מכל מכשיר
            </p>
            <Button
              onClick={() => { window.location.href = '/Auth'; }}
              className="w-full h-12 text-white rounded-2xl font-bold text-sm"
              style={{ background: '#FFBF00', color: '#2D5233' }}
            >
              הירשם בחינם
            </Button>
            <button
              onClick={() => setShowGuestSignup(false)}
              className="w-full text-xs py-1 font-medium"
              style={{ color: '#D1D5DB' }}
            >
              חזרה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

//  Main export 
export default function Documents() {
  const { isGuest } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const vehicleIdParam = urlParams.get('vehicle_id');

  if (isGuest) return <GuestDocuments vehicleIdParam={vehicleIdParam} />;
  return <AuthDocuments vehicleIdParam={vehicleIdParam} />;
}

//  Auth Documents
function AuthDocuments({ vehicleIdParam }) {
  const { role } = useAccountRole();
  // Drivers in a business workspace must only see documents that
  // belong to vehicles they're actively assigned to. Without this
  // scoping the page leaks every document a manager uploaded for the
  // whole fleet — privacy + clutter problem.
  const { isBusiness, isDriver, canManageRoutes } = useWorkspaceRole();
  const restrictToDriverAssignments = isBusiness && isDriver && !canManageRoutes;
  const [accountId, setAccountId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showScanWizard, setShowScanWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [openingDocId, setOpeningDocId] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length > 0) setAccountId(members[0].account_id);
    }
    init();
  }, []);

  // Driver assignments — used to scope both the documents query and
  // the vehicles dropdown so drivers only see what's theirs.
  const { data: driverAssignedVehicleIds = null } = useQuery({
    queryKey: ['driver-assigned-vehicle-ids', accountId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('vehicle_id')
        .eq('account_id', accountId)
        .eq('driver_user_id', userId)
        .eq('status', 'active');
      if (error) return [];
      return (data || []).map(a => a.vehicle_id);
    },
    enabled: !!accountId && !!userId && restrictToDriverAssignments,
    staleTime: 60 * 1000,
  });

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', accountId, vehicleIdParam, restrictToDriverAssignments, driverAssignedVehicleIds?.join(',')],
    queryFn: async () => {
      try {
        const filter = { account_id: accountId };
        if (vehicleIdParam) filter.vehicle_id = vehicleIdParam;
        const all = await db.documents.filter(filter, {
          order: { column: 'created_at', ascending: false },
          limit: 200,
        });
        // Driver scoping happens client-side because Supabase's filter
        // helper takes equality only. The result set is already
        // capped at 200 so the post-filter is cheap.
        if (restrictToDriverAssignments) {
          const allowed = new Set(driverAssignedVehicleIds || []);
          return all.filter(d => d.vehicle_id && allowed.has(d.vehicle_id));
        }
        return all;
      } catch { return []; }
    },
    // For drivers we wait for assignments to resolve so the first
    // render isn't a flash of unfiltered manager-style data.
    enabled: !!accountId && (!restrictToDriverAssignments || driverAssignedVehicleIds !== null),
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles-list', accountId, restrictToDriverAssignments, driverAssignedVehicleIds?.join(',')],
    queryFn: async () => {
      const all = await db.vehicles.filter({ account_id: accountId });
      if (restrictToDriverAssignments) {
        const allowed = new Set(driverAssignedVehicleIds || []);
        return (all || []).filter(v => allowed.has(v.id));
      }
      return all;
    },
    enabled: !!accountId && (!restrictToDriverAssignments || driverAssignedVehicleIds !== null),
  });

  const handleSave = async (form) => {
    setSaving(true);
    try {
      // Re-verify that the current user is actually בעלים/מנהל on the account
      // we're about to write into. the documents RLS policy rejects inserts
      // from שותף (viewers) with a cryptic "row-level security policy"
      // message. Catch it here so the user sees a clear Hebrew explanation
      // instead of the raw Postgres error.
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('לא מחובר');
      const liveMembers = await db.account_members.filter({ user_id: authUser.id, status: 'פעיל' });
      const myMember = liveMembers.find(m => m.account_id === accountId);
      if (!myMember) {
        throw new Error('החשבון שלך לא משויך לקבוצה. נסה להתנתק ולהתחבר שוב.');
      }
      if (!['בעלים', 'מנהל'].includes(myMember.role)) {
        throw new Error('רק בעלים או מנהל יכולים להוסיף מסמכים. פנה לבעל החשבון לעלות בהרשאה.');
      }

      // Diagnostic log. helps narrow down RLS rejections. Stripped at build
      // time by Vite since we don't ship to production with NODE_ENV=dev.
      console.info('[Documents.save] authUser=%s accountId=%s role=%s status=%s',
        authUser.id, accountId, myMember.role, myMember.status);

      // Only keep known DB columns. The form field is `description`, which
      // matches the DB column 1:1 — no remapping needed.
      // (Historical note: an earlier version mapped `description` → `notes`
      // on the assumption the DB column was named `notes`. That column does
      // NOT exist in this schema; PostgREST rejected every save where the
      // user populated the description field. Removed during Sprint A.B-1
      // smoke testing — caught by an end-to-end insert that wrote to `notes`
      // and got back: "Could not find the 'notes' column of 'documents'".)
      // Sprint A.B: `storage_path` is now persisted alongside `file_url` so
      // the document viewer can refresh expired signed URLs without losing
      // track of the underlying Storage object.
      const DOC_COLUMNS = ['document_type','title','issue_date','expiry_date','vehicle_id','file_url','storage_path','description'];
      const data = { account_id: accountId };
      DOC_COLUMNS.forEach(k => {
        if (form[k] !== undefined && form[k] !== null && form[k] !== '') data[k] = form[k];
      });

      const created = await db.documents.create(data);
      if (!created) throw new Error('שמירה נכשלה');
      if (userId) await trackUserAction(userId);
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      await queryClient.refetchQueries({ queryKey: ['documents', accountId, vehicleIdParam] });
      // Notify shared parties — fire-and-forget. The RPC short-circuits
      // for unshared vehicles. Vehicle id resolution: the form may set
      // its own `vehicle_id` (when adding from Documents page filter),
      // otherwise fall back to the URL param.
      try {
        const targetVehicleId = data?.vehicle_id || vehicleIdParam;
        if (targetVehicleId) {
          const { notifyVehicleChange } = await import('@/lib/notifyVehicleChange');
          const summary = data?.title
            ? `נוסף מסמך: ${data.document_type || 'מסמך'} — ${data.title}`
            : `נוסף מסמך: ${data?.document_type || 'מסמך'}`;
          notifyVehicleChange(targetVehicleId, 'document_added', summary);
        }
      } catch { /* never block the save toast */ }
      setShowAdd(false);
      hapticFeedback('medium');
      toast.success('מסמך נוסף בהצלחה');
    } catch (err) {
      console.error('Document save error:', err);
      hapticFeedback('heavy');
      const msg = err?.message || 'שגיאה לא ידועה';
      toast.error('שגיאה בשמירת המסמך: ' + msg);
    } finally {
      setSaving(false);
    }
  };

  // Resolve the most-current URL for a document. Sprint A.B rows have a
  // storage_path → we sign a fresh URL each time we open them (the
  // persisted file_url is good for 7 days but we don't want to depend
  // on that). Legacy rows have file_url only (typically a base64 data:
  // URL whitelisted by openFileUrlSafely), so they pass through unchanged.
  const resolveDocUrl = async (doc) => {
    if (doc?.storage_path) {
      try {
        return await getSignedUrl(doc.storage_path);
      } catch (err) {
        console.warn('signed URL refresh failed, falling back to file_url', err);
        return doc.file_url || null;
      }
    }
    return doc?.file_url || null;
  };

  const handleOpenDocument = async (doc) => {
    setOpeningDocId(doc.id);
    try {
      const url = await resolveDocUrl(doc);
      if (!url) {
        toast.error('הקובץ לא זמין');
        return;
      }
      const opened = openFileUrlSafely(url);
      if (!opened) toast.error('לא ניתן לפתוח את הקובץ - כתובת לא מאובטחת');
    } finally {
      setOpeningDocId(null);
    }
  };

  // Same URL resolution used by the download button. Returned to DocCard
  // via a callback so the card itself doesn't need to import getSignedUrl.
  const handleDownloadDocument = async (doc) => {
    const url = await resolveDocUrl(doc);
    if (!url) {
      toast.error('הקובץ לא זמין להורדה');
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.title || 'document';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = async (id) => {
    try {
      await db.documents.delete(id);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('הפריט נמחק בהצלחה');
    } catch (err) {
      console.error('Document delete error:', err);
      toast.error('שגיאה במחיקת המסמך');
    }
  };

  if (!accountId || isLoading) {
    return (
      <div dir="rtl">
        <PageHeader title="מסמכים" subtitle="טוען מסמכים..." />
        <div className="px-3">
          <ListSkeleton count={5} variant="document" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="מסמכים"
        backPage={vehicleIdParam ? `VehicleDetail?id=${vehicleIdParam}` : undefined}
        actions={canEdit(role) && (
          <Button onClick={() => setShowAdd(true)} className="gap-2 text-xs sm:text-sm rounded-2xl font-bold" style={{ background: '#FFBF00', color: '#2D5233' }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">סרוק / העלה מסמך</span>
            <span className="sm:hidden">העלה</span>
          </Button>
        )}
      />

      <VehicleScanWizard
        open={showScanWizard}
        onClose={() => setShowScanWizard(false)}
        vehicles={vehicles}
        accountId={accountId}
        userId={userId}
        onNewVehicleData={() => {}}
        onUpdateVehicle={() => { queryClient.invalidateQueries({ queryKey: ['documents'] }); setShowScanWizard(false); }}
      />

      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="אין מסמכים" description="העלה מסמכים כמו רישיון רכב, ביטוח ועוד" />
      ) : vehicleIdParam ? (
        <GroupedDocList
          docs={documents}
          vehicles={vehicles}
          onOpen={handleOpenDocument}
          onDownload={handleDownloadDocument}
          onDelete={id => setDeleteTarget(id)}
          openingId={openingDocId}
        />
      ) : (
        <VehicleGroupedDocList
          docs={documents}
          vehicles={vehicles}
          onOpen={handleOpenDocument}
          onDownload={handleDownloadDocument}
          onDelete={id => setDeleteTarget(id)}
          openingId={openingDocId}
        />
      )}

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onConfirm={() => { handleDelete(deleteTarget); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />

      <DocUploadDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSave={handleSave}
        vehicleIdParam={vehicleIdParam}
        vehicles={vehicles}
        saving={saving}
        accountId={accountId}
        userId={userId}
      />
    </div>
  );
}
