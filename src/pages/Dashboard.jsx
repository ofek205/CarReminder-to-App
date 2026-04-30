import React, { useState, useEffect, useMemo } from 'react';
import { SYSTEM_POPUP_IDS, logSystemPopupEvent } from '@/lib/popups/systemPopups';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { isSafeFileUrl } from '@/lib/securityUtils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from '@/components/shared/PullToRefreshIndicator';
import { Plus, Car, ChevronLeft, Bell, Calendar, Shield, Wrench, AlertTriangle, Clock, CheckCircle, Ship, Bike, Truck, Mountain, AlertCircle, ArrowUpDown, Search, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import VehicleImage, { hasVehiclePhoto } from "../components/shared/VehicleImage";
import SignUpPromptDialog from "../components/shared/SignUpPromptDialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useAuth } from "../components/shared/GuestContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { toast } from "sonner";
import { daysUntil } from "../components/shared/ReminderEngine";
import { usesHours, usesKm } from "../components/shared/DateStatusUtils";
import { DEMO_VEHICLE, DEMO_VESSEL, DEMO_CORK_NOTES, DEMO_VESSEL_CORK_NOTES, DEMO_VESSEL_ISSUES, DEMO_DOCUMENTS, DEMO_VESSEL_DOCUMENTS } from "../components/shared/demoVehicleData";
import { format, parseISO } from 'date-fns';
import { C, getTheme, isVesselType, getVehicleCategory } from '@/lib/designTokens';
import CompleteProfileScreen, { isProfileSkipActive } from '../components/shared/CompleteProfileScreen';
import LicensePlate from '../components/shared/LicensePlate';
import FirstTimeTour from '../components/shared/FirstTimeTour';
import SharedIndicator from '@/components/sharing/SharedIndicator';
import { Share2 } from 'lucide-react';
import VehicleCheckPlateInput from '@/components/shared/VehicleCheckPlateInput';
// Lazy-loaded — only mounts on first card-share-tap so we don't pull
// the dialog + its 9 RPC bindings into the dashboard's first paint.
const ShareVehicleDialog = React.lazy(() => import('@/components/sharing/ShareVehicleDialog'));

// Icon per high-level category. cme uses Wrench (mirrors VehicleTypeSelector
// + Vehicles.jsx), offroad uses Mountain, special falls back to Car. Anything
// missing here ends up with Car too — defensive fallback.
const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car, cme: Wrench, offroad: Mountain };
function getVehicleIcon(vt, nn, mfr) { return ICON_MAP[getVehicleCategory(vt, nn, mfr)] || Car; }

//  Helper: format date nicely 
function fmtDate(dateStr) {
  if (!dateStr) return '';
  try { return format(parseISO(dateStr), 'dd.MM.yyyy'); } catch { return dateStr; }
}

function daysLabel(days) {
  if (days === null) return '';
  if (days < 0) {
    const overdue = Math.abs(days);
    if (overdue === 1) return 'פג לפני יום';
    if (overdue < 30) return `פג לפני ${overdue} ימים`;
    const months = Math.round(overdue / 30);
    return `פג לפני ${months} ${months === 1 ? 'חודש' : 'חודשים'}`;
  }
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days < 30) return `בעוד ${days} ימים`;
  const months = Math.round(days / 30);
  return `בעוד ${months} ${months === 1 ? 'חודש' : 'חודשים'}`;
}

const QUICK_CHECK_PREFILL_KEY = 'vehicle_quick_check_prefill_plate';
function normalizeQuickCheckPlateInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

//  Compact alerts bar
function UrgentBanner({ reminders, onView }) {
  const actionable = (reminders || [])
    .map(r => ({ ...r, days: daysUntil(r.date) }))
    .filter(r => r.days !== null && r.days <= 30);
  const count = actionable.length;

  useEffect(() => {
    if (count > 0) logSystemPopupEvent(SYSTEM_POPUP_IDS.urgentBanner, 'shown');
  }, [count]);

  if (count <= 0) return null;
  const overdueCount = actionable.filter(r => r.days < 0).length;

  return (
    <div
      className="mb-4 rounded-2xl border px-3 py-2.5 flex items-center justify-between gap-2"
      style={{ background: '#FEF2F2', borderColor: '#FCA5A5' }}
      dir="rtl"
    >
      <div className="min-w-0">
        <p className="text-sm font-black text-red-700 truncate">יש לך {count} התראות שדורשות טיפול ⚠️</p>
        {overdueCount > 0 && <p className="text-[11px] text-red-600">מתוכן {overdueCount} באיחור</p>}
      </div>
      <button
        type="button"
        onClick={() => {
          logSystemPopupEvent(SYSTEM_POPUP_IDS.urgentBanner, 'clicked');
          onView?.();
        }}
        className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-black text-white bg-red-600 hover:bg-red-700 transition-colors"
      >
        צפה
      </button>
    </div>
  );
}

function VehicleCheckHero({ hasVehicles, plate, onPlateChange, onSubmit, submitting }) {
  return (
    <section
      className="rounded-3xl p-5 sm:p-6 mb-4 text-center border"
      style={{ background: 'linear-gradient(180deg, #F3F9F4 0%, #FFFFFF 100%)', borderColor: '#D8E5D9' }}
      dir="rtl"
    >
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8F2EA] text-[#2D5233] text-xs font-black mb-3">
        בדיקה חכמה תוך שניות
      </div>
      <h1 className="font-black text-2xl sm:text-3xl text-[#1C2E20] mb-1.5">
        {hasVehicles ? 'רוצה לבדוק רכב נוסף?' : 'בדוק כל רכב תוך שניות'}
      </h1>
      <p className="text-sm sm:text-base text-gray-600 mb-4">
        {hasVehicles
          ? 'הזן מספר רישוי וקבל את כל הפרטים תוך שניות'
          : 'הזן מספר רישוי וקבל דוח מלא כולל תובנות ופרטים'}
      </p>
      <VehicleCheckPlateInput
        value={plate}
        onChange={onPlateChange}
        onEnter={onSubmit}
        disabled={submitting}
        compact
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="mt-3 rounded-2xl px-6 py-2.5 text-sm font-black text-white bg-[#2D5233] hover:bg-[#1E3D24] transition-colors disabled:opacity-60"
      >
        {submitting ? 'מעביר...' : 'הפק דוח רכב'}
      </button>
      <p className="text-xs text-gray-500 mt-2">כולל דוח PDF מלא</p>
    </section>
  );
}

//  Hero Vehicle Card (premium design - photo background)
function VehicleCard({ vehicle, isDemo, isGuestVehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  // Share dialog state. lifted into each card so the dialog mounts
  // on demand (lazy import above keeps it out of the first paint).
  // Owner-only — sharees can't re-share, demo/guest cards have no
  // real DB row to share against. The button is hidden in those
  // cases so the affordance never lies about what it does.
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const canShare = !isDemo && !isGuestVehicle && !vehicle.is_shared_with_me;

  const testDays    = daysUntil(vehicle.test_due_date);
  const insDays     = daysUntil(vehicle.insurance_due_date);
  const needsAction = (testDays !== null && testDays <= 60) || (insDays !== null && insDays <= 60);

  const statusBadge = needsAction
    ? { label: 'תחזוקה נדרשת', bg: T.yellow, color: T.primary }
    : { label: 'תקין', bg: T.successBg, color: T.success };

  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || (isVessel ? 'כלי שייט' : 'רכב');
  const make = vehicle.manufacturer || '';
  const model = vehicle.model || '';
  const detailUrl = `${createPageUrl('VehicleDetail')}?id=${vehicle.id}`;

  const hasPhoto = hasVehiclePhoto(vehicle);

  return (
    <>
    <Link to={detailUrl}>
      <div className="rounded-3xl overflow-hidden mb-5"
        style={{ boxShadow: `0 8px 32px ${T.primary}25` }}>

        {/* Hero image section */}
        <div className="relative" style={{ height: '220px' }}>
          {/* Background */}
          {hasPhoto ? (
            <VehicleImage vehicle={vehicle} alt={name}
              loading="lazy" decoding="async"
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

          {/* Demo / Guest badge */}
          {(isDemo || isGuestVehicle) && (
            <div className="absolute top-4 left-4 z-10">
              <span className="text-xs font-black px-3 py-1.5 rounded-full backdrop-blur-md flex items-center gap-1"
                style={isDemo
                  ? { background: '#FFBF00', color: '#92400E', boxShadow: '0 2px 8px rgba(255,191,0,0.4)' }
                  : { background: 'rgba(255,255,255,0.9)', color: '#2D5233', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }
                }>
                {isDemo ? '👀 לדוגמה' : '💾 שמור זמנית'}
              </span>
            </div>
          )}

          {/* Share controls cluster (top-left).
              - Share button: owner-only, primary amber CTA. Tapping
                opens the share dialog without navigating into the
                vehicle detail page (preventDefault + stopPropagation
                to stop the wrapping <Link>).
              - SharedIndicator pill: shown beneath when the vehicle
                already has accepted shares OR is shared *with* the
                current user. Same component as VehicleDetail so the
                visual language stays consistent. */}
          {(canShare || vehicle.share_count > 0 || vehicle.is_shared_with_me) && (
            <div className="absolute top-4 left-4 z-10 flex flex-col items-start gap-1.5">
              {canShare && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShareDialogOpen(true);
                  }}
                  className="h-8 px-2.5 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 backdrop-blur-md"
                  style={{ background: '#F59E0B', color: '#fff', boxShadow: '0 4px 12px rgba(245,158,11,0.45)' }}
                  aria-label="שתף את כלי התחבורה"
                  title="שיתוף">
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold">שיתוף</span>
                </button>
              )}
              {(vehicle.share_count > 0 || vehicle.is_shared_with_me) && (
                <SharedIndicator
                  shareCount={vehicle.share_count || 0}
                  isSharedWithMe={!!vehicle.is_shared_with_me}
                  size="sm"
                />
              )}
            </div>
          )}

          {/* Vehicle name on image */}
          <div className="absolute bottom-4 right-4 left-4 z-10" dir="rtl">
            <h3 className="font-black text-white leading-tight" style={{ fontSize: '1.75rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
              {name}
            </h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-base font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>
                {[make, model, vehicle.year].filter(Boolean).join(' · ')}
              </p>
              {vehicle.license_plate && !isVessel && (
                <LicensePlate value={vehicle.license_plate} size="sm" showCopy={false} />
              )}
            </div>
          </div>

          {/* Vehicle icon for no-photo */}
          {!hasPhoto && (
            <div className="absolute inset-0 flex items-center justify-center">
              <VehicleIcon className="w-20 h-20" style={{ color: 'rgba(255,255,255,0.15)' }} />
            </div>
          )}
        </div>

        {/* Stats bar — use usesHours() instead of isVessel so off-road
            and CME vehicles edited into engine-hours mode show "שעות
            מנוע" with their engine hours instead of "קילומטראז'" with
            an empty / stale km. */}
        <div className="grid grid-cols-3" style={{ background: T.card }} dir="rtl">
          {[
            { label: usesHours(vehicle) ? 'שעות מנוע' : 'קילומטראז\'', value: usesHours(vehicle) ? (vehicle.current_engine_hours ? Number(vehicle.current_engine_hours).toLocaleString() : '-') : (vehicle.current_km ? Number(vehicle.current_km).toLocaleString() : '-') },
            { label: 'שנת יצור', value: vehicle.year || '-' },
            { label: isVessel ? 'כושר שייט' : 'טיפול הבא', value: testDays !== null ? daysLabel(testDays) : '-' },
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
    {/* Share dialog. RENDERED OUTSIDE the <Link> on purpose: even
        though Radix Dialog portals to document.body, React's synthetic
        events still bubble through the React tree — so a click inside
        the dialog (or its backdrop) would otherwise propagate to the
        wrapping Link and navigate the user away. Sibling-of-Link
        keeps the click semantics clean. Lazy-loaded so the dialog +
        its 9 RPC bindings only download after first share-tap. */}
    {shareDialogOpen && (
      <React.Suspense fallback={null}>
        <ShareVehicleDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          vehicle={vehicle}
        />
      </React.Suspense>
    )}
    </>
  );
}

//  Info Tile (premium)
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

//  Reminder Row (premium) 
function ReminderRow({ reminder, vehicles }) {
  const days = daysUntil(reminder.date);
  const urgency = days !== null && days < 0 ? 'danger' : days !== null && days <= 14 ? 'warn' : 'ok';
  const urgencyColor = { ok: '#3A7D44', warn: '#D97706', danger: '#DC2626' }[urgency];
  const urgencyBg    = { ok: '#E8F5E9', warn: '#FEF3C7', danger: '#FEF2F2' }[urgency];
  const icons = { insurance: Shield, test: Calendar, maintenance: Wrench };
  const Icon = icons[reminder.type] || Bell;

  // Resolve which vehicle this reminder belongs to so the row can (a) show a
  // recognizable label ("הוויטארה 🚙" beats "טסט שנתי") and (b) deep-link into
  // that vehicle's detail page. reminder.subtitle is already the nickname/
  // manufacturer where available; vehicle_type is a useful fallback for
  // vehicles the user never renamed.
  const vehicle = vehicles?.find(v => v.id === reminder.vehicle_id);
  const vehicleLabel = reminder.subtitle
    || vehicle?.nickname
    || [vehicle?.manufacturer, vehicle?.model].filter(Boolean).join(' ')
    || vehicle?.vehicle_type
    || null;

  const body = (
    <div className={`flex items-center gap-3 p-3 mb-2 rounded-2xl transition-all ${vehicle ? 'hover:brightness-[0.98] active:scale-[0.99] cursor-pointer' : ''}`}
      style={{ background: urgencyBg }} dir="rtl">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
        style={{ background: urgencyColor, boxShadow: `0 4px 12px ${urgencyColor}40` }}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-base truncate" style={{ color: C.text }}>{reminder.title}</p>
        {vehicleLabel && (
          <p className="text-xs mt-0.5 font-semibold truncate" style={{ color: C.muted }}>{vehicleLabel}</p>
        )}
        <p className="text-sm mt-0.5 font-bold" style={{ color: urgencyColor }}>{daysLabel(days)}</p>
      </div>
      <div className="text-left shrink-0">
        <p className="font-bold text-base" style={{ color: C.text }}>{fmtDate(reminder.date)}</p>
      </div>
    </div>
  );

  return vehicle
    ? <Link to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}>{body}</Link>
    : body;
}

//  Status Summary (authenticated multi-vehicle) 
// Each card is tappable: opens a small popover listing the vehicles in that
// bucket with the specific reason (טסט / ביטוח + date/days), each row links
// to /VehicleDetail?id=<id>.
function StatusSummary({ vehicles }) {
  const [drill, setDrill] = useState(null); // 'ok' | 'soon' | 'overdue' | null

  // Classify every vehicle into a bucket AND capture the specific reasons so
  // the drill-down can show "טסט פג לפני 3 ימים" instead of just the plate.
  const buckets = useMemo(() => {
    const ok = [], soon = [], overdue = [];
    vehicles.forEach(v => {
      const testD = daysUntil(v.test_due_date);
      const insD  = daysUntil(v.insurance_due_date);
      const worst = Math.min(
        testD !== null ? testD : 999,
        insD  !== null ? insD  : 999
      );
      const isVessel = isVesselType(v.vehicle_type, v.nickname);
      const reasons = [];
      if (testD !== null) {
        reasons.push({ kind: isVessel ? 'כושר שייט' : 'טסט', days: testD, date: v.test_due_date });
      }
      if (insD !== null) {
        reasons.push({ kind: isVessel ? 'ביטוח ימי' : 'ביטוח', days: insD, date: v.insurance_due_date });
      }
      const row = { vehicle: v, reasons, worst };
      if (worst < 0) overdue.push(row);
      else if (worst <= 60) soon.push(row);
      else ok.push(row);
    });
    // Sort each bucket. most urgent first (smallest "worst" first).
    const byUrgency = (a, b) => a.worst - b.worst;
    overdue.sort(byUrgency);
    soon.sort(byUrgency);
    ok.sort((a, b) => b.worst - a.worst); // highest days-left first for "ok"
    return { ok, soon, overdue };
  }, [vehicles]);

  const items = [
    { key: 'ok',      label: 'תקין',   count: buckets.ok.length,      icon: CheckCircle,   color: '#3A7D44', bg: '#E8F5E9' },
    { key: 'soon',    label: 'בקרוב',  count: buckets.soon.length,    icon: Clock,         color: '#D97706', bg: '#FEF3C7' },
    { key: 'overdue', label: 'באיחור', count: buckets.overdue.length, icon: AlertTriangle, color: '#DC2626', bg: '#FEF2F2' },
  ];

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 mb-5" dir="rtl">
        {items.map(item => {
          const clickable = item.count > 0;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => clickable && setDrill(item.key)}
              disabled={!clickable}
              aria-label={`הצג רכבים במצב ${item.label}`}
              className="rounded-2xl py-3 px-2 flex flex-col items-center gap-1.5 transition-transform active:scale-[0.97] disabled:cursor-default"
              style={{ background: item.bg, opacity: clickable ? 1 : 0.7 }}>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-2xl" style={{ color: item.color }}>{item.count}</span>
                <item.icon className="w-5 h-5" style={{ color: item.color }} />
              </div>
              <span className="text-xs font-bold" style={{ color: item.color }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      <StatusDrilldownDialog
        open={drill !== null}
        status={drill}
        rows={drill ? buckets[drill] : []}
        onClose={() => setDrill(null)}
      />
    </>
  );
}

// Drill-down popup that lists vehicles in the tapped status bucket.
// Each row is a link to the vehicle's detail page.
function StatusDrilldownDialog({ open, status, rows, onClose }) {
  const STATUS_META = {
    ok:      { title: 'רכבים תקינים',  color: '#3A7D44', bg: '#E8F5E9', icon: CheckCircle },
    soon:    { title: 'עומד לפוג',     color: '#D97706', bg: '#FEF3C7', icon: Clock },
    overdue: { title: 'פג תוקף',       color: '#DC2626', bg: '#FEF2F2', icon: AlertTriangle },
  };
  const meta = STATUS_META[status] || STATUS_META.ok;
  const Icon = meta.icon;

  // Label a single reason as a short Hebrew status line.
  const reasonLine = (r) => {
    if (r.days === null || r.days === undefined) return r.kind;
    if (r.days < 0)  return `${r.kind} פג לפני ${Math.abs(r.days)} ימים`;
    if (r.days === 0) return `${r.kind} פג היום`;
    if (r.days === 1) return `${r.kind} פג מחר`;
    return `${r.kind} פג בעוד ${r.days} ימים`;
  };

  // Filter each row's reasons to the ones matching this bucket, so we don't
  // show "ok" reasons when the user clicked "overdue".
  const filteredReasons = (row) => {
    return row.reasons.filter(r => {
      if (status === 'overdue') return r.days !== null && r.days < 0;
      if (status === 'soon')    return r.days !== null && r.days >= 0 && r.days <= 60;
      return r.days !== null && r.days > 60;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        dir="rtl"
        className="max-w-sm w-[calc(100vw-32px)] max-h-[60vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0">
        <VisuallyHidden.Root>
          <DialogTitle>{meta.title}</DialogTitle>
        </VisuallyHidden.Root>

        {/* Header. pr-14 leaves room for the absolute-positioned X button
            (top-right in RTL, 32px × 32px + 16px gutter). */}
        <div className="px-4 pr-14 py-3.5 flex items-center gap-2 border-b"
          style={{ background: meta.bg, borderColor: meta.color + '20' }}>
          <Icon className="w-5 h-5 shrink-0" style={{ color: meta.color }} />
          <p className="font-black text-[15px] leading-tight" style={{ color: meta.color }}>{meta.title}</p>
          <span className="mr-auto text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ color: meta.color, background: '#fff' }}>
            {rows.length}
          </span>
        </div>

        {/* List */}
        <div className="divide-y divide-gray-100">
          {rows.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-gray-400">אין רכבים במצב זה</p>
          )}
          {rows.map(({ vehicle, reasons }) => {
            const r = filteredReasons({ reasons });
            const title = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || 'רכב';
            return (
              <Link
                key={vehicle.id}
                to={createPageUrl('VehicleDetail') + `?id=${encodeURIComponent(vehicle.id)}`}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{title}</p>
                  {vehicle.license_plate && (
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5" dir="ltr">{vehicle.license_plate}</p>
                  )}
                  <div className="mt-1 space-y-0.5">
                    {r.length === 0
                      ? <p className="text-[11px]" style={{ color: meta.color }}>ללא פרטים</p>
                      : r.map((reason, i) => (
                          <p key={i} className="text-[11px] flex items-center gap-1" style={{ color: meta.color }}>
                            <span className="w-1 h-1 rounded-full" style={{ background: meta.color }} />
                            {reasonLine(reason)}
                          </p>
                        ))
                    }
                  </div>
                </div>
                <ChevronLeft className="w-4 h-4 text-gray-400 shrink-0" />
              </Link>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

//  Compact Vehicle Row (for multi-vehicle authenticated view) 
function VehicleRow({ vehicle }) {
  const navigate = useNavigate();
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

  // Title + subtitle. avoid repeating info the user can already read from
  // the title. Two scenarios to handle:
  //   (a) nickname exists → title=nickname, subtitle=mfr+model+year. But if
  //       the nickname already contains a word from the manufacturer (e.g.
  //       "ניסאן ניסאן" + manufacturer "ניסאן יפן"), drop the mfr from subtitle.
  //   (b) no nickname → title=mfr+model, subtitle=year only (showing mfr+model
  //       again in the subtitle would just echo the same line twice).
  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || (isVessel ? 'כלי שייט' : 'רכב');
  const titleWords = name.toLowerCase().split(/[\s·]+/).filter(Boolean);
  const isWordInTitle = (s) => (s || '').toLowerCase().split(/\s+/).filter(Boolean).some(w => titleWords.includes(w));
  const subtitleParts = [];
  if (vehicle.manufacturer && !isWordInTitle(vehicle.manufacturer)) subtitleParts.push(vehicle.manufacturer);
  if (vehicle.model && !isWordInTitle(vehicle.model)) subtitleParts.push(vehicle.model);
  if (vehicle.year) subtitleParts.push(vehicle.year);
  const subtitle = subtitleParts.join(' · ');

  // Hours vs km — usesHours covers vessels, RZR/מיול AND every CME
  // subtype (forklifts, excavators, rollers, tractors). Without this
  // a Hyster forklift was flaring "חסר: קילומטראז'" because the only
  // hours-mode branch was isVessel.
  const isHoursVehicle = usesHours(vehicle);
  const isKmVehicle    = usesKm(vehicle);

  // Missing fields. reduced list: only the fields that matter for reminders.
  // Cosmetic gaps (photo / fuel type / insurance company) are no longer flagged
  // here because every card lacking a photo was flaring the warning banner and
  // turning the whole dashboard into a wall of orange. Those still appear in
  // the Edit screen where the user actually fills them in.
  const missingFields = [];
  if (!vehicle.test_due_date) missingFields.push(isVessel ? 'כושר שייט' : 'טסט');
  if (!vehicle.insurance_due_date) missingFields.push(isVessel ? 'ביטוח ימי' : 'ביטוח');
  if (!vehicle.license_plate) missingFields.push('מספר רישוי');
  if (!vehicle.manufacturer) missingFields.push('יצרן');
  if (isKmVehicle    && !vehicle.current_km)            missingFields.push("קילומטראז'");
  if (isHoursVehicle && !vehicle.current_engine_hours)  missingFields.push('שעות מנוע');
  const hasMissing = missingFields.length > 0 && !vehicle._isDemo;

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
          {hasVehiclePhoto(vehicle) ? (
            <VehicleImage vehicle={vehicle} alt={name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {isHoursVehicle ? (
              vehicle.current_engine_hours && (
                <p className="text-xs" style={{ color: T.muted }}>
                  {Number(vehicle.current_engine_hours).toLocaleString()} שעות מנוע
                </p>
              )
            ) : (
              vehicle.current_km && (
                <p className="text-xs" style={{ color: T.muted }}>
                  {Number(vehicle.current_km).toLocaleString()} ק"מ
                </p>
              )
            )}
            {vehicle.license_plate && !isVessel && (
              <LicensePlate value={vehicle.license_plate} size="sm" showCopy={false} />
            )}
          </div>
          {hasMissing && (
            // Button (not Link) because this whole row is already wrapped in a
            // <Link>. Nesting <a> inside <a> is invalid HTML and produces the
            // validateDOMNesting warning in React. Programmatic navigate keeps
            // the same behavior; stopPropagation prevents the row's Link from
            // firing instead.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const fieldParam = {
                  'טסט': 'test_due_date',
                  'כושר שייט': 'test_due_date',
                  'ביטוח': 'insurance_due_date',
                  'ביטוח ימי': 'insurance_due_date',
                  'מספר רישוי': 'license_plate',
                  'יצרן': 'manufacturer',
                  'קילומטראז\'': 'current_km',
                  'שעות מנוע': 'current_engine_hours',
                }[missingFields[0]] || '';
                navigate(`${createPageUrl('EditVehicle')}?id=${vehicle.id}&field=${encodeURIComponent(fieldParam)}`);
              }}
              className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full hover:bg-orange-100 transition-colors"
              title={`חסר: ${missingFields.join(', ')}. לחץ להשלמה`}
              style={{ background: '#FFF7ED', border: '1px solid #FFEDD5' }}>
              <AlertCircle className="w-3 h-3 shrink-0" style={{ color: '#EA580C' }} aria-hidden="true" />
              <span className="text-[10px] font-bold" style={{ color: '#EA580C' }}>
                {missingFields.length <= 2
                  ? `חסר: ${missingFields.join(', ')}`
                  : `חסרים ${missingFields.length} פרטים: ${missingFields.slice(0, 2).join(', ')}…`}
              </span>
            </button>
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

// BottomNav moved to Layout - shared across all pages

//  Main Dashboard 
import useNotificationScheduler from '@/hooks/useNotificationScheduler';

export default function Dashboard() {
  const { isAuthenticated, isGuest, isLoading, user, guestVehicles, getStoredGuestVehicles,
    getStoredGuestDocuments, getStoredGuestReminderSettings, clearGuestData, isDemoDismissed } = useAuth();
  // Phase 9 step 5: when active workspace is business, route by role.
  //   manager / viewer / owner → /BusinessDashboard
  //   driver                   → /MyVehicles  (their assigned vehicles)
  // Without the driver branch, drivers fell through BusinessDashboard's
  // manager-only guard and saw "אין הרשאה לדשבורד" — and crucially,
  // they never reached the per-driver vehicle filter, so the personal
  // Dashboard ended up showing them every vehicle in the workspace.
  const navigateRef = useNavigate();
  const { activeWorkspace } = useWorkspace();
  const { isDriver, canManageRoutes } = useWorkspaceRole();
  useEffect(() => {
    if (isGuest) return;
    if (activeWorkspace?.account_type !== 'business') return;
    if (isDriver && !canManageRoutes) {
      navigateRef(createPageUrl('MyVehicles'), { replace: true });
    } else {
      navigateRef(createPageUrl('BusinessDashboard'), { replace: true });
    }
  }, [activeWorkspace, isGuest, isDriver, canManageRoutes, navigateRef]);
  const [accountId, setAccountId] = useState(null);
  const [filteredVehicles, setFilteredVehicles] = useState(null);
  // Dashboard list sort. Default: newest-added first.
  // Options: 'newest' | 'name' | 'status' | 'year' | 'updated'
  const [sortBy, setSortBy] = useState(() => {
    try { return localStorage.getItem('cr_dashboard_sort') || 'newest'; } catch { return 'newest'; }
  });
  useEffect(() => {
    try { localStorage.setItem('cr_dashboard_sort', sortBy); } catch {}
  }, [sortBy]);
  // Free-text search across nickname / manufacturer / model / year / plate.
  const [searchQuery, setSearchQuery] = useState('');
  const [showSignUp, setShowSignUp] = useState(false);
  const [showCompleteProfile, setShowCompleteProfile] = useState(false);
  const [profileMissing, setProfileMissing] = useState(false);
  const [quickCheckPlate, setQuickCheckPlate] = useState('');
  const [quickCheckSubmitting, setQuickCheckSubmitting] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const openQuickCheck = () => {
    const normalized = normalizeQuickCheckPlateInput(quickCheckPlate);
    if (normalized) {
      try { sessionStorage.setItem(QUICK_CHECK_PREFILL_KEY, normalized); } catch {}
    }
    setQuickCheckSubmitting(true);
    navigate(createPageUrl('vehicle-check'));
  };

  // Pull-to-refresh
  const { pulling, progress } = usePullToRefresh(async () => {
    await queryClient.invalidateQueries({ queryKey: ['my-vehicles', user?.id, accountId] });
    await new Promise(r => setTimeout(r, 500));
  });


  //  Authenticated init (Supabase) 
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function init() {
      try {
        // Find existing account membership. We pull ALL rows first so a
        // legacy row with status NULL / 'active' / 'ממתין' doesn't send us
        // down the "create a fresh account" branch — that path hits the
        // accounts_insert RLS policy or the account_members UNIQUE
        // constraint and left some users stuck on an infinite loading
        // spinner (Ilan/Eyal bug). Prefer 'פעיל' if present; otherwise
        // fall back to any row before creating a new account.
        const allMembers = await db.account_members.filter({ user_id: user.id });
        // Skip explicitly-removed rows; prefer active; tie-break by role
        // so a multi-membership user lands on the בעלים account.
        const usable = allMembers.filter(m => m.status !== 'הוסר' && m.status !== 'removed');
        const ROLE_PRIORITY = { 'בעלים': 0, 'מנהל': 1, 'שותף': 2 };
        const sortByRole = (a, b) => (ROLE_PRIORITY[a.role] ?? 9) - (ROLE_PRIORITY[b.role] ?? 9);
        let members = usable.filter(m => m.status === 'פעיל').sort(sortByRole);
        if (members.length === 0 && usable.length > 0) {
          members = [...usable].sort(sortByRole);  // legacy/migration rows
        }
        let finalAccountId;
        if (members.length > 0) {
          finalAccountId = members[0].account_id;
        } else {
          // Check if this user has a migrated account from Base44
          let migratedAccount = null;
          try {
            const email = user.email?.toLowerCase().trim();
            if (email) {
              const { data: mapRows } = await supabase.from('migration_email_map')
                .select('*').eq('email', email).is('claimed_by_user_id', null).limit(1);
              if (mapRows?.length > 0) migratedAccount = mapRows[0];
            }
          } catch {} // Table may not exist yet

          if (migratedAccount) {
            // Link user to existing migrated account
            await db.account_members.create({
              account_id: migratedAccount.account_id, user_id: user.id, role: 'בעלים', status: 'פעיל',
            });
            finalAccountId = migratedAccount.account_id;
            // Mark migration as claimed
            try {
              await supabase.from('migration_email_map').update({
                claimed_by_user_id: user.id, claimed_at: new Date().toISOString(),
              }).eq('email', migratedAccount.email);
            } catch {}
            // Pre-fill profile from migration data if available
            try {
              if (migratedAccount.phone || migratedAccount.birth_date || migratedAccount.driver_license_number) {
                const profileData = { user_id: user.id };
                if (migratedAccount.phone) profileData.phone = migratedAccount.phone;
                if (migratedAccount.birth_date) profileData.birth_date = migratedAccount.birth_date;
                if (migratedAccount.driver_license_number) profileData.driver_license_number = migratedAccount.driver_license_number;
                if (migratedAccount.license_expiration_date) profileData.license_expiration_date = migratedAccount.license_expiration_date;
                const existing = await db.user_profiles.filter({ user_id: user.id });
                if (existing.length === 0) await db.user_profiles.create(profileData);
              }
            } catch {}
          } else {
            // No migration → call the SECURITY DEFINER RPC that creates
            // account + membership atomically. The old flow did the same
            // two writes from the client, but the `members_insert_weak`
            // RLS policy rejects role='בעלים' on direct INSERT, so the
            // membership write silently failed and the next login created
            // yet another orphan account (we discovered one user had 69).
            const { data: ensuredId, error: ensureErr } = await supabase.rpc('ensure_user_account');
            if (ensureErr) throw ensureErr;
            finalAccountId = ensuredId;
          }
        }
        setAccountId(finalAccountId);

        // Profile-completion popup.
        //   Source of truth = DB (user_profiles.phone). The old localStorage
        //   "profile_completed" flag would gate the popup forever after the
        //   first session, so users who skipped once never saw it again.
        //   Now: always check DB. If phone missing → show the popup UNLESS
        //   the user tapped "דלג" recently (short cooldown). Notifications
        //   page also shows a pending card the whole time phone is missing.
        try {
          const profiles = await db.user_profiles.filter({ user_id: user.id });
          const hasPhone = profiles.length > 0 && !!profiles[0].phone;
          if (hasPhone) {
            localStorage.setItem('profile_completed', '1');
          } else if (!isProfileSkipActive()) {
            setShowCompleteProfile(true);
          } else {
            // Skipped recently. keep the lightweight banner instead of popup.
            setProfileMissing(true);
          }
        } catch {
          // If the profiles table read fails, fall back to showing the popup
          // unless the user just skipped.
          if (!isProfileSkipActive()) setShowCompleteProfile(true);
        }

        // Guest → authenticated migration
        const sanitizeStr = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
        const sanitizeNum = (v, min = 0, max = 9999999) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined; };
        const sanitizeDateStr = (v) => { if (typeof v !== 'string') return undefined; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined; };
        const storedVehicles = getStoredGuestVehicles().filter(v => !v._isDemo);
        if (storedVehicles.length > 0 && finalAccountId) {
          for (const gv of storedVehicles.slice(0, 20)) {
            await db.vehicles.create({
              account_id: finalAccountId,
              vehicle_type: sanitizeStr(gv.vehicle_type, 40) || 'רכב',
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

  // my_vehicles_v = owned ∪ accepted-shared rows. The legacy
  // account-scoped filter excluded vehicles shared with the user via
  // vehicle_shares, so sharees would see an empty Dashboard even after
  // accepting an invite. The view also exposes is_shared_with_me +
  // share_role columns so card components can render the indicator.
  const { data: vehicles = [], isLoading: vehiclesLoading } = useQuery({
    queryKey: ['my-vehicles', user?.id, accountId],
    queryFn: async () => {
      const { data, error } = await supabase.from('my_vehicles_v').select('*');
      if (error) throw error;
      // Phase 9 fix: scope to the active workspace so a user with both
      // personal + business memberships doesn't see vehicles from the
      // other workspace mixed into the personal Dashboard. Shared
      // vehicles (vehicle_shares) keep showing because they're a
      // personal-flow feature; business workspace users are redirected
      // to /BusinessDashboard above so this filter only runs in
      // personal context.
      return (data || []).filter(v => v.is_shared_with_me || v.account_id === accountId);
    },
    enabled: !!user?.id && !!accountId,
    // Bumped from 2 min → 10 min. Real changes invalidate the cache
    // immediately via useSharedVehicleRealtime (it listens on
    // vehicle_shares + app_notifications and invalidates 'my-vehicles'
    // on every event), so the staleTime only governs how often the
    // cache is treated as stale on tab refocus / background refetches.
    // 10 min cuts background refetches by 5× while real-time freshness
    // stays exact for actual edits.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Schedule device notifications for authenticated users.
  // Pass the FULL vehicle list (not filteredVehicles) so the user's UI
  // filter doesn't silently suppress pushes for filtered-out vehicles.
  const { unreadCount } = useNotificationScheduler(vehicles || [], accountId);

  if (isLoading) return <LoadingSpinner />;
  // Driver in business workspace — the redirect useEffect above sends
  // them to /MyVehicles, but it runs after the first paint. Without
  // this short-circuit they briefly see the manager-style vehicle
  // list (every car in the workspace) before the URL changes. Return
  // a spinner so nothing leaks during that one render.
  if (activeWorkspace?.account_type === 'business' && isDriver && !canManageRoutes) {
    return <LoadingSpinner />;
  }

  //  GUEST MODE 
  if (isGuest) {
    // Seed demo data on first visit (synchronous - no useEffect needed)
    if (guestVehicles.length === 0 && !isDemoDismissed) {
      const stored = localStorage.getItem('fleet_guest_vehicles');
      if (!stored || stored === '[]') {
        localStorage.setItem('fleet_guest_vehicles', JSON.stringify([DEMO_VEHICLE, DEMO_VESSEL]));
        localStorage.setItem('fleet_guest_cork_notes', JSON.stringify([...DEMO_CORK_NOTES, ...DEMO_VESSEL_CORK_NOTES]));
        localStorage.setItem('fleet_guest_vessel_issues', JSON.stringify(DEMO_VESSEL_ISSUES));
        localStorage.setItem('fleet_guest_documents', JSON.stringify([...DEMO_DOCUMENTS, ...DEMO_VESSEL_DOCUMENTS]));
        // Force reload to pick up seeded data from GuestContext
        window.location.reload();
        return <LoadingSpinner />;
      }
    }

    const hasGuestVehicles = guestVehicles.length > 0;
    const vehiclesToShow = hasGuestVehicles ? guestVehicles : [DEMO_VEHICLE, DEMO_VESSEL];
    const isShowingDemo = vehiclesToShow.some(v => v._isDemo);

    // Build reminders from vehicle dates.
    //
    // subtitle must identify *the vehicle* so the user can tell which row
    // belongs to which car. Earlier we were using v.insurance_company for
    // the insurance subtitle, which printed things like "ליברה" / "הפניקס"
    // — useful information but confusing next to "חידוש ביטוח" because it
    // answered the wrong question ("which insurer" instead of "which car").
    // Unified rule for both reminder types: nickname → "manufacturer model"
    // → manufacturer alone.
    const vehicleLabel = v => v.nickname
      || [v.manufacturer, v.model].filter(Boolean).join(' ')
      || v.manufacturer
      || '';
    const reminders = vehiclesToShow.flatMap(v => {
      const vc = getVehicleCategory(v.vehicle_type, v.nickname, v.manufacturer);
      const isV = isVesselType(v.vehicle_type, v.nickname);
      const vtw = isV ? 'כושר שייט' : vc === 'motorcycle' ? 'טסט אופנוע' : vc === 'truck' ? 'טסט משאית' : vc === 'offroad' ? `טסט ${v.vehicle_type || 'כלי שטח'}` : 'טסט שנתי';
      const iw = isV ? 'ביטוח ימי' : 'חידוש ביטוח';
      const vLabel = vehicleLabel(v);
      return [
        v.test_due_date      && { id: `${v.id}_test`, vehicle_id: v.id, title: vtw, date: v.test_due_date, type: 'test', subtitle: vLabel },
        v.insurance_due_date && { id: `${v.id}_ins`,  vehicle_id: v.id, title: iw,  date: v.insurance_due_date, type: 'insurance', subtitle: vLabel },
      ].filter(Boolean);
    });

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
          <VehicleCheckHero
            hasVehicles={hasGuestVehicles}
            plate={quickCheckPlate}
            onPlateChange={setQuickCheckPlate}
            onSubmit={openQuickCheck}
            submitting={quickCheckSubmitting}
          />
          <UrgentBanner
            reminders={upcomingReminders}
            onView={() => {
              const remindersTitle = document.getElementById('dashboard-reminders-title');
              remindersTitle?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          />

          {/* Section header */}
          <div className="flex items-center justify-between mb-4" dir="rtl">
            <h2 className="font-black text-2xl" style={{ color: C.text }}>כלי התחבורה שלי</h2>
            <Link to={createPageUrl('Vehicles')}
              className="flex items-center gap-1 text-base font-extrabold" style={{ color: C.green }}>
              ניהול <ChevronLeft className="w-4 h-4" />
            </Link>
          </div>

          {/* Demo banner - prominent */}
          {isShowingDemo && (
            <div className="rounded-2xl p-4 mb-4 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }}>
              <div className="flex items-center gap-3" dir="rtl">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: '#FFBF00' }}>
                  <span className="text-lg">👀</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black" style={{ color: '#92400E' }}>אלו רכבים לדוגמה בלבד</p>
                  <p className="text-xs mt-0.5" style={{ color: '#B45309' }}>כך ייראה המסך שלך - הוסף את כלי התחבורה האמיתי שלך</p>
                </div>
              </div>
            </div>
          )}

          {/* Vehicles list - each card gets its own demo/guest status */}
          {vehiclesToShow.map(v => (
            <VehicleCard key={v.id} vehicle={v} isDemo={!!v._isDemo} isGuestVehicle={!v._isDemo && v.id?.startsWith('guest_')} />
          ))}

          {/* Add vehicle button */}
          <Link to={createPageUrl('AddVehicle')} data-tour="add-vehicle">
            <button className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mb-6 transition-all active:scale-[0.98]"
              style={{ background: C.yellow, color: C.greenDark }}>
              הוספת כלי תחבורה חדש
              <Plus className="w-4 h-4" />
            </button>
          </Link>

          {/* Upcoming reminders */}
          {upcomingReminders.length > 0 && (
            <div>
              <h2 id="dashboard-reminders-title" className="font-black text-2xl mb-4" style={{ color: C.text }} dir="rtl">
                טיפולים קרובים
              </h2>
              <div>
                {upcomingReminders.map(r => <ReminderRow key={r.id} reminder={r} vehicles={vehiclesToShow} />)}
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

  //  Complete Profile Screen (one-time) 
  if (showCompleteProfile && user) {
    return <CompleteProfileScreen user={user} onDone={() => { setShowCompleteProfile(false); setProfileMissing(false); }} />;
  }

  //  AUTHENTICATED MODE 
  if (!accountId || vehiclesLoading) return <LoadingSpinner />;

  // Status severity used when the user sorts by status. most urgent first.
  // Matches the intent on /Vehicles: expired > upcoming > ok.
  const statusRank = (v) => {
    const dates = [v.test_due_date, v.insurance_due_date].map(daysUntil).filter(d => d !== null);
    if (dates.length === 0) return 3;           // no dates → sort last
    const min = Math.min(...dates);
    if (min < 0) return 0;                      // expired
    if (min <= 30) return 1;                    // upcoming
    return 2;                                   // ok
  };

  // Apply search + sort on top of any active category filter.
  const baseList = filteredVehicles !== null ? filteredVehicles : vehicles;
  const q = searchQuery.trim().toLowerCase();
  // Strip dashes/spaces so "1234567" matches a plate stored as "12-345-67".
  const qDigits = q.replace(/\D/g, '');
  const searched = !q ? baseList : baseList.filter(v => {
    const hay = [v.nickname, v.manufacturer, v.model, v.year, v.license_plate]
      .filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) return true;
    // Plate-only fallback: compare digit-by-digit so hyphenation doesn't block.
    if (qDigits.length >= 3 && v.license_plate) {
      const plateDigits = String(v.license_plate).replace(/\D/g, '');
      if (plateDigits.includes(qDigits)) return true;
    }
    return false;
  });
  const sortVehicles = (list) => {
    const arr = [...list];
    switch (sortBy) {
      case 'name':
        return arr.sort((a, b) =>
          String(a.nickname || a.manufacturer || '').localeCompare(String(b.nickname || b.manufacturer || ''), 'he'));
      case 'status':
        return arr.sort((a, b) => statusRank(a) - statusRank(b));
      case 'year':
        return arr.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
      case 'type':
        // Group by vehicle_type (subcategory), then by name within each group.
        // Hebrew-aware locale compare so 'אופנוע' / 'כלי שייט' sort naturally.
        return arr.sort((a, b) => {
          const typeA = String(a.vehicle_type || 'רכב');
          const typeB = String(b.vehicle_type || 'רכב');
          const byType = typeA.localeCompare(typeB, 'he');
          if (byType !== 0) return byType;
          const nameA = String(a.nickname || a.manufacturer || '');
          const nameB = String(b.nickname || b.manufacturer || '');
          return nameA.localeCompare(nameB, 'he');
        });
      case 'updated':
        return arr.sort((a, b) =>
          new Date(b.updated_at || b.created_at || b.created_date || 0) -
          new Date(a.updated_at || a.created_at || a.created_date || 0));
      case 'newest':
      default:
        return arr.sort((a, b) =>
          new Date(b.created_at || b.created_date || 0) -
          new Date(a.created_at || a.created_date || 0));
    }
  };
  const displayedVehicles = sortVehicles(searched);

  // Same vehicle-identification rule as the guest-mode reminders above —
  // subtitle must identify which vehicle, never the insurance company.
  const allReminders = vehicles.flatMap(v => {
    const vc = getVehicleCategory(v.vehicle_type, v.nickname, v.manufacturer);
    const isV = isVesselType(v.vehicle_type, v.nickname);
    const vtw = isV ? 'כושר שייט' : vc === 'motorcycle' ? 'טסט אופנוע' : vc === 'truck' ? 'טסט משאית' : vc === 'offroad' ? `טסט ${v.vehicle_type || 'כלי שטח'}` : 'טסט שנתי';
    const iw = isV ? 'ביטוח ימי' : 'חידוש ביטוח';
    const vLabel = v.nickname
      || [v.manufacturer, v.model].filter(Boolean).join(' ')
      || v.manufacturer
      || '';
    return [
      v.test_due_date      && { id: `${v.id}_test`, vehicle_id: v.id, title: vtw, date: v.test_due_date,      type: 'test',      subtitle: vLabel },
      v.insurance_due_date && { id: `${v.id}_ins`,  vehicle_id: v.id, title: iw,  date: v.insurance_due_date, type: 'insurance', subtitle: vLabel },
    ].filter(Boolean);
  }).sort((a, b) => daysUntil(a.date) - daysUntil(b.date));

  return (
    <div className="-mx-4 -mt-4 pb-4" style={{ background: C.bg, minHeight: '100dvh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <PullToRefreshIndicator pulling={pulling} progress={progress} />
      {/* First-time user tooltip tour. narrowly targeted so we don't annoy
          engaged users. Shown only when:
            (a) The account was created within the last 24h, OR
            (b) The account is >10 days old AND the user still has zero vehicles
                (they never completed onboarding. the tour is the nudge they need).
          The hook self-gates with localStorage so a user who skipped it once
          never sees it again. */}
      {(() => {
        const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0;
        const ageMs = createdAt ? Date.now() - createdAt : 0;
        const dayMs = 24 * 60 * 60 * 1000;
        const noVehicles = (vehicles?.length || 0) === 0;
        // Both "just registered" and "stuck onboarding" sub-conditions
        // require zero vehicles at the source. The earlier code relied
        // on a single outer `!hasAnyVehicle` guard; pushing the check
        // down to each sub-condition makes the gate self-protecting
        // against future refactors.
        const justRegistered = createdAt > 0 && ageMs < dayMs && noVehicles;
        const stuckNoVehicles = createdAt > 0 && ageMs >= 10 * dayMs && noVehicles;
        const shouldTour = isAuthenticated && !isGuest && (justRegistered || stuckNoVehicles);
        // Product decision: tool-tip tours are for brand-new users only.
        // Once any vehicle exists the user has completed setup and doesn't
        // need further hand-holding on this page.
        return <FirstTimeTour enabled={shouldTour} />;
      })()}
      <div className="px-4 pt-6">
        <VehicleCheckHero
          hasVehicles={vehicles.length > 0}
          plate={quickCheckPlate}
          onPlateChange={setQuickCheckPlate}
          onSubmit={openQuickCheck}
          submitting={quickCheckSubmitting}
        />
        <UrgentBanner
          reminders={allReminders}
          onView={() => navigate(createPageUrl('Notifications'))}
        />

        {/* Header with vehicle count */}
        <div className="flex items-center justify-between mb-3" dir="rtl">
          <div>
            <h2 className="font-black text-2xl" style={{ color: C.text }}>כלי התחבורה שלי</h2>
          </div>
          <Link to={createPageUrl('Vehicles')}
            className="flex items-center gap-1 text-sm font-bold" style={{ color: C.green }}>
            ניהול <ChevronLeft className="w-4 h-4" />
          </Link>
        </div>

        {/* Search + sort. visually identical to the /Vehicles page for
            consistency. Only rendered when there are 2+ vehicles to filter. */}
        {vehicles.length > 1 && (
          <div className="flex items-center gap-2 mb-4" dir="rtl">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.muted }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חפש רכב / מספר רישוי..."
                dir="rtl"
                className="w-full h-10 pr-9 pl-3 rounded-xl border text-sm font-medium outline-none transition-all focus:ring-2"
                style={{ background: '#fff', borderColor: C.border, color: C.text, '--tw-ring-color': C.primary }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center hover:bg-gray-100"
                  aria-label="נקה חיפוש">
                  <X className="w-3 h-3" style={{ color: C.muted }} />
                </button>
              )}
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[110px] h-10 rounded-xl text-xs font-bold shrink-0"
                style={{ borderColor: C.border, color: C.text }}>
                <ArrowUpDown className="w-3.5 h-3.5 shrink-0" style={{ color: C.muted }} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="newest" className="text-sm">מהחדש לישן</SelectItem>
                <SelectItem value="name" className="text-sm">שם</SelectItem>
                <SelectItem value="type" className="text-sm">סוג</SelectItem>
                <SelectItem value="status" className="text-sm">סטטוס</SelectItem>
                <SelectItem value="year" className="text-sm">שנת ייצור</SelectItem>
                <SelectItem value="updated" className="text-sm">עודכן לאחרונה</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {vehicles.length === 0 ? (
          <div className="text-center py-16">
            <Car className="w-16 h-16 mx-auto mb-4" style={{ color: C.muted }} />
            <p className="font-bold text-lg mb-1" style={{ color: C.text }}>אין כלי תחבורה עדיין</p>
            <p className="text-sm mb-6" style={{ color: C.muted }}>הוסף את כלי התחבורה הראשון שלך</p>
            <Link to={createPageUrl('AddVehicle')} data-tour="add-vehicle">
              <button className="px-8 py-3 rounded-2xl font-bold"
                style={{ background: C.yellow, color: C.greenDark }}>
                הוסף כלי תחבורה
              </button>
            </Link>
          </div>
        ) : (
          <>
            {/* Status summary cards */}
            <StatusSummary vehicles={vehicles} />

            {/* Compact vehicle list. The first row gets a data-tour hook
                for the post-first-save walkthrough. */}
            {displayedVehicles.map((vehicle, idx) => (
              <div key={vehicle.id} data-tour={idx === 0 ? 'dash-first-vehicle' : undefined}>
                <VehicleRow vehicle={vehicle} />
              </div>
            ))}

            {/* Add vehicle button */}
            <Link to={createPageUrl('AddVehicle')} data-tour="add-vehicle">
              <button className="w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 mb-6 transition-all active:scale-[0.98]"
                style={{ background: C.yellow, color: C.greenDark }}>
                הוספת כלי תחבורה חדש
                <Plus className="w-4 h-4" />
              </button>
            </Link>

            {/* Upcoming reminders from all vehicles */}
            {allReminders.length > 0 && (
              <div>
                <h2 id="dashboard-reminders-title" className="font-black text-2xl mb-4" style={{ color: C.text }} dir="rtl">
                  תזכורות קרובות
                </h2>
                <div className="rounded-3xl px-4" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 2px 16px rgba(45,82,51,0.07)' }}>
                  {allReminders.slice(0, 6).map(r => <ReminderRow key={r.id} reminder={r} vehicles={vehicles} />)}
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
