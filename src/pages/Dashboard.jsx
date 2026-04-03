import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { isSafeFileUrl } from '@/lib/securityUtils';
import { useQuery } from '@tanstack/react-query';
import { Plus, Car, FileText, User, Home, ChevronLeft, Bell, Calendar, Shield, Wrench, AlertTriangle, Clock, CheckCircle, Ship, Bike, Truck } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import SignUpPromptDialog from "../components/shared/SignUpPromptDialog";
import { useAuth } from "../components/shared/GuestContext";
import { toast } from "sonner";
import { daysUntil } from "../components/shared/ReminderEngine";
import { DEMO_VEHICLE, DEMO_VESSEL, DEMO_REMINDERS, DEMO_CORK_NOTES, DEMO_VESSEL_CORK_NOTES, DEMO_VESSEL_ISSUES } from "../components/shared/demoVehicleData";
import { format, parseISO } from 'date-fns';
import { C, getTheme, isVesselType, getVehicleCategory } from '@/lib/designTokens';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };
function getVehicleIcon(vt, nn, mfr) { return ICON_MAP[getVehicleCategory(vt, nn, mfr)] || Car; }
import { he } from 'date-fns/locale';

// ── Helper: format date nicely ──────────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '';
  try { return format(parseISO(dateStr), 'dd.MM.yyyy'); } catch { return dateStr; }
}

function daysLabel(days) {
  if (days === null) return '';
  if (days < 0) return `פג תוקף`;
  if (days === 0) return 'היום';
  if (days < 30) return `בעוד ${days} ימים`;
  const months = Math.round(days / 30);
  return `בעוד ${months} ${months === 1 ? 'חודש' : 'חודשים'}`;
}

// ── Urgent Banner ───────────────────────────────────────────────────────────
function UrgentBanner({ reminders, vehicles }) {
  const allReminders = reminders || [];
  const urgent = allReminders
    .map(r => ({ ...r, days: daysUntil(r.date) }))
    .filter(r => r.days !== null && r.days <= 180)
    .sort((a, b) => a.days - b.days)[0];

  if (!urgent) return null;

  const urgentVehicle = vehicles?.find(v => v.id === urgent.vehicle_id);
  const isUrgentVessel = isVesselType(urgentVehicle?.vehicle_type, urgentVehicle?.nickname);
  const typeLabel = {
    insurance: isUrgentVessel ? 'חידוש ביטוח ימי' : 'חידוש ביטוח',
    test:      isUrgentVessel ? 'כושר שייט' : 'טסט רכב',
    maintenance: 'טיפול תקופתי',
  }[urgent.type] || urgent.title;
  const vehicleName = urgentVehicle?.nickname || urgentVehicle?.manufacturer || '';
  const T = getTheme(urgentVehicle?.vehicle_type, urgentVehicle?.nickname, urgentVehicle?.manufacturer);

  return (
    <div className="rounded-3xl p-5 mb-6 relative overflow-hidden"
      style={{ background: T.grad, boxShadow: `0 8px 32px ${T.primary}40` }}>
      {/* Decorative circles */}
      <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full" style={{ background: `${T.yellow}20` }} />

      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold px-3 py-1 rounded-full"
            style={{ background: T.yellow, color: T.primary }}>
            ⚠️ התראה דחופה
          </span>
        </div>
        <h2 className="font-black text-[1.5rem] sm:text-2xl mb-1.5 leading-tight text-white" dir="rtl">
          {typeLabel} קרב
        </h2>
        {vehicleName && (
          <p className="text-base font-semibold mb-5" style={{ color: 'rgba(255,255,255,0.85)' }} dir="rtl">
            {vehicleName} &bull; {daysLabel(urgent.days)}
          </p>
        )}
        <Link to={createPageUrl('Notifications')}>
          <button className="w-full py-3.5 rounded-2xl font-bold text-base transition-all active:scale-[0.98]"
            style={{ background: T.yellow, color: T.primary }}>
            צפה בתזכורות
          </button>
        </Link>
      </div>
    </div>
  );
}

// ── Hero Vehicle Card (premium design — photo background) ──────────────────
function VehicleCard({ vehicle, isDemo }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);

  const testDays    = daysUntil(vehicle.test_due_date);
  const insDays     = daysUntil(vehicle.insurance_due_date);
  const needsAction = (testDays !== null && testDays <= 60) || (insDays !== null && insDays <= 60);

  const statusBadge = needsAction
    ? { label: 'תחזוקה נדרשת', bg: T.yellow, color: T.primary }
    : { label: 'תקין', bg: T.successBg, color: T.success };

  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || (isVessel ? 'כלי שייט' : 'רכב');
  const make = vehicle.manufacturer || '';
  const model = vehicle.model || '';
  const detailUrl = isDemo
    ? createPageUrl('DemoVehicleDetail')
    : `${createPageUrl('VehicleDetail')}?id=${vehicle.id}`;

  const hasPhoto = !!vehicle.vehicle_photo;

  return (
    <Link to={detailUrl}>
      <div className="rounded-3xl overflow-hidden mb-5"
        style={{ boxShadow: `0 8px 32px ${T.primary}25` }}>

        {/* Hero image section */}
        <div className="relative" style={{ height: '220px' }}>
          {/* Background */}
          {hasPhoto ? (
            <img src={vehicle.vehicle_photo} alt={name}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: '50% 55%' }} />
          ) : (
            <div className="absolute inset-0" style={{ background: T.grad }} />
          )}

          {/* Dark gradient overlay */}
          <div className="absolute inset-0" style={{
            background: hasPhoto
              ? 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.1) 100%)'
              : 'none'
          }} />

          {/* Status badge */}
          <div className="absolute top-4 right-4 z-10">
            <span className="text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm"
              style={{ background: statusBadge.bg, color: statusBadge.color }}>
              {statusBadge.label}
            </span>
          </div>

          {/* Demo badge */}
          {isDemo && (
            <div className="absolute top-4 left-4 z-10">
              <span className="text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-sm"
                style={{ background: 'rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.9)' }}>
                לדוגמה
              </span>
            </div>
          )}

          {/* Vehicle name on image */}
          <div className="absolute bottom-4 right-4 left-4 z-10" dir="rtl">
            <h3 className="font-black text-white leading-tight" style={{ fontSize: '1.75rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
              {name}
            </h3>
            <p className="text-base mt-1 font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {[make, model, vehicle.year].filter(Boolean).join(' · ')}
            </p>
          </div>

          {/* Vehicle icon for no-photo */}
          {!hasPhoto && (
            <div className="absolute inset-0 flex items-center justify-center">
              <VehicleIcon className="w-20 h-20" style={{ color: 'rgba(255,255,255,0.15)' }} />
            </div>
          )}
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3" style={{ background: T.card }} dir="rtl">
          {[
            { label: isVessel ? 'שעות מנוע' : 'קילומטראז\'', value: isVessel ? (vehicle.current_engine_hours ? Number(vehicle.current_engine_hours).toLocaleString() : '—') : (vehicle.current_km ? Number(vehicle.current_km).toLocaleString() : '—') },
            { label: 'שנת יצור', value: vehicle.year || '—' },
            { label: isVessel ? 'כושר שייט' : 'טיפול הבא', value: testDays !== null ? daysLabel(testDays) : '—' },
          ].map((stat, i) => (
            <div key={i} className={`py-4 px-3 text-center ${i < 2 ? 'border-l' : ''}`}
              style={{ borderColor: T.border }}>
              <p className="font-black text-base sm:text-lg" style={{ color: T.text }}>{stat.value}</p>
              <p className="text-sm mt-1 font-bold" style={{ color: T.muted }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── Info Tile (premium) ─────────────────────────────────────────────────────
function InfoTile({ icon: Icon, label, value, status }) {
  const isOk = status === 'ok';
  const isWarn = status === 'warn';
  const bg = isOk ? C.greenDark : isWarn ? '#92400E' : '#991B1B';
  const lightBg = isOk ? '#E8F5E9' : isWarn ? '#FEF3C7' : '#FEF2F2';
  const color = isOk ? '#fff' : '#fff';

  return (
    <div className="flex-1 rounded-3xl p-4 flex flex-col gap-3 relative overflow-hidden"
      style={{ background: bg, boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
      <div className="absolute -top-6 -left-6 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.2)' }}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div dir="rtl" className="relative z-10">
        <p className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>{label}</p>
        <p className="font-black text-lg mt-1 text-white">{value}</p>
      </div>
    </div>
  );
}

// ── Reminder Row (premium) ──────────────────────────────────────────────────
function ReminderRow({ reminder }) {
  const days = daysUntil(reminder.date);
  const urgency = days !== null && days < 0 ? 'danger' : days !== null && days <= 14 ? 'warn' : 'ok';
  const urgencyColor = { ok: '#3A7D44', warn: '#D97706', danger: '#DC2626' }[urgency];
  const urgencyBg    = { ok: '#E8F5E9', warn: '#FEF3C7', danger: '#FEF2F2' }[urgency];
  const icons = { insurance: Shield, test: Calendar, maintenance: Wrench };
  const Icon = icons[reminder.type] || Bell;

  return (
    <div className="flex items-center gap-3 p-3 mb-2 rounded-2xl transition-all"
      style={{ background: urgencyBg }} dir="rtl">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
        style={{ background: urgencyColor, boxShadow: `0 4px 12px ${urgencyColor}40` }}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-base" style={{ color: C.text }}>{reminder.title}</p>
        <p className="text-sm mt-0.5 font-bold" style={{ color: urgencyColor }}>{daysLabel(days)}</p>
      </div>
      <div className="text-left shrink-0">
        <p className="font-bold text-base" style={{ color: C.text }}>{fmtDate(reminder.date)}</p>
      </div>
    </div>
  );
}

// ── Status Summary (authenticated multi-vehicle) ───────────────────────────
function StatusSummary({ vehicles }) {
  let ok = 0, soon = 0, overdue = 0;
  vehicles.forEach(v => {
    const testD = daysUntil(v.test_due_date);
    const insD  = daysUntil(v.insurance_due_date);
    const worst = Math.min(
      testD !== null ? testD : 999,
      insD  !== null ? insD  : 999
    );
    if (worst < 0) overdue++;
    else if (worst <= 60) soon++;
    else ok++;
  });

  const items = [
    { label: 'תקין',   count: ok,      icon: CheckCircle,   color: '#3A7D44', bg: '#E8F5E9' },
    { label: 'בקרוב',  count: soon,    icon: Clock,         color: '#D97706', bg: '#FEF3C7' },
    { label: 'באיחור', count: overdue, icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2' },
  ];

  return (
    <div className="grid grid-cols-3 gap-2.5 mb-5" dir="rtl">
      {items.map(item => (
        <div key={item.label} className="rounded-2xl py-3 px-2 flex flex-col items-center gap-1.5"
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

// ── Compact Vehicle Row (for multi-vehicle authenticated view) ─────────────
function VehicleRow({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);

  const testDays = daysUntil(vehicle.test_due_date);
  const insDays  = daysUntil(vehicle.insurance_due_date);
  const worstDays = Math.min(
    testDays !== null ? testDays : 999,
    insDays  !== null ? insDays  : 999
  );
  const isOverdue = worstDays < 0;
  const isSoon    = worstDays >= 0 && worstDays <= 60;

  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || (isVessel ? 'כלי שייט' : 'רכב');
  const subtitle = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ');

  // Status badges
  const badges = [];
  if (testDays !== null) {
    const tStatus = testDays < 0 ? 'overdue' : testDays <= 30 ? 'soon' : 'ok';
    badges.push({ label: isVessel ? 'כושר שייט' : 'טסט', date: fmtDate(vehicle.test_due_date), status: tStatus });
  }
  if (insDays !== null) {
    const iStatus = insDays < 0 ? 'overdue' : insDays <= 30 ? 'soon' : 'ok';
    badges.push({ label: isVessel ? 'ביטוח ימי' : 'ביטוח', date: fmtDate(vehicle.insurance_due_date), status: iStatus });
  }

  const badgeStyles = {
    ok:      { bg: T.successBg, color: T.success, text: 'תקין' },
    soon:    { bg: T.warnBg,    color: T.warn,    text: 'בקרוב' },
    overdue: { bg: T.errorBg,   color: T.error,   text: 'באיחור' },
  };

  return (
    <Link to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}>
      <div className="rounded-2xl p-3 mb-3 flex gap-3 items-center transition-all active:scale-[0.99]"
        style={{
          background: T.card,
          border: `1px solid ${isOverdue ? '#FECACA' : isSoon ? '#FDE68A' : T.border}`,
          boxShadow: `0 2px 12px ${T.primary}10`,
        }}
        dir="rtl">

        {/* Vehicle thumbnail */}
        <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0"
          style={{ background: T.light }}>
          {vehicle.vehicle_photo ? (
            <img src={vehicle.vehicle_photo} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <VehicleIcon className="w-7 h-7" style={{ color: T.accent, opacity: 0.6 }} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-base truncate" style={{ color: T.text }}>{name}</h3>
          <p className="text-sm mt-0.5 truncate font-medium" style={{ color: T.muted }}>{subtitle}</p>
          {isVessel ? (
            vehicle.current_engine_hours && (
              <p className="text-xs mt-0.5" style={{ color: T.muted }}>
                {Number(vehicle.current_engine_hours).toLocaleString()} שעות מנוע
              </p>
            )
          ) : (
            vehicle.current_km && (
              <p className="text-xs mt-0.5" style={{ color: T.muted }}>
                {Number(vehicle.current_km).toLocaleString()} ק"מ
              </p>
            )
          )}
        </div>

        {/* Status badges */}
        <div className="flex flex-col gap-1 shrink-0">
          {badges.map(b => {
            const s = badgeStyles[b.status];
            return (
              <span key={b.label} className="text-xs font-bold px-2 py-1 rounded-lg text-center whitespace-nowrap"
                style={{ background: s.bg, color: s.color }}>
                {b.label}: {s.text}
              </span>
            );
          })}
        </div>

        <ChevronLeft className="w-4 h-4 shrink-0" style={{ color: T.muted }} />
      </div>
    </Link>
  );
}

// BottomNav moved to Layout — shared across all pages

// ── Main Dashboard ──────────────────────────────────────────────────────────
import useNotificationScheduler from '@/hooks/useNotificationScheduler';

export default function Dashboard() {
  const { isAuthenticated, isGuest, isLoading, user, guestVehicles, getStoredGuestVehicles,
    getStoredGuestDocuments, getStoredGuestReminderSettings, clearGuestData, isDemoDismissed } = useAuth();
  const [accountId, setAccountId] = useState(null);
  const [filteredVehicles, setFilteredVehicles] = useState(null);
  const [showSignUp, setShowSignUp] = useState(false);
  const navigate = useNavigate();

  // Schedule device notifications for authenticated users
  const { unreadCount } = useNotificationScheduler(filteredVehicles || [], accountId);

  // ── Authenticated init (Supabase) ────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function init() {
      try {
        // Find existing account membership
        let members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
        let finalAccountId;
        if (members.length > 0) {
          finalAccountId = members[0].account_id;
        } else {
          // Create account + membership for new user
          const account = await db.accounts.create({
            name: `החשבון של ${user.full_name || 'המשתמש'}`,
            owner_user_id: user.id,
          });
          await db.account_members.create({
            account_id: account.id, user_id: user.id, role: 'בעלים',
            status: 'פעיל',
          });
          finalAccountId = account.id;
        }
        setAccountId(finalAccountId);

        // Guest → authenticated migration
        const sanitizeStr = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
        const sanitizeNum = (v, min = 0, max = 9999999) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined; };
        const sanitizeDateStr = (v) => { if (typeof v !== 'string') return undefined; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };
        const storedVehicles = getStoredGuestVehicles();
        if (storedVehicles.length > 0 && finalAccountId) {
          for (const gv of storedVehicles.slice(0, 20)) {
            await db.vehicles.create({
              account_id: finalAccountId,
              manufacturer: sanitizeStr(gv.manufacturer, 60),
              model: sanitizeStr(gv.model, 60),
              year: sanitizeNum(gv.year, 1900, 2030),
              nickname: sanitizeStr(gv.nickname, 60),
              license_plate: sanitizeStr(gv.license_plate, 20),
              current_km: sanitizeNum(gv.current_km, 0, 9999999),
              test_due_date: sanitizeDateStr(gv.test_due_date),
              insurance_due_date: sanitizeDateStr(gv.insurance_due_date),
              ...(isSafeFileUrl(gv.vehicle_photo) ? { vehicle_photo: gv.vehicle_photo } : {}),
            });
          }
          clearGuestData();
          toast.success(`${storedVehicles.length} רכבים הועברו לחשבון שלך בהצלחה!`);
        }
      } catch (err) {
        console.error('Dashboard init error:', err);
      }
    }
    init();
  }, [isAuthenticated, user]);

  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <LoadingSpinner />;

  // ── GUEST MODE ─────────────────────────────────────────────────────────────
  if (isGuest) {
    // Seed demo data on first visit (synchronous — no useEffect needed)
    if (guestVehicles.length === 0 && !isDemoDismissed) {
      const stored = localStorage.getItem('fleet_guest_vehicles');
      if (!stored || stored === '[]') {
        localStorage.setItem('fleet_guest_vehicles', JSON.stringify([DEMO_VEHICLE, DEMO_VESSEL]));
        localStorage.setItem('fleet_guest_cork_notes', JSON.stringify([...DEMO_CORK_NOTES, ...DEMO_VESSEL_CORK_NOTES]));
        localStorage.setItem('fleet_guest_vessel_issues', JSON.stringify(DEMO_VESSEL_ISSUES));
        // Force reload to pick up seeded data from GuestContext
        window.location.reload();
        return <LoadingSpinner />;
      }
    }

    const hasGuestVehicles = guestVehicles.length > 0;
    const vehiclesToShow = hasGuestVehicles ? guestVehicles : [DEMO_VEHICLE, DEMO_VESSEL];
    const isShowingDemo = vehiclesToShow.some(v => v._isDemo);

    // Build reminders from vehicle dates
    const reminders = vehiclesToShow.flatMap(v => [
      v.test_due_date      && { id: `${v.id}_test`,  vehicle_id: v.id, title: 'טסט שנתי',    date: v.test_due_date,      type: 'test',        subtitle: v.nickname || v.manufacturer },
      v.insurance_due_date && { id: `${v.id}_ins`,   vehicle_id: v.id, title: 'חידוש ביטוח', date: v.insurance_due_date, type: 'insurance',   subtitle: v.insurance_company || '' },
    ].filter(Boolean));

    const upcomingReminders = reminders
      .filter(r => daysUntil(r.date) !== null)
      .sort((a, b) => daysUntil(a.date) - daysUntil(b.date))
      .slice(0, 4);

    const testDays = daysUntil(vehiclesToShow[0]?.test_due_date);
    const insDays  = daysUntil(vehiclesToShow[0]?.insurance_due_date);

    return (
      <div className="-mx-4 -mt-4 pb-4" style={{ background: C.bg, minHeight: '100dvh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <SignUpPromptDialog open={showSignUp} onClose={() => setShowSignUp(false)}
          reason="כדי לשמור את הרכבים שלך לצמיתות ולגשת אליהם מכל מכשיר" />

        <div className="px-4 pt-6">

          {/* Urgent banner */}
          <UrgentBanner reminders={upcomingReminders} vehicles={vehiclesToShow} />

          {/* Section header */}
          <div className="flex items-center justify-between mb-4" dir="rtl">
            <h2 className="font-black text-2xl" style={{ color: C.text }}>הרכבים שלי</h2>
            <Link to={createPageUrl('Vehicles')}
              className="flex items-center gap-1 text-base font-extrabold" style={{ color: C.green }}>
              נהל רכבים <ChevronLeft className="w-4 h-4" />
            </Link>
          </div>

          {/* Demo badge */}
          {isShowingDemo && (
            <div className="rounded-xl px-3 py-2.5 mb-3 text-center text-sm font-bold"
              style={{ background: '#FEF3C7', color: '#92400E' }}>
              רכב לדוגמה — הוסף את הרכב שלך
            </div>
          )}

          {/* Single demo vehicle → big card. Multiple vehicles → compact rows + status summary */}
          {isShowingDemo ? (
            <>
              <VehicleCard key={vehiclesToShow[0].id} vehicle={vehiclesToShow[0]} isDemo={true} />
              {/* Info tiles for single demo */}
              <div className="flex gap-3 mb-4">
                <InfoTile
                  icon={Calendar}
                  label="טסט שנתי"
                  value={testDays !== null ? daysLabel(testDays) : 'לא הוזן'}
                  status={testDays === null ? 'ok' : testDays < 0 ? 'danger' : testDays <= 30 ? 'warn' : 'ok'}
                />
                <InfoTile
                  icon={Shield}
                  label="ביטוח מקיף"
                  value={insDays !== null ? (insDays >= 0 ? 'בתוקף' : 'פג תוקף') : 'לא הוזן'}
                  status={insDays === null ? 'ok' : insDays < 0 ? 'danger' : insDays <= 30 ? 'warn' : 'ok'}
                />
              </div>
            </>
          ) : (
            <>
              <StatusSummary vehicles={vehiclesToShow} />
              {vehiclesToShow.map(v => (
                <VehicleRow key={v.id} vehicle={v} />
              ))}
            </>
          )}

          {/* Add vehicle button */}
          <Link to={createPageUrl('AddVehicle')}>
            <button className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mb-6 transition-all active:scale-[0.98]"
              style={{ background: C.yellow, color: C.greenDark }}>
              <Plus className="w-4 h-4" />
              הוספת רכב חדש
            </button>
          </Link>

          {/* Upcoming reminders */}
          {upcomingReminders.length > 0 && (
            <div>
              <h2 className="font-black text-2xl mb-4" style={{ color: C.text }} dir="rtl">
                טיפולים קרובים
              </h2>
              <div>
                {upcomingReminders.map(r => <ReminderRow key={r.id} reminder={r} />)}
              </div>
            </div>
          )}

          {/* Sign up prompt */}
          {isShowingDemo && (
            <button onClick={() => setShowSignUp(true)}
              className="w-full mt-4 py-4 rounded-2xl font-bold text-base border-2 transition-all"
              style={{ borderColor: C.greenDark, color: C.greenDark, background: 'transparent' }}>
              הירשם לשמירת הנתונים
            </button>
          )}
        </div>

        {/* BottomNav is now in Layout */}
      </div>
    );
  }

  // ── AUTHENTICATED MODE ─────────────────────────────────────────────────────
  if (!accountId || vehiclesLoading) return <LoadingSpinner />;

  const displayedVehicles = filteredVehicles !== null ? filteredVehicles : vehicles;

  const allReminders = vehicles.flatMap(v => [
    v.test_due_date      && { id: `${v.id}_test`, vehicle_id: v.id, title: 'טסט שנתי',    date: v.test_due_date,      type: 'test',      subtitle: v.nickname || v.manufacturer },
    v.insurance_due_date && { id: `${v.id}_ins`,  vehicle_id: v.id, title: 'חידוש ביטוח', date: v.insurance_due_date, type: 'insurance', subtitle: v.insurance_company || '' },
  ].filter(Boolean)).sort((a, b) => daysUntil(a.date) - daysUntil(b.date));

  return (
    <div className="-mx-4 -mt-4 pb-4" style={{ background: C.bg, minHeight: '100dvh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div className="px-4 pt-6">

        {/* Urgent banner — only if something is urgent */}
        <UrgentBanner reminders={allReminders} vehicles={vehicles} />

        {/* Header with vehicle count */}
        <div className="flex items-center justify-between mb-4" dir="rtl">
          <div>
            <h2 className="font-black text-2xl" style={{ color: C.text }}>הרכבים שלי</h2>
            <p className="text-xs font-medium mt-0.5" style={{ color: C.muted }}>{vehicles.length} כלי רכב</p>
          </div>
          <Link to={createPageUrl('Vehicles')}
            className="flex items-center gap-1 text-sm font-bold" style={{ color: C.green }}>
            נהל רכבים <ChevronLeft className="w-4 h-4" />
          </Link>
        </div>

        {vehicles.length === 0 ? (
          <div className="text-center py-16">
            <Car className="w-16 h-16 mx-auto mb-4" style={{ color: C.muted }} />
            <p className="font-bold text-lg mb-1" style={{ color: C.text }}>אין רכבים עדיין</p>
            <p className="text-sm mb-6" style={{ color: C.muted }}>הוסף את הרכב הראשון שלך</p>
            <Link to={createPageUrl('AddVehicle')}>
              <button className="px-8 py-3 rounded-2xl font-bold"
                style={{ background: C.yellow, color: C.greenDark }}>
                הוסף רכב
              </button>
            </Link>
          </div>
        ) : (
          <>
            {/* Status summary cards */}
            <StatusSummary vehicles={vehicles} />

            {/* Compact vehicle list */}
            {displayedVehicles.map(vehicle => (
              <VehicleRow key={vehicle.id} vehicle={vehicle} />
            ))}

            {/* Add vehicle button */}
            <Link to={createPageUrl('AddVehicle')}>
              <button className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mb-6 transition-all active:scale-[0.98]"
                style={{ background: C.yellow, color: C.greenDark }}>
                <Plus className="w-4 h-4" />
                הוספת רכב חדש
              </button>
            </Link>

            {/* Upcoming reminders from all vehicles */}
            {allReminders.length > 0 && (
              <div>
                <h2 className="font-black text-2xl mb-4" style={{ color: C.text }} dir="rtl">
                  תזכורות קרובות
                </h2>
                <div className="rounded-3xl px-4" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 2px 16px rgba(45,82,51,0.07)' }}>
                  {allReminders.slice(0, 6).map(r => <ReminderRow key={r.id} reminder={r} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {/* BottomNav is in Layout */}
    </div>
  );
}
