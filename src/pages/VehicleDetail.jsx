import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Edit, FileText, Lock, Car, Ship, Calendar, Shield, ChevronLeft, ChevronDown, ChevronUp, Bike, Truck, Bell } from "lucide-react";
import { getTheme, isVesselType, getVehicleCategory } from '@/lib/designTokens';
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import VehicleInfoSection from "../components/vehicle/VehicleInfoSection";
import MaintenanceSection from "../components/vehicle/MaintenanceSection";
import CorkBoard from "../components/vehicle/CorkBoard";
import { SafeComponent } from "../components/shared/SafeComponent";
import { useAuth } from "../components/shared/GuestContext";
import useAccountRole from '@/hooks/useAccountRole';
import { canEdit, canDelete, isViewOnly } from '@/lib/permissions';
import { daysUntil } from '../components/shared/ReminderEngine';
import { getDateStatus, formatDateHe, getVehicleLabels } from '../components/shared/DateStatusUtils';
import StatusBadge from '../components/shared/StatusBadge';
import LicensePlate from '../components/shared/LicensePlate';


// ── Inline Reminders Section ─────────────────────────────────────────────────
function RemindersPreview({ vehicle, T }) {
  const [open, setOpen] = useState(false);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);
  const items = [
    vehicle.test_due_date && { icon: Calendar, label: labels.testWord, date: vehicle.test_due_date, status: getDateStatus(vehicle.test_due_date) },
    vehicle.insurance_due_date && { icon: Shield, label: labels.insuranceWord || 'ביטוח', date: vehicle.insurance_due_date, status: getDateStatus(vehicle.insurance_due_date) },
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3" style={{ background: T.light }}>
        <Bell className="w-4 h-4" style={{ color: T.primary }} />
        <span className="text-sm font-black" style={{ color: T.text }}>תזכורות</span>
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

// ── Inline Documents Preview ─────────────────────────────────────────────────
function DocumentsPreview({ vehicleId, documents, T }) {
  const vehicleDocs = (documents || []).filter(d => d.vehicle_id === vehicleId).slice(0, 4);
  if (vehicleDocs.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
      <div className="flex items-center gap-2 px-4 py-3" style={{ background: T.light }}>
        <FileText className="w-4 h-4" style={{ color: T.primary }} />
        <span className="text-sm font-black" style={{ color: T.text }}>מסמכים</span>
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

// ── Vehicle icon helper ───────────────────────────────────────────────────────
const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };
function getVehicleIcon(vehicleType, nickname, manufacturer) {
  return ICON_MAP[getVehicleCategory(vehicleType, nickname, manufacturer)] || Car;
}

// ── Helper: vessel-aware label ───────────────────────────────────────────────
function vehicleWord(vt, nn) { return isVesselType(vt, nn) ? 'כלי שייט' : 'רכב'; }

// ── Guest vehicle detail ──────────────────────────────────────────────────────
function GuestVehicleDetail({ vehicle, vehicleId }) {
  const { removeGuestVehicle, guestDocuments } = useAuth();
  const navigate = useNavigate();
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const vWord = vehicleWord(vehicle.vehicle_type, vehicle.nickname);
  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || vWord;
  const subtitle = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ');
  const hasPhoto = !!vehicle.vehicle_photo;

  const handleDelete = () => {
    removeGuestVehicle(vehicleId);
    navigate(createPageUrl('Dashboard'));
  };

  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const testDays = daysUntil(vehicle.test_due_date);
  const insDays = daysUntil(vehicle.insurance_due_date);
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
            <img src={vehicle.vehicle_photo} alt={name} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: '50% 55%' }} />
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

          {/* Status badge */}
          <div className="absolute top-4 left-4 z-10">
            <span className="text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-sm"
              style={{ background: statusBadge.bg, color: statusBadge.color }}>
              {statusBadge.label}
            </span>
          </div>

          {/* No-photo icon */}
          {!hasPhoto && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-24 h-24 rounded-3xl flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.1)' }}>
                <VehicleIcon className="w-12 h-12" style={{ color: 'rgba(255,255,255,0.5)', strokeWidth: 1.5 }} />
              </div>
            </div>
          )}

          {/* Vehicle name + subtitle + license plate */}
          <div className="absolute bottom-4 right-4 left-4 z-10">
            <h1 className="font-black text-white leading-tight" style={{ fontSize: '1.75rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{name}</h1>
            <p className="text-base font-semibold mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>{subtitle}</p>
            {vehicle.license_plate && !isVessel && (
              <div className="mt-2">
                <LicensePlate value={vehicle.license_plate} size="md" showCopy={false} />
              </div>
            )}
          </div>
        </div>

        {/* Stats bar - like Dashboard */}
        <div className="grid grid-cols-3" style={{ background: '#fff' }}>
          {[
            { label: isVessel ? 'שעות מנוע' : 'קילומטראז\'', value: isVessel ? (vehicle.current_engine_hours ? Number(vehicle.current_engine_hours).toLocaleString() : '-') : (vehicle.current_km ? Number(vehicle.current_km).toLocaleString() : '-') },
            { label: 'שנת ייצור', value: vehicle.year || '-' },
            { label: isVessel ? 'כושר שייט' : 'טסט', value: testDays !== null ? daysLabel(testDays) : '-' },
          ].map((stat, i) => (
            <div key={i} className={`py-4 px-3 text-center ${i < 2 ? 'border-l' : ''}`}
              style={{ borderColor: T.border }}>
              <p className="font-black text-base" style={{ color: T.text }}>{stat.value}</p>
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
          <span className="text-lg">👀</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black" style={{ color: '#92400E' }}>{vWord} לדוגמה</p>
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

        <SafeComponent label="CorkBoard">
          <CorkBoard vehicle={vehicle} isGuest />
        </SafeComponent>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
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
          <div className="text-7xl mb-4" role="img" aria-hidden="true">🚗</div>
          <h1 className="text-xl font-black mb-2" style={{ color: '#1C2E20' }}>לא בחרנו רכב</h1>
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
      // Valid id format but not found in local storage — same friendly fallback
      return (
        <div dir="rtl" className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-sm w-full text-center">
            <div className="text-7xl mb-4" role="img" aria-hidden="true">🔍</div>
            <h1 className="text-xl font-black mb-2" style={{ color: '#1C2E20' }}>הרכב לא נמצא</h1>
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
  const [accountIds, setAccountIds] = useState([]);

  useEffect(() => {
    if (!user) return;
    async function init() {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      setAccountIds(members.map(m => m.account_id));
    }
    init();
  }, []);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicle', vehicleId, accountIds.join(',')],
    queryFn: async () => {
      for (const accountId of accountIds) {
        const results = await db.vehicles.filter({ id: vehicleId, account_id: accountId });
        if (results.length > 0) return results;
      }
      return [];
    },
    enabled: !!vehicleId && accountIds.length > 0,
    refetchOnMount: 'always', // Always fetch fresh data when navigating to this page
    staleTime: 2 * 60 * 1000, // 2 minutes cache
  });

  const vehicle = vehicles[0];

  // One-time auto-enrich: if vehicle has license plate but missing tech spec fields, fetch from gov API
  const [enrichDone, setEnrichDone] = useState(false);
  useEffect(() => {
    if (!vehicle || enrichDone || !vehicle.license_plate) return;
    if (isVesselType(vehicle.vehicle_type, vehicle.nickname)) return; // Vessels don't use gov API
    const specFields = ['model_code','trim_level','vin','pollution_group','vehicle_class','safety_rating',
      'horsepower','engine_cc','drivetrain','total_weight','doors','seats','airbags',
      'transmission','body_type','country_of_origin','co2','green_index','tow_capacity'];
    const missing = specFields.filter(f => !vehicle[f]);
    if (missing.length === 0) { setEnrichDone(true); return; }
    // Check localStorage flag - only try once per vehicle per version
    // Version 2: reset after DB columns were added
    const enrichKey = `enriched_v4_${vehicle.id}`;
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
          'transmission','body_type','country_of_origin','co2','green_index','tow_capacity'];
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

  const handleDelete = async () => {
    if (!vehicleIsOwned) return;
    // TODO: migrate MaintenanceLog, Document, VehicleMaintenancePlan to Supabase
    // For now, just delete the vehicle
    await db.vehicles.delete(vehicleId);
    queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    navigate(createPageUrl('Dashboard'));
  };

  if (isLoading || accountIds.length === 0) return <LoadingSpinner />;

  // Vehicle loaded but doesn't belong to user's accounts - access denied
  if (!vehicle || !vehicleIsOwned) {
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
  const hasPhoto = !!vehicle.vehicle_photo;

  return (
    <div className="-mx-4 -mt-4" dir="rtl">
      {/* ── Hero Card ── */}
      <div className="relative overflow-hidden" style={{ height: hasPhoto ? '220px' : '150px' }}>
        {hasPhoto ? (
          <img src={vehicle.vehicle_photo} alt={name}
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
          <h1 className="font-black text-white text-2xl leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
            {name}
          </h1>
          <p className="text-sm mt-1 font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>{subtitle}</p>
        </div>
      </div>

      {/* ── View-only banner for חבר ── */}
      {isViewOnly(role) && (
        <div className="mx-4 mb-3 rounded-2xl px-4 py-2.5 flex items-center gap-2 text-sm font-medium" style={{ background: '#DBEAFE', color: '#1E40AF', border: '1px solid #93C5FD' }} dir="rtl">
          הצטרפת כחבר - תצוגה בלבד
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="px-4 -mt-5 relative z-20 flex gap-2 mb-4">
        {canEdit(role) && (
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
        {canDelete(role) && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                style={{ background: '#FEF2F2', color: '#DC2626', border: '1.5px solid #FECACA' }}>
                <Trash2 className="h-4 w-4" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>מחיקת {isVessel ? 'כלי שייט' : 'רכב'}</AlertDialogTitle>
                <AlertDialogDescription>
                  פעולה זו תמחק את ה{isVessel ? 'כלי שייט' : 'רכב'} וכל המידע המשויך אליו. לא ניתן לבטל פעולה זו.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex-row-reverse gap-2">
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">מחק</AlertDialogAction>
                <AlertDialogCancel>ביטול</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* ── Vehicle info + maintenance ── */}
      <div className="px-4 space-y-4 pb-8">
        <SafeComponent label="VehicleInfoSection">
          <VehicleInfoSection vehicle={vehicle} />
        </SafeComponent>

        {/* Inline reminders */}
        <RemindersPreview vehicle={vehicle} T={T} />

        <SafeComponent label="MaintenanceSection">
          <MaintenanceSection vehicle={vehicle} />
        </SafeComponent>
        <SafeComponent label="CorkBoard">
          <CorkBoard vehicle={vehicle} readOnly={isViewOnly(role)} />
        </SafeComponent>
      </div>
    </div>
  );
}