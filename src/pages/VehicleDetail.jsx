import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Trash2, Edit, FileText, Lock, Pencil, Car, Ship, Calendar, Shield, ChevronLeft, Bike, Truck } from "lucide-react";
import { getTheme, isVesselType, getVehicleCategory } from '@/lib/designTokens';
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import VehicleInfoSection from "../components/vehicle/VehicleInfoSection";
import MaintenanceSection from "../components/vehicle/MaintenanceSection";
import VesselIssuesSection from "../components/vehicle/VesselIssuesSection";
import CorkBoard from "../components/vehicle/CorkBoard";
import { SafeComponent } from "../components/shared/SafeComponent";
import { useAuth } from "../components/shared/GuestContext";
import useAccountRole from '@/hooks/useAccountRole';
import { canEdit, canDelete, isViewOnly } from '@/lib/permissions';
import { daysUntil } from '../components/shared/ReminderEngine';


// ── Vehicle icon helper ───────────────────────────────────────────────────────
const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };
function getVehicleIcon(vehicleType, nickname, manufacturer) {
  return ICON_MAP[getVehicleCategory(vehicleType, nickname, manufacturer)] || Car;
}

// ── Helper: vessel-aware label ───────────────────────────────────────────────
function vehicleWord(vt, nn) { return isVesselType(vt, nn) ? 'כלי שייט' : 'רכב'; }

// ── Guest vehicle detail ──────────────────────────────────────────────────────
function GuestVehicleDetail({ vehicle, vehicleId }) {
  const { removeGuestVehicle } = useAuth();
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
    if (d === null) return '—';
    if (d < 0) return 'פג תוקף';
    if (d === 0) return 'היום';
    if (d < 30) return `${d} ימים`;
    return `${Math.round(d / 30)} חודשים`;
  }

  return (
    <div className="-mx-4 -mt-4" dir="rtl">
      {/* Hero card — matches Dashboard style */}
      <div className="rounded-b-3xl overflow-hidden" style={{ boxShadow: `0 8px 32px ${T.primary}25` }}>
        {/* Photo / gradient */}
        <div className="relative" style={{ height: hasPhoto ? '240px' : '180px' }}>
          {hasPhoto ? (
            <img src={vehicle.vehicle_photo} alt={name} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: '50% 55%' }} />
          ) : (
            <div className="absolute inset-0" style={{ background: T.grad }} />
          )}
          <div className="absolute inset-0" style={{ background: hasPhoto ? 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.1) 100%)' : 'none' }} />

          {/* Back button */}
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
              <VehicleIcon className="w-20 h-20" style={{ color: 'rgba(255,255,255,0.12)' }} />
            </div>
          )}

          {/* Vehicle name + license plate badge */}
          <div className="absolute bottom-4 right-4 left-4 z-10">
            <h1 className="font-black text-white leading-tight" style={{ fontSize: '1.75rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <p className="text-base font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>{subtitle}</p>
              {vehicle.license_plate && (
                <span className="inline-flex items-center gap-1 px-1 py-0.5 rounded"
                  dir="ltr"
                  style={{ background: '#FFBF00', boxShadow: '0 2px 6px rgba(0,0,0,0.25)', border: '2px solid #1A3A5C' }}>
                  {/* Israel flag badge */}
                  <span className="flex flex-col items-center justify-center px-1 py-0.5 rounded-sm"
                    style={{ background: '#1A3A5C' }}>
                    <span className="text-white font-bold" style={{ fontSize: '6px', lineHeight: 1 }}>IL</span>
                    <svg viewBox="0 0 60 40" style={{ width: '14px', height: '9px' }}>
                      <rect width="60" height="40" fill="white"/>
                      <rect y="4" width="60" height="5" fill="#003DA5"/>
                      <rect y="31" width="60" height="5" fill="#003DA5"/>
                      <polygon points="30,10 34.5,21 25.5,21" fill="none" stroke="#003DA5" strokeWidth="2"/>
                      <polygon points="30,26 25.5,15 34.5,15" fill="none" stroke="#003DA5" strokeWidth="2"/>
                    </svg>
                  </span>
                  <span className="text-xs font-black tracking-wider px-1" style={{ color: '#1a1a1a' }}>
                    {vehicle.license_plate}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats bar — like Dashboard */}
        <div className="grid grid-cols-3" style={{ background: '#fff' }}>
          {[
            { label: isVessel ? 'שעות מנוע' : 'קילומטראז\'', value: isVessel ? (vehicle.current_engine_hours ? Number(vehicle.current_engine_hours).toLocaleString() : '—') : (vehicle.current_km ? Number(vehicle.current_km).toLocaleString() : '—') },
            { label: 'שנת ייצור', value: vehicle.year || '—' },
            { label: isVessel ? 'כושר שייט' : 'טסט', value: testDays !== null ? daysLabel(testDays) : '—' },
          ].map((stat, i) => (
            <div key={i} className={`py-4 px-3 text-center ${i < 2 ? 'border-l' : ''}`}
              style={{ borderColor: T.border }}>
              <p className="font-black text-base" style={{ color: T.text }}>{stat.value}</p>
              <p className="text-sm mt-1 font-bold" style={{ color: T.muted }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Action buttons — clean, outlined */}
      <div className="px-4 mt-4 flex gap-2 mb-3">
        <Link to={createPageUrl(`EditVehicle?id=${vehicleId}`)} className="flex-1">
          <button className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: '#fff', color: T.primary, border: `1.5px solid ${T.border}` }}>
            <Edit className="h-4 w-4" /> עריכה
          </button>
        </Link>
        <Link to={createPageUrl(`Documents?vehicle_id=${vehicleId}`)}>
          <button className="py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: '#fff', color: '#6B7280', border: '1.5px solid #E5E7EB' }}>
            <FileText className="h-4 w-4" /> מסמכים
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
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">מחק</AlertDialogAction>
              <AlertDialogCancel>ביטול</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Guest banner */}
      <div className="mx-4 mb-4 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: T.yellowSoft, border: `1px solid ${T.border}` }}>
        <Lock className="h-4 w-4 shrink-0" style={{ color: T.primary }} />
        <p className="text-sm font-medium" style={{ color: T.text }}>
          {vWord} זמני - נשמר במכשיר בלבד.{' '}
          <Link to={createPageUrl('Auth')} className="underline font-bold" style={{ color: T.primary }}>הירשם כדי לשמור</Link>
        </p>
      </div>

      {/* Vehicle info */}
      <div className="px-4 space-y-4 pb-8">
        <SafeComponent label="VehicleInfoSection">
          <VehicleInfoSection vehicle={vehicle} />
        </SafeComponent>
        {isVesselType(vehicle.vehicle_type, vehicle.nickname) && (
          <SafeComponent label="VesselIssuesSection">
            <VesselIssuesSection vehicle={vehicle} isGuest />
          </SafeComponent>
        )}
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

  // Guest vehicle - load from local state
  if (isGuest || (vehicleId && (vehicleId.startsWith('guest_') || vehicleId.startsWith('demo_')))) {
    const guestVehicle = guestVehicles.find(v => v.id === vehicleId);
    if (!guestVehicle) return <LoadingSpinner />;
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
  });

  const vehicle = vehicles[0];

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

  // Vehicle loaded but doesn't belong to user's accounts — access denied
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
      <div className="relative overflow-hidden" style={{ height: hasPhoto ? '240px' : '180px' }}>
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

        {/* Back button */}
        <Link to={createPageUrl('Dashboard')} className="absolute top-4 right-4 z-20">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center backdrop-blur-sm"
            style={{ background: 'rgba(255,255,255,0.2)' }}>
            <ChevronLeft className="w-5 h-5 text-white" style={{ transform: 'rotate(180deg)' }} />
          </div>
        </Link>

        {/* No-photo icon */}
        {!hasPhoto && (
          <div className="absolute inset-0 flex items-center justify-center">
            <VehicleIcon className="w-20 h-20" style={{ color: 'rgba(255,255,255,0.12)' }} />
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
          הצטרפת כחבר — תצוגה בלבד
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="px-4 -mt-5 relative z-20 flex gap-2 mb-4">
        {canEdit(role) && (
          <Link to={createPageUrl(`EditVehicle?id=${vehicleId}`)}>
            <button className="py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{ background: T.yellow, color: T.primary, boxShadow: `0 4px 12px ${T.yellow}40` }}>
              <Edit className="h-4 w-4" />
              עריכה
            </button>
          </Link>
        )}
        <Link to={createPageUrl(`Documents?vehicle_id=${vehicleId}`)}>
          <button className="py-3 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: T.light, color: T.primary, border: `1.5px solid ${T.border}` }}>
            <FileText className="h-4 w-4" />
            מסמכים
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
        <SafeComponent label="MaintenanceSection">
          <MaintenanceSection vehicle={vehicle} />
        </SafeComponent>
        {isVessel && (
          <SafeComponent label="VesselIssuesSection">
            <VesselIssuesSection vehicle={vehicle} readOnly={isViewOnly(role)} />
          </SafeComponent>
        )}
        <SafeComponent label="CorkBoard">
          <CorkBoard vehicle={vehicle} readOnly={isViewOnly(role)} />
        </SafeComponent>
      </div>
    </div>
  );
}