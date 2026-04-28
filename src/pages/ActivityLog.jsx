/**
 * Phase 7 — Activity Log timeline.
 *
 * Two implicit modes (server RLS does the filtering):
 *   - Manager (בעלים/מנהל/שותף): sees every log in the workspace,
 *     gets filter chips for user/vehicle/route/date.
 *   - Driver: sees only their own actions + logs about routes assigned
 *     to them. Filters are limited because the dataset is already
 *     narrow.
 *
 * Pagination: keyset on created_at DESC, page size 30. "Load more"
 * button appends. No "load all" path — designed so a 50k-row workspace
 * doesn't kill the browser.
 *
 * Reads from view v_activity_log which joins user_profiles.full_name
 * for display.
 */
import React, { useState } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, Calendar, ChevronLeft, FileText,
  CheckCircle2, AlertTriangle, MessageSquare, Plus, Truck, User as UserIcon,
  Image as ImageIcon, Filter, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';

const PAGE_SIZE = 30;

// Hebrew label + icon per action_type. Unknown types fall back to a
// generic icon and the raw action string — defensive against future
// log types added before this map is updated.
const ACTION_META = {
  'workspace.create':       { label: 'נוצרה סביבת עבודה עסקית', icon: Briefcase,    cls: 'text-purple-600 bg-purple-50' },
  'driver.assign':          { label: 'נהג שויך לרכב',          icon: UserIcon,     cls: 'text-blue-600 bg-blue-50' },
  'route.create':           { label: 'נוצר מסלול',              icon: Plus,         cls: 'text-green-600 bg-green-50' },
  'route.start':            { label: 'מסלול יצא לדרך',          icon: Truck,        cls: 'text-blue-600 bg-blue-50' },
  'route.complete':         { label: 'מסלול הושלם',             icon: CheckCircle2, cls: 'text-green-700 bg-green-50' },
  'route.reopen':           { label: 'מסלול נפתח מחדש',         icon: ChevronLeft,  cls: 'text-yellow-700 bg-yellow-50' },
  'stop.complete':          { label: 'תחנה הושלמה',             icon: CheckCircle2, cls: 'text-green-700 bg-green-50' },
  'stop.skip':              { label: 'תחנה דולגה',               icon: ChevronLeft,  cls: 'text-yellow-700 bg-yellow-50' },
  'stop.issue':             { label: 'תקלה דווחה בתחנה',        icon: AlertTriangle, cls: 'text-red-700 bg-red-50' },
  'stop.reopen':            { label: 'תחנה נפתחה מחדש',         icon: ChevronLeft,  cls: 'text-gray-600 bg-gray-100' },
  'stop.note_added':        { label: 'נוספה הערה לתחנה',        icon: MessageSquare, cls: 'text-gray-700 bg-gray-100' },
  'stop.photo_added':       { label: 'נוספה תמונה לתחנה',       icon: ImageIcon,    cls: 'text-gray-700 bg-gray-100' },
  'stop.issue_documented':  { label: 'תיעוד תקלה',              icon: AlertTriangle, cls: 'text-red-700 bg-red-50' },
  'expense.add':            { label: 'נרשמה הוצאה',             icon: Plus,         cls: 'text-blue-600 bg-blue-50' },
  'expense.update':         { label: 'הוצאה עודכנה',            icon: MessageSquare, cls: 'text-gray-700 bg-gray-100' },
  'expense.delete':         { label: 'הוצאה נמחקה',             icon: AlertTriangle, cls: 'text-red-700 bg-red-50' },
};
function metaFor(action) {
  return ACTION_META[action] || { label: action, icon: FileText, cls: 'text-gray-700 bg-gray-100' };
}

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString('he-IL', { hour12: false }); }
  catch { return ts; }
}

export default function ActivityLog() {
  const { isAuthenticated } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, canManageRoutes, canDriveRoutes, isLoading: roleLoading } = useWorkspaceRole();
  const queryClient = useQueryClient();

  const [filterUser,    setFilterUser]    = useState('');
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterRoute,   setFilterRoute]   = useState('');
  const [filterDate,    setFilterDate]    = useState('');     // 'YYYY-MM-DD' (start of day)
  const [showFilters,   setShowFilters]   = useState(false);

  // Members + vehicles + routes for the filter dropdowns. Manager only.
  const { data: members = [] } = useQuery({
    queryKey: ['activity-filter-members', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('account_members')
        .select('user_id, role')
        .eq('account_id', accountId)
        .eq('status', 'פעיל');
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['activity-filter-vehicles', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles').select('id, nickname, license_plate, manufacturer, model')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes,
    staleTime: 5 * 60 * 1000,
  });

  const { data: routes = [] } = useQuery({
    queryKey: ['activity-filter-routes', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('routes').select('id, title, scheduled_for')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canManageRoutes,
    staleTime: 60 * 1000,
  });

  // Paginated log fetch.
  const filterKey = JSON.stringify({ filterUser, filterVehicle, filterRoute, filterDate });
  const {
    data, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isLoading,
  } = useInfiniteQuery({
    queryKey: ['activity-log', accountId, filterKey],
    enabled: !!accountId && (canManageRoutes || canDriveRoutes),
    initialPageParam: null, // cursor: ISO timestamp string (created_at) or null for first page
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('v_activity_log')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      if (filterUser)    q = q.eq('actor_user_id', filterUser);
      if (filterVehicle) q = q.eq('vehicle_id',    filterVehicle);
      if (filterRoute)   q = q.eq('route_id',      filterRoute);
      if (filterDate) {
        const start = new Date(filterDate + 'T00:00:00').toISOString();
        const end   = new Date(filterDate + 'T23:59:59.999').toISOString();
        q = q.gte('created_at', start).lte('created_at', end);
      }
      const { data: rows, error } = await q;
      if (error) throw error;
      return rows || [];
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]?.created_at,
  });

  if (!isAuthenticated) {
    return <Empty text="צריך להתחבר כדי לראות יומן פעילות." />;
  }
  if (roleLoading) return <Empty text="טוען..." />;
  if (!isBusiness) {
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="יומן פעילות זמין בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );
  }
  if (!canManageRoutes && !canDriveRoutes) {
    return <Empty text="התפקיד שלך בחשבון הזה לא כולל גישה ליומן הפעילות." />;
  }

  const allLogs = (data?.pages || []).flat();
  const hasFilters = filterUser || filterVehicle || filterRoute || filterDate;

  const clearFilters = () => {
    setFilterUser(''); setFilterVehicle(''); setFilterRoute(''); setFilterDate('');
  };

  return (
    <div dir="rtl" className="max-w-3xl mx-auto py-2">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">יומן פעילות</h1>
          <p className="text-xs text-gray-500">
            {canManageRoutes
              ? 'תיעוד כרונולוגי של כל הפעולות בחשבון. שורה לכל אירוע.'
              : 'הפעולות שלך והפעילות במסלולים שמשויכים אליך.'}
          </p>
        </div>
        {canManageRoutes && (
          <button
            type="button"
            onClick={() => setShowFilters(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold ${
              hasFilters ? 'bg-[#2D5233] text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            סנן
            {hasFilters && <span className="bg-white/20 rounded-full px-1.5 text-[10px]">{[filterUser, filterVehicle, filterRoute, filterDate].filter(Boolean).length}</span>}
          </button>
        )}
      </div>

      {showFilters && canManageRoutes && (
        <div className="bg-gray-50 rounded-xl p-3 mb-3 space-y-2">
          <FilterRow label="משתמש">
            <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} className={selectCls}>
              <option value="">הכל</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.user_id.slice(0, 8)} ({m.role})</option>)}
            </select>
          </FilterRow>
          <FilterRow label="רכב">
            <select value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)} className={selectCls}>
              <option value="">הכל</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim()}
                </option>
              ))}
            </select>
          </FilterRow>
          <FilterRow label="מסלול">
            <select value={filterRoute} onChange={(e) => setFilterRoute(e.target.value)} className={selectCls}>
              <option value="">הכל</option>
              {routes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </FilterRow>
          <FilterRow label="תאריך">
            <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className={selectCls} />
          </FilterRow>
          {hasFilters && (
            <button type="button" onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-gray-600 px-2 py-1 hover:bg-gray-100 rounded">
              <X className="h-3 w-3" /> נקה סינון
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-xs text-gray-400 py-8">טוען יומן...</div>
      ) : allLogs.length === 0 ? (
        <Empty
          icon={<Calendar className="h-10 w-10 text-gray-300" />}
          title={hasFilters ? 'לא נמצאה פעילות בסינון הזה' : 'עוד לא נרשמה פעילות'}
          text={hasFilters
            ? 'נסה להסיר חלק מהמסננים, או לבחור טווח תאריכים אחר.'
            : 'כל פעולה בחשבון תיכתב ליומן אוטומטית. יצירת מסלול, עדכון תחנה, הוספת הוצאה.'}
          embedded
        />
      ) : (
        <>
          <ol className="space-y-1.5">
            {allLogs.map(log => <LogRow key={log.id} log={log} />)}
          </ol>
          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              className="w-full mt-3 py-2.5 rounded-xl bg-gray-100 text-xs font-bold text-gray-700 disabled:opacity-60"
            >
              {isFetchingNextPage ? 'טוען...' : 'טען עוד'}
            </button>
          )}
          {!hasNextPage && allLogs.length >= PAGE_SIZE && (
            <p className="text-center text-[10px] text-gray-400 mt-3">סוף היומן</p>
          )}
        </>
      )}
    </div>
  );
}

function LogRow({ log }) {
  const meta = metaFor(log.action);
  const Icon = meta.icon;
  return (
    <li className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${meta.cls}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{meta.label}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {log.actor_label} · {fmtTime(log.created_at)}
          </p>
          {log.note && (
            <p className="text-[11px] text-gray-700 bg-gray-50 rounded-md px-2 py-1 mt-1.5 leading-relaxed">
              {log.note}
            </p>
          )}
          {log.attachment_ref && (
            <p className="text-[10px] text-blue-700 mt-1 truncate">
              📎 {log.attachment_ref}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function FilterRow({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

const selectCls = "w-full px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs";

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
