import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { useQuery } from '@tanstack/react-query';
import { Plus, Car, ChevronLeft, Calendar, Shield, Ship, Bike, Truck } from "lucide-react";
import { getTheme, isVesselType, getVehicleCategory } from '@/lib/designTokens';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };
function getVehicleIcon(vt, nn, mfr) { return ICON_MAP[getVehicleCategory(vt, nn, mfr)] || Car; }
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { SafeComponent } from "../components/shared/SafeComponent";
import GuestVehicleCard from "../components/dashboard/GuestVehicleCard";
import SignUpPromptDialog from "../components/shared/SignUpPromptDialog";
import { useAuth } from "../components/shared/GuestContext";
import { C } from '@/lib/designTokens';

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── Compact vehicle row (matches Dashboard design) ─────────────────────────
function VehicleListRow({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const isVessel = isVesselType(vehicle.vehicle_type, vehicle.nickname);
  const VehicleIcon = getVehicleIcon(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);

  const testDays = daysUntil(vehicle.test_due_date);
  const insDays  = daysUntil(vehicle.insurance_due_date);
  const worstDays = Math.min(testDays ?? 999, insDays ?? 999);
  const isOverdue = worstDays < 0;
  const isSoon    = worstDays >= 0 && worstDays <= 60;

  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || (isVessel ? 'כלי שייט' : 'רכב');
  const subtitle = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ');

  const badges = [];
  if (testDays !== null) {
    const s = testDays < 0 ? 'overdue' : testDays <= 30 ? 'soon' : 'ok';
    badges.push({ label: 'טסט', status: s });
  }
  if (insDays !== null) {
    const s = insDays < 0 ? 'overdue' : insDays <= 30 ? 'soon' : 'ok';
    badges.push({ label: 'ביטוח', status: s });
  }

  const badgeStyles = {
    ok:      { bg: C.successBg, color: C.success, text: 'תקין' },
    soon:    { bg: C.warnBg,    color: C.warn,    text: 'בקרוב' },
    overdue: { bg: C.errorBg,   color: C.error,   text: 'באיחור' },
  };

  return (
    <Link to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}>
      <div className="rounded-2xl p-3.5 mb-3 flex gap-3 items-center transition-all active:scale-[0.99]"
        style={{
          background: C.card,
          border: `1.5px solid ${isOverdue ? '#FECACA' : isSoon ? '#FDE68A' : C.border}`,
          boxShadow: '0 2px 12px rgba(45,82,51,0.06)',
        }}
        dir="rtl">

        {/* Thumbnail */}
        <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0" style={{ background: T.light }}>
          {vehicle.vehicle_photo ? (
            <img src={vehicle.vehicle_photo} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <VehicleIcon className="w-6 h-6" style={{ color: T.accent, opacity: 0.6 }} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base truncate" style={{ color: C.text }}>{name}</h3>
          <p className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>{subtitle}</p>
          {vehicle.license_plate && (
            <p className="text-xs mt-0.5 font-medium" style={{ color: C.muted }}>{vehicle.license_plate}</p>
          )}
        </div>

        {/* Badges */}
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

        <ChevronLeft className="w-4 h-4 shrink-0" style={{ color: C.muted }} />
      </div>
    </Link>
  );
}

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

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
  });

  if (authLoading) return <LoadingSpinner />;

  // ── Guest mode ──────────────────────────────────────────────────────────
  if (isGuest) {
    return (
      <div dir="rtl">
        <SignUpPromptDialog open={showSignUp} onClose={() => setShowSignUp(false)} reason="הירשם כדי לשמור רכבים לצמיתות" />
        <PageHeader
          title="רכבים"
          subtitle={`${guestVehicles.length} כלי רכב (זמני)`}
          actions={
            <Link to={createPageUrl('AddVehicle')}>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
                style={{ background: C.yellow, color: C.greenDark }}>
                <Plus className="h-4 w-4" />
                רכב חדש
              </button>
            </Link>
          }
        />
        {guestVehicles.length === 0 ? (
          <div className="text-center py-16">
            <Car className="w-16 h-16 mx-auto mb-4" style={{ color: C.muted }} />
            <p className="font-bold text-lg mb-1" style={{ color: C.text }}>אין רכבים עדיין</p>
            <p className="text-sm mb-6" style={{ color: C.muted }}>הוסף את הרכב הראשון שלך</p>
            <Link to={createPageUrl('AddVehicle')}>
              <button className="px-8 py-3 rounded-2xl font-bold" style={{ background: C.yellow, color: C.greenDark }}>
                הוסף רכב
              </button>
            </Link>
          </div>
        ) : (
          <div>
            {guestVehicles.map(v => (
              <SafeComponent key={v.id} label="GuestVehicleCard">
                <GuestVehicleCard vehicle={v} onRegisterClick={() => setShowSignUp(true)} />
              </SafeComponent>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Authenticated mode ──────────────────────────────────────────────────
  if (!accountId || isLoading) return <LoadingSpinner />;

  return (
    <div dir="rtl">
      <PageHeader
        title="רכבים"
        subtitle={`${vehicles.length} כלי רכב`}
        actions={
          <Link to={createPageUrl('AddVehicle')}>
            <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: C.yellow, color: C.greenDark }}>
              <Plus className="h-4 w-4" />
              רכב חדש
            </button>
          </Link>
        }
      />
      {vehicles.length === 0 ? (
        <div className="text-center py-16">
          <Car className="w-16 h-16 mx-auto mb-4" style={{ color: C.muted }} />
          <p className="font-bold text-lg mb-1" style={{ color: C.text }}>אין רכבים עדיין</p>
          <p className="text-sm mb-6" style={{ color: C.muted }}>הוסף את הרכב הראשון שלך</p>
          <Link to={createPageUrl('AddVehicle')}>
            <button className="px-8 py-3 rounded-2xl font-bold" style={{ background: C.yellow, color: C.greenDark }}>
              הוסף רכב
            </button>
          </Link>
        </div>
      ) : (
        <div>
          <p className="text-xs font-medium mb-3" style={{ color: C.muted }}>
            מציג {vehicles.length} רכבים
          </p>
          <div>
            {vehicles.map(v => (
              <VehicleListRow key={v.id} vehicle={v} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
