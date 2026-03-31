import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from "@/components/ui/card";
import { createPageUrl } from "@/utils";
import { Gauge, Lock, Car, Ship, Bike, Truck } from "lucide-react";
import { getTheme, getVehicleCategory } from '@/lib/designTokens';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };

export default function GuestVehicleCard({ vehicle, onRegisterClick }) {
  const category = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const VehicleIcon = ICON_MAP[category] || Car;
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname);
  const isVessel = category === 'vessel';

  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || (isVessel ? 'כלי שייט' : 'רכב זמני');

  return (
    <Link to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}>
      <Card className="p-4 sm:p-5 border border-dashed rounded-2xl cursor-pointer hover:shadow-md transition-all"
        style={{ borderColor: T.border, background: `${T.light}60` }}>
        <div className="flex items-center gap-3" dir="rtl">
          <div className="w-14 h-14 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm"
            style={{ border: `1px solid ${T.border}` }}>
            <VehicleIcon className="w-7 h-7" style={{ color: T.accent }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold truncate" style={{ color: T.text }}>
              {name}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: T.muted }}>
              {vehicle.license_plate && <span dir="ltr">{vehicle.license_plate}</span>}
              {vehicle.year && <span> • {vehicle.year}</span>}
            </p>
            {isVessel ? (
              vehicle.current_engine_hours && (
                <p className="text-xs mt-1 flex items-center gap-1" style={{ color: T.muted }}>
                  <Gauge className="h-3 w-3" />
                  {Number(vehicle.current_engine_hours).toLocaleString()} שעות מנוע
                </p>
              )
            ) : (
              vehicle.current_km && (
                <p className="text-xs mt-1 flex items-center gap-1" style={{ color: T.muted }}>
                  <Gauge className="h-3 w-3" />
                  {Number(vehicle.current_km).toLocaleString()} ק״מ
                </p>
              )
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg shrink-0"
            style={{ background: T.light, color: T.accent }}>
            <Lock className="h-3 w-3" />
            <span>זמני</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
