import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Gauge, Clock, RefreshCw, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { usesKm, usesHours } from '../shared/DateStatusUtils';
import { useAuth } from '../shared/GuestContext';
import { getTheme } from '@/lib/designTokens';
import { db } from '@/lib/supabaseEntities';

export default function MileageUpdateWidget({ vehicle, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { isGuest, updateGuestVehicle } = useAuth();
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname);

  const isKm    = usesKm(vehicle.vehicle_type, vehicle.nickname);
  const isHours = usesHours(vehicle.vehicle_type, vehicle.nickname);
  if (!isKm && !isHours) return null;

  const currentValue = isKm ? vehicle.current_km : vehicle.current_engine_hours;
  const updateDate   = isKm ? vehicle.km_update_date : vehicle.engine_hours_update_date;
  const unit         = isKm ? 'ק״מ' : 'שעות מנוע';
  const sectionLabel = isKm ? 'קילומטראז\'' : 'שעות מנוע';

  const cancel = () => { setOpen(false); setValue(''); };

  const save = async () => {
    const num = Number(value);
    if (!value || isNaN(num) || num < 0) { toast.error('יש להזין מספר תקין'); return; }
    if (currentValue && num < currentValue) {
      toast.error(`הערך החדש (${num.toLocaleString()}) נמוך מהערך הנוכחי (${currentValue.toLocaleString()})`);
      return;
    }
    setSaving(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const update = isKm
        ? { current_km: num, km_update_date: today }
        : { current_engine_hours: num, engine_hours_update_date: today };

      if (isGuest) {
        updateGuestVehicle(vehicle.id, update);
      } else {
        await db.vehicles.update(vehicle.id, update);
        queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] });
      }
      toast.success(`${unit} עודכנו בהצלחה`);
      setOpen(false);
      setValue('');
      onUpdated?.(update);
    } catch {
      toast.error('שגיאה בשמירה, נסה שוב');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl px-4 py-3.5" dir="rtl"
      style={{
        background: '#FFFFFF',
        border: '1.5px solid #E5E7EB',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}>

      {!open ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: T.light }}>
              {isKm
                ? <Gauge className="h-5 w-5" style={{ color: T.primary }} />
                : <Clock className="h-5 w-5" style={{ color: T.primary }} />}
            </div>
            <div>
              <p className="text-xs font-bold" style={{ color: '#6B7280' }}>{sectionLabel}</p>
              {currentValue ? (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-black" style={{ color: '#111827' }}>
                    {Number(currentValue).toLocaleString()}
                  </span>
                  <span className="text-xs font-bold" style={{ color: '#9CA3AF' }}>{unit}</span>
                </div>
              ) : (
                <span className="text-sm font-medium" style={{ color: '#9CA3AF' }}>טרם עודכן</span>
              )}
              {updateDate && (
                <p className="text-[11px]" style={{ color: '#9CA3AF' }}>
                  עודכן {new Date(updateDate).toLocaleDateString('he-IL')}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => { setValue(currentValue ? String(currentValue) : ''); setOpen(true); }}
            className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-xl transition-all active:scale-[0.97]"
            style={{ background: T.primary, color: '#FFFFFF' }}>
            <RefreshCw className="h-3.5 w-3.5" />
            עדכן
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: T.light }}>
              {isKm ? <Gauge className="h-4 w-4" style={{ color: T.primary }} /> : <Clock className="h-4 w-4" style={{ color: T.primary }} />}
            </div>
            <span className="text-sm font-bold" style={{ color: T.text }}>עדכון {sectionLabel}</span>
          </div>

          {currentValue && (
            <p className="text-xs" style={{ color: T.muted }}>
              ערך נוכחי: <strong style={{ color: T.text }}>{Number(currentValue).toLocaleString()} {unit}</strong>
            </p>
          )}

          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={`הזן ${unit}...`}
              className="flex-1 h-11 text-base font-medium rounded-xl"
              autoFocus
              inputMode="numeric"
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            />
            <span className="text-sm shrink-0" style={{ color: T.muted }}>{unit}</span>
          </div>

          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !value}
              className="flex-1 h-10 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: T.primary, color: '#FFFFFF' }}>
              <Check className="h-3.5 w-3.5" />
              שמור
            </button>
            <button onClick={cancel}
              className="h-10 px-4 rounded-xl font-medium text-sm flex items-center justify-center transition-all"
              style={{ background: T.light, color: T.muted, border: `1px solid ${T.border}` }}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
