/**
 * Phase 8 — Expenses CRUD (Manager only).
 *
 * List + add/edit/delete manual vehicle expenses. The list view is a
 * tight per-row card; the editor opens a polished bottom-sheet/modal
 * dialog with:
 *
 *   • Rich VehiclePicker (icon + name + plate + search) — replaces the
 *     plate-only native <select> the previous version had.
 *   • Receipt attachment with two paths:
 *       1. Upload + AI scan — Gemini extracts amount, date, vendor and
 *          suggests a category, prefilling the form.
 *       2. Upload only — store the receipt for record-keeping without
 *          the AI step.
 *     Both store the file in the shared scans bucket and persist the
 *     URL on vehicle_expenses.receipt_url / receipt_storage_path.
 *   • Inline preview of the attached receipt with "החלף" / "הסר".
 *
 * Drivers cannot reach this page — RLS denies SELECT for role='driver'
 * and the businessOnly nav flag hides the link.
 *
 * SQL prerequisites (supabase-expense-receipts.sql, run once):
 *   • vehicle_expenses.receipt_url, receipt_storage_path columns
 *   • add_vehicle_expense / update_vehicle_expense extended signatures
 *
 * Note: repair_logs.cost values entered through Maintenance/Repairs UI
 * are NOT shown here — that page already manages them. Reports.jsx
 * aggregates BOTH sources together.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Loader2, Briefcase, Receipt, X, Upload, Camera,
  ScanLine, Sparkles, FileText, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import VehicleLabel from '@/components/shared/VehicleLabel';
import VehiclePicker from '@/components/shared/VehiclePicker';
import MobileBackButton from '@/components/shared/MobileBackButton';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uploadScanFile, deleteFile } from '@/lib/supabaseStorage';
import { extractDataFromUploadedFile } from '@/lib/aiExtract';
import { validateUploadFile } from '@/lib/securityUtils';

const CATEGORY_LABELS = {
  fuel:      'דלק',
  repair:    'תיקון',
  insurance: 'ביטוח',
  other:     'אחר',
};
const CATEGORY_ORDER = ['fuel', 'repair', 'insurance', 'other'];

const fmtMoney = (n, c = 'ILS') =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: c }).format(n || 0);
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';

export default function Expenses() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isManager, isLoading: roleLoading } = useWorkspaceRole();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(null); // null | {} (new) | row (edit)

  // Phase 9 step 7 — keyset pagination on created_at, 30 rows per page.
  const PAGE_SIZE = 30;
  const {
    data: expensePages, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['expenses', accountId],
    enabled: !!accountId && isManager && isBusiness,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('vehicle_expenses')
        .select('*')
        .eq('account_id', accountId)
        .order('expense_date', { ascending: false })
        .order('created_at',   { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.created_at,
    staleTime: 30 * 1000,
  });
  const expenses = (expensePages?.pages || []).flat();

  const { data: vehicles = [] } = useQuery({
    queryKey: ['expenses-vehicle-picker', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId && isManager,
    staleTime: 5 * 60 * 1000,
  });

  if (authLoading || roleLoading)
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;

  if (!isAuthenticated)
    return <Empty text="צריך להתחבר." />;

  if (!isBusiness)
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="ניהול הוצאות זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );

  if (!isManager)
    return (
      <Empty
        icon={<Receipt className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לניהול עלויות"
        text="הוספה ועריכה של עלויות שמורה למנהלי החשבון."
      />
    );

  const vehicleById = Object.fromEntries(vehicles.map(v => [v.id, v]));

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <MobileBackButton />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">הוצאות תפעול</h1>
          <p className="text-xs text-gray-500">דלק, ביטוח ועלויות תפעוליות נוספות של הצי</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({})}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98] shadow-sm"
        >
          <Plus className="h-4 w-4" /> הוצאה חדשה
        </button>
      </div>

      {isLoading ? (
        <p className="text-center text-xs text-gray-400 py-6">טוען הוצאות...</p>
      ) : expenses.length === 0 ? (
        <Empty
          icon={<Receipt className="h-10 w-10 text-gray-300" />}
          title="עוד אין הוצאות בחשבון"
          text="הוסף הוצאה ראשונה: דלק, ביטוח או כל עלות אחרת. הסכומים יופיעו אוטומטית בדוחות."
          embedded
        />
      ) : (
        <ul className="space-y-1.5">
          {expenses.map(e => (
            <li key={e.id} className="bg-white border border-gray-100 rounded-xl p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-sm font-bold text-gray-900">{fmtMoney(e.amount, e.currency)}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700 font-bold">
                      {CATEGORY_LABELS[e.category] || e.category}
                    </span>
                    <span className="text-[11px] text-gray-400">{fmtDate(e.expense_date)}</span>
                    {e.receipt_url && (
                      <a
                        href={e.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#E8F2EA] text-[#2D5233] text-[10px] font-bold border border-[#2D5233]/20 hover:bg-[#2D5233]/10"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <FileText className="h-2.5 w-2.5" /> חשבונית
                      </a>
                    )}
                  </div>
                  <VehicleLabel
                    vehicle={vehicleById[e.vehicle_id]}
                    size="sm"
                    showSubtitle={false}
                  />
                  {e.note && <p className="text-[11px] text-gray-700 mt-1.5">{e.note}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setEditing(e)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <Pencil className="h-3.5 w-3.5 text-gray-500" />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm('למחוק את ההוצאה? פעולה זו לא ניתנת לביטול.')) return;
                      try {
                        const { error } = await supabase.rpc('delete_vehicle_expense', { p_id: e.id });
                        if (error) throw error;
                        // Receipt blob cleanup is best-effort; if it
                        // fails the row is already gone so the user is
                        // none the wiser.
                        if (e.receipt_storage_path) {
                          deleteFile(e.receipt_storage_path).catch(() => {});
                        }
                        toast.success('ההוצאה נמחקה');
                        await queryClient.invalidateQueries({ queryKey: ['expenses'] });
                      } catch {
                        toast.error('המחיקה נכשלה. נסה שוב.');
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {expenses.length > 0 && hasNextPage && (
        <button
          type="button"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
          className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-xs font-bold text-gray-700 disabled:opacity-60"
        >
          {isFetchingNextPage ? 'טוען...' : 'טען עוד הוצאות'}
        </button>
      )}
      {expenses.length > 0 && !hasNextPage && expenses.length >= PAGE_SIZE && (
        <p className="text-center text-[10px] text-gray-400 mt-3">סוף הרשימה</p>
      )}

      {editing && (
        <ExpenseDialog
          row={editing}
          vehicles={vehicles}
          accountId={accountId}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await queryClient.invalidateQueries({ queryKey: ['expenses'] });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Dialog ---------------------------------------------------

function ExpenseDialog({ row, vehicles, accountId, onClose, onSaved }) {
  const isEdit = !!row?.id;

  // Body scroll lock — without this, a phone can scroll the page
  // behind the dialog with the same swipe gesture intended for the
  // dialog's own scroll, leaving the user disoriented when they
  // dismiss. Restore the original overflow on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [vehicleId, setVehicleId] = useState(row.vehicle_id   || '');
  const [amount,    setAmount]    = useState(row.amount   != null ? String(row.amount) : '');
  const [category,  setCategory]  = useState(row.category    || 'fuel');
  const [date,      setDate]      = useState(row.expense_date || new Date().toISOString().slice(0, 10));
  const [note,      setNote]      = useState(row.note         || '');
  const [submitting, setSubmitting] = useState(false);

  // Receipt state ----------------------------------------------------
  // url        — signed URL we can render now (newly uploaded OR loaded
  //              from the existing row).
  // storagePath — bucket-relative path; the source of truth.
  // didReplace  — manager replaced/removed the existing receipt; we
  //              tell the RPC to clear via p_clear_receipt or update
  //              with the new path.
  // newPath     — when a new file was uploaded in THIS dialog session.
  //              On dialog close without save, we delete that orphan;
  //              on save, we mark it as committed so cleanup skips.
  const [receiptUrl,  setReceiptUrl]  = useState(row.receipt_url || '');
  const [receiptPath, setReceiptPath] = useState(row.receipt_storage_path || '');
  const [uploading,   setUploading]   = useState(false);
  const [scanning,    setScanning]    = useState(false);
  const [scanError,   setScanError]   = useState('');
  const [didChangeReceipt, setDidChangeReceipt] = useState(false);
  const newOrphanPathRef = useRef(null); // path uploaded in THIS session
  const savedRef         = useRef(false);
  const fileInputRef     = useRef(null);

  const handleClose = () => {
    // If we uploaded a fresh receipt in this session and the user
    // closes without saving, drop the orphan blob so we don't pay for
    // unreferenced storage.
    if (newOrphanPathRef.current && !savedRef.current) {
      deleteFile(newOrphanPathRef.current).catch(() => {});
    }
    onClose();
  };

  // -- file upload ---------------------------------------------------
  const handleFile = async (file, { thenScan } = {}) => {
    if (!file) return;
    const validation = validateUploadFile(file, 'doc', 10);
    if (!validation.ok) { setScanError(validation.error); return; }

    setScanError('');
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('no user');
      const { file_url, storage_path } = await uploadScanFile({ file, userId: user.id });

      // If the user is replacing an EXISTING receipt, queue the previous
      // one for cleanup once the row is saved. We don't delete it yet
      // because if the user cancels, the original is still referenced.
      // Easiest correct approach: if didChangeReceipt was already true
      // (already an orphan from this session), nuke it immediately.
      if (newOrphanPathRef.current) {
        deleteFile(newOrphanPathRef.current).catch(() => {});
      }
      newOrphanPathRef.current = storage_path;
      setReceiptUrl(file_url);
      setReceiptPath(storage_path);
      setDidChangeReceipt(true);

      if (thenScan) {
        await runAiScan(file_url);
      }
    } catch {
      setScanError('שגיאה בהעלאת הקובץ. נסה שנית.');
    } finally {
      setUploading(false);
    }
  };

  // -- AI scan -------------------------------------------------------
  const runAiScan = async (urlOverride) => {
    const url = urlOverride || receiptUrl;
    if (!url) { setScanError('יש להעלות חשבונית קודם'); return; }
    setScanning(true);
    setScanError('');
    try {
      const schema = {
        type: 'object',
        properties: {
          amount:   { type: 'number', description: 'הסכום הסופי לתשלום בשקלים (ILS). אם המסמך באנגלית — סכום total.' },
          date:     { type: 'string', description: 'תאריך החשבונית בפורמט YYYY-MM-DD. אם יש רק DD/MM/YYYY — המר.' },
          vendor:   { type: 'string', description: 'שם בית העסק / המוסך / תחנת הדלק.' },
          category: { type: 'string', enum: ['fuel', 'repair', 'insurance', 'other'],
                      description: 'אחת מ: fuel (דלק / תחנת דלק), repair (תיקונים / מוסך / חלפים), insurance (ביטוח / פוליסה), other (כל השאר).' },
        },
      };
      const result = await extractDataFromUploadedFile({
        file_url: url,
        json_schema: schema,
        instructions: 'חלץ פרטי חשבונית כספית. החזר רק את הערכים שמופיעים בבירור במסמך. אם שדה לא ברור — השאר ריק.',
      });
      if (result?.status !== 'success' || !result.output) {
        throw new Error(result?.details || 'extraction_failed');
      }
      const out = result.output;
      // Only overwrite fields the AI confidently extracted; leave the
      // rest of the form untouched.
      if (out.amount && Number(out.amount) > 0) setAmount(String(out.amount));
      if (out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date)) setDate(out.date);
      if (out.category && CATEGORY_LABELS[out.category]) setCategory(out.category);
      if (out.vendor && !note) setNote(out.vendor);
      toast.success('הסריקה הושלמה — בדוק את הפרטים והוסף');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('receipt scan failed:', err);
      setScanError('הסריקה לא הצליחה — מלא את הפרטים ידנית');
    } finally {
      setScanning(false);
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

  // -- submit --------------------------------------------------------
  const submit = async (e) => {
    e.preventDefault();
    if (!isEdit && !vehicleId) { toast.error('יש לבחור רכב'); return; }
    const amt = Number(amount);
    if (Number.isNaN(amt) || amt < 0) { toast.error('הסכום לא תקין'); return; }
    if (!date) { toast.error('יש לבחור תאריך'); return; }

    setSubmitting(true);
    try {
      if (isEdit) {
        const { error } = await supabase.rpc('update_vehicle_expense', {
          p_id:                   row.id,
          p_amount:               amt,
          p_category:             category,
          p_expense_date:         date,
          p_note:                 note,
          p_receipt_url:          didChangeReceipt ? (receiptUrl || null) : null,
          p_receipt_storage_path: didChangeReceipt ? (receiptPath || null) : null,
          p_clear_receipt:        didChangeReceipt && !receiptPath,
        });
        if (error) throw error;
        // If we replaced an existing receipt, the OLD blob is now
        // orphaned — nuke it.
        if (didChangeReceipt && row.receipt_storage_path
            && row.receipt_storage_path !== receiptPath) {
          deleteFile(row.receipt_storage_path).catch(() => {});
        }
        toast.success('ההוצאה עודכנה');
      } else {
        const { error } = await supabase.rpc('add_vehicle_expense', {
          p_account_id:           accountId,
          p_vehicle_id:           vehicleId,
          p_amount:               amt,
          p_category:             category,
          p_expense_date:         date,
          p_note:                 note || null,
          p_currency:             'ILS',
          p_receipt_url:          receiptUrl || null,
          p_receipt_storage_path: receiptPath || null,
        });
        if (error) throw error;
        toast.success('ההוצאה נוספה');
      }
      savedRef.current = true;
      onSaved?.();
    } catch (err) {
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_manager'))    toast.error('אין לך הרשאת מנהל בחשבון הזה');
      else if (msg.includes('vehicle_not_in_workspace')) toast.error('הרכב שנבחר לא שייך לחשבון הזה');
      else if (msg.includes('invalid_amount'))           toast.error('הסכום לא תקין');
      else if (msg.includes('invalid_category'))         toast.error('קטגוריה לא תקינה');
      else                                                toast.error('השמירה נכשלה. נסה שוב.');
      // eslint-disable-next-line no-console
      console.error('expense save failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-2 sm:p-3"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#E8F2EA] flex items-center justify-center">
              <Receipt className="h-4 w-4 text-[#2D5233]" />
            </div>
            <h2 className="text-base font-bold text-gray-900">
              {isEdit ? 'ערוך הוצאה' : 'הוצאה חדשה'}
            </h2>
          </div>
          <button onClick={handleClose} className="p-1.5 hover:bg-gray-100 rounded-lg" aria-label="סגור">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        {/* Body — scrollable so the receipt section never pushes the
            submit button off-screen on a small device. */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
          {/* Vehicle */}
          {!isEdit && (
            <Field label="רכב" required>
              <VehiclePicker
                vehicles={vehicles}
                value={vehicleId}
                onChange={setVehicleId}
                placeholder="בחר רכב מהצי..."
              />
            </Field>
          )}
          {isEdit && (
            <Field label="רכב">
              <div className="px-3 py-2 rounded-lg border border-gray-100 bg-gray-50">
                <VehicleLabel
                  vehicle={vehicles.find(v => v.id === row.vehicle_id)}
                  size="sm"
                  interactive={false}
                />
              </div>
            </Field>
          )}

          {/* AI receipt scan section */}
          <ReceiptScanCard
            receiptUrl={receiptUrl}
            uploading={uploading}
            scanning={scanning}
            scanError={scanError}
            onUpload={(file, opts) => handleFile(file, opts)}
            onScan={() => runAiScan()}
            onRemove={removeReceipt}
            fileInputRef={fileInputRef}
          />

          {/* Amount + Category */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="סכום (₪)" required>
              <Input
                type="number" inputMode="decimal" step="0.01" min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-10 rounded-xl text-sm"
                placeholder="0"
              />
            </Field>
            <Field label="קטגוריה" required>
              <CategoryPicker value={category} onChange={setCategory} />
            </Field>
          </div>

          {/* Date */}
          <Field label="תאריך" required>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-xl text-sm" />
          </Field>

          {/* Note */}
          <Field label="הערה">
            <Textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="rounded-xl text-sm"
              placeholder="תיאור קצר, מספר חשבונית, או כל פרט שיועיל"
            />
          </Field>
        </form>

        {/* Sticky footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-white">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="w-full py-3 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 shadow-sm"
          >
            {submitting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : isEdit ? 'שמור שינויים' : 'הוסף הוצאה'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Receipt scan card ----------------------------------------

function ReceiptScanCard({ receiptUrl, uploading, scanning, scanError, onUpload, onScan, onRemove, fileInputRef }) {
  // Camera input gives mobile users the OS camera picker; the regular
  // file input gives desktop users their file dialog. Both feed the
  // same upload handler.
  const cameraRef = useRef(null);
  const isImage = /\.(jpe?g|png|webp|heic|heif)(\?|$)/i.test(receiptUrl || '');

  const handleFileEvent = (e, opts) => {
    const f = e.target.files?.[0];
    if (f) onUpload(f, opts);
    e.target.value = '';
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-bl from-[#F5FAF6] to-white p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <ScanLine className="h-3.5 w-3.5 text-[#2D5233]" />
          <span className="text-xs font-bold text-gray-900">חשבונית / קבלה</span>
        </div>
        {!receiptUrl && (
          <span className="text-[10px] text-gray-400">לא חובה</span>
        )}
      </div>

      {!receiptUrl ? (
        <>
          <p className="text-[10px] text-gray-500 leading-relaxed mb-2.5">
            צרף תמונת חשבונית או קבלה. אפשר לסרוק עם AI שיזהה אוטומטית סכום, תאריך וקטגוריה — או רק לתעד.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {/* Hidden file inputs driven by the two visible buttons. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => handleFileEvent(e, { thenScan: false })}
              className="hidden"
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handleFileEvent(e, { thenScan: true })}
              className="hidden"
            />

            {/* Both buttons sized to clear iOS's 44px tap target —
                py-3 + the icon row gives ~52px of comfortable thumb area. */}
            <button
              type="button"
              disabled={uploading || scanning}
              onClick={() => cameraRef.current?.click()}
              className="min-h-[52px] flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold active:scale-[0.97] disabled:opacity-60 shadow-sm"
            >
              <span className="flex items-center gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                <Camera className="h-3.5 w-3.5" />
              </span>
              <span>צלם וסרוק עם AI</span>
            </button>
            <button
              type="button"
              disabled={uploading || scanning}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[52px] flex flex-col items-center justify-center gap-1 py-3 px-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-[11px] font-bold active:scale-[0.97] disabled:opacity-60 hover:bg-gray-50"
            >
              <Upload className="h-3.5 w-3.5 text-gray-500" />
              <span>צרף קובץ בלבד</span>
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {/* Inline preview — image gets a thumbnail; PDFs / unknowns get
              a generic file pill so the user knows it's there. */}
          <div className="flex items-center gap-3 p-2 rounded-lg bg-white border border-gray-100">
            {isImage ? (
              <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <img
                  src={receiptUrl}
                  alt="חשבונית"
                  className="w-14 h-14 rounded-md object-cover border border-gray-100"
                />
              </a>
            ) : (
              <a
                href={receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 w-14 h-14 rounded-md bg-gray-50 border border-gray-100 flex items-center justify-center"
              >
                <FileText className="h-6 w-6 text-gray-400" />
              </a>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-gray-900">חשבונית מצורפת</p>
              <a
                href={receiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[#2D5233] underline"
              >
                פתח בחלון חדש
              </a>
            </div>
            <button
              type="button"
              onClick={onRemove}
              className="p-1.5 rounded-md hover:bg-red-50"
              aria-label="הסר חשבונית"
              title="הסר"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={scanning}
              onClick={onScan}
              className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-[#2D5233] text-white text-[11px] font-bold disabled:opacity-60 active:scale-[0.97]"
            >
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {scanning ? 'מנתח חשבונית...' : 'סרוק שדות עם AI'}
            </button>
            <button
              type="button"
              disabled={uploading || scanning}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-gray-100 text-gray-700 text-[11px] font-bold active:scale-[0.97]"
            >
              <Upload className="h-3.5 w-3.5" />
              החלף
            </button>
          </div>
        </div>
      )}

      {(uploading) && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          מעלה קובץ...
        </div>
      )}
      {scanError && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{scanError}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Category picker (visual segmented control) --------------

const CATEGORY_VISUAL = {
  fuel:      { color: 'text-blue-700  bg-blue-50  border-blue-200',    activeBg: 'bg-blue-600' },
  repair:    { color: 'text-orange-700 bg-orange-50 border-orange-200', activeBg: 'bg-orange-600' },
  insurance: { color: 'text-purple-700 bg-purple-50 border-purple-200', activeBg: 'bg-purple-600' },
  other:     { color: 'text-slate-700  bg-slate-50  border-slate-200',  activeBg: 'bg-slate-600' },
};

function CategoryPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {CATEGORY_ORDER.map(c => {
        const active = c === value;
        const v = CATEGORY_VISUAL[c];
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`px-2.5 py-2 rounded-lg text-xs font-bold border transition-all ${
              active
                ? `${v.activeBg} text-white border-transparent shadow-sm`
                : `${v.color} hover:brightness-95`
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        );
      })}
    </div>
  );
}

// ---------- helpers --------------------------------------------------

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function Empty({ icon, title, text, embedded }) {
  return (
    <div dir="rtl" className={embedded ? 'py-10' : 'max-w-md mx-auto py-16'}>
      <div className="text-center px-6">
        {icon && <div className="flex justify-center mb-3">{icon}</div>}
        {title && <p className="text-sm font-bold text-gray-700 mb-1">{title}</p>}
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
