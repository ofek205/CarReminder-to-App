import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { openFileUrlSafely, isSafeFileUrl } from '@/lib/securityUtils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, FileText, Upload, Trash2, Eye, Download, Loader2, Sparkles, CheckCircle2, X, Lock, ChevronDown, ChevronUp, Camera } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import EmptyState from "../components/shared/EmptyState";
import { formatDateHe, isVessel } from "../components/shared/DateStatusUtils";
import { daysLabel, daysUntil } from "../components/shared/ReminderEngine";
import { trackUserAction } from "../components/shared/ReviewManager";
import VehicleScanWizard from "../components/vehicle/VehicleScanWizard";
import ConfirmDeleteDialog from "../components/shared/ConfirmDeleteDialog";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import useAccountRole from '@/hooks/useAccountRole';
import { canEdit } from '@/lib/permissions';

// ── Document category definitions ─────────────────────────────────────────────
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

// ── Parse DD/MM/YYYY → YYYY-MM-DD ─────────────────────────────────────────────
function parseDocDate(str) {
  if (!str) return '';
  const parts = str.split('/');
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  const fy = y.length === 2 ? '20' + y : y;
  const result = `${fy}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isNaN(new Date(result).getTime()) ? '' : result;
}

const EMPTY_FORM = { document_type: 'מסמך אחר', title: '', description: '', vehicle_id: '', issue_date: '', expiry_date: '', file_url: '' };

// ── Upload dialog (shared logic wrapper) ──────────────────────────────────────
function DocUploadDialog({ open, onClose, onSave, vehicleIdParam, vehicles, saving, isGuest = false }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, vehicle_id: vehicleIdParam || '' });
  const [uploading, setUploading] = useState(false);
  const [aiScanning, setAiScanning] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [fileName, setFileName] = useState('');

  // Vehicle-aware document categories
  const selectedVehicle = vehicles?.find(v => v.id === (form.vehicle_id || vehicleIdParam));
  const categories = getDocCategories(selectedVehicle?.vehicle_type, selectedVehicle?.nickname);

  useEffect(() => {
    if (!open) {
      setForm({ ...EMPTY_FORM, vehicle_id: vehicleIdParam || '' });
      setAiResult(null);
      setFileName('');
    }
  }, [open, vehicleIdParam]);

  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
  const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];
  const MAX_FILE_SIZE = 5 * 1024 * 1024;

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) { toast.error('הקובץ גדול מ-5MB'); e.target.value = ''; return; }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) { toast.error('ניתן להעלות רק JPG, PNG, PDF'); e.target.value = ''; return; }
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) { toast.error('סיומת קובץ לא מותרת'); e.target.value = ''; return; }
    const mimeToExtMap = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'application/pdf': ['.pdf'] };
    if (!(mimeToExtMap[file.type] || []).includes(ext)) { toast.error('סוג הקובץ אינו תואם לסיומת'); e.target.value = ''; return; }

    setUploading(true);
    try {
      // Read file as base64 — works for both guest (localStorage) and auth (until Supabase Storage is set up)
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setFileName(file.name);
      setForm(f => ({ ...f, file_url: base64 }));
    } catch (err) {
      console.error('File read error:', err);
      toast.error('שגיאה בקריאת הקובץ');
    } finally {
      setUploading(false);
    }
  };

  const handleAiScan = async () => {
    if (!form.file_url) return;
    setAiScanning(true);
    setAiResult(null);
    try {
      const { aiRequest } = await import('@/lib/aiProxy');
      // Read the file as base64 for AI vision
      const mediaType = form.file_url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const imageData = form.file_url.split(',')[1];
      if (!imageData) { toast.error('לא ניתן לקרוא את הקובץ'); setAiScanning(false); return; }

      const json = await aiRequest({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
            { type: 'text', text: `סרוק מסמך זה וחלץ פרטים. סוגי מסמכים אפשריים: ${docTypes.join(' / ')}.
החזר JSON בלבד: {"document_type":"סוג", "title":"כותרת/שם מנפיק", "issue_date":"YYYY-MM-DD", "expiry_date":"YYYY-MM-DD"}.
אם לא ניתן לזהות שדה — השאר ריק.` },
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
        toast.error('לא הצלחתי לקרוא את המסמך — מלא ידנית');
      }
    } catch (err) {
      console.error('Document AI scan error:', err);
      toast.error('שגיאה בסריקת המסמך');
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

  const handleSave = () => {
    onSave(form);
  };

  const canSave = isGuest ? (form.title || form.document_type) : form.file_url;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{isGuest ? 'הוסף מסמך' : 'סרוק / העלה מסמך'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4" dir="rtl">

          {/* ── Guest: AI scan requires registration ── */}
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

          {/* ── Upload zone ── */}
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
              {/* Camera capture — separate button below the drop zone */}
              {!uploading && (
                <label className={`${buttonVariants({ variant: "outline" })} mt-2 w-full cursor-pointer gap-2 justify-center border-[#2D5233] text-[#2D5233] hover:bg-[#FDF6F0]`}>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
                  <Camera className="h-4 w-4" />
                  צלם מסמך
                </label>
              )}
            </div>
          )}

          {/* ── AI Scan banner ── */}
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

          {/* ── AI result preview ── */}
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

          {/* ── Category ── */}
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
                  <span className="text-base">{cat.emoji}</span>
                  <span className="truncate">{cat.type}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Title ── */}
          <div>
            <Label className="text-right block mb-1.5">כותרת / שם המסמך</Label>
            <Input
              dir="rtl"
              placeholder="לדוגמה: מגדל ביטוח - פוליסה 12345"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* ── Description ── */}
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

          {/* ── Vehicle selector ── */}
          {!vehicleIdParam && vehicles && vehicles.length > 0 && (
            <div>
              <Label className="text-right block mb-1.5">רכב (אופציונלי)</Label>
              <Select value={form.vehicle_id} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
                <SelectTrigger dir="rtl"><SelectValue placeholder="בחר רכב" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nickname || `${v.manufacturer} ${v.model}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ── Dates ── */}
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
            disabled={saving || (!isGuest && !form.file_url)}
            className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'שמור מסמך'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Expiry pill helper ────────────────────────────────────────────────────────
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

// ── Document card ──────────────────────────────────────────────────────────────
function DocCard({ doc, vehicle, onOpen, onDelete, openingId }) {
  const cat = getCat(doc.document_type);

  return (
    <Card className="p-4 border border-gray-100">
      <div className="flex items-start justify-between gap-3" dir="rtl">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`w-10 h-10 rounded-xl ${cat.bg} flex items-center justify-center shrink-0 text-lg`}>
            {cat.emoji}
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
          {doc.file_url && onOpen && (
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
                onClick={() => {
                  const a = document.createElement('a');
                  a.href = doc.file_url;
                  a.download = doc.title || 'document';
                  a.target = '_blank';
                  a.rel = 'noopener noreferrer';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
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

// ── Grouped document list ─────────────────────────────────────────────────────
function GroupedDocList({ docs, vehicles, onOpen, onDelete, openingId }) {
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
                <span className="text-base">{cat.emoji}</span>
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
                  {/* Latest document — always visible */}
                  {latest && (
                    <DocCard
                      key={latest.id}
                      doc={latest}
                      vehicle={vehicles.find(v => v.id === latest.vehicle_id)}
                      onOpen={onOpen}
                      onDelete={onDelete}
                      openingId={openingId}
                    />
                  )}
                  {/* Older documents — collapsed by default */}
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

// ── Guest Documents ───────────────────────────────────────────────────────────
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
      // Check for existing document of same type for this vehicle — mark old as superseded
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

      {/* Guest banner — single combined banner */}
      <div className="mb-4 rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }} dir="rtl">
        <span className="text-lg">{docs.some(d => d._isDemo) ? '👀' : '🔒'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black" style={{ color: '#92400E' }}>
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
      ) : (
        <GroupedDocList
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
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className="text-lg font-black text-gray-900">הירשם כדי לשמור</h2>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              הרשמה בחינם תוך שניות — ותוכל לשמור מסמכים, לקבל תזכורות ולגשת מכל מכשיר
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

// ── Main export ───────────────────────────────────────────────────────────────
export default function Documents() {
  const { isGuest } = useAuth();
  const urlParams = new URLSearchParams(window.location.search);
  const vehicleIdParam = urlParams.get('vehicle_id');

  if (isGuest) return <GuestDocuments vehicleIdParam={vehicleIdParam} />;
  return <AuthDocuments vehicleIdParam={vehicleIdParam} />;
}

// ── Auth Documents ─────────────────────────────────────────────────────────────
function AuthDocuments({ vehicleIdParam }) {
  const { role } = useAccountRole();
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

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents', accountId, vehicleIdParam],
    queryFn: async () => {
      // TODO: Document entity not yet in Supabase — returning empty array
      return [];
    },
    enabled: !!accountId,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles-list', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
  });

  const handleSave = async (form) => {
    setSaving(true);
    const data = { ...form, account_id: accountId, uploaded_by_user_id: userId };
    Object.keys(data).forEach(k => { if (data[k] === '' || data[k] === undefined) delete data[k]; });
    // TODO: Document entity not yet in Supabase — create is a no-op for now
    // await db.documents.create(data);
    toast.info('שמירת מסמכים תתאפשר בקרוב (בהעברה ל-Supabase)');
    if (userId) await trackUserAction(userId);
    queryClient.invalidateQueries({ queryKey: ['documents'] });
    setShowAdd(false);
    setSaving(false);
    toast.success('מסמך נוסף בהצלחה');
  };

  const handleOpenDocument = async (doc) => {
    setOpeningDocId(doc.id);
    try {
      // If the document already has a stored file_url, validate and open it directly
      if (doc.file_url) {
        const opened = openFileUrlSafely(doc.file_url);
        if (!opened) toast.error('לא ניתן לפתוח את הקובץ — כתובת לא מאובטחת');
        return;
      }
      // TODO: migrate signed URL generation to Supabase Edge Function
      // const res = await supabase.functions.invoke('getDocumentSignedUrl', { body: { document_id: doc.id } });
      // const url = res.data?.signed_url;
      const url = null;
      if (url) {
        const opened = openFileUrlSafely(url);
        if (!opened) toast.error('לא ניתן לפתוח את הקובץ — כתובת לא מאובטחת');
      }
    } finally {
      setOpeningDocId(null);
    }
  };

  const handleDelete = async (id) => {
    // TODO: Document entity not yet in Supabase — delete is a no-op for now
    // await db.documents.delete(id);
    queryClient.invalidateQueries({ queryKey: ['documents'] });
    toast.success('הפריט נמחק בהצלחה');
  };

  if (!accountId || isLoading) return <LoadingSpinner />;

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
      ) : (
        <GroupedDocList
          docs={documents}
          vehicles={vehicles}
          onOpen={handleOpenDocument}
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
      />
    </div>
  );
}
