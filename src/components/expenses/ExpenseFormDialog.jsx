import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateInput } from '@/components/ui/date-input';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, ScanLine, Camera, Receipt } from 'lucide-react';
import { C } from '@/lib/designTokens';
import {
  MANUAL_EXPENSE_CATEGORIES,
  createManualExpense,
  updateManualExpense,
  deleteManualExpense,
} from '@/services/expenses';
import { uploadScanFile, deleteFile, refreshSignedUrl } from '@/lib/supabaseStorage';
import { extractDataFromUploadedFile } from '@/lib/aiExtract';
import { validateUploadFile } from '@/lib/securityUtils';

/**
 * ExpenseFormDialog — add OR edit a MANUAL expense.
 *
 * Props:
 *   open               boolean
 *   onClose            ()
 *   onSaved            () — fired after successful create/update/delete
 *   accountId, userId, vehicleId
 *   vehicles           Array<{id, nickname?, manufacturer?, model?, license_plate?}>
 *                      — passed by /MyExpenses in aggregate mode (vehicleId=null).
 *                      When vehicleId is set, this is ignored.
 *                      When vehicleId is null AND this list is non-empty,
 *                      a "Vehicle" picker becomes the first form field
 *                      (required before save).
 *   initial            row from v_vehicle_expense_feed | null  (null = create mode)
 *   scanFirst          boolean — if true, opens with the file picker
 *                                 expanded so the user uploads-and-scans
 *                                 before filling the form (used by the
 *                                 "סרוק חשבונית" button).
 *
 * Uses the existing scans bucket + extract_document AI mode — same
 * pattern the B2B Expenses page uses, just with the extended 16-cat
 * enum.
 */
const today = () => new Date().toISOString().split('T')[0];

export default function ExpenseFormDialog({
  open,
  onClose,
  onSaved,
  accountId,
  userId,
  vehicleId,
  vehicles = [],
  initial = null,
  scanFirst = false,
}) {
  const isEdit = !!initial?.id && initial?.source_type === 'expense';

  // form state
  const [amount,   setAmount]   = useState('');
  const [category, setCategory] = useState('fuel');
  const [date,     setDate]     = useState(today());
  const [title,    setTitle]    = useState('');
  const [vendor,   setVendor]   = useState('');
  const [note,     setNote]     = useState('');
  const [receiptUrl,  setReceiptUrl]  = useState('');
  const [receiptPath, setReceiptPath] = useState('');
  const [didChangeReceipt, setDidChangeReceipt] = useState(false);
  // In agg mode (vehicleId prop is null) the user picks a vehicle in
  // the form. When vehicleId is set, this state mirrors it and the
  // picker is hidden. We always read `targetVehicleId` from this state
  // at submit time so the two modes share one code path.
  const [vehicleSelection, setVehicleSelection] = useState(vehicleId || '');

  // Per-field error (inline, in addition to toast) — clears as soon as
  // the user touches the offending field. Only one at a time.
  const [fieldError, setFieldError] = useState({ field: null, message: '' });
  const setFE = (field, message) => setFieldError({ field, message });
  const clearFE = (field) => setFieldError(prev => prev.field === field ? { field: null, message: '' } : prev);

  // io state
  const [submitting, setSubmitting] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [scanning,   setScanning]   = useState(false);
  const [scanError,  setScanError]  = useState('');
  const fileInputRef = useRef(null);

  // Confirm dialogs (replacing native confirm()):
  //   - confirmDelete:    user pressed delete on an existing expense
  //   - confirmOverwrite: user pressed "סרוק" again on a form that
  //                       already has values; the AI would overwrite
  //                       amount/date/category. We ask first.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  // Tracks the orphan file path from the most recent upload — if the
  // user closes without saving, we delete it so the bucket doesn't pile
  // up unsigned blobs.
  const newOrphanPathRef = useRef(null);
  const savedRef         = useRef(false);

  // Hydrate form on open
  useEffect(() => {
    if (!open) return;
    savedRef.current = false;
    if (initial) {
      setAmount(String(initial.amount ?? ''));
      setCategory(initial.category || 'fuel');
      setDate(initial.expense_date || today());
      setTitle(initial.title || '');
      setVendor(initial.vendor || '');
      setNote(initial.note || '');
      setReceiptUrl(initial.receipt_url || '');
      setReceiptPath(initial.receipt_storage_path || '');
      setDidChangeReceipt(false);
      // Edit mode: vehicle is locked to the original row's vehicle.
      setVehicleSelection(initial.vehicle_id || vehicleId || '');
    } else {
      setAmount('');
      setCategory('fuel');
      setDate(today());
      setTitle('');
      setVendor('');
      setNote('');
      setReceiptUrl('');
      setReceiptPath('');
      setDidChangeReceipt(false);
      // Create mode:
      //   • vehicleId prop provided (single-vehicle page) → mirror it
      //   • vehicleId null (aggregate mode)               → empty,
      //     user must pick from `vehicles` before save.
      setVehicleSelection(vehicleId || '');
    }
    setScanError('');
    setFieldError({ field: null, message: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, vehicleId]);

  // Auto-trigger file picker when in scan-first mode
  useEffect(() => {
    if (open && scanFirst && !receiptUrl) {
      // Small delay so the dialog finishes mounting before we open
      // the native picker (iOS sometimes drops it otherwise).
      const t = setTimeout(() => fileInputRef.current?.click(), 250);
      return () => clearTimeout(t);
    }
  }, [open, scanFirst, receiptUrl]);

  // Cleanup orphan file when dialog closes without save
  useEffect(() => {
    if (open) return;
    if (!savedRef.current && newOrphanPathRef.current) {
      deleteFile(newOrphanPathRef.current).catch(() => {});
      newOrphanPathRef.current = null;
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  // ── File upload + optional AI scan ─────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const v = validateUploadFile(file, 'doc', 5);
    if (!v.ok) { toast.error(v.error); return; }

    if (!userId) { toast.error('צריך התחברות מחדש'); return; }
    setUploading(true);
    try {
      const { file_url, storage_path } = await uploadScanFile({ file, userId });
      // If there was a previous orphan from this open session, clean it.
      if (newOrphanPathRef.current && newOrphanPathRef.current !== storage_path) {
        deleteFile(newOrphanPathRef.current).catch(() => {});
      }
      newOrphanPathRef.current = storage_path;
      setReceiptUrl(file_url);
      setReceiptPath(storage_path);
      setDidChangeReceipt(true);

      // Auto-run AI scan in scan-first flow
      if (scanFirst) {
        await runAiScan(file_url);
      }
    } catch (err) {
      console.error('upload error:', err);
      toast.error('שגיאה בהעלאת הקובץ');
    } finally {
      setUploading(false);
    }
  };

  const removeReceipt = () => {
    if (newOrphanPathRef.current) {
      deleteFile(newOrphanPathRef.current).catch(() => {});
      newOrphanPathRef.current = null;
    }
    setReceiptUrl('');
    setReceiptPath('');
    setDidChangeReceipt(true);
  };

  // Whether the form already has user-entered data that an AI scan
  // would overwrite. Used to decide whether to ask for confirmation
  // before re-running scan.
  const hasFormData = () => {
    const amt = Number(amount);
    return (Number.isFinite(amt) && amt > 0)
        || !!title.trim()
        || !!vendor.trim();
  };

  // Public entry point — checks if confirmation is needed, defers to
  // _runAiScanInternal if not.
  const runAiScan = async (urlOverride) => {
    if (hasFormData()) {
      setConfirmOverwrite(true);
      return;
    }
    return _runAiScanInternal(urlOverride);
  };

  const _runAiScanInternal = async (urlOverride) => {
    const url = urlOverride || receiptUrl;
    if (!url) { setScanError('צריך להעלות חשבונית לפני סריקה.'); return; }
    setScanning(true);
    setScanError('');
    try {
      const enumCodes = MANUAL_EXPENSE_CATEGORIES.map(c => c.code);
      const schema = {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'הסכום הסופי לתשלום בשקלים. אם המסמך באנגלית: שדה total.' },
          date:   { type: 'string', description: 'תאריך החשבונית בפורמט YYYY-MM-DD. אם DD/MM/YYYY: המר.' },
          vendor: { type: 'string', description: 'שם בית העסק / המוסך / תחנת הדלק / סוכנות הביטוח.' },
          title:  { type: 'string', description: 'תיאור קצר של ההוצאה (1-4 מילים) — למשל "תדלוק", "טסט שנתי", "ביטוח חובה 2026". אם לא ברור: השאר ריק.' },
          license_plate: { type: 'string', description: 'מספר רישוי אם מופיע בחשבונית (ספרות בלבד, ללא מקפים). אם אין: השאר ריק.' },
          category: { type: 'string', enum: enumCodes,
                      description: 'אחת מהקטגוריות. fuel=דלק, inspection=טסט, license_fee=אגרת רישוי, insurance_mtpl=ביטוח חובה, insurance_comp=ביטוח מקיף, insurance_3p=ביטוח צד ג׳, parking=חניה, wash=שטיפה, tires=צמיגים, toll=כביש אגרה, towing=גרירה, accessories=אביזרים, general=כללי, other=אחר.' },
        },
      };
      const result = await extractDataFromUploadedFile({
        file_url: url,
        json_schema: schema,
        instructions: 'חלץ פרטי חשבונית כספית. החזר רק ערכים שמופיעים בבירור במסמך. אם שדה לא ברור: השאר ריק.',
      });
      if (result?.status !== 'success' || !result.output) {
        // Service-level failure (network, AI provider, etc). Treat
        // as a soft "couldn't read" — never expose the technical
        // reason to the user.
        setScanError('לא הצלחנו לקרוא את כל הפרטים, אפשר להשלים ידנית.');
        return;
      }
      const out = result.output;

      // Apply only fields that the AI confidently extracted; leave
      // the rest untouched so a partial scan still helps. Overwrite
      // semantics are uniform across all fields — the user already
      // confirmed (via confirmOverwrite) if there was prior input,
      // so we don't second-guess per-field.
      let filledAny = false;
      if (out.amount && Number(out.amount) > 0)             { setAmount(String(out.amount)); filledAny = true; }
      if (out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date)) { setDate(out.date); filledAny = true; }
      if (out.category && enumCodes.includes(out.category)) { setCategory(out.category); filledAny = true; }
      if (out.vendor) { setVendor(String(out.vendor).slice(0, 80)); filledAny = true; }
      if (out.title)  { setTitle(String(out.title).slice(0, 80));   filledAny = true; }

      if (!filledAny) {
        // Provider returned success but every field was empty.
        setScanError('לא הצלחנו לקרוא את כל הפרטים, אפשר להשלים ידנית.');
        return;
      }

      // license_plate is informational for now — surfaced as a hint in
      // the title if no title was extracted (keeps things simple; we
      // don't auto-switch the selected vehicle).
      toast.success('הסריקה הושלמה. בדוק את הפרטים והוסף.');
    } catch (err) {
      // Any unexpected error → friendly text, no technical detail to user.
      console.error('receipt scan failed:', err);
      setScanError('לא הצלחנו לקרוא את כל הפרטים, אפשר להשלים ידנית.');
    } finally {
      setScanning(false);
    }
  };

  // ── Validation + Submit ──────────────────────────────────────────────
  // Validation rules:
  //   • Vehicle  — required (set on the page; can't be empty when adding)
  //   • Category — required, defaults to 'fuel' so this never empty
  //                in practice, but we still guard
  //   • Amount   — required, > 0 (positive). Reject empty / 0 / negative
  //   • Date     — required
  //   • Title / Vendor / Note / Receipt — optional
  //
  // We use BOTH a toast (so the user notices) AND an inline highlight
  // on the offending field. The first failing field wins; we don't
  // pile up multiple errors at once.
  const submit = async (e) => {
    e?.preventDefault?.();

    // Single source of truth for the vehicle being saved against:
    // either the locked prop (single-vehicle page) or the picker selection
    // (aggregate mode). Edit mode uses the existing row's vehicle and
    // never lets the user reassign it (would require a separate flow).
    const targetVehicleId = isEdit
      ? (initial?.vehicle_id || null)
      : (vehicleId || vehicleSelection || null);
    if (!isEdit && !targetVehicleId) {
      toast.error('יש לבחור רכב');
      setFE('vehicle', 'יש לבחור רכב');
      return;
    }
    if (!category) {
      toast.error('יש לבחור קטגוריה');
      setFE('category', 'יש לבחור קטגוריה');
      return;
    }
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) {
      toast.error('הסכום חייב להיות גדול מ-0');
      setFE('amount', 'הזן סכום גדול מ-0');
      return;
    }
    if (!date) {
      toast.error('יש לבחור תאריך');
      setFE('date', 'יש לבחור תאריך');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateManualExpense(initial.id, {
          amount: amt,
          category,
          expenseDate: date,
          title: title || null,
          note: note || null,
          vendor: vendor || null,
          receiptUrl: didChangeReceipt ? (receiptUrl || null) : null,
          receiptStoragePath: didChangeReceipt ? (receiptPath || null) : null,
          clearReceipt: didChangeReceipt && !receiptPath,
        });
        toast.success('ההוצאה עודכנה');
      } else {
        await createManualExpense({
          accountId,
          vehicleId: targetVehicleId,
          amount: amt,
          category,
          expenseDate: date,
          title: title || null,
          note: note || null,
          vendor: vendor || null,
          receiptUrl: receiptUrl || null,
          receiptStoragePath: receiptPath || null,
          source: scanFirst ? 'ai_scan' : 'manual',
        });
        toast.success('ההוצאה נוספה');
      }
      savedRef.current = true;
      newOrphanPathRef.current = null;
      onSaved?.();
      onClose?.();
    } catch (err) {
      // Surface a user-friendly message; technical details land in the
      // console for debugging.
      console.error('submit error:', err);
      toast.error('שגיאה בשמירה. נסה שוב בעוד רגע.');
    } finally {
      setSubmitting(false);
    }
  };

  // Initiate delete — opens a styled AlertDialog instead of native
  // confirm(). _executeDelete actually deletes after the user confirms.
  const handleDelete = () => {
    if (!isEdit) return;
    setConfirmDelete(true);
  };
  const _executeDelete = async () => {
    setConfirmDelete(false);
    if (!isEdit) return;
    setSubmitting(true);
    try {
      await deleteManualExpense(initial.id);
      // Best-effort cleanup of the receipt blob.
      if (initial.receipt_storage_path) {
        deleteFile(initial.receipt_storage_path).catch(() => {});
      }
      toast.success('ההוצאה נמחקה');
      savedRef.current = true;
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error('delete error:', err);
      toast.error('שגיאה במחיקה');
    } finally {
      setSubmitting(false);
    }
  };

  // Open the receipt — refreshes the signed URL on demand if we have
  // the storage_path. The cached signed URL is good for 7 days; if the
  // user is editing an old expense the URL might be stale, so we
  // generate a fresh one. Falls back to the cached URL otherwise.
  const openReceipt = async (e) => {
    e.preventDefault();
    if (!receiptUrl && !receiptPath) return;
    let url = receiptUrl;
    if (receiptPath) {
      try {
        const fresh = await refreshSignedUrl(receiptPath);
        if (fresh) url = fresh;
      } catch {
        // If refresh fails (RLS, not found), fall through to the
        // cached URL — better than nothing.
      }
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent dir="rtl" className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2 border-b border-gray-100">
          <DialogTitle className="text-base font-bold text-right">
            {isEdit ? 'עריכת הוצאה' : (scanFirst ? 'סריקת חשבונית' : 'הוספת הוצאה')}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-gray-500 text-right">
            {scanFirst
              ? 'בחר חשבונית — נסרוק אותה עם AI ונמלא לך את הפרטים'
              : 'הזן את פרטי ההוצאה'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="p-4 space-y-3">
          {/* Vehicle picker — only in aggregate mode (vehicleId prop null
              + create mode + a populated vehicles list). In single-
              vehicle mode it's hidden so the form stays compact. */}
          {!isEdit && !vehicleId && Array.isArray(vehicles) && vehicles.length > 0 && (
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
                רכב <span className="text-red-400">*</span>
              </label>
              <Select
                value={vehicleSelection}
                onValueChange={(v) => { setVehicleSelection(v); clearFE('vehicle'); }}
              >
                <SelectTrigger className={`rounded-xl ${fieldError.field === 'vehicle' ? 'border-red-400' : ''}`}>
                  <SelectValue placeholder="בחר רכב" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {vehicles.map(v => {
                    const name = v.nickname
                      || [v.manufacturer, v.model].filter(Boolean).join(' ')
                      || v.license_plate
                      || 'רכב';
                    return (
                      <SelectItem key={v.id} value={v.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{name}</span>
                          {v.license_plate && (
                            <span className="text-[11px]" dir="ltr" style={{ color: C.muted }}>
                              · {v.license_plate}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {fieldError.field === 'vehicle' && (
                <p className="text-[11px] text-red-600 mt-1">{fieldError.message}</p>
              )}
            </div>
          )}

          {/* Receipt block — upload/scan controls */}
          <div className="rounded-xl p-3 space-y-2" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4" style={{ color: C.primary }} />
              <span className="text-xs font-bold" style={{ color: C.text }}>חשבונית</span>
            </div>
            {receiptUrl ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openReceipt}
                  className="flex-1 truncate text-xs font-medium px-3 py-2 rounded-lg bg-white border text-right"
                  style={{ borderColor: C.border, color: C.primary }}
                >
                  צפה בחשבונית
                </button>
                <button
                  type="button"
                  onClick={() => runAiScan()}
                  disabled={scanning}
                  className="h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-60"
                  style={{ background: C.primary, color: '#fff' }}
                >
                  {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
                  סרוק
                </button>
                <button
                  type="button"
                  onClick={removeReceipt}
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  aria-label="הסר חשבונית"
                >
                  <Trash2 className="w-4 h-4" style={{ color: '#DC2626' }} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex-1 h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                  style={{ background: '#fff', color: C.primary, border: `1px solid ${C.border}` }}
                >
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  בחר קובץ
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-10 px-3 rounded-lg flex items-center justify-center"
                  style={{ background: '#fff', color: C.primary, border: `1px solid ${C.border}` }}
                  aria-label="צלם חשבונית"
                >
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            )}
            {scanError && (
              <p className="text-[11px] text-red-600">{scanError}</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={handleFile}
              className="hidden"
            />
          </div>

          {/* Amount + Date side-by-side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
                סכום <span className="text-red-400">*</span>
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={e => { setAmount(e.target.value); clearFE('amount'); }}
                placeholder="₪"
                className={`rounded-xl ${fieldError.field === 'amount' ? 'border-red-400' : ''}`}
                dir="ltr"
                aria-invalid={fieldError.field === 'amount'}
              />
              {fieldError.field === 'amount' && (
                <p className="text-[11px] text-red-600 mt-1">{fieldError.message}</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
                תאריך <span className="text-red-400">*</span>
              </label>
              <DateInput
                value={date}
                onChange={e => { setDate(e.target.value); clearFE('date'); }}
                className={`rounded-xl ${fieldError.field === 'date' ? 'border-red-400' : ''}`}
              />
              {fieldError.field === 'date' && (
                <p className="text-[11px] text-red-600 mt-1">{fieldError.message}</p>
              )}
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
              קטגוריה <span className="text-red-400">*</span>
            </label>
            <Select value={category} onValueChange={(v) => { setCategory(v); clearFE('category'); }}>
              <SelectTrigger className={`rounded-xl ${fieldError.field === 'category' ? 'border-red-400' : ''}`}>
                <SelectValue placeholder="בחר קטגוריה" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {MANUAL_EXPENSE_CATEGORIES.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    <span className="flex items-center gap-2">
                      <span>{c.emoji}</span>
                      <span>{c.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldError.field === 'category' && (
              <p className="text-[11px] text-red-600 mt-1">{fieldError.message}</p>
            )}
          </div>

          {/* Title — short headline ("טסט שנתי 2026", "תדלוק לפני ים המלח") */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
              כותרת
            </label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 80))}
              placeholder="טסט שנתי 2026 / תדלוק לפני נסיעה..."
              className="rounded-xl"
              maxLength={80}
            />
          </div>

          {/* Vendor */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
              ספק / שם בית העסק
            </label>
            <Input
              value={vendor}
              onChange={e => setVendor(e.target.value.slice(0, 80))}
              placeholder="תחנת פז / מוסך אורי / סוכנות הראל..."
              className="rounded-xl"
              maxLength={80}
            />
          </div>

          {/* Note */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
              הערות (אופציונלי)
            </label>
            <Textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="פרטים נוספים..."
              className="rounded-xl min-h-[60px] resize-y"
            />
          </div>

          {/* Footer actions */}
          <div className="pt-2 flex items-center gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={submitting}
                className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: '#FEE2E2', color: '#DC2626' }}
                aria-label="מחק"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="flex-1 h-11 rounded-xl text-sm font-bold border"
              style={{ borderColor: C.border, color: C.text, background: '#fff' }}
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={submitting || uploading || scanning}
              className="flex-1 h-11 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ background: C.primary }}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'עדכן' : 'שמור הוצאה'}
            </button>
          </div>
        </form>
      </DialogContent>

      {/* Confirm: delete an existing expense. Replaces native
          window.confirm() so the affordance matches the rest of the app
          and supports RTL + dark backdrop + ESC. */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את ההוצאה?</AlertDialogTitle>
            <AlertDialogDescription>
              לא ניתן לבטל פעולה זו. הקובץ של החשבונית יימחק גם הוא.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={_executeDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: re-scanning will overwrite values the user already
          typed. Asked once, before AI runs — if confirmed, all fields
          the AI extracts will replace current input uniformly. */}
      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>להחליף את הנתונים הקיימים?</AlertDialogTitle>
            <AlertDialogDescription>
              ה-AI יחליף את הסכום, התאריך, הקטגוריה, הספק והכותרת בערכים שיתחלצו מהחשבונית.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmOverwrite(false); _runAiScanInternal(); }}
            >
              סרוק והחלף
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
