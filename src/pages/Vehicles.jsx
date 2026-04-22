import React, { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/shared/PullToRefreshIndicator';
import { Plus, Car, Ship, Bike, Truck, Star, Mountain, Search, SlidersHorizontal, X, CheckCircle, Clock, AlertTriangle, ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { C, getTheme, getVehicleCategory, isOffroadType } from '@/lib/designTokens';
import { isVessel, isOffroad, getVehicleLabels } from '../components/shared/DateStatusUtils';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import PageHeader from '../components/shared/PageHeader';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { ListSkeleton } from '../components/shared/Skeletons';
import { SafeComponent } from '../components/shared/SafeComponent';
import GuestVehicleCard from '../components/dashboard/GuestVehicleCard';
import VehicleCardEnhanced from '../components/vehicles/VehicleCardEnhanced';
import SignUpPromptDialog from '../components/shared/SignUpPromptDialog';
import { useAuth } from '../components/shared/GuestContext';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

//  Helpers 
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getWorstStatus(vehicle) {
  const testD = daysUntil(vehicle.test_due_date);
  const insD = daysUntil(vehicle.insurance_due_date);
  const worst = Math.min(testD ?? 999, insD ?? 999);
  if (worst < 0) return 'overdue';
  if (worst <= 60) return 'soon';
  return 'ok';
}

// "אופנוע שטח" belongs to BOTH motorcycle and offroad categories
const DUAL_CATEGORY_TYPES = {
  'אופנוע שטח': ['motorcycle', 'offroad'],
};

function getCategory(vehicle) {
  // Check for dual-category types first. primary category is the first one
  if (DUAL_CATEGORY_TYPES[vehicle.vehicle_type]) return DUAL_CATEGORY_TYPES[vehicle.vehicle_type][0];
  if (isOffroad(vehicle.vehicle_type)) return 'offroad';
  if (isVessel(vehicle.vehicle_type, vehicle.nickname)) return 'vessel';
  const cat = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  if (cat === 'motorcycle') return 'motorcycle';
  if (cat === 'truck') return 'truck';
  // Check for special types
  if (vehicle.vehicle_type === 'רכב מיוחד' || vehicle.vehicle_type === 'רכב אספנות'
    || vehicle.vehicle_type === 'טרקטור' || vehicle.vehicle_type === 'מלגזה'
    || vehicle.vehicle_type === 'נגרר' || vehicle.vehicle_type === 'קרוואן'
    || vehicle.vehicle_type === 'אוטובוס' || vehicle.vehicle_type === 'רכב צמ"ה'
    || vehicle.vehicle_type === 'מחרשה' || vehicle.vehicle_type === 'רכב תפעולי') return 'special';
  return 'car';
}

function matchesCategory(vehicle, categoryTab) {
  const dualCats = DUAL_CATEGORY_TYPES[vehicle.vehicle_type];
  if (dualCats) return dualCats.includes(categoryTab);
  return getCategory(vehicle) === categoryTab;
}

//  Category Tabs Config 
const CATEGORY_TABS = [
  { key: 'all',        label: 'הכל',       icon: null,     color: C.primary },
  { key: 'car',        label: 'רכבים',     icon: Car,      color: C.primary },
  { key: 'motorcycle', label: 'אופנועים',  icon: Bike,     color: C.primary },
  { key: 'truck',      label: 'משאיות',    icon: Truck,    color: C.primary },
  { key: 'vessel',     label: 'כלי שייט',  icon: Ship,     color: '#0C7B93' },
  { key: 'offroad',    label: 'כלי שטח',   icon: Mountain, color: C.primary },
  { key: 'special',    label: 'מיוחדים',   icon: Star,     color: C.warn },
];

//  Sort Options 
const SORT_OPTIONS = [
  { key: 'name',   label: 'שם' },
  { key: 'status', label: 'סטטוס' },
  { key: 'year',   label: 'שנת ייצור' },
];

const STATUS_ORDER = { overdue: 0, soon: 1, ok: 2 };

//  Status Summary Bar 
function StatusSummaryBar({ counts, activeFilter, onFilter }) {
  const items = [
    { key: null,       label: 'הכל',     count: counts.total,   icon: Car,            color: C.primary, bg: C.light },
    { key: 'ok',       label: 'תקין',    count: counts.ok,      icon: CheckCircle,    color: C.success, bg: C.successBg },
    { key: 'soon',     label: 'בקרוב',   count: counts.soon,    icon: Clock,          color: C.warn,    bg: C.warnBg },
    { key: 'overdue',  label: 'באיחור',  count: counts.overdue, icon: AlertTriangle,  color: C.error,   bg: C.errorBg },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 mb-4" dir="rtl">
      {items.map(item => {
        const active = activeFilter === item.key;
        return (
          <button key={item.key || 'all'} type="button"
            onClick={() => onFilter(active ? undefined : item.key)}
            className="rounded-2xl py-2.5 px-2 flex flex-col items-center gap-1 transition-all active:scale-[0.97]"
            style={{
              background: active ? item.color : item.bg,
              border: `1.5px solid ${active ? item.color : 'transparent'}`,
              boxShadow: active ? `0 4px 12px ${item.color}30` : 'none',
            }}>
            <div className="flex items-center gap-1">
              <span className="font-black text-xl" style={{ color: active ? '#fff' : item.color }}>{item.count}</span>
              <item.icon className="w-4 h-4" style={{ color: active ? '#fff' : item.color }} />
            </div>
            <span className="text-[10px] font-bold" style={{ color: active ? '#fff' : item.color }}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

//  Category Tabs 
function CategoryTabs({ activeTab, onTab, categoryCounts }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-3" dir="rtl"
      style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      {CATEGORY_TABS.map(tab => {
        const count = categoryCounts[tab.key] || 0;
        if (tab.key !== 'all' && count === 0) return null;
        const active = activeTab === tab.key;
        const Icon = tab.icon;
        return (
          <button key={tab.key} type="button"
            onClick={() => onTab(active && tab.key !== 'all' ? 'all' : tab.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-bold whitespace-nowrap shrink-0 transition-all active:scale-[0.97]"
            style={{
              background: active ? tab.color : C.light,
              color: active ? '#fff' : C.muted,
              boxShadow: active ? `0 3px 10px ${tab.color}30` : 'none',
            }}>
            {Icon && <Icon className="w-3.5 h-3.5" />}
            <span>{tab.label}</span>
            <span className="text-[10px] opacity-80">({count})</span>
          </button>
        );
      })}
    </div>
  );
}

//  Search + Filter Row 
function SearchFilterRow({ searchQuery, onSearch, sortBy, onSort, isVessel, theme }) {
  const T = theme || C;
  return (
    <div className="flex items-center gap-2 mb-3" dir="rtl">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: T.muted }} />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearch(e.target.value)}
          placeholder={isVessel ? 'חפש כלי שייט...' : 'חפש רכב...'}
          className="w-full h-10 pr-9 pl-3 rounded-xl border text-sm font-medium outline-none transition-all focus:ring-2"
          style={{
            background: '#fff',
            borderColor: T.border,
            color: T.text,
            '--tw-ring-color': T.primary,
          }}
          dir="rtl"
        />
        {searchQuery && (
          <button onClick={() => onSearch('')}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center hover:bg-gray-100">
            <X className="w-3 h-3" style={{ color: T.muted }} />
          </button>
        )}
      </div>

      {/* Sort */}
      <Select value={sortBy} onValueChange={onSort}>
        <SelectTrigger className="w-[110px] h-10 rounded-xl text-xs font-bold shrink-0"
          style={{ borderColor: T.border, color: T.text }}>
          <ArrowUpDown className="w-3.5 h-3.5 shrink-0" style={{ color: T.muted }} />
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {SORT_OPTIONS.map(opt => (
            <SelectItem key={opt.key} value={opt.key} className="text-sm">{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

//  Skeleton Card 
function SkeletonCard() {
  return (
    <div className="rounded-2xl p-4 mb-3 flex gap-3.5 items-start animate-pulse"
      style={{ background: C.card, border: `1.5px solid ${C.border}` }} dir="rtl">
      <div className="w-20 h-20 rounded-2xl shrink-0" style={{ background: C.light }} />
      <div className="flex-1 space-y-2.5 py-1">
        <div className="h-4 w-3/4 rounded-lg" style={{ background: C.light }} />
        <div className="h-3 w-1/2 rounded-lg" style={{ background: C.light }} />
        <div className="h-3 w-1/3 rounded-lg" style={{ background: C.light }} />
      </div>
    </div>
  );
}

//  Premium Empty State 
function PremiumEmptyState({ hasFilters, onClearFilters, theme, isVessel }) {
  const T = theme || C;
  return (
    <div className="rounded-3xl p-8 relative overflow-hidden" style={{ background: T.light }}>
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full" style={{ background: `${T.primary}08` }} />
      <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full" style={{ background: `${T.yellow}15` }} />
      <div className="relative z-10 text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: T.border }}>
          {isVessel ? <Ship className="w-8 h-8" style={{ color: T.primary, opacity: 0.5 }} /> : <Car className="w-8 h-8" style={{ color: T.primary, opacity: 0.5 }} />}
        </div>
        {hasFilters ? (
          <>
            <h3 className="font-black text-lg mb-2" style={{ color: T.text }}>לא נמצאו תוצאות</h3>
            <p className="text-sm mb-5 max-w-xs mx-auto" style={{ color: T.muted }}>נסה לשנות את החיפוש או הסינון</p>
            <button onClick={onClearFilters}
              className="px-6 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: T.primary, color: '#fff' }}>
              נקה סינון
            </button>
          </>
        ) : (
          <>
            <h3 className="font-black text-lg mb-2" style={{ color: T.text }}>{isVessel ? 'אין כלי שייט עדיין' : 'אין רכבים עדיין'}</h3>
            <p className="text-sm mb-5 max-w-xs mx-auto" style={{ color: T.muted }}>{isVessel ? 'הוסף את כלי השייט הראשון שלך' : 'הוסף את הרכב הראשון שלך וקבל תזכורות לטסט, ביטוח וטיפולים'}</p>
            <Link to={createPageUrl('AddVehicle')}>
              <button className="px-8 py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
                style={{ background: T.yellow, color: T.primary }}>
                {isVessel ? 'הוסף כלי שייט' : 'הוסף רכב'}
                <Plus className="w-4 h-4 inline mr-1.5" />
              </button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

// 
//  Main Component 
// 

function VehiclesContent({ vehicles, isLoading }) {
  //  Filter & sort state 
  const location = useLocation();
  const urlCategory = new URLSearchParams(location.search).get('category');
  const isVesselPage = urlCategory === 'vessel';
  const T = isVesselPage ? getTheme('כלי שייט') : C; // page-level theme

  // Pre-filter: vessel page shows only vessels, regular page shows only non-vessels
  const filteredByPage = useMemo(() => {
    return vehicles.filter(v => {
      const cat = getCategory(v);
      return isVesselPage ? cat === 'vessel' : cat !== 'vessel';
    });
  }, [vehicles, isVesselPage]);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeCategoryTab, setActiveCategoryTab] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  // null | 'overdue' | 'soon'. driven by the two clickable badges above the list.
  const [statusFilter, setStatusFilter] = useState(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  //  Computed: status & category per vehicle 
  const vehicleMeta = useMemo(() => {
    return filteredByPage.map(v => ({
      vehicle: v,
      status: getWorstStatus(v),
      category: getCategory(v),
    }));
  }, [filteredByPage]);

  //  Counts 
  const statusCounts = useMemo(() => {
    const c = { total: filteredByPage.length, ok: 0, soon: 0, overdue: 0 };
    vehicleMeta.forEach(m => { if (c[m.status] !== undefined) c[m.status]++; });
    return c;
  }, [vehicleMeta, filteredByPage.length]);

  const categoryCounts = useMemo(() => {
    const c = { all: filteredByPage.length, car: 0, motorcycle: 0, truck: 0, vessel: 0, offroad: 0, special: 0 };
    vehicleMeta.forEach(m => {
      // Dual-category types count in all their categories
      const dualCats = DUAL_CATEGORY_TYPES[m.vehicle.vehicle_type];
      if (dualCats) {
        dualCats.forEach(cat => { if (c[cat] !== undefined) c[cat]++; });
      } else {
        if (c[m.category] !== undefined) c[m.category]++; else c.car++;
      }
    });
    return c;
  }, [vehicleMeta, filteredByPage.length]);

  //  Filtering pipeline 
  const filteredVehicles = useMemo(() => {
    let result = [...vehicleMeta];

    // Status filter (overdue / soon). clicked from the quick-status row.
    if (statusFilter) {
      result = result.filter(m => m.status === statusFilter);
    }

    // Category filter (dual-category types like "אופנוע שטח" appear in multiple tabs)
    if (activeCategoryTab !== 'all') {
      result = result.filter(m => matchesCategory(m.vehicle, activeCategoryTab));
    }

    // Search
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter(m => {
        const v = m.vehicle;
        const haystack = [v.nickname, v.manufacturer, v.model, v.year, v.license_plate].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    // Sort
    result.sort((a, b) => {
      const va = a.vehicle, vb = b.vehicle;
      switch (sortBy) {
        case 'status':
          return (STATUS_ORDER[a.status] ?? 2) - (STATUS_ORDER[b.status] ?? 2);
        case 'year':
          return (Number(vb.year) || 0) - (Number(va.year) || 0);
        case 'name':
        default:
          const nameA = va.nickname || va.manufacturer || '';
          const nameB = vb.nickname || vb.manufacturer || '';
          return nameA.localeCompare(nameB, 'he');
      }
    });

    return result.map(m => m.vehicle);
  }, [vehicleMeta, activeCategoryTab, debouncedSearch, sortBy, statusFilter]);

  const hasActiveFilters = activeCategoryTab !== 'all' || debouncedSearch.trim() || !!statusFilter;

  const clearAllFilters = () => {
    setSearchQuery('');
    setDebouncedSearch('');
    setActiveCategoryTab('all');
    setStatusFilter(null);
  };

  //  Loading 
  if (isLoading) {
    return (
      <div dir="rtl">
        <PageHeader title={isVesselPage ? 'כלי שייט' : 'רכבים'} subtitle="טוען..." gradient={T.grad} />
        <ListSkeleton count={4} variant="vehicle" />
      </div>
    );
  }

  //  Render 
  return (
    <div dir="rtl" style={{ maxWidth: '100vw', overflowX: 'hidden' }}>
      <PageHeader
        title={isVesselPage ? 'כלי שייט' : 'רכבים'}
        subtitle={`${filteredByPage.length} ${isVesselPage ? 'כלי שייט' : 'כלי רכב'}`}
        gradient={T.grad}
        actions={
          <Link to={createPageUrl('AddVehicle')}>
            <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: isVesselPage ? '#fff' : C.yellow, color: isVesselPage ? T.primary : C.greenDark, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {isVesselPage ? 'כלי שייט חדש' : 'רכב חדש'}
              <Plus className="h-4 w-4" />
            </button>
          </Link>
        }
      />

      {/* Demo banner */}
      {filteredByPage.some(v => v._isDemo) && (
        <div className="rounded-2xl p-3.5 mb-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }} dir="rtl">
          <span className="text-lg">👀</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black" style={{ color: '#92400E' }}>{isVesselPage ? 'כלי שייט לדוגמה' : 'רכבים לדוגמה'}</p>
            <p className="text-xs" style={{ color: '#B45309' }}>הוסף את הרכב האמיתי שלך כדי להתחיל</p>
          </div>
        </div>
      )}

      {filteredByPage.length === 0 ? (
        <PremiumEmptyState hasFilters={false} theme={T} isVessel={isVesselPage} />
      ) : (
        <>
          {/* Quick status line. both badges are clickable and toggle a
              filter on the vehicle list (same UX as the dashboard). */}
          {(statusCounts.overdue > 0 || statusCounts.soon > 0) && (
            <div className="flex items-center gap-2 mb-3 px-1 flex-wrap" dir="rtl">
              {statusCounts.overdue > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilter(f => f === 'overdue' ? null : 'overdue')}
                  className="text-xs font-bold flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors"
                  style={{
                    color: C.error,
                    background: statusFilter === 'overdue' ? C.errorBg : 'transparent',
                    border: `1px solid ${statusFilter === 'overdue' ? C.error : 'transparent'}`,
                  }}>
                  <AlertTriangle className="w-3.5 h-3.5" /> {statusCounts.overdue} באיחור
                </button>
              )}
              {statusCounts.soon > 0 && (
                <button
                  type="button"
                  onClick={() => setStatusFilter(f => f === 'soon' ? null : 'soon')}
                  className="text-xs font-bold flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors"
                  style={{
                    color: C.warn,
                    background: statusFilter === 'soon' ? C.warnBg : 'transparent',
                    border: `1px solid ${statusFilter === 'soon' ? C.warn : 'transparent'}`,
                  }}>
                  <Clock className="w-3.5 h-3.5" /> {statusCounts.soon} בקרוב
                </button>
              )}
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setStatusFilter(null)}
                  className="text-[11px] text-gray-500 underline mr-auto">
                  נקה סינון
                </button>
              )}
            </div>
          )}

          {/* Category Tabs - hide on vessel page (only one category) */}
          {!isVesselPage && Object.values(categoryCounts).filter(c => c > 0).length > 2 && (
            <CategoryTabs activeTab={activeCategoryTab} onTab={setActiveCategoryTab} categoryCounts={categoryCounts} />
          )}

          {/* Search + Sort */}
          <SearchFilterRow
            searchQuery={searchQuery}
            onSearch={setSearchQuery}
            sortBy={sortBy}
            onSort={setSortBy}
            isVessel={isVesselPage}
            theme={T}
          />

          {/* Result count */}
          {hasActiveFilters && (
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium" style={{ color: C.muted }}>
                מציג {filteredVehicles.length} מתוך {filteredByPage.length}
              </p>
              <button onClick={clearAllFilters}
                className="text-xs font-bold flex items-center gap-1 px-2 py-1 rounded-lg transition-all hover:bg-gray-100"
                style={{ color: C.error }}>
                <X className="w-3 h-3" />
                נקה הכל
              </button>
            </div>
          )}

          {/* Vehicle list */}
          {filteredVehicles.length === 0 ? (
            <PremiumEmptyState hasFilters={true} onClearFilters={clearAllFilters} theme={T} isVessel={isVesselPage} />
          ) : (
            <div>
              {filteredVehicles.map(v => (
                <VehicleCardEnhanced key={v.id} vehicle={v} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 
//  Page Export (handles auth/guest routing) 
// 

export default function Vehicles() {
  const auth = useAuth();
  if (!auth) return <LoadingSpinner />;
  const { isAuthenticated, isGuest, isLoading: authLoading, user, guestVehicles } = auth;
  const [accountId, setAccountId] = useState(null);
  const [showSignUp, setShowSignUp] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function init() {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length > 0) setAccountId(members[0].account_id);
    }
    init();
  }, [isAuthenticated, user]);

  const queryClient = useQueryClient();
  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
    refetchOnMount: 'always',
    staleTime: 2 * 60 * 1000, // 2 minutes cache
  });

  // Pull-to-refresh. re-fetches the vehicles list.
  const { pulling, progress } = usePullToRefresh(async () => {
    await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    await new Promise(r => setTimeout(r, 500));
  });

  if (authLoading) return <LoadingSpinner />;

  //  Guest mode 
  if (isGuest) {
    return (
      <div dir="rtl">
        <PullToRefreshIndicator pulling={pulling} progress={progress} />
        <SignUpPromptDialog open={showSignUp} onClose={() => setShowSignUp(false)} reason="הירשם כדי לשמור רכבים לצמיתות" />
        <VehiclesContent vehicles={guestVehicles} isLoading={false} />
      </div>
    );
  }

  //  Authenticated mode 
  return (
    <>
      <PullToRefreshIndicator pulling={pulling} progress={progress} />
      <VehiclesContent vehicles={vehicles} isLoading={!accountId || isLoading} />
    </>
  );
}
