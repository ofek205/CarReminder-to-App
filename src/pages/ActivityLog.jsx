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
import VehiclePicker from '@/components/shared/VehiclePicker';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// Living Dashboard system - shared with all B2B pages.
import { PageShell, Card } from '@/components/business/system';

const PAGE_SIZE = 30;

// Hebrew label + icon per action_type, plus an `accent` keyed to the
// Living Dashboard palette so each row's Card stripe color hints at
// the action's domain at a glance:
//   emerald = positive completion (route/stop completed, route created)
//   blue    = informational      (assignment, note, photo, expense add)
//   amber   = neutral revert     (reopen, skip, expense update)
//   red     = problem / removal  (issue, expense delete)
//   purple  = administrative     (workspace.create)
// Unknown types fall back to a generic icon and the raw action string —
// defensive against future log types added before this map is updated.
const ACTION_META = {
  'workspace.create':       { label: 'נוצרה סביבת עבודה עסקית', icon: Briefcase,     accent: 'purple',  cls: 'text-purple-600 bg-purple-50' },
  'driver.assign':          { label: 'נהג שויך לרכב',           icon: UserIcon,      accent: 'blue',    cls: 'text-blue-600 bg-blue-50' },
  'route.create':           { label: 'נוצרה משימה',             icon: Plus,          accent: 'emerald', cls: 'text-green-600 bg-green-50' },
  'route.start':            { label: 'משימה יצאה לדרך',         icon: Truck,         accent: 'blue',    cls: 'text-blue-600 bg-blue-50' },
  'route.complete':         { label: 'משימה הושלמה',            icon: CheckCircle2,  accent: 'emerald', cls: 'text-green-700 bg-green-50' },
  'route.reopen':           { label: 'משימה נפתחה מחדש',        icon: ChevronLeft,   accent: 'amber',   cls: 'text-yellow-700 bg-yellow-50' },
  'stop.complete':          { label: 'תחנה הושלמה',             icon: CheckCircle2,  accent: 'emerald', cls: 'text-green-700 bg-green-50' },
  'stop.skip':              { label: 'תחנה דולגה',              icon: ChevronLeft,   accent: 'amber',   cls: 'text-yellow-700 bg-yellow-50' },
  'stop.issue':             { label: 'תקלה דווחה בתחנה',        icon: AlertTriangle, accent: 'red',     cls: 'text-red-700 bg-red-50' },
  'stop.reopen':            { label: 'תחנה נפתחה מחדש',         icon: ChevronLeft,   accent: 'amber',   cls: 'text-gray-600 bg-gray-100' },
  'stop.note_added':        { label: 'נוספה הערה לתחנה',        icon: MessageSquare, accent: 'blue',    cls: 'text-gray-700 bg-gray-100' },
  'stop.photo_added':       { label: 'נוספה תמונה לתחנה',       icon: ImageIcon,     accent: 'blue',    cls: 'text-gray-700 bg-gray-100' },
  'stop.issue_documented':  { label: 'תיעוד תקלה',              icon: AlertTriangle, accent: 'red',     cls: 'text-red-700 bg-red-50' },
  'expense.add':            { label: 'נרשמה הוצאה',             icon: Plus,          accent: 'blue',    cls: 'text-blue-600 bg-blue-50' },
  'expense.update':         { label: 'הוצאה עודכנה',            icon: MessageSquare, accent: 'amber',   cls: 'text-gray-700 bg-gray-100' },
  'expense.delete':         { label: 'הוצאה נמחקה',             icon: AlertTriangle, accent: 'red',     cls: 'text-red-700 bg-red-50' },
};
function metaFor(action) {
  return ACTION_META[action] || { label: action, icon: FileText, accent: 'emerald', cls: 'text-gray-700 bg-gray-100' };
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
      const { data, error } = await supabase.rpc('workspace_members_directory', {
        p_account_id: accountId,
      });
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
        .from('vehicles')
        .select('id, nickname, license_plate, manufacturer, model')
        .eq('account_id', accountId)
        .order('created_date', { ascending: false })
        .limit(500);
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
    <PageShell
      title="יומן פעילות"
      subtitle={canManageRoutes
        ? 'תיעוד כרונולוגי של כל הפעולות בחשבון. שורה לכל אירוע.'
        : 'הפעולות שלך והפעילות במשימות שמשויכות אליך.'}
      actions={canManageRoutes && (
        <button
          type="button"
          onClick={() => setShowFilters(o => !o)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98] border"
          style={hasFilters
            ? {
                background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
                color: '#FFFFFF',
                borderColor: '#065F46',
                boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
              }
            : {
                background: '#FFFFFF',
                color: '#10B981',
                borderColor: '#D1FAE5',
              }}
        >
          <Filter className="h-3.5 w-3.5" />
          סנן
          {hasFilters && (
            <span
              className="rounded-full px-1.5 text-[10px]"
              style={{ background: 'rgba(255,255,255,0.25)' }}
            >
              {[filterUser, filterVehicle, filterRoute, filterDate].filter(Boolean).length}
            </span>
          )}
        </button>
      )}
    >
      {showFilters && canManageRoutes && (
        <Card className="mb-4 space-y-2">
          <FilterRow label="משתמש">
            <Select value={filterUser || 'all-users'} onValueChange={(v) => setFilterUser(v === 'all-users' ? '' : v)}>
              <SelectTrigger className={selectTriggerCls}>
                <SelectValue placeholder="כל המשתמשים" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-users">כל המשתמשים</SelectItem>
                {members.map(m => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name || m.email || 'משתמש ללא שם'} · {m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterRow>
          <FilterRow label="רכב">
            {/* Rich vehicle picker — searchable, themed, replaces the
                plate-only native <select>. */}
            <VehiclePicker
              vehicles={vehicles}
              value={filterVehicle}
              onChange={setFilterVehicle}
              placeholder="כל הרכבים"
              allowClear
              size="sm"
            />
          </FilterRow>
          <FilterRow label="משימה">
            <Select value={filterRoute || 'all-routes'} onValueChange={(v) => setFilterRoute(v === 'all-routes' ? '' : v)}>
              <SelectTrigger className={selectTriggerCls}>
                <SelectValue placeholder="כל המשימות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all-routes">כל המשימות</SelectItem>
                {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterRow>
          <FilterRow label="תאריך">
            <DateInput
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="h-10 rounded-xl text-xs"
            />
          </FilterRow>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-gray-100"
              style={{ color: '#4B5D52' }}
            >
              <X className="h-3 w-3" /> נקה סינון
            </button>
          )}
        </Card>
      )}

      {isLoading ? (
        <Card className="text-center py-8">
          <p className="text-xs" style={{ color: '#6B7C72' }}>טוען יומן...</p>
        </Card>
      ) : allLogs.length === 0 ? (
        <Card className="text-center py-12">
          <Calendar className="h-10 w-10 mx-auto mb-3" style={{ color: '#A7F3D0' }} />
          <p className="text-sm font-bold mb-1" style={{ color: '#0B2912' }}>
            {hasFilters ? 'לא נמצאה פעילות בסינון הזה' : 'עוד לא נרשמה פעילות'}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: '#6B7C72' }}>
            {hasFilters
              ? 'נסה להסיר חלק מהמסננים, או לבחור טווח תאריכים אחר.'
              : 'כל פעולה בחשבון תיכתב ליומן אוטומטית. יצירת משימה, עדכון תחנה, הוספת הוצאה.'}
          </p>
        </Card>
      ) : (
        <>
          <ol className="space-y-2">
            {allLogs.map(log => <LogRow key={log.id} log={log} />)}
          </ol>
          {hasNextPage && (
            <button
              type="button"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              className="w-full mt-4 py-3 rounded-xl text-xs font-bold transition-all disabled:opacity-60 hover:scale-[1.01] active:scale-[0.99]"
              style={{
                background: '#FFFFFF',
                color: '#10B981',
                border: '1.5px solid #D1FAE5',
              }}
            >
              {isFetchingNextPage ? 'טוען...' : 'טען עוד'}
            </button>
          )}
          {!hasNextPage && allLogs.length >= PAGE_SIZE && (
            <p className="text-center text-[10px] mt-4" style={{ color: '#A7B3AB' }}>סוף היומן</p>
          )}
        </>
      )}
    </PageShell>
  );
}

function LogRow({ log }) {
  const meta = metaFor(log.action);
  const Icon = meta.icon;
  return (
    <li>
      <Card accent={meta.accent} padding="p-3.5">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${meta.cls}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#0B2912' }}>{meta.label}</p>
            <p className="text-[11px] truncate" style={{ color: '#6B7C72' }}>
              {log.actor_label} · {fmtTime(log.created_at)}
            </p>
            {log.note && (
              <p
                className="text-[11px] rounded-md px-2 py-1 mt-1.5 leading-relaxed"
                style={{ background: '#F0F7F4', color: '#0B2912' }}
              >
                {log.note}
              </p>
            )}
            {log.attachment_ref && (
              <p className="text-[10px] mt-1 truncate" style={{ color: '#1E40AF' }}>
                📎 {log.attachment_ref}
              </p>
            )}
          </div>
        </div>
      </Card>
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

const selectTriggerCls = "h-10 rounded-xl text-xs font-bold";

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
