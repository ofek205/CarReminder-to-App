/**
 * Phase 8 — Reports.
 *
 * Manager-only page (drivers cannot read vehicle_expenses).
 *
 * Three tabs backed by views v_vehicle_cost_summary,
 * v_monthly_expense_summary, v_activity_summary. Filters: vehicle (for
 * vehicles tab), date range (applied to all). Top "summary cards"
 * provide the manager-dashboard inputs the brief asks for: total this
 * month, most expensive vehicle, recent expenses.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, Calendar, Truck, AlertTriangle, CheckCircle2,
  TrendingUp, Receipt, Filter, Fuel, Wrench, Shield, Package,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';

const fmtMoney = (n, c = 'ILS') =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n || 0);
const fmtMonth = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('he-IL', { year: 'numeric', month: 'long' });
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('he-IL') : '';
const todayISO     = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

const CATEGORY = {
  fuel:      { label: 'דלק',      icon: Fuel,    cls: 'text-blue-600 bg-blue-50' },
  repair:    { label: 'תיקונים',  icon: Wrench,  cls: 'text-orange-600 bg-orange-50' },
  insurance: { label: 'ביטוח',    icon: Shield,  cls: 'text-purple-600 bg-purple-50' },
  other:     { label: 'אחר',      icon: Package, cls: 'text-gray-600 bg-gray-50' },
};

export default function Reports() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { accountId } = useAccountRole();
  const { isBusiness, isManager, isViewer, isLoading: roleLoading } = useWorkspaceRole();
  const canRead = isManager || isViewer;

  const [tab, setTab]               = useState('vehicles'); // vehicles | monthly | activity
  const [filterVehicle, setFilterVehicle] = useState('');
  const [filterFrom, setFilterFrom] = useState('');         // optional ISO date
  const [filterTo,   setFilterTo]   = useState('');

  // Vehicles list — for picker + label lookups across tabs.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['reports-vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 5 * 60 * 1000,
  });

  // Per-vehicle cost summary.
  const { data: vehicleSummaries = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['v-vehicle-cost', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_vehicle_cost_summary')
        .select('*')
        .eq('account_id', accountId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Monthly expense summary.
  const { data: monthlySummaries = [], isLoading: monthlyLoading } = useQuery({
    queryKey: ['v-monthly', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_monthly_expense_summary')
        .select('*')
        .eq('account_id', accountId)
        .order('month', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Activity summary.
  const { data: activitySummaries = [], isLoading: activityLoading } = useQuery({
    queryKey: ['v-activity', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_activity_summary')
        .select('*')
        .eq('account_id', accountId)
        .order('month', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Recent expenses (top of page card).
  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['reports-recent-expenses', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_expenses')
        .select('id, vehicle_id, amount, currency, category, expense_date, note')
        .eq('account_id', accountId)
        .order('expense_date', { ascending: false })
        .order('created_at',   { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!accountId && canRead && isBusiness,
    staleTime: 60 * 1000,
  });

  // Filtered + sorted derived data.
  const vehicleLabel = (id) => {
    const v = vehicles.find(x => x.id === id);
    if (!v) return id?.slice(0, 8) || '—';
    return v.nickname || v.license_plate || `${v.manufacturer || ''} ${v.model || ''}`.trim() || '—';
  };

  const filteredVehicles = useMemo(() => {
    let rows = vehicleSummaries;
    if (filterVehicle) rows = rows.filter(r => r.vehicle_id === filterVehicle);
    return [...rows].sort((a, b) => Number(b.total) - Number(a.total));
  }, [vehicleSummaries, filterVehicle]);

  const filteredMonthly = useMemo(() => {
    return monthlySummaries.filter(r => {
      if (filterFrom && r.month < filterFrom) return false;
      if (filterTo   && r.month > filterTo)   return false;
      return true;
    });
  }, [monthlySummaries, filterFrom, filterTo]);

  const filteredActivity = useMemo(() => {
    return activitySummaries.filter(r => {
      if (filterFrom && r.month < filterFrom) return false;
      if (filterTo   && r.month > filterTo)   return false;
      return true;
    });
  }, [activitySummaries, filterFrom, filterTo]);

  // Top summary cards.
  const monthStart = monthStartISO();
  const thisMonthTotal = useMemo(() => {
    const row = monthlySummaries.find(r => r.month === monthStart);
    return row?.total || 0;
  }, [monthlySummaries, monthStart]);

  const mostExpensiveVehicle = useMemo(() => {
    if (vehicleSummaries.length === 0) return null;
    return [...vehicleSummaries].sort((a, b) => Number(b.total) - Number(a.total))[0];
  }, [vehicleSummaries]);

  if (authLoading || roleLoading)
    return <div dir="rtl" className="text-center py-16 text-xs text-gray-400">טוען...</div>;

  if (!isAuthenticated)
    return <Empty text="צריך להתחבר." />;

  if (!isBusiness)
    return (
      <Empty
        icon={<Briefcase className="h-10 w-10 text-gray-300" />}
        title="דוחות זמינים בחשבון עסקי"
        text="עבור לחשבון עסקי דרך הסרגל העליון, או צור חשבון חדש."
      />
    );

  if (!canRead)
    return (
      <Empty
        icon={<TrendingUp className="h-10 w-10 text-gray-300" />}
        title="אין הרשאה לדוחות"
        text="צפייה בדוחות שמורה למנהלי החשבון. פנה לבעלים אם נדרשת לך גישה."
      />
    );

  return (
    <div dir="rtl" className="max-w-4xl mx-auto py-2">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">דוחות וניתוחים</h1>
        <p className="text-xs text-gray-500">סקירה כספית ותפעולית של הצי. הנתונים מתעדכנים אוטומטית.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        <SummaryCard
          icon={<Calendar className="h-4 w-4" />}
          label="הוצאות החודש"
          value={fmtMoney(thisMonthTotal)}
          tone="green"
        />
        <SummaryCard
          icon={<Truck className="h-4 w-4" />}
          label="הרכב היקר ביותר"
          value={mostExpensiveVehicle ? fmtMoney(mostExpensiveVehicle.total) : '—'}
          sub={mostExpensiveVehicle ? vehicleLabel(mostExpensiveVehicle.vehicle_id) : 'אין נתונים'}
          tone="orange"
        />
        <SummaryCard
          icon={<Receipt className="h-4 w-4" />}
          label="הוצאות אחרונות"
          value={recentExpenses.length}
          sub={recentExpenses.length === 0 ? 'אין הוצאות עדיין' : 'ראה את הלשונית "סיכום חודשי"'}
          tone="blue"
        />
      </div>

      {/* Filters */}
      <div className="bg-gray-50 rounded-xl p-3 mb-4 flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1 text-[11px] font-bold text-gray-600 mr-1">
          <Filter className="h-3 w-3" /> סינון:
        </div>
        {tab === 'vehicles' && (
          <FilterField label="רכב">
            <select value={filterVehicle} onChange={(e) => setFilterVehicle(e.target.value)} className={selectCls}>
              <option value="">הכל</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{vehicleLabel(v.id)}</option>
              ))}
            </select>
          </FilterField>
        )}
        {tab !== 'vehicles' && (
          <>
            <FilterField label="מתאריך">
              <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className={selectCls} />
            </FilterField>
            <FilterField label="עד">
              <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className={selectCls} />
            </FilterField>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-gray-100">
        <Tab id="vehicles" current={tab} onClick={setTab}>עלויות לפי רכב</Tab>
        <Tab id="monthly"  current={tab} onClick={setTab}>סיכום חודשי</Tab>
        <Tab id="activity" current={tab} onClick={setTab}>פעילות</Tab>
      </div>

      {tab === 'vehicles' && (
        <VehiclesTab
          rows={filteredVehicles}
          loading={vehiclesLoading}
          vehicleLabel={vehicleLabel}
        />
      )}
      {tab === 'monthly' && (
        <MonthlyTab rows={filteredMonthly} loading={monthlyLoading} />
      )}
      {tab === 'activity' && (
        <ActivityTab rows={filteredActivity} loading={activityLoading} />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------

function VehiclesTab({ rows, loading, vehicleLabel }) {
  if (loading) return <p className="text-center text-xs text-gray-400 py-6">טוען נתונים...</p>;
  if (rows.length === 0)
    return <Empty text="עוד אין מספיק נתונים לדוח. הוסף הוצאות דרך מסך &quot;הוצאות&quot;, או רשום עלות לתיקון בכרטיס הרכב." embedded />;

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.vehicle_id} className="bg-white border border-gray-100 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-gray-900 truncate">{vehicleLabel(r.vehicle_id)}</p>
            <span className="text-sm font-bold text-[#2D5233]">{fmtMoney(r.total)}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {['fuel', 'repair', 'insurance', 'other'].map(cat => {
              const meta = CATEGORY[cat];
              const Icon = meta.icon;
              const value = Number(r['by_' + cat] || 0);
              return (
                <div key={cat} className={`rounded-lg p-2 ${meta.cls} ${value === 0 ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <Icon className="h-3 w-3" />
                    <span className="text-[10px] font-bold">{meta.label}</span>
                  </div>
                  <p className="text-[11px] font-bold">{fmtMoney(value)}</p>
                </div>
              );
            })}
          </div>
          {r.last_expense_date && (
            <p className="text-[10px] text-gray-400 mt-2 text-left">
              עדכון אחרון: {fmtDate(r.last_expense_date)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function MonthlyTab({ rows, loading }) {
  if (loading) return <p className="text-center text-xs text-gray-400 py-6">טוען נתונים...</p>;
  if (rows.length === 0)
    return <Empty text="אין הוצאות בטווח התאריכים שנבחר. נסה טווח רחב יותר." embedded />;

  const max = Math.max(...rows.map(r => Number(r.total) || 0));

  return (
    <div className="space-y-2">
      {rows.map(r => {
        const pct = max > 0 ? Math.max(4, (Number(r.total) / max) * 100) : 0;
        return (
          <div key={r.month} className="bg-white border border-gray-100 rounded-xl p-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-bold text-gray-900">{fmtMonth(r.month)}</p>
              <span className="text-sm font-bold text-[#2D5233]">{fmtMoney(r.total)}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#2D5233]" style={{ width: pct + '%' }} />
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">{r.entry_count} רישומים</p>
          </div>
        );
      })}
    </div>
  );
}

function ActivityTab({ rows, loading }) {
  if (loading) return <p className="text-center text-xs text-gray-400 py-6">טוען נתונים...</p>;
  if (rows.length === 0)
    return <Empty text="אין פעילות מסלולים בטווח שנבחר. צור מסלול חדש כדי להתחיל לעקוב." embedded />;

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.month} className="bg-white border border-gray-100 rounded-xl p-3">
          <p className="text-sm font-bold text-gray-900 mb-2">{fmtMonth(r.month)}</p>
          <div className="grid grid-cols-4 gap-1.5">
            <ActivityCell icon={<Truck className="h-3 w-3" />}        value={r.route_count}      label="מסלולים"     cls="bg-blue-50 text-blue-700" />
            <ActivityCell icon={<CheckCircle2 className="h-3 w-3" />} value={r.completed_stops}  label="הושלמו"      cls="bg-green-50 text-green-700" />
            <ActivityCell icon={<AlertTriangle className="h-3 w-3" />} value={r.issue_stops}     label="תקלות"       cls="bg-red-50 text-red-700" />
            <ActivityCell icon={<Calendar className="h-3 w-3" />}     value={r.skipped_stops}    label="דולגו"        cls="bg-yellow-50 text-yellow-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityCell({ icon, value, label, cls }) {
  return (
    <div className={`rounded-lg p-2 ${cls} ${(!value || value === 0) ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-1 mb-0.5">{icon}<span className="text-[10px] font-bold">{label}</span></div>
      <p className="text-sm font-bold">{value || 0}</p>
    </div>
  );
}

function SummaryCard({ icon, label, value, sub, tone }) {
  const toneCls = tone === 'green'  ? 'text-[#2D5233] bg-[#E8F2EA]'
                : tone === 'orange' ? 'text-orange-700 bg-orange-50'
                :                     'text-blue-700 bg-blue-50';
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold mb-2 ${toneCls}`}>
        {icon}{label}
      </div>
      <p className="text-base font-bold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1 truncate">{sub}</p>}
    </div>
  );
}

function Tab({ id, current, onClick, children }) {
  const active = id === current;
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${
        active ? 'border-[#2D5233] text-[#2D5233]' : 'border-transparent text-gray-500'
      }`}
    >
      {children}
    </button>
  );
}

const selectCls = "px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-xs";

function FilterField({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-500 mb-0.5">{label}</label>
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
