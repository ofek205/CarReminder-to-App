import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Car, Ship, Bike, Truck, ChevronLeft, Gauge, Clock, Calendar, Shield, Wrench, MoreVertical, Edit, FileText, Trash2, AlertCircle } from 'lucide-react';
import { getTheme, getVehicleCategory, C } from '@/lib/designTokens';
import { getDateStatus, isVessel, isOffroad, usesKm, usesHours, getVehicleLabels } from '../shared/DateStatusUtils';
import StatusBadge from '../shared/StatusBadge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };

export default function VehicleCardEnhanced({ vehicle }) {
  const navigate = useNavigate();
  const category = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const VehicleIcon = ICON_MAP[category] || Car;
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);

  const testStatus = getDateStatus(vehicle.test_due_date);
  const insStatus = getDateStatus(vehicle.insurance_due_date);

  // Missing fields detection
  const missingFields = [];
  if (!vehicle.test_due_date) missingFields.push(labels.testWord);
  if (!vehicle.insurance_due_date) missingFields.push(labels.insuranceWord || 'ביטוח');
  if (!vehicle.license_plate) missingFields.push('מספר רישוי');
  if (!vehicle.vehicle_photo) missingFields.push('תמונה');
  const hasMissing = missingFields.length > 0 && !vehicle._isDemo;

  // Worst status for card border color
  const worstSt = [testStatus.status, insStatus.status].includes('danger') ? 'danger'
    : [testStatus.status, insStatus.status].includes('warn') ? 'warn' : 'ok';

  const borderColor = worstSt === 'danger' ? '#FECACA' : worstSt === 'warn' ? '#FDE68A' : T.border;

  const name = vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ') || labels.vehicleFallback;
  const subtitle = [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ');

  return (
    <Link to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}>
      <div className="rounded-2xl p-4 mb-3 flex gap-3.5 items-start transition-all active:scale-[0.99] relative"
        style={{
          background: C.card,
          border: `1.5px solid ${borderColor}`,
          borderRight: `4px solid ${T.accent}`,
          boxShadow: `0 2px 16px ${T.primary}08`,
        }}
        dir="rtl">

        {/* Photo */}
        <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0" style={{ background: T.light }}>
          {vehicle.vehicle_photo ? (
            <img src={vehicle.vehicle_photo} alt={name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <VehicleIcon className="w-8 h-8" style={{ color: T.accent, opacity: 0.5 }} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base truncate" style={{ color: C.text }}>{name}</h3>
                {vehicle._isDemo && (
                  <span className="text-xs font-black px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: '#FFBF00', color: '#92400E' }}>
                    לדוגמה
                  </span>
                )}
              </div>
              {subtitle && <p className="text-xs mt-0.5 truncate font-medium" style={{ color: C.muted }}>{subtitle}</p>}
            </div>

            {/* Quick actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); }}
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 hover:bg-gray-100 transition-all -mt-0.5">
                  <MoreVertical className="w-4 h-4" style={{ color: C.muted }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" dir="rtl" className="w-40">
                <DropdownMenuItem onClick={e => { e.stopPropagation(); navigate(`${createPageUrl('EditVehicle')}?id=${vehicle.id}`); }}
                  className="gap-2 text-sm font-medium cursor-pointer">
                  <Edit className="w-4 h-4" /> עריכה
                </DropdownMenuItem>
                <DropdownMenuItem onClick={e => { e.stopPropagation(); navigate(`${createPageUrl('Documents')}?vehicle_id=${vehicle.id}`); }}
                  className="gap-2 text-sm font-medium cursor-pointer">
                  <FileText className="w-4 h-4" /> מסמכים
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* License plate + metric */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {vehicle.license_plate && (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md tracking-wider"
                style={{ background: '#F0F4FF', color: '#475569', border: '1px solid #CBD5E1' }}
                dir="ltr">
                {vehicle.license_plate}
              </span>
            )}
            {usesKm(vehicle.vehicle_type, vehicle.nickname) && vehicle.current_km && (
              <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: C.muted }}>
                <Gauge className="w-3 h-3" />
                {Number(vehicle.current_km).toLocaleString()} ק״מ
              </span>
            )}
            {usesHours(vehicle.vehicle_type, vehicle.nickname) && vehicle.current_engine_hours && (
              <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: C.muted }}>
                <Clock className="w-3 h-3" />
                {Number(vehicle.current_engine_hours).toLocaleString()} שעות
              </span>
            )}
          </div>

          {/* Status badges */}
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" style={{ color: C.muted }} />
              <span className="text-[10px] font-bold" style={{ color: C.muted }}>{labels.testWord}:</span>
              <StatusBadge status={testStatus.status} label={testStatus.label} />
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3" style={{ color: C.muted }} />
              <span className="text-[10px] font-bold" style={{ color: C.muted }}>{labels.insuranceWord || 'ביטוח'}:</span>
              <StatusBadge status={insStatus.status} label={insStatus.label} />
            </div>
          </div>

          {/* Missing fields indicator */}
          {hasMissing && (
            <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: '#FFF7ED', border: '1px solid #FFEDD5' }}>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: '#EA580C' }} />
              <span className="text-[11px] font-bold" style={{ color: '#EA580C' }}>
                פרטים חסרים: {missingFields.join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* Chevron */}
        <ChevronLeft className="w-4 h-4 shrink-0 self-center" style={{ color: C.muted, opacity: 0.5 }} />
      </div>
    </Link>
  );
}
