import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Edit, FileText, Lock, Car, Ship, Calendar, Shield, ChevronLeft, ChevronDown, ChevronUp, Bike, Truck, Bell, Share2, Loader2, Search } from "lucide-react";
import ShareVehicleDialog from "@/components/sharing/ShareVehicleDialog";
import SharedIndicator from "@/components/sharing/SharedIndicator";
import VehicleAccessModal from "@/components/sharing/VehicleAccessModal";
import SharingHelpButton from "@/components/sharing/SharingHelpButton";
import { toast } from "sonner";
import { getTheme, isVesselType, getVehicleCategory } from '@/lib/designTokens';
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import VehicleImage, { hasVehiclePhoto } from "../components/shared/VehicleImage";

// First-time walkthrough of the vehicle detail page (cars/motorcycles/etc).
// Fires once per user the first time they open any non-vessel vehicle.
const CAR_DETAIL_TOUR_STEPS = [
  {
    key: 'vd-reminders',
    title: 'תזכורות וחידושים',
    body: 'תאריכי טסט, ביטוח וטיפולים שמתקרבים. נזכיר בזמן, לא ברגע שיפוג התוקף.',
  },
  {
    key: 'vd-maintenance',
    title: 'טיפולים ותיקונים',
    body: 'כל טיפול או תיקון שנעשה לרכב. הוסף חדש או עיין בהיסטוריה.',
  },
  {
    key: 'vd-corkboard',
    title: 'לוח הודעות אישי',
    body: 'מקום לרשום הערות, מספרי טלפון חשובים ולהצמיד תמונות.',
  },
];

// Vessel-specific walkthrough. Maritime terminology, teal palette.
// Fires once per user the first time they open any vessel.
const VESSEL_DETAIL_TOUR_STEPS = [
  {
    key: 'vd-reminders',
    title: 'תעודות ומועדים',
    body: 'כושר שייט, ביטוח ימי ופירוטכניקה. נזכיר לפני שיפוג התוקף, לא אחרי.',
  },
  {
    key: 'vd-checklists',
    title: 'צ׳ק ליסטים לים',
    body: 'בדיקות לפני הנעת מנוע, הכנה ליציאה וסיום לאחר חזרה. ערוך רשימות משלך ושמור.',
  },
  {
    key: 'vd-maintenance',
    title: 'יומן תחזוקה',
    body: 'טיפולים, תיקונים ושעות מנוע. כל ההיסטוריה של הכלי במקום אחד.',
  },
  {
    key: 'vd-corkboard',
    title: 'לוח הקברניט',
    body: 'הערות, אנשי קשר מהמרינה ותמונות מהים. לוח אישי שלך.',
  },
];
import VehicleInfoSection from "../components/vehicle/VehicleInfoSection";
import MaintenanceSection from "../components/vehicle/MaintenanceSection";
import VesselIssuesSection from "../components/vehicle/VesselIssuesSection";
import CorkBoard from "../components/vehicle/CorkBoard";
import GuestVesselChecklistsPreview from "../components/vehicle/GuestVesselChecklistsPreview";
import { SafeComponent } from "../components/shared/SafeComponent";
import { useAuth } from "../components/shared/GuestContext";
import useAccountRole from '@/hooks/useAccountRole';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { canEdit, canDelete, isViewOnly } from '@/lib/permissions';
import { daysUntil } from '../components/shared/ReminderEngine';
import { getDateStatus, getVehicleLabels, usesHours } from '../components/shared/DateStatusUtils';
import StatusBadge from '../components/shared/StatusBadge';
import LicensePlate from '../components/shared/LicensePlate';


//  Inline Reminders Section 
function RemindersPreview({ vehicle, T }) {
  const [open, setOpen] = useState(false);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);
  const items = [
    vehicle.test_due_date && { icon: Calendar, label: labels.testWord, date: vehicle.test_due_date, status: getDateStatus(vehicle.test_due_date) },
    vehicle.insurance_due_date && { icon: Shield, label: labels.insuranceWord || 'ביטוח', date: vehicle.insurance_due_date, status: getDateStatus(vehicle.insurance_due_date) },
    // Periodic inspection certificate (תסקיר). Optional everywhere;
    // surfaces here only when set. Mainly relevant for CME (forklifts,
    // excavators, telehandlers) but exposed for any vehicle.
    vehicle.inspection_report_expiry_date && { icon: FileText, label: 'תסקיר', date: vehicle.inspection_report_expiry_date, status: getDateStatus(vehicle.inspection_report_expiry_date) },
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3" style={{ background: T.light }}>
        <Bell className="w-4 h-4" style={{ color: T.primary }} />
        <span className="text-sm font-bold" style={{ color: T.text }}>תזכורות</span>
        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: T.primary, color: '#fff' }}>{items.length}</span>
        {open
          ? <ChevronUp className="w-4 h-4 mr-auto" style={{ color: T.primary }} />
          : <ChevronDown className="w-4 h-4 mr-auto" style={{ color: T.primary }} />
        }
      </button>
      {open && (
        <div className="divide-y" style={{ borderColor: `${T.border}60` }}>
          {items.map(item => (
            <div key={item.label} className="flex items-center gap-3 px-4 py-3">
              <item.icon className="w-4 h-4 shrink-0" style={{ color: T.muted }} />
              <span className="text-sm font-bold flex-1" style={{ color: T.text }}>{item.label}</span>
              <StatusBadge status={item.status.status} label={item.status.label} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

//  Inline Documents Preview 
function DocumentsPreview({ vehicleId, documents, T }) {
  const vehicleDocs = (documents || []).filter(d => d.vehicle_id === vehicleId).slice(0, 4);
  if (vehicleDocs.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
      <div className="flex items-center gap-2 px-4 py-3" style={{ background: T.light }}>
        <FileText className="w-4 h-4" style={{ color: T.primary }} />
        <span className="text-sm font-bold" style={{ color: T.text }}>מסמכים</span>
        <span className="text-xs font-bold px-1.5 py-0.5 rounded-full mr-auto" style={{ background: T.primary, color: '#fff' }}>{vehicleDocs.length}</span>
      </div>
      <div className="divide-y" style={{ borderColor: `${T.border}60` }}>
        {vehicleDocs.map(doc => {
          const expStatus = doc.expiry_date ? getDateStatus(doc.expiry_date) : null;
          return (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="w-4 h-4 shrink-0" style={{ color: T.muted }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: T.text }}>{doc.title}</p>
                <p className="text-xs" style={{ color: T.muted }}>{doc.document_type}</p>
              </div>
              {expStatus && <StatusBadge status={expStatus.status} label={expStatus.label} />}
            </div>
          );
        })}
      </div>
      <Link to={`${createPageUrl('Documents')}?vehicle_id=${vehicleId}`}>
        <div className="px-4 py-2.5 text-center text-xs font-bold" style={{ color: T.primary, borderTop: `1px solid ${T.border}60` }}>
          כל המסמכים →
        </div>
      </Link>
    </div>
  );
}

//  Vehicle icon helper 
const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };
function getVehicleIcon(vehicleType, nickname, manufacturer) {
  return ICON_MAP[getVehicleCategory(vehicleType, nickname, manufacturer)] || Car;
}

//  Helper: vessel-aware label 
function vehicleWord(vt, nn) { return isVesselType(vt, nn) ? 'כלי שייט' : 'רכב'; }

//  Guest vehicle detail 
function GuestVehicleDetail({ vehicle, vehicleId }) {
  const { removeGuestVehicle, guestDocuments } = useAuth();
  const navigate = useNavigate();
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const vWord = vehicleWord(vehicle.vehicle_type, vehicle.nickname);
  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || vWord;
  const subtitle = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ');
  const hasPhoto = hasVehiclePhoto(vehicle);

  const handleDelete = () => {
    removeGuestVehicle(vehicleId);
    navigate(createPageUrl('Dashboard'));
  };

  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  // usesHours covers vessels, off-road toys (RZR / מיול), every CME
  // subtype (forklifts, excavators, loaders…) and tractors. Used for
  // the stats bar + reminders below so a forklift shows "שעות מנוע"
  // instead of the misleading "קילומטראז׳: -" the bare isVessel check
  // was rendering.
  const isHoursVehicle = usesHours(vehicle);
  const testDays = daysUntil(vehicle.test_due_date);
  const insDays = daysUntil(vehicle.insurance_due_date);
  // Inspection report ("תסקיר") expiry — surfaced in the dates row
  // for any non-vessel vehicle with an inspection date set. Vessels
  // have כושר שייט instead so we hide it for them.
  const inspectionDays = daysUntil(vehicle.inspection_report_expiry_date);
  const needsAction = (testDays !== null && testDays <= 60) || (insDays !== null && insDays <= 60);
  const statusBadge = needsAction
    ? { label: 'תחזוקה נדרשת', bg: T.yellow, color: T.primary }
    : { label: 'תקין', bg: '#E8F5E9', color: '#2E7D32' };

  function daysLabel(d) {
    if (d === null) return '-';
    if (d < 0) return 'פג תוקף';
    if (d === 0) return 'היום';
    if (d < 30) return `${d} ימים`;
    return `${Math.round(d / 30)} חודשים`;
  }

  return (
    <div className="-mx-4 -mt-4" dir="rtl">
      {/* Hero card - matches Dashboard style */}
      <div className="rounded-b-3xl overflow-hidden" style={{ boxShadow: `0 8px 32px ${T.primary}25` }}>
        {/* Photo / gradient */}
        <div className="relative" style={{ height: hasPhoto ? '220px' : '150px' }}>
          {hasPhoto ? (
            <VehicleImage vehicle={vehicle} alt={name} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: '50% 55%' }} />
          ) : (
            <div className="absolute inset-0" style={{ background: T.grad }} />
          )}
          <div className="absolute inset-0" style={{ background: hasPhoto ? 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.1) 100%)' : 'none' }} />

          {/* Back button → Dashboard for guests */}
          <Link to={createPageUrl('Dashboard')} className="absolute top-4 right-4 z-20">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <ChevronLeft className="w-5 h-5 text-white" style={{ transform: 'rotate(180deg)' }} />
            </div>
          </Link>

          {/* License plate. top-left identity chip (if available).
              Falls back to the status badge when the vehicle has no plate
              (guest demo cars without a license number). */}
          {vehicle.license_plate && !isVessel ? (
            <div className="absolute top-4 left-4 z-20">
              <LicensePlate value={vehicle.license_plate} size="sm" showCopy />
            </div>
          ) : (
            <div className="absolute top-4 left-4 z-10">
              <span className="text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm"
                style={{ background: statusBadge.bg, color: statusBadge.color }}>
                {statusBadge.label}
              </span>
            </div>
          )}

          {/* No-photo icon */}
          {!hasPhoto && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-3xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <VehicleIcon className="w-12 h-12" style={{ color: 'rgba(255,255,255,0.5)', strokeWidth: 1.5 }} />
              </div>
            </div>
          )}

          {/* Vehicle name + subtitle */}
          <div className="absolute bottom-4 right-4 left-4 z-10">
            <h1 className="font-bold text-white leading-tight" style={{ fontSize: '1.75rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{name}</h1>
            <p className="text-base font-semibold mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>{subtitle}</p>
          </div>
        </div>

        {/* Stats bar - like Dashboard */}
        <div className="grid grid-cols-3" style={{ background: '#fff' }}>
          {[
            // Hours vs km — driven by usesHours() so the row reads correctly
            // for forklifts / excavators / rollers / tractors / RZRs / vessels.
            { label: isHoursVehicle ? 'שעות מנוע' : 'קילומטראז\'',
              value: isHoursVehicle
                ? (vehicle.current_engine_hours ? Number(vehicle.current_engine_hours).toLocaleString() : '-')
                : (vehicle.current_km ? Number(vehicle.current_km).toLocaleString() : '-') },
            { label: 'שנת ייצור', value: vehicle.year || '-' },
            { label: isVessel ? 'כושר שייט' : 'טסט', value: testDays !== null ? daysLabel(testDays) : '-' },
          ].map((stat, i) => (
            <div key={i} className={`py-4 px-3 text-center ${i < 2 ? 'border-l' : ''}`}
              style={{ borderColor: T.border }}>
              <p className="font-bold text-base" style={{ color: T.text }}>{stat.value}</p>
              <p className="text-sm mt-1 font-bold" style={{ color: T.muted }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons - clean, outlined */}
      <div className="px-4 mt-4 flex gap-2 mb-3">
        <Link to={createPageUrl(`EditVehicle?id=${vehicleId}`)} className="flex-1">
          <button className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: '#fff', color: T.primary, border: `1.5px solid ${T.border}` }}>
            עריכה <Edit className="h-4 w-4" />
          </button>
        </Link>
        <Link to={createPageUrl(`Documents?vehicle_id=${vehicleId}`)}>
          <button className="py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: '#fff', color: '#6B7280', border: '1.5px solid #E5E7EB' }}>
            מסמכים <FileText className="h-4 w-4" />
          </button>
        </Link>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="py-3 px-3 rounded-xl font-bold text-sm flex items-center justify-center transition-all active:scale-[0.98]"
              style={{ background: '#fff', color: '#DC2626', border: '1.5px solid #FECACA' }}>
              <Trash2 className="h-4 w-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>מחיקת {vWord}</AlertDialogTitle>
              <AlertDialogDescription>פעולה זו תמחק את ה{vWord} מהמכשיר שלך. לא ניתן לבטל.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex gap-2 justify-end">
              <AlertDialogCancel>ביטול</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">מחק</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Demo / Guest banner */}
      {vehicle._isDemo ? (
        <div className="mx-4 mb-4 rounded-2xl p-3.5 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }}>
          <Car className="h-5 w-5 shrink-0" style={{ color: '#92400E' }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#92400E' }}>{vWord} לדוגמה</p>
            <p className="text-xs" style={{ color: '#B45309' }}>הוסף את ה{vWord} האמיתי שלך כדי להתחיל</p>
          </div>
        </div>
      ) : (
        <div className="mx-4 mb-4 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: T.yellowSoft, border: `1px solid ${T.border}` }}>
          <Lock className="h-4 w-4 shrink-0" style={{ color: T.primary }} />
          <p className="text-sm font-medium" style={{ color: T.text }}>
            {vWord} זמני - נשמר במכשיר בלבד.{' '}
            <Link to={createPageUrl('Auth')} className="underline font-bold" style={{ color: T.primary }}>הירשם כדי לשמור</Link>
          </p>
        </div>
      )}

      {/* Vehicle info */}
      <div className="px-4 space-y-4 pb-8">
        <SafeComponent label="VehicleInfoSection">
          <VehicleInfoSection vehicle={vehicle} />
        </SafeComponent>

        {/* Inline reminders */}
        <RemindersPreview vehicle={vehicle} T={T} />

        {/* Inline documents */}
        <DocumentsPreview vehicleId={vehicleId} documents={guestDocuments} T={T} />

        {/* Vessel-only: read-only preview of the pre/engine/post
            checklists. The auth flow surfaces a real entry card
            that opens /ChecklistHub; for guests we render a static
            preview so they can see what the feature looks like
            without needing real DB rows. Footer CTA prompts signup
            to "activate" the checklists. */}
        {isVessel && (
          <SafeComponent label="GuestVesselChecklistsPreview">
            <GuestVesselChecklistsPreview />
          </SafeComponent>
        )}

        <SafeComponent label="CorkBoard">
          <CorkBoard vehicle={vehicle} isGuest />
        </SafeComponent>
      </div>
    </div>
  );
}

//  Main component 
export default function VehicleDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const vehicleId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isGuest, user, guestVehicles } = useAuth();

  // Guard: someone landed here without an id (bad link, typo, stale share).
  // Previously we'd show a spinner forever. Now show a friendly message
  // + CTA back to the list.
  if (!vehicleId) {
    return (
      <div dir="rtl" className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="mb-4 flex justify-center" aria-hidden="true">
            <Car className="h-14 w-14" style={{ color: '#2D5233' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#1C2E20' }}>לא בחרנו רכב</h1>
          <p className="text-sm mb-6" style={{ color: '#6B7280' }}>
            נראה שהגעת לכאן בלי לבחור רכב. חזור לרשימה כדי לבחור אחד.
          </p>
          <button
            onClick={() => navigate('/Vehicles')}
            className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #2D5233 0%, #4B7A53 100%)', color: '#fff' }}>
            חזרה לרשימת הרכבים
          </button>
        </div>
      </div>
    );
  }

  // Guest vehicle - load from local state
  if (isGuest || vehicleId.startsWith('guest_') || vehicleId.startsWith('demo_')) {
    const guestVehicle = guestVehicles.find(v => v.id === vehicleId);
    if (!guestVehicle) {
      // Valid id format but not found in local storage. same friendly fallback
      return (
        <div dir="rtl" className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center">
            <div className="mb-4 flex justify-center" aria-hidden="true">
              <Search className="h-14 w-14" style={{ color: '#2D5233' }} />
            </div>
            <h1 className="text-xl font-bold mb-2" style={{ color: '#1C2E20' }}>הרכב לא נמצא</h1>
            <p className="text-sm mb-6" style={{ color: '#6B7280' }}>
              ייתכן שהרכב נמחק או שהקישור פג תוקף.
            </p>
            <button
              onClick={() => navigate('/Vehicles')}
              className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #2D5233 0%, #4B7A53 100%)', color: '#fff' }}>
              חזרה לרשימת הרכבים
            </button>
          </div>
        </div>
      );
    }
    return <GuestVehicleDetail vehicle={guestVehicle} vehicleId={vehicleId} />;
  }

  // Authenticated vehicle
  return <AuthVehicleDetail vehicleId={vehicleId} navigate={navigate} queryClient={queryClient} />;
}

function AuthVehicleDetail({ vehicleId, navigate, queryClient }) {
  const { user } = useAuth();
  const { role } = useAccountRole();
  // The vehicle-share workflow is a personal-account concept (one user
  // sharing their car with family/friends). In a business workspace
  // sharing is replaced by driver assignments, so we hide the share
  // controls here and the manager uses the Drivers page instead.
  const { isBusiness, isDriver, canManageRoutes } = useWorkspaceRole();
  // A driver in a business workspace can VIEW their assigned vehicle's
  // details but cannot edit, delete, or share it — that's the manager's
  // responsibility. We pre-compute one flag and use it to gate the
  // action cluster + delete button + edit affordances below.
  const driverReadOnly = isBusiness && isDriver && !canManageRoutes;
  const [accountIds, setAccountIds] = useState([]);

  useEffect(() => {
    if (!user) return;
    async function init() {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      setAccountIds(members.map(m => m.account_id));
    }
    init();
  }, []);

  // Vehicle query goes through my_vehicles_v so sharees (recipients of
  // accepted vehicle_shares) can open the page too. The previous version
  // looped account_ids the user belongs to and did `vehicles.filter({id,
  // account_id})` — which never matched a vehicle the user doesn't own,
  // so accepted sharees got an "אין לך גישה לרכב זה" screen.
  // my_vehicles_v RLS already restricts rows to (owned ∪ accepted-shared),
  // so this is the right entry point for both modes.
  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicle', vehicleId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('my_vehicles_v')
        .select('*')
        .eq('id', vehicleId)
        .limit(1);
      if (error) throw error;
      return data || [];
    },
    enabled: !!vehicleId && !!user?.id,
    refetchOnMount: 'always',
    staleTime: 2 * 60 * 1000,
  });

  const vehicle = vehicles[0];

  // Hash-based deep link → scroll to a named section once the vehicle
  // has loaded. Used by /MyExpenses to land the user on the maintenance
  // log when they tap a treatment/repair row from the expenses list.
  // Single allowlist of valid hashes so we don't try to scroll to
  // arbitrary garbage from a malformed URL.
  useEffect(() => {
    if (!vehicle) return;
    const hash = (window.location.hash || '').replace(/^#/, '');
    const allowed = new Set(['vd-maintenance', 'vd-corkboard']);
    if (!allowed.has(hash)) return;
    // Two rAFs so the DOM has the chance to lay out the section we're
    // scrolling to (sections lazy-render via SafeComponent).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }, [vehicle?.id]);

  // One-time auto-enrich: if vehicle has license plate but missing tech spec fields, fetch from gov API
  const [enrichDone, setEnrichDone] = useState(false);
  useEffect(() => {
    if (!vehicle || enrichDone || !vehicle.license_plate) return;
    if (isVesselType(vehicle.vehicle_type, vehicle.nickname)) return; // Vessels don't use gov API
    const specFields = ['model_code','trim_level','vin','pollution_group','vehicle_class','safety_rating',
      'horsepower','engine_cc','drivetrain','total_weight','doors','seats','airbags',
      'transmission','body_type','country_of_origin','co2','green_index','tow_capacity',
      // gov.il enrichment (v6): odometer @ last test + ownership history
      // count + personal-import flag. A vehicle missing any of these
      // qualifies for a re-fetch even if the spec fields above are
      // already filled. Note: is_personal_import defaults to false in
      // DB, so we DON'T add it to the missing-check (we'd refetch
      // forever for non-imported cars). Personal-import gets backfilled
      // organically when v6 fires for any other reason.
      'current_km','ownership_hand'];
    const missing = specFields.filter(f => !vehicle[f]);
    if (missing.length === 0) { setEnrichDone(true); return; }
    // Check localStorage flag — only try once per vehicle per version.
    // v6: bumped from v5 to wire in the personal-import dataset so
    // existing vehicles get re-checked once for the import flag.
    const enrichKey = `enriched_v6_${vehicle.id}`;
    if (localStorage.getItem(enrichKey)) { setEnrichDone(true); return; }
    (async () => {
      try {
        const { lookupVehicleByPlate } = await import('../services/vehicleLookup');
        const govData = await lookupVehicleByPlate(vehicle.license_plate);
        if (!govData) { localStorage.setItem(enrichKey, '1'); setEnrichDone(true); return; }
        const allFields = ['engine_model','model_code','trim_level','vin','pollution_group',
          'vehicle_class','safety_rating','front_tire','rear_tire','color','ownership',
          'first_registration_date','fuel_type',
          'horsepower','engine_cc','drivetrain','total_weight','doors','seats','airbags',
          'transmission','body_type','country_of_origin','co2','green_index','tow_capacity',
          // Gov.il enrichment additions — backfills the new fields
          // for vehicles that pre-date the dataset integration.
          'current_km','ownership_hand','ownership_history',
          'is_personal_import','personal_import_type'];
        const update = {};
        allFields.forEach(f => { if (govData[f] && !vehicle[f]) update[f] = govData[f]; });
        if (Object.keys(update).length > 0) {
          // Try batch update first (1 call), fallback to per-field if columns missing
          try {
            await db.vehicles.update(vehicle.id, update);
          } catch {
            // Some columns may not exist - retry per field
            for (const [key, val] of Object.entries(update)) {
              try { await db.vehicles.update(vehicle.id, { [key]: val }); } catch {}
            }
          }
          queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
        }
        localStorage.setItem(`enriched_v4_${vehicle.id}`, '1');
      } catch {}
      setEnrichDone(true);
    })();
  }, [vehicle?.id, enrichDone]);

  const vehicleIsOwned = vehicle && accountIds.length > 0 && accountIds.includes(vehicle.account_id);

  // Sharing state — driven by `vehicle_shares` rows for THIS vehicle.
  // shareCount = accepted shares the owner has granted (drives the
  //              "👥 N" pill on the owner's view).
  // mySharedAccess = the row where the current user is the recipient
  //                  (drives the "משותף איתי" pill + leave button).
  const { data: shareInfo } = useQuery({
    queryKey: ['vehicle-share-info', vehicleId, user?.id],
    queryFn: async () => {
      if (!vehicleId) return { shareCount: 0, mySharedAccess: null };
      // The vshare_select RLS policy only returns rows where the caller
      // is either the owner or the recipient — safe to query directly.
      const { data, error } = await supabase
        .from('vehicle_shares')
        .select('id, status, role, shared_with_user_id, owner_user_id')
        .eq('vehicle_id', vehicleId);
      if (error) return { shareCount: 0, mySharedAccess: null };
      const accepted = (data || []).filter(r => r.status === 'accepted');
      const mine = accepted.find(r => r.shared_with_user_id === user?.id);
      return { shareCount: accepted.length, mySharedAccess: mine || null };
    },
    enabled: !!vehicleId && !!user?.id,
    staleTime: 30 * 1000,
  });
  const shareCount = shareInfo?.shareCount ?? 0;
  const isSharedWithMe = !!shareInfo?.mySharedAccess;

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Two delete paths:
  //   * Owner of an unshared vehicle → straight delete (current behavior)
  //   * Owner of a shared vehicle → DB call with mode='both' which
  //     notifies all recipients before cascade-deleting the row
  //   * Recipient of a shared vehicle → mode='self_leave' which just
  //     revokes their own access, leaving the vehicle intact for owner
  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (vehicleIsOwned) {
        if (shareCount > 0) {
          // Routes through the SECURITY DEFINER RPC so all recipients
          // get a 'share_deleted' notification before we drop the row.
          const { error } = await supabase.rpc('delete_vehicle_with_share_choice', {
            p_vehicle_id: vehicleId,
            p_mode: 'both',
          });
          if (error) throw error;
        } else {
          await db.vehicles.delete(vehicleId);
        }
        toast.success('הרכב נמחק');
      } else if (isSharedWithMe) {
        // Sharee leaves the share — vehicle stays with the owner.
        const { error } = await supabase.rpc('delete_vehicle_with_share_choice', {
          p_vehicle_id: vehicleId,
          p_mode: 'self_leave',
        });
        if (error) throw error;
        toast.success('הוסרת מהשיתוף');
      } else {
        toast.error('אין הרשאה למחוק');
        setDeleting(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles-list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] });
      navigate(createPageUrl('Dashboard'));
    } catch (e) {
      toast.error(`שגיאה במחיקה: ${e?.message || 'נסה שוב'}`);
      setDeleting(false);
    }
  };

  if (isLoading || accountIds.length === 0) return <LoadingSpinner />;

  // Vehicle loaded but neither owned nor shared-with-me → access denied.
  // RLS already enforces this server-side; the client check is a faster
  // fail-fast and a friendlier error than rendering an empty page when
  // the underlying queries return null.
  if (!vehicle || (!vehicleIsOwned && !isSharedWithMe)) {
    return (
      <div className="text-center py-20 text-gray-500" dir="rtl">
        <p className="text-lg font-medium">הרכב לא נמצא</p>
        <p className="text-sm mt-1">אין לך גישה לרכב זה.</p>
      </div>
    );
  }

  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const name = vehicle.nickname || `${vehicle.manufacturer || ''} ${vehicle.model || ''}`.trim() || (isVessel ? 'כלי שייט' : 'רכב');
  const subtitle = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ');
  const hasPhoto = hasVehiclePhoto(vehicle);

  return (
    <div className="-mx-4 -mt-4" dir="rtl">
      {/*  Hero Card  */}
      <div className="relative overflow-hidden" style={{ height: hasPhoto ? '220px' : '150px' }}>
        {hasPhoto ? (
          <VehicleImage vehicle={vehicle} alt={name}
            className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: '50% 55%' }} />
        ) : (
          <div className="absolute inset-0" style={{ background: T.grad }} />
        )}
        <div className="absolute inset-0" style={{
          background: hasPhoto
            ? 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.15) 60%, rgba(0,0,0,0.05) 100%)'
            : 'none'
        }} />

        {/* Back button → Vehicles list */}
        <Link to={createPageUrl('Vehicles')} className="absolute top-4 right-4 z-20">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-sm"
            style={{ background: 'rgba(255,255,255,0.2)' }}>
            <ChevronLeft className="w-5 h-5 text-white" style={{ transform: 'rotate(180deg)' }} />
          </div>
        </Link>

        {/* Top-left stack: license plate + share controls.
            Owner of a non-shared vehicle    → ShareButton only
            Owner of a shared vehicle        → ShareButton + indicator pill
                                                (pill opens VehicleAccessModal)
            Recipient ("shared with me")     → indicator pill only — opens
                                                modal with the "leave share"
                                                action.
            The pill always reflects the current count fetched via the
            useQuery above; clicks are intercepted (stopPropagation on the
            button) so they don't bubble through the hero gradient. */}
        <div className="absolute top-4 left-4 z-20 flex flex-col items-start gap-2">
          {vehicle.license_plate && !isVessel && (
            <LicensePlate value={vehicle.license_plate} size="sm" showCopy />
          )}
          <div className="flex items-center gap-2">
            {vehicleIsOwned && !isViewOnly(role) && isBusiness && !driverReadOnly && (
              // Business swap-in for the share cluster: there is no
              // "share with email" in a fleet workspace, so we surface
              // the equivalent action a manager actually wants from
              // here — assigning a driver. Routes back to the Drivers
              // page so the manager picks the driver from the workspace
              // directory rather than free-text email entry. Drivers
              // shouldn't see this — /Drivers itself is manager-only
              // and would reject them with a permission error.
              <Link
                to={createPageUrl('Drivers')}
                className="h-9 px-3 rounded-2xl flex items-center gap-1.5 transition-all active:scale-95"
                style={{ background: '#2D5233', color: '#fff', boxShadow: '0 2px 6px rgba(45,82,51,0.35)' }}
                aria-label="שייך נהג לרכב"
                title="שייך נהג"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">שייך נהג</span>
              </Link>
            )}
            {vehicleIsOwned && !isViewOnly(role) && !isBusiness && (
              // Share-controls cluster. Both buttons share the same
              // amber/gold palette so they read as a single sharing
              // module rather than two unrelated affordances. The
              // share button is the *primary* action (filled amber,
              // white icon), the "i" is *secondary* (light amber,
              // dark icon) — same family, clear hierarchy.
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-2xl backdrop-blur-md"
                style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 4px 14px rgba(180,83,9,0.18)' }}>
                <button
                  type="button"
                  onClick={() => setShareDialogOpen(true)}
                  className="h-8 px-2.5 rounded-xl flex items-center gap-1.5 transition-all active:scale-95"
                  style={{ background: '#F59E0B', color: '#fff', boxShadow: '0 2px 6px rgba(245,158,11,0.35)' }}
                  aria-label="שתף את הרכב"
                  title="שיתוף הרכב">
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold">שיתוף</span>
                </button>
                <SharingHelpButton size="sm" />
              </div>
            )}
            {!isBusiness && (shareCount > 0 || isSharedWithMe) && (
              <SharedIndicator
                shareCount={shareCount}
                isSharedWithMe={isSharedWithMe}
                size="md"
                onClick={() => setAccessModalOpen(true)}
              />
            )}
          </div>
        </div>

        {/* No-photo vehicle icon */}
        {!hasPhoto && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.1)' }}>
              <VehicleIcon className="w-12 h-12" style={{ color: 'rgba(255,255,255,0.5)', strokeWidth: 1.5 }} />
            </div>
          </div>
        )}

        {/* Name overlay */}
        <div className="absolute bottom-4 right-4 left-4 z-10">
          <h1 className="font-bold text-white text-2xl leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            {name}
          </h1>
          <p className="text-sm mt-1 font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>{subtitle}</p>
        </div>
      </div>

      {/*  View-only banner for חבר  */}
      {isViewOnly(role) && (
        <div className="mx-4 mb-3 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-sm font-medium" style={{ background: '#DBEAFE', color: '#1E40AF', border: '1px solid #93C5FD' }} dir="rtl">
          הצטרפת כחבר - תצוגה בלבד
        </div>
      )}

      {/*  Action buttons — driverReadOnly hides עריכה / מחיקה for
           drivers in business mode. They can still open Documents
           (filtered to their assigned vehicles already). */}
      <div className="px-4 -mt-5 relative z-20 flex gap-2 mb-4">
        {canEdit(role) && !driverReadOnly && (
          <Link to={createPageUrl(`EditVehicle?id=${vehicleId}`)}>
            <button className="py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ background: T.yellow, color: T.primary, boxShadow: `0 4px 12px ${T.yellow}40` }}>
              עריכה
              <Edit className="h-4 w-4" />
            </button>
          </Link>
        )}
        <Link to={createPageUrl(`Documents?vehicle_id=${vehicleId}`)}>
          <button className="py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: T.light, color: T.primary, border: `1.5px solid ${T.border}` }}>
            מסמכים
            <FileText className="h-4 w-4" />
          </button>
        </Link>
        {(canDelete(role) || isSharedWithMe) && !driverReadOnly && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: '#FEF2F2', color: '#DC2626', border: '1.5px solid #FECACA' }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isSharedWithMe
                    ? 'יציאה מהשיתוף'
                    : shareCount > 0
                      ? `מחיקת ה${isVessel ? 'כלי שייט' : 'רכב'} המשותף`
                      : `מחיקת ${isVessel ? 'כלי שייט' : 'רכב'}`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isSharedWithMe ? (
                    <>הרכב יוסר מהרשימה שלך. הבעלים והמשתתפים האחרים ימשיכו לראות אותו כרגיל.</>
                  ) : shareCount > 0 ? (
                    <>
                      הרכב משותף עם עוד <strong>{shareCount}</strong> משתמשים. המחיקה תסיר אותו ואת כל המידע מכולם, וכולם יקבלו על כך התראה. הפעולה אינה הפיכה.
                    </>
                  ) : (
                    <>פעולה זו תמחק את ה{isVessel ? 'כלי שייט' : 'רכב'} וכל המידע המשויך אליו. הפעולה אינה הפיכה.</>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-row-reverse gap-2">
                <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : (isSharedWithMe ? 'יציאה מהשיתוף' : 'מחק')}
                </AlertDialogAction>
                <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Sharing dialogs — rendered once at the top level so the share
          button + indicator above can open them without prop-drilling. */}
      <ShareVehicleDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        vehicle={vehicle}
      />
      <VehicleAccessModal
        open={accessModalOpen}
        onOpenChange={setAccessModalOpen}
        vehicle={vehicle}
        isOwner={vehicleIsOwned}
      />

      {/* Tool-tip tours intentionally disabled on this page. Reaching
          VehicleDetail implies the user already has at least one vehicle,
          and per product decision the tours are reserved for first-time
          users with zero vehicles. Components kept imported for future
          use but not rendered. */}

      {/*  Vehicle info + maintenance  */}
      <div className="px-4 space-y-4 pb-8">
        <SafeComponent label="VehicleInfoSection">
          <VehicleInfoSection vehicle={vehicle} />
        </SafeComponent>

        {/* Inline reminders */}
        <div data-tour="vd-reminders">
          <RemindersPreview vehicle={vehicle} T={T} />
        </div>

        {/* Pre/Post-trip checklists. vessels only. CTA card opens the
            dedicated /ChecklistHub page where the user actually runs the
            checklist. Keeping a lightweight entry point here preserves
            discoverability from the vessel page. */}
        {isVessel && (
          <div data-tour="vd-checklists">
            <ChecklistsEntryCard vehicleId={vehicle.id} navigate={navigate} />
          </div>
        )}

        <div id="vd-maintenance" data-tour="vd-maintenance" style={{ scrollMarginTop: '90px' }}>
          <SafeComponent label="MaintenanceSection">
            <MaintenanceSection vehicle={vehicle} />
          </SafeComponent>
        </div>
        {/* Vessel-only: list of open/active issues on the boat. Checklist
            runs can auto-push issues here via the opt-in checkbox. */}
        {isVessel && (
          <SafeComponent label="VesselIssuesSection">
            <VesselIssuesSection vehicle={vehicle} readOnly={isViewOnly(role)} />
          </SafeComponent>
        )}
        <div data-tour="vd-corkboard">
          <SafeComponent label="CorkBoard">
            <CorkBoard vehicle={vehicle} readOnly={isViewOnly(role)} />
          </SafeComponent>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Entry card for the vessel-only checklist hub.                              */
/* Kept minimal on purpose. the full experience lives on /ChecklistHub.      */
/* -------------------------------------------------------------------------- */

function ChecklistsEntryCard({ vehicleId, navigate }) {
  const handleOpen = () => {
    navigate(`${createPageUrl('ChecklistHub')}?vehicleId=${vehicleId}`);
  };
  return (
    <button onClick={handleOpen}
      className="w-full text-right rounded-2xl p-4 transition-all active:translate-y-px"
      style={{
        background: 'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)',
        boxShadow: '0 6px 20px rgba(12,123,147,0.28)',
        color: '#fff',
      }} dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base">צ'ק ליסטים</p>
          <p className="text-xs opacity-85 mt-0.5">בדיקות מנוע, לפני יציאה וסיום. לחץ כדי להתחיל.</p>
        </div>
        <div className="text-white/80 text-lg">←</div>
      </div>
    </button>
  );
}