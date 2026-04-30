import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Search, Copy, Trash2, Play, Pause, Pencil, Eye, RefreshCw, Loader2,
} from 'lucide-react';
import ConfirmDeleteDialog from '@/components/shared/ConfirmDeleteDialog';
import AdminPopupEditor from '@/components/admin/AdminPopupEditor';
import { CATEGORIES, STATUSES, TRIGGERS } from '@/lib/popups/constants';

/**
 * AdminPopupsTab — main management screen.
 *
 * Rendered inside AdminDashboard as the "פופ-אפים" tab. Shows every
 * admin-managed popup with filters, CTR snapshots, and inline actions.
 * Opens AdminPopupEditor on add/edit.
 */
export default function AdminPopupsTab() {
  const [popups, setPopups]   = useState([]);
  const [stats7d, setStats7d] = useState({});   // { [popup_id]: { shown, dismissed, clicked } }
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  //  Filters / search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [triggerFilter, setTriggerFilter] = useState('all');

  //  Editor state
  const [editing, setEditing] = useState(null); // popup row | 'new' | null
  const [deleting, setDeleting] = useState(null);

  //  Load popups + 7d stats
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: list }, { data: stats }] = await Promise.all([
          supabase.from('admin_popups').select('*').order('updated_at', { ascending: false }),
          supabase.rpc('admin_popup_stats_7d'),
        ]);
        if (cancelled) return;
        setPopups(Array.isArray(list) ? list : []);
        const m = {};
        (stats || []).forEach(s => { m[s.popup_id] = s; });
        setStats7d(m);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshTick]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return popups.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (triggerFilter !== 'all' && (p.trigger?.kind) !== triggerFilter) return false;
      if (q && !(
        (p.name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [popups, search, statusFilter, categoryFilter, triggerFilter]);

  const totals = useMemo(() => {
    const byStatus = popups.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
    const shownToday = Object.values(stats7d).reduce((s, r) => s + (r.shown || 0), 0);
    return { active: byStatus.active || 0, draft: byStatus.draft || 0, shownToday };
  }, [popups, stats7d]);

  //  Actions
  const handleToggleStatus = async (popup) => {
    const next = popup.status === 'active' ? 'paused' : 'active';
    try {
      const { error } = await supabase.from('admin_popups').update({ status: next }).eq('id', popup.id);
      if (error) throw error;
      toast.success(next === 'active' ? 'הופעל' : 'הושהה');
      setRefreshTick(t => t + 1);
    } catch (e) { toast.error(`פעולה נכשלה: ${e.message}`); }
  };

  const handleDuplicate = async (popup) => {
    try {
      const copy = { ...popup };
      delete copy.id; delete copy.created_at; delete copy.updated_at; delete copy.created_by;
      copy.name = `${popup.name} (עותק)`;
      copy.status = 'draft';
      // A duplicate of a system popup must lose the lock — otherwise the
      // new row would inherit is_system=true and be uneditable too.
      copy.is_system = false;
      const { error } = await supabase.from('admin_popups').insert(copy);
      if (error) throw error;
      toast.success('שוכפל');
      setRefreshTick(t => t + 1);
    } catch (e) { toast.error(`שכפול נכשל: ${e.message}`); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      const { error } = await supabase.from('admin_popups').delete().eq('id', deleting.id);
      if (error) throw error;
      toast.success('נמחק');
      setDeleting(null);
      setRefreshTick(t => t + 1);
    } catch (e) { toast.error(`מחיקה נכשלה: ${e.message}`); }
  };

  const handleSaved = () => {
    setEditing(null);
    setRefreshTick(t => t + 1);
  };

  if (editing) {
    return (
      <AdminPopupEditor
        popup={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <div dir="rtl" className="space-y-4">
      {/*  Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-4">
          <h2 className="text-lg font-bold text-gray-900">🔔 ניהול פופ-אפים</h2>
          <p className="text-xs text-gray-500">
            {totals.active} פעילים · {totals.draft} טיוטות · {totals.shownToday} הוצגו ב-7 ימים אחרונים
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setRefreshTick(t => t + 1)}
            className="h-9 px-3 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-1.5">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> רענן
          </button>
          <button onClick={() => setEditing('new')}
            className="h-9 px-4 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5 shadow-sm">
            <Plus className="w-3.5 h-3.5" /> פופ-אפ חדש
          </button>
        </div>
      </div>

      {/*  Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם או תיאור..."
            className="pr-9 rounded-xl h-9 text-sm" dir="rtl" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px] h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">כל הקטגוריות</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={triggerFilter} onValueChange={setTriggerFilter}>
          <SelectTrigger className="w-[140px] h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">כל הטריגרים</SelectItem>
            {TRIGGERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/*  Table */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState onCreate={() => setEditing('new')} hasFilters={search || statusFilter !== 'all' || categoryFilter !== 'all' || triggerFilter !== 'all'} />
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-right">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                <th className="px-4 py-3 text-right">שם</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">קטגוריה</th>
                <th className="px-4 py-3 text-right">סטטוס</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">טריגר</th>
                <th className="px-4 py-3 text-right hidden lg:table-cell">7 ימ' אחרונים</th>
                <th className="px-4 py-3 text-right hidden lg:table-cell">עודכן</th>
                <th className="px-4 py-3 text-right">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(p => (
                <PopupRow
                  key={p.id}
                  popup={p}
                  stats={stats7d[p.id]}
                  onEdit={() => setEditing(p)}
                  onToggle={() => handleToggleStatus(p)}
                  onDuplicate={() => handleDuplicate(p)}
                  onDelete={() => setDeleting(p)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        onConfirm={handleDelete}
        title={`מחיקת "${deleting?.name || ''}"`}
        description="כל נתוני האנליטיקס של הפופ-אפ הזה יימחקו. לא ניתן לבטל את הפעולה."
      />
    </div>
  );
}

function PopupRow({ popup, stats, onEdit, onToggle, onDuplicate, onDelete }) {
  const statusMeta = STATUSES.find(s => s.value === popup.status) || STATUSES[0];
  const catMeta = CATEGORIES.find(c => c.value === popup.category);
  const trigMeta = TRIGGERS.find(t => t.value === popup.trigger?.kind);
  const shown = stats?.shown || 0;
  const dismissed = stats?.dismissed || 0;
  const clicked = stats?.clicked || 0;
  const ctr = shown > 0 ? Math.round((clicked / shown) * 100) : null;

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-sm font-bold text-gray-900">
              {popup.name}
              {popup.is_system && <span className="text-[10px] mr-1 text-gray-400">🔒</span>}
            </p>
            {popup.description && (
              <p className="text-[11px] text-gray-400 line-clamp-1 max-w-xs">{popup.description}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-xs text-gray-600">{catMeta?.label || popup.category}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
          style={{ color: statusMeta.color, background: statusMeta.bg }}>
          {statusMeta.label}
        </span>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-xs text-gray-600">{trigMeta?.label || '—'}</span>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        {shown > 0 ? (
          <div className="text-[11px]">
            <span className="font-bold text-gray-900">👁 {shown}</span>
            <span className="text-gray-400"> · {dismissed} סגירות</span>
            {ctr !== null && <span className="text-emerald-600 font-bold"> · CTR {ctr}%</span>}
          </div>
        ) : <span className="text-[11px] text-gray-300">—</span>}
      </td>
      <td className="px-4 py-3 hidden lg:table-cell text-[11px] text-gray-400">
        {popup.updated_at ? new Date(popup.updated_at).toLocaleDateString('he-IL') : '—'}
      </td>
      <td className="px-4 py-3">
        {/* System popups: view-only. Code owns their timing/content; the DB
         * row exists as a catalog + analytics target only. Admin can still
         * duplicate (to start a new popup seeded from the system layout). */}
        {popup.is_system ? (
          <div className="flex items-center gap-1">
            <IconButton title="צפה בפרטים" onClick={onEdit}><Eye className="w-3.5 h-3.5" /></IconButton>
            <IconButton title="שכפל (כטיוטה ניתנת לעריכה)" onClick={onDuplicate}><Copy className="w-3.5 h-3.5" /></IconButton>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <IconButton title="ערוך" onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></IconButton>
            <IconButton
              title={popup.status === 'active' ? 'השהה' : 'הפעל'}
              onClick={onToggle}>
              {popup.status === 'active'
                ? <Pause className="w-3.5 h-3.5" />
                : <Play  className="w-3.5 h-3.5" />}
            </IconButton>
            <IconButton title="שכפל" onClick={onDuplicate}><Copy className="w-3.5 h-3.5" /></IconButton>
            <IconButton title="מחק" onClick={onDelete} danger><Trash2 className="w-3.5 h-3.5" /></IconButton>
          </div>
        )}
      </td>
    </tr>
  );
}

function IconButton({ children, onClick, title, danger = false }) {
  return (
    <button onClick={onClick} title={title}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
        danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-500 hover:bg-gray-100'
      }`}>
      {children}
    </button>
  );
}

function EmptyState({ onCreate, hasFilters }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 py-16 px-6 text-center">
      <p className="text-lg font-bold text-gray-700">
        {hasFilters ? 'לא נמצאו פופ-אפים תואמים' : 'עדיין אין פופ-אפים'}
      </p>
      <p className="text-xs text-gray-400 mt-1 mb-5">
        {hasFilters ? 'נסה לנקות את הפילטרים' : 'צור את הפופ-אפ הראשון ותתחיל לראות נתונים'}
      </p>
      {!hasFilters && (
        <button onClick={onCreate}
          className="h-10 px-5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> צור פופ-אפ חדש
        </button>
      )}
    </div>
  );
}
