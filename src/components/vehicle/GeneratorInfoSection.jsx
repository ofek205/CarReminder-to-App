import React from 'react';
import { Zap, Wrench, ShieldCheck, Info } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { formatDateHe } from '../shared/DateStatusUtils';
import MileageUpdateWidget from './MileageUpdateWidget';

/**
 * GeneratorInfoSection — the read-only detail block for a generator, shown on
 * VehicleDetail instead of the (car/vessel-centric) VehicleInfoSection.
 *
 * Pure presentational: renders the generator_* columns + reuses
 * MileageUpdateWidget for the work-hours updater (which already shows
 * "שעות עבודה" for generators). No mutations of its own.
 */

/** One label→value row. Renders nothing when the value is empty. */
function Row({ label, value, ltr = false }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center justify-between py-2.5 px-1"
      style={{ borderBottom: `1px solid ${C.gray100}` }}>
      <span className="text-xs font-medium" style={{ color: C.gray500 }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: C.text }} dir={ltr ? 'ltr' : 'rtl'}>{value}</span>
    </div>
  );
}

/** A titled card grouping a set of rows. */
function Card({ icon: Icon, title, children }) {
  return (
    <div className="rounded-2xl p-4" dir="rtl"
      style={{ background: '#FFFFFF', border: `1.5px solid ${C.gray200}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: C.primary }} />
        <span className="text-sm font-bold" style={{ color: C.gray700 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

/** Yes/No/unknown → readable Hebrew (booleans + the fire-approval string). */
function yesNo(v) {
  if (v === true) return 'כן';
  if (v === false) return 'לא';
  return v || ''; // string values (e.g. 'לא יודע') pass through
}

export default function GeneratorInfoSection({ vehicle }) {
  const v = vehicle || {};
  const typeLabel = v.generator_type === 'אחר'
    ? (v.generator_type_other || 'אחר')
    : v.generator_type;
  const manufacturerModel = [v.manufacturer, v.model].filter(Boolean).join(' ');
  const power = v.power_value != null && v.power_value !== ''
    ? `${v.power_value}${v.power_unit ? ' ' + v.power_unit : ''}`
    : '';
  const criticalSystems = Array.isArray(v.critical_systems) ? v.critical_systems : [];

  return (
    <div className="space-y-4" dir="rtl">

      {/* General + technical details */}
      <Card icon={Zap} title="פרטי הגנרטור">
        <Row label="סוג גנרטור" value={typeLabel} />
        <Row label="מיקום" value={v.location} />
        <Row label="יצרן ודגם" value={manufacturerModel} ltr />
        <Row label="מספר סידורי" value={v.serial_number} ltr />
        <Row label="שנת ייצור" value={v.year} ltr />
        <Row label="סוג דלק" value={v.fuel_type} />
        <Row label="הספק" value={power} ltr />
        <Row label="מחובר ל-ATS" value={yesNo(v.has_ats)} />
        <Row label="משמש לחירום" value={yesNo(v.is_emergency_generator)} />
        {v.connected_to_critical_systems === true && criticalSystems.length > 0 && (
          <Row label="מערכות קריטיות" value={criticalSystems.join(', ')} />
        )}
      </Card>

      {/* Work-hours updater — reuses the shared widget (shows "שעות עבודה"
          for generators) and writes to current_engine_hours. */}
      <MileageUpdateWidget vehicle={vehicle} />

      {/* Maintenance / inspection dates */}
      <Card icon={Wrench} title="טיפולים ובדיקות">
        <Row label="טיפול אחרון" value={v.last_service_date ? formatDateHe(v.last_service_date) : ''} ltr />
        <Row label="בדיקת עומס אחרונה" value={v.last_load_bank_test_date ? formatDateHe(v.last_load_bank_test_date) : ''} ltr />
        <Row label="אישור תקינות אחרון" value={v.last_safety_approval_date ? formatDateHe(v.last_safety_approval_date) : ''} ltr />
        {v.has_hour_meter === true && v.work_hours_at_last_service != null && v.work_hours_at_last_service !== '' && (
          <Row label="שעות עבודה בטיפול האחרון" value={`${v.work_hours_at_last_service} שעות`} ltr />
        )}
      </Card>

      {/* Regulation + technician */}
      {(v.requires_fire_dept_approval || v.technician_name || v.technician_phone) && (
        <Card icon={ShieldCheck} title="רגולציה וטכנאי">
          <Row label="נדרש אישור כבאות / רישוי עסק" value={yesNo(v.requires_fire_dept_approval)} />
          <Row label="טכנאי / חברה מטפלת" value={v.technician_name} />
          <Row label="טלפון טכנאי" value={v.technician_phone} ltr />
        </Card>
      )}

      {/* Liability note (spec §11) — reminders are guidance only. */}
      <div className="rounded-xl border px-3 py-2.5 flex items-start gap-2 text-[11px] leading-relaxed"
        style={{ background: C.warnSubtle, borderColor: C.warnBorder, color: C.warnDark }}>
        <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          התזכורות הן המלצה כללית בלבד ואינן מחליפות הוראות יצרן, בדיקת טכנאי מוסמך
          או דרישות רגולטוריות רלוונטיות.
        </span>
      </div>
    </div>
  );
}
