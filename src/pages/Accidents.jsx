import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { useQuery } from '@tanstack/react-query';
import { Plus, AlertTriangle, ChevronLeft, Camera, Phone, Calendar, MapPin, Car, CheckCircle, Clock, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import { useAuth } from '../components/shared/GuestContext';
import { C, getTheme } from '@/lib/designTokens';
import { isVessel, getVehicleLabels } from '../components/shared/DateStatusUtils';
import { DEMO_ACCIDENTS, DEMO_VEHICLE } from '../components/shared/demoVehicleData';
import { format, parseISO } from 'date-fns';

function fmtDate(dateStr) {
  if (!dateStr) return '';
  try { return format(parseISO(dateStr), 'dd.MM.yyyy'); } catch { return dateStr; }
}

const STATUS_MAP = {
  'פתוח':   { bg: '#FEF2F2', color: '#DC2626', gradBg: '#991B1B', icon: AlertTriangle, label: 'פתוח' },
  'בטיפול': { bg: '#FEF3C7', color: '#92400E', gradBg: '#92400E', icon: Clock,         label: 'בטיפול' },
  'סגור':   { bg: '#E8F5E9', color: '#2E7D32', gradBg: '#2E7D32', icon: CheckCircle,   label: 'סגור' },
};

// ── Status Summary Cards ────────────────────────────────────────────────────
function StatusSummary({ accidents }) {
  const counts = { 'פתוח': 0, 'בטיפול': 0, 'סגור': 0 };
  accidents.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });

  const items = [
    { key: 'פתוח',   label: 'פתוחות',  count: counts['פתוח'],   color: '#DC2626', bg: '#FEF2F2', icon: AlertTriangle },
    { key: 'בטיפול', label: 'בטיפול',  count: counts['בטיפול'], color: '#D97706', bg: '#FEF3C7', icon: Clock },
    { key: 'סגור',   label: 'סגורות',  count: counts['סגור'],   color: '#2E7D32', bg: '#E8F5E9', icon: CheckCircle },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5 mb-5" dir="rtl">
      {items.map(item => (
        <div key={item.key} className="rounded-2xl py-3 px-2 flex flex-col items-center gap-1.5"
          style={{ background: item.bg }}>
          <div className="flex items-center gap-1.5">
            <span className="font-black text-2xl" style={{ color: item.color }}>{item.count}</span>
            <item.icon className="w-5 h-5" style={{ color: item.color }} />
          </div>
          <span className="text-xs font-bold" style={{ color: item.color }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Accident Card (premium) ─────────────────────────────────────────────────
function AccidentRow({ accident, vehicleName, vehicle }) {
  const status = STATUS_MAP[accident.status] || STATUS_MAP['פתוח'];
  const hasPhotos = accident.photos?.length > 0;
  const StatusIcon = status.icon;
  const T = getTheme(vehicle?.vehicle_type, vehicle?.nickname, vehicle?.manufacturer);
  const labels = getVehicleLabels(vehicle?.vehicle_type, vehicle?.nickname);

  return (
    <Link to={`${createPageUrl('AddAccident')}?id=${accident.id}`}>
      <div className="rounded-2xl overflow-hidden mb-3 transition-all active:scale-[0.99]"
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          boxShadow: `0 4px 20px ${T.primary}12`,
        }}
        dir="rtl">

        {/* Top section with photo or gradient */}
        {hasPhotos ? (
          <div className="relative h-36 overflow-hidden">
            <img src={accident.photos[0]} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            <div className="absolute inset-0" style={{
              background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 60%, transparent 100%)'
            }} />
            {/* Status badge on photo */}
            <div className="absolute top-3 left-3 z-10">
              <span className="text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1"
                style={{ background: `${status.bg}ee`, color: status.color }}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            </div>
            {/* Photo count */}
            {accident.photos.length > 1 && (
              <div className="absolute top-3 right-3 z-10">
                <span className="text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-sm flex items-center gap-1"
                  style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>
                  <Camera className="w-3 h-3" />
                  {accident.photos.length}
                </span>
              </div>
            )}
            {/* Vehicle + driver on photo */}
            <div className="absolute bottom-3 right-3 left-3 z-10">
              <h3 className="font-black text-white text-base leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                {vehicleName || labels.vehicleFallback}
                {accident.other_driver_name && ` - ${accident.other_driver_name}`}
              </h3>
            </div>
          </div>
        ) : (
          /* No photo: compact gradient header */
          <div className="relative px-4 pt-4 pb-3 overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${status.bg} 0%, ${T.card} 100%)` }}>
            <div className="absolute -top-6 -left-6 w-20 h-20 rounded-full"
              style={{ background: `${status.color}08` }} />
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm truncate" style={{ color: T.text }}>
                  {vehicleName || labels.vehicleFallback}
                  {accident.other_driver_name && ` - ${accident.other_driver_name}`}
                </h3>
              </div>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1 shrink-0 mr-2"
                style={{ background: status.bg, color: status.color }}>
                <StatusIcon className="w-3 h-3" />
                {status.label}
              </span>
            </div>
          </div>
        )}

        {/* Details section */}
        <div className="px-4 py-3">
          {/* Date + Location row */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-xs font-medium" style={{ color: T.muted }}>
              <Calendar className="w-3.5 h-3.5" />
              {fmtDate(accident.date)}
            </span>
            {accident.location && (
              <span className="flex items-center gap-1 text-xs truncate" style={{ color: T.muted }}>
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{accident.location}</span>
              </span>
            )}
          </div>

          {/* Tags row */}
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {accident.other_driver_plate && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1"
                style={{ background: T.light, color: T.primary, border: `1px solid ${T.border}` }}
                dir="ltr">
                <Car className="w-3 h-3" />
                {accident.other_driver_plate}
              </span>
            )}
            {accident.other_driver_insurance_company && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1"
                style={{ background: '#EDE9FE', color: '#6D28D9' }}>
                <Shield className="w-3 h-3" />
                {accident.other_driver_insurance_company}
              </span>
            )}
            {accident.other_driver_phone && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-lg flex items-center gap-1"
                style={{ background: '#E0F2FE', color: '#0369A1' }}>
                <Phone className="w-3 h-3" />
                קשר
              </span>
            )}
            {!hasPhotos && accident.photos?.length === 0 && null}
            {!hasPhotos && (
              <span className="flex items-center gap-1 text-xs" style={{ color: T.muted }}>
                <Camera className="w-3 h-3" style={{ opacity: 0.4 }} />
                ללא תמונות
              </span>
            )}
          </div>
        </div>

        {/* Bottom arrow hint */}
        <div className="px-4 pb-3 flex justify-start">
          <span className="text-xs font-medium flex items-center gap-1" style={{ color: T.muted }}>
            <ChevronLeft className="w-3.5 h-3.5" />
            לחץ לפרטים
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── Empty State (premium) ───────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="text-center py-12" dir="rtl">
      <div className="rounded-3xl p-8 relative overflow-hidden"
        style={{ background: '#FEF2F2' }}>
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full"
          style={{ background: 'rgba(220,38,38,0.05)' }} />
        <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full"
          style={{ background: 'rgba(220,38,38,0.03)' }} />

        <div className="relative z-10">
          <div className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center"
            style={{ background: '#FECACA' }}>
            <AlertTriangle className="w-10 h-10" style={{ color: '#DC2626' }} />
          </div>
          <h3 className="font-black text-xl mb-2" style={{ color: C.text }}>אין תאונות רשומות</h3>
          <p className="text-sm mb-6 max-w-xs mx-auto leading-relaxed" style={{ color: C.muted }}>
            תיעוד תאונות עוזר לעקוב אחר פרטי הנזק, הנהג השני והביטוח
          </p>
          <Link to={createPageUrl('AddAccident')}>
            <button className="px-8 py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{
                background: C.yellow,
                color: C.greenDark,
                boxShadow: '0 4px 16px rgba(255,191,0,0.3)',
              }}>
              תעד תאונה ראשונה
              <Plus className="w-4 h-4 inline mr-1" />
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function Accidents() {
  const { isAuthenticated, isGuest, isLoading, user, guestVehicles, guestAccidents } = useAuth();
  const [accountId, setAccountId] = useState(null);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function init() {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length > 0) setAccountId(members[0].account_id);
    }
    init();
  }, [isAuthenticated, user]);

  const { data: accidents = [], isLoading: accidentsLoading } = useQuery({
    queryKey: ['accidents', accountId],
    queryFn: () => db.accidents.filter({ account_id: accountId }),
    enabled: !!accountId,
    staleTime: 0,
  });

  const { data: authVehicles = [] } = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
  });

  if (isLoading) return <LoadingSpinner />;

  const hasGuestAccidents = (guestAccidents || []).length > 0;
  const allAccidents = isGuest ? (hasGuestAccidents ? guestAccidents : DEMO_ACCIDENTS) : accidents;
  const allVehicles = isGuest ? [...guestVehicles, DEMO_VEHICLE] : authVehicles;
  const sortedAccidents = [...allAccidents].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const getVehicle = (vehicleId) => allVehicles.find(v => v.id === vehicleId);
  const getVehicleName = (vehicleId) => {
    const v = getVehicle(vehicleId);
    if (!v) return '';
    const labels = getVehicleLabels(v.vehicle_type, v.nickname);
    return v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || labels.vehicleFallback;
  };

  const loading = isAuthenticated && accidentsLoading;

  return (
    <div dir="rtl">
      {/* Header with gradient banner */}
      <div className="rounded-3xl p-5 mb-5 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #991B1B 0%, #DC2626 100%)', boxShadow: '0 8px 32px rgba(153,27,27,0.25)' }}>
        {/* Decorative circles */}
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full" style={{ background: 'rgba(255,191,0,0.15)' }} />

        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.2)' }}>
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-black text-white">תאונות</h1>
                  <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {sortedAccidents.length} {sortedAccidents.length === 1 ? 'תאונה' : 'תאונות'}
                    {isGuest ? ' (זמני)' : ''}
                  </p>
                </div>
              </div>
            </div>
            <Link to={createPageUrl('AddAccident')}>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
                style={{ background: C.yellow, color: '#991B1B', boxShadow: '0 4px 12px rgba(255,191,0,0.3)' }}>
                חדשה
                <Plus className="h-4 w-4" />
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Demo banner */}
      {isGuest && !hasGuestAccidents && sortedAccidents.length > 0 && (
        <div className="rounded-2xl p-3 mb-4 flex items-center gap-2 text-xs font-medium"
          style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}
          dir="rtl">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>תאונות לדוגמה - הוסף את כלי הרכב שלך כדי לתעד תאונות אמיתיות</span>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingSpinner />
      ) : sortedAccidents.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Status summary */}
          <StatusSummary accidents={sortedAccidents} />

          {/* Accident cards */}
          <div>
            {sortedAccidents.map(accident => (
              <AccidentRow
                key={accident.id}
                accident={accident}
                vehicle={getVehicle(accident.vehicle_id)}
                vehicleName={getVehicleName(accident.vehicle_id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
