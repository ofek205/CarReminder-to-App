import { toast } from 'sonner';
import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPageUrl } from '@/utils';
import { Car, Ship, Bike, Truck, ChevronLeft, Gauge, Clock, Calendar, Shield, MoreVertical, Edit, FileText, AlertCircle, RefreshCw, Check, X } from 'lucide-react';
import { getTheme, getVehicleCategory, C } from '@/lib/designTokens';
import VehicleIcon from '../shared/VehicleIcon';
import { getDateStatus, usesKm, usesHours, getVehicleLabels, isVessel } from '../shared/DateStatusUtils';
import StatusBadge from '../shared/StatusBadge';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '../shared/GuestContext';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };

// ── localStorage helper for mileage update dates ───────────────────────────
const MILEAGE_DATES_KEY = 'carreminder_mileage_dates';
function getMileageUpdateDate(vehicleId) {
  try {
    const all = JSON.parse(localStorage.getItem(MILEAGE_DATES_KEY) || '{}');
    return all[vehicleId] || null;
  } catch { return null; }
}
function setMileageUpdateDate(vehicleId) {
  try {
    const all = JSON.parse(localStorage.getItem(MILEAGE_DATES_KEY) || '{}');
    all[vehicleId] = new Date().toISOString();
    localStorage.setItem(MILEAGE_DATES_KEY, JSON.stringify(all));
  } catch {}
}

// ── Inline Quick Update (left side button) ─────────────────────────────────
function QuickMileageBtn({ vehicle, T, isKm, onOpenUpdate }) {
  const unit = isKm ? 'ק״מ' : 'שעות';
  const localDate = getMileageUpdateDate(vehicle.id);
  const dbDate = isKm ? vehicle.km_update_date : vehicle.engine_hours_update_date;
  const displayDate = localDate || dbDate;

  return (
    <button
      onClick={e => { e.preventDefault(); e.stopPropagation(); onOpenUpdate(); }}
      className="flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all active:scale-[0.95] shrink-0 self-center"
      style={{ background: T.light, border: `1px solid ${T.border}`, minWidth: '56px' }}>
      <RefreshCw className="w-3.5 h-3.5" style={{ color: T.primary }} />
      <span className="text-[9px] font-bold leading-tight" style={{ color: T.primary }}>עדכן {unit}</span>
      {displayDate && (
        <span className="text-[8px] font-medium leading-tight" style={{ color: T.muted }}>
          {new Date(displayDate).toLocaleDateString('he-IL')}
        </span>
      )}
    </button>
  );
}

// ── Inline update row (appears below card) ─────────────────────────────────
function QuickMileageInput({ vehicle, T, isKm, onClose }) {
  const [value, setValue] = useState(
    (isKm ? vehicle.current_km : vehicle.current_engine_hours)
      ? String(isKm ? vehicle.current_km : vehicle.current_engine_hours)
      : ''
  );
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const currentValue = isKm ? vehicle.current_km : vehicle.current_engine_hours;
  const localDate = getMileageUpdateDate(vehicle.id);
  const dbDate = isKm ? vehicle.km_update_date : vehicle.engine_hours_update_date;
  const updateDate = localDate || dbDate;
  const unit = isKm ? 'ק״מ' : 'שעות';
  const Icon = isKm ? Gauge : Clock;

  const handleSave = async (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    const num = Number(value);
    if (!value || isNaN(num) || num < 0) { toast.error('יש להזין מספר תקין'); return; }
    if (currentValue && num < currentValue) {
      toast.error(`הערך החדש (${num.toLocaleString()}) נמוך מהערך הנוכחי (${currentValue.toLocaleString()})`);
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // Save km/hours value first (always works)
      const coreUpdate = isKm ? { current_km: num } : { current_engine_hours: num };
      await db.vehicles.update(vehicle.id, coreUpdate);
      // Try saving the update date too (column may not exist yet)
      try {
        const dateUpdate = isKm ? { km_update_date: now } : { engine_hours_update_date: now };
        await db.vehicles.update(vehicle.id, dateUpdate);
      } catch {}
      // Save update date to localStorage (always works, even without DB column)
      setMileageUpdateDate(vehicle.id);
      // Wait for data to refresh before closing - refetchType active forces immediate refetch
      await queryClient.refetchQueries({ queryKey: ['vehicles'] });
      await queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      onClose();
    } catch (err) {
      toast.error('שגיאה בשמירה. נסה שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl p-3 mb-3 transition-all"
      style={{ background: T.light, border: `1.5px solid ${T.border}` }}
      dir="rtl"
      onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0" style={{ color: T.primary }} />
        <span className="text-xs font-bold shrink-0" style={{ color: T.text }}>
          עדכון {isKm ? 'קילומטראז\'' : 'שעות מנוע'}
        </span>
        {updateDate && (
          <span className="text-[10px] font-medium mr-auto" style={{ color: T.muted }}>
            עודכן: {new Date(updateDate).toLocaleDateString('he-IL')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(e); if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
          placeholder={currentValue ? `נוכחי: ${Number(currentValue).toLocaleString()}` : `הזן ${unit}...`}
          className="flex-1 text-sm font-bold bg-white rounded-xl px-3 py-2 outline-none"
          style={{ border: `1.5px solid ${T.border}`, color: C.text }}
          autoFocus
          dir="rtl"
        />
        <span className="text-xs font-bold shrink-0" style={{ color: T.muted }}>{unit}</span>
        <button onClick={handleSave} disabled={saving || !value}
          className="h-9 px-3 rounded-xl font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-40"
          style={{ background: T.primary, color: '#fff' }}>
          <Check className="w-3.5 h-3.5" />
          שמור
        </button>
        <button onClick={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
          className="h-9 w-9 rounded-xl flex items-center justify-center transition-all"
          style={{ background: '#F3F4F6', color: '#6B7280' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function VehicleCardEnhanced({ vehicle }) {
  const navigate = useNavigate();
  const { isGuest } = useAuth();
  const category = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const labels = getVehicleLabels(vehicle.vehicle_type, vehicle.nickname);
  const testStatus = getDateStatus(vehicle.test_due_date);
  const insStatus = getDateStatus(vehicle.insurance_due_date);
  const isKm = usesKm(vehicle.vehicle_type, vehicle.nickname);
  const isHours = usesHours(vehicle.vehicle_type, vehicle.nickname);

  const showQuickUpdate = useMemo(() => {
    if (isGuest || vehicle._isDemo || (!isKm && !isHours)) return false;
    const localUpdateDate = getMileageUpdateDate(vehicle.id);
    const dbUpdateDate = isKm ? vehicle.km_update_date : vehicle.engine_hours_update_date;
    const lastUpdateStr = localUpdateDate || dbUpdateDate || null;
    const lastUpdate = lastUpdateStr ? new Date(lastUpdateStr) : null;
    const daysSinceUpdate = lastUpdate ? Math.floor((Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)) : Infinity;
    return daysSinceUpdate > 30;
  }, [isGuest, vehicle._isDemo, vehicle.id, isKm, isHours, vehicle.km_update_date, vehicle.engine_hours_update_date]);

  const [updateOpen, setUpdateOpen] = useState(false);

  // Missing fields detection
  const isVesselV = isVessel(vehicle.vehicle_type, vehicle.nickname);
  // Missing fields — only truly essential ones, adapted per vehicle type
  const missingFields = [];
  if (!vehicle.test_due_date) missingFields.push(labels.testWord);
  if (!vehicle.insurance_due_date) missingFields.push(isVesselV ? 'ביטוח ימי' : 'ביטוח');
  if (!vehicle.license_plate) missingFields.push('מספר רישוי');
  if (!vehicle.manufacturer && !isVesselV) missingFields.push('יצרן');
  if (!vehicle.fuel_type && !isVesselV && !isHours) missingFields.push('סוג דלק');
  if (isKm && !vehicle.current_km) missingFields.push('קילומטראז\'');
  if (isHours && !vehicle.current_engine_hours) missingFields.push('שעות מנוע');
  const hasMissing = missingFields.length > 0 && !vehicle._isDemo;

  // Worst status for card border color
  const worstSt = [testStatus.status, insStatus.status].includes('danger') ? 'danger'
    : [testStatus.status, insStatus.status].includes('warn') ? 'warn' : 'ok';

  const borderColor = worstSt === 'danger' ? '#FECACA' : worstSt === 'warn' ? '#FDE68A' : T.border;

  const hasNickname = !!vehicle.nickname;
  const name = vehicle.nickname || vehicle.manufacturer || labels.vehicleFallback;
  // If nickname exists, show manufacturer+model+year as subtitle. If no nickname, show model+year only (manufacturer is already the name)
  const subtitle = hasNickname
    ? [vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ')
    : [vehicle.model, vehicle.year].filter(Boolean).join(' · ');

  return (
    <div>
      <Link to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}>
        <div className="rounded-2xl p-4 mb-0 flex gap-3.5 items-start transition-all active:scale-[0.99] relative"
          style={{
            background: C.card,
            border: `1.5px solid ${borderColor}`,
            borderRight: `4px solid ${T.accent}`,
            boxShadow: `0 2px 16px ${T.primary}08`,
            marginBottom: updateOpen ? '0' : '0',
            borderBottomLeftRadius: updateOpen ? 0 : undefined,
            borderBottomRightRadius: updateOpen ? 0 : undefined,
          }}
          dir="rtl">

          {/* Photo */}
          <div className="w-20 h-20 rounded-2xl overflow-hidden shrink-0" style={{ background: T.light }}>
            {vehicle.vehicle_photo ? (
              <img src={vehicle.vehicle_photo} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <VehicleIcon vehicle={vehicle} className="w-8 h-8" style={{ color: T.accent, opacity: 0.5 }} />
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

            {/* License plate + metric - single compact line */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {vehicle.license_plate && (
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider"
                  style={{ background: '#F0F4FF', color: '#475569', border: '1px solid #E2E8F0' }}
                  dir="ltr">
                  {vehicle.license_plate}
                </span>
              )}
              {isKm && vehicle.current_km && (
                <span className="text-[10px] font-medium" style={{ color: C.muted }}>
                  {Number(vehicle.current_km).toLocaleString()} ק״מ
                </span>
              )}
              {isHours && vehicle.current_engine_hours && (
                <span className="text-[10px] font-medium" style={{ color: C.muted }}>
                  {Number(vehicle.current_engine_hours).toLocaleString()} שעות
                </span>
              )}
            </div>

            {/* Status - compact inline */}
            <div className="flex items-center gap-2 mt-2 flex-wrap overflow-hidden">
              <span className="text-[10px] font-bold" style={{ color: C.muted }}>{labels.testWord}:</span>
              <StatusBadge status={testStatus.status} label={testStatus.label} />
              <span className="text-[10px] font-bold" style={{ color: C.muted }}>{labels.insuranceWord || 'ביטוח'}:</span>
              <StatusBadge status={insStatus.status} label={insStatus.label} />
            </div>

            {/* Missing fields - click navigates to edit */}
            {hasMissing && (
              <button
                onClick={e => { e.preventDefault(); e.stopPropagation(); navigate(`${createPageUrl('EditVehicle')}?id=${vehicle.id}`); }}
                className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded-lg w-full text-right transition-all active:scale-[0.98] overflow-hidden"
                style={{ background: '#FFF7ED', border: '1px solid #FFEDD5' }}>
                <AlertCircle className="w-3 h-3 shrink-0" style={{ color: '#EA580C' }} />
                <span className="text-[10px] font-bold flex-1 truncate" style={{ color: '#EA580C' }}>
                  פרטים חסרים: {missingFields.join(', ')}
                </span>
                <Edit className="w-3 h-3 shrink-0" style={{ color: '#EA580C' }} />
              </button>
            )}
          </div>

          {/* Left side: quick update button OR chevron */}
          {showQuickUpdate ? (
            <QuickMileageBtn vehicle={vehicle} T={T} isKm={isKm} onOpenUpdate={() => setUpdateOpen(true)} />
          ) : (
            <ChevronLeft className="w-4 h-4 shrink-0 self-center" style={{ color: C.muted, opacity: 0.5 }} />
          )}
        </div>
      </Link>

      {/* Inline update input - appears below card */}
      {updateOpen && (
        <QuickMileageInput vehicle={vehicle} T={T} isKm={isKm} onClose={() => setUpdateOpen(false)} />
      )}

      {/* Spacer when no update open */}
      {!updateOpen && <div className="mb-3" />}
    </div>
  );
}

// Memoize - only re-render if vehicle changes
export default React.memo(VehicleCardEnhanced, (prev, next) => {
  // Cheap shallow compare on key vehicle fields that affect rendering
  const a = prev.vehicle, b = next.vehicle;
  return a.id === b.id &&
    a.nickname === b.nickname &&
    a.manufacturer === b.manufacturer &&
    a.model === b.model &&
    a.test_due_date === b.test_due_date &&
    a.insurance_due_date === b.insurance_due_date &&
    a.current_km === b.current_km &&
    a.current_engine_hours === b.current_engine_hours &&
    a.vehicle_photo === b.vehicle_photo &&
    a.license_plate === b.license_plate;
});
