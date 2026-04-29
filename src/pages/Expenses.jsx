/**
 * Phase 8 — Expenses CRUD (Manager only).
 *
 * List + add/edit/delete manual vehicle expenses (fuel, insurance,
 * other; repair entries can also live here for non-repair_logs flows).
 *
 * Drivers cannot reach this page — RLS on vehicle_expenses denies SELECT
 * for role='driver', and the businessOnly nav flag hides the link.
 *
 * Note: repair_logs.cost values entered through the existing
 * Maintenance/Repairs UI are NOT shown here — that page already manages
 * them. Reports.jsx aggregates BOTH sources together.
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Loader2, Briefcase, Receipt, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import VehicleLabel, { vehicleDisplayText } from '@/components/shared/VehicleLabel';

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

  const [editing, setEditing]     = useState(null); // null | {} (new) | row (edit)

  // Phase 9 step 7 — keyset pagination on created_at, 30 rows per page.
  // expense_date can repeat across rows so cursor uses created_at which
  // is monotonic. Display order is still expense_date desc → created_at desc
  // for natural reading.
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
  const vehicleLabel = (id) => vehicleDisplayText(vehicleById[id]);

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">הוצאות תפעול</h1>
          <p className="text-xs text-gray-500">דלק, ביטוח ועלויות תפעוליות נוספות של הצי</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({})}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#2D5233] text-white text-xs font-bold active:scale-[0.98]"
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
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-bold text-gray-900">{fmtMoney(e.amount, e.currency)}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-700 font-bold">
                      {CATEGORY_LABELS[e.category] || e.category}
                    </span>
                    <span className="text-[11px] text-gray-400">{fmtDate(e.expense_date)}</span>
                  </div>
                  {/* Interactive vehicle row — click goes to VehicleDetail.
                      Replaces the previous "license-plate-only" text. */}
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
                        toast.success('ההוצאה נמחקה');
                        await queryClient.invalidateQueries({ queryKey: ['expenses'] });
                      } catch (err) {
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

function ExpenseDialog({ row, vehicles, accountId, onClose, onSaved }) {
  const isEdit = !!row?.id;
  const [vehicleId, setVehicleId] = useState(row.vehicle_id   || '');
  const [amount,    setAmount]    = useState(row.amount   != null ? String(row.amount) : '');
  const [category,  setCategory]  = useState(row.category    || 'fuel');
  const [date,      setDate]      = useState(row.expense_date || new Date().toISOString().slice(0, 10));
  const [note,      setNote]      = useState(row.note         || '');
  const [submitting, setSubmitting] = useState(false);

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
          p_id:           row.id,
          p_amount:       amt,
          p_category:     category,
          p_expense_date: date,
          p_note:         note,
        });
        if (error) throw error;
        toast.success('ההוצאה עודכנה');
      } else {
        const { error } = await supabase.rpc('add_vehicle_expense', {
          p_account_id:   accountId,
          p_vehicle_id:   vehicleId,
          p_amount:       amt,
          p_category:     category,
          p_expense_date: date,
          p_note:         note || null,
          p_currency:     'ILS',
        });
        if (error) throw error;
        toast.success('ההוצאה נוספה');
      }
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
    <div dir="rtl" className="fixed inset-0 z-[10000] bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{isEdit ? 'ערוך הוצאה' : 'הוצאה חדשה'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="h-4 w-4 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {!isEdit && (
            <Field label="רכב" required>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
                <option value="">בחר רכב...</option>
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="סכום (₪)" required>
              <input type="number" step="0.01" min="0" value={amount}
                onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </Field>
            <Field label="קטגוריה" required>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="תאריך" required>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="הערה">
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls}
              placeholder="תיאור קצר, מספר חשבונית, או כל פרט שיועיל"
            />
          </Field>
          <button type="submit" disabled={submitting}
            className="w-full py-2.5 rounded-xl font-bold text-sm bg-[#2D5233] text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? 'שמור שינויים' : 'הוסף הוצאה'}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30";
function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-700 mb-1">{label} {required && <span className="text-red-500">*</span>}</label>
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
