import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { C } from '@/lib/designTokens';
import FieldError from '@/components/shared/FieldError';

/**
 * GeneratorFields — the full generator detail form, shared by AddVehicle and
 * EditVehicle. Pure presentational: reads `form` and writes via `handleChange`.
 *
 * The generator category stores everything on the vehicles row (nullable
 * columns added in add-generator-fields.sql). Work-hours reuse the existing
 * current_engine_hours column — there is NO separate work-hours column.
 *
 * Progressive disclosure: hour-meter readings, critical-systems checklist and
 * the "other" text fields only appear once their gating answer is given, so a
 * small home generator isn't faced with the full industrial form.
 *
 * Props:
 *   form         — the form state object (must contain the generator_* fields)
 *   handleChange(field, value) — setter used by every input
 *   errors       — optional { field: message } map (AddVehicle validation)
 *   clearError(field) — optional, clears a field error on edit
 */

export const GENERATOR_TYPE_OPTIONS = [
  'גנרטור ביתי קטן',
  'גנרטור נייד / שטח / אירועים',
  'גנרטור קבוע לעסק / מבנה',
  'גנרטור חירום',
  'גנרטור תעשייתי',
  'גנרטור למתקן רפואי / מתקן קריטי',
  'אחר',
];

const FUEL_OPTIONS = ['דיזל', 'בנזין', 'גז', 'אחר'];
const POWER_UNITS = ['kVA', 'kW'];
const FIRE_APPROVAL_OPTIONS = ['כן', 'לא', 'לא יודע'];
export const CRITICAL_SYSTEM_OPTIONS = [
  'תאורת חירום',
  'משאבות כיבוי',
  'חדר שרתים',
  'מקררים / ציוד רפואי',
  'מעלית חירום',
  'מערכות עשן',
  'אחר',
];

/** A small "כן / לא" (or custom-options) segmented toggle for boolean fields. */
function YesNo({ value, onChange, options }) {
  const opts = options || [
    { val: true, label: 'כן' },
    { val: false, label: 'לא' },
  ];
  return (
    <div className="flex gap-2" dir="rtl">
      {opts.map(opt => {
        const active = value === opt.val;
        return (
          <button
            key={String(opt.val)}
            type="button"
            onClick={() => onChange(opt.val)}
            className="px-5 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{
              background: active ? C.primary : '#fff',
              color: active ? '#fff' : C.gray500,
              border: `1.5px solid ${active ? C.primary : C.border}`,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Section wrapper — a titled card so the long form reads as digestible groups. */
function Section({ title, children }) {
  return (
    <div className="rounded-2xl p-4 space-y-3"
      style={{ background: '#fff', border: `1.5px solid ${C.border}` }}>
      <h3 className="text-sm font-bold" style={{ color: C.primary }}>{title}</h3>
      {children}
    </div>
  );
}

export default function GeneratorFields({ form, handleChange, errors = {}, clearError = () => {} }) {
  const criticalSystems = Array.isArray(form.critical_systems) ? form.critical_systems : [];

  const toggleCriticalSystem = (sys) => {
    const next = criticalSystems.includes(sys)
      ? criticalSystems.filter(s => s !== sys)
      : [...criticalSystems, sys];
    handleChange('critical_systems', next);
  };

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── פרטים כלליים ───────────────────────────────────────────── */}
      <Section title="פרטים כלליים">
        <div data-field="nickname">
          <Label>שם הגנרטור / כינוי <span className="text-red-400">*</span></Label>
          <Input
            value={form.nickname || ''}
            onChange={e => { handleChange('nickname', e.target.value); clearError('nickname'); }}
            onClear={() => handleChange('nickname', '')}
            placeholder="לדוגמה: גנרטור חירום לעסק"
            error={!!errors.nickname}
          />
          <FieldError message={errors.nickname} />
        </div>

        <div data-field="generator_type">
          <Label>סוג גנרטור <span className="text-red-400">*</span></Label>
          <Select
            value={form.generator_type || ''}
            onValueChange={v => { handleChange('generator_type', v); clearError('generator_type'); }}
          >
            <SelectTrigger className="h-11"><SelectValue placeholder="בחר סוג גנרטור..." /></SelectTrigger>
            <SelectContent dir="rtl">
              {GENERATOR_TYPE_OPTIONS.map(t => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError message={errors.generator_type} />
          {form.generator_type === 'אחר' && (
            <div className="mt-2" data-field="generator_type_other">
              <Input
                value={form.generator_type_other || ''}
                onChange={e => { handleChange('generator_type_other', e.target.value); clearError('generator_type_other'); }}
                placeholder="פרט את סוג הגנרטור"
                error={!!errors.generator_type_other}
              />
              <FieldError message={errors.generator_type_other} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>יצרן</Label>
            <Input value={form.manufacturer || ''} onChange={e => handleChange('manufacturer', e.target.value)} onClear={() => handleChange('manufacturer', '')} />
          </div>
          <div>
            <Label>דגם</Label>
            <Input value={form.model || ''} onChange={e => handleChange('model', e.target.value)} onClear={() => handleChange('model', '')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>מספר סידורי</Label>
            <Input value={form.serial_number || ''} onChange={e => handleChange('serial_number', e.target.value)} onClear={() => handleChange('serial_number', '')} dir="ltr" />
          </div>
          <div>
            <Label>שנת ייצור</Label>
            <Input type="number" min="1950" max={new Date().getFullYear()} inputMode="numeric" value={form.year || ''} onChange={e => handleChange('year', e.target.value)} placeholder="2024" dir="ltr" />
          </div>
        </div>

        <div>
          <Label>מיקום הגנרטור</Label>
          <Input value={form.location || ''} onChange={e => handleChange('location', e.target.value)} onClear={() => handleChange('location', '')} placeholder="לדוגמה: מחסן, חניון, גג, אתר עבודה" />
        </div>
      </Section>

      {/* ── נתונים טכניים ──────────────────────────────────────────── */}
      <Section title="נתונים טכניים">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>סוג דלק</Label>
            <Select value={form.fuel_type || ''} onValueChange={v => handleChange('fuel_type', v)}>
              <SelectTrigger className="h-11"><SelectValue placeholder="בחר" /></SelectTrigger>
              <SelectContent dir="rtl">
                {FUEL_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>הספק</Label>
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.1" inputMode="decimal" value={form.power_value || ''} onChange={e => handleChange('power_value', e.target.value)} placeholder="0" dir="ltr" className="flex-1" />
              <Select value={form.power_unit || ''} onValueChange={v => handleChange('power_unit', v)}>
                <SelectTrigger className="h-11 w-24"><SelectValue placeholder="יחידה" /></SelectTrigger>
                <SelectContent dir="ltr">
                  {POWER_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div>
          <Label>האם קיים מונה שעות עבודה?</Label>
          <YesNo value={form.has_hour_meter} onChange={v => handleChange('has_hour_meter', v)} />
        </div>

        {form.has_hour_meter === true && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>שעות עבודה נוכחיות</Label>
              {/* Stored in current_engine_hours — the shared usage column. */}
              <Input type="number" min="0" step="1" inputMode="numeric" value={form.current_engine_hours || ''} onChange={e => handleChange('current_engine_hours', e.target.value)} placeholder="0" dir="ltr" />
            </div>
            <div>
              <Label>שעות עבודה בטיפול האחרון</Label>
              <Input type="number" min="0" step="1" inputMode="numeric" value={form.work_hours_at_last_service || ''} onChange={e => handleChange('work_hours_at_last_service', e.target.value)} placeholder="0" dir="ltr" />
            </div>
          </div>
        )}
      </Section>

      {/* ── מערכות חירום ובקרה ─────────────────────────────────────── */}
      <Section title="מערכות חירום ובקרה">
        <div>
          <Label>מחובר למערכת העברה אוטומטית (ATS)?</Label>
          <YesNo value={form.has_ats} onChange={v => handleChange('has_ats', v)} />
        </div>
        <div>
          <Label>משמש לחירום?</Label>
          <YesNo value={form.is_emergency_generator} onChange={v => handleChange('is_emergency_generator', v)} />
        </div>
        <div>
          <Label>מחובר למערכות קריטיות?</Label>
          <YesNo value={form.connected_to_critical_systems} onChange={v => handleChange('connected_to_critical_systems', v)} />
        </div>

        {form.connected_to_critical_systems === true && (
          <div>
            <Label className="block mb-1.5">אילו מערכות?</Label>
            <div className="flex flex-wrap gap-2">
              {CRITICAL_SYSTEM_OPTIONS.map(sys => {
                const selected = criticalSystems.includes(sys);
                return (
                  <button
                    key={sys}
                    type="button"
                    onClick={() => toggleCriticalSystem(sys)}
                    className="px-3 py-1.5 rounded-full text-sm font-medium border transition-all active:scale-95"
                    style={selected
                      ? { background: C.primary, borderColor: C.primary, color: '#fff' }
                      : { background: '#fff', borderColor: C.gray300, color: C.gray700 }}
                  >
                    {selected && '✓ '}{sys}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* ── רגולציה / אישורים ──────────────────────────────────────── */}
      <Section title="רגולציה ואישורים">
        <div>
          <Label>נדרש אישור כבאות / רישוי עסק?</Label>
          <YesNo
            value={form.requires_fire_dept_approval}
            onChange={v => handleChange('requires_fire_dept_approval', v)}
            options={FIRE_APPROVAL_OPTIONS.map(o => ({ val: o, label: o }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>תאריך אישור תקינות אחרון</Label>
            <DateInput value={form.last_safety_approval_date || ''} onChange={e => handleChange('last_safety_approval_date', e.target.value)} />
          </div>
          <div>
            <Label>תאריך בדיקת עומס אחרונה</Label>
            <DateInput value={form.last_load_bank_test_date || ''} onChange={e => handleChange('last_load_bank_test_date', e.target.value)} />
          </div>
          <div>
            <Label>תאריך טיפול אחרון</Label>
            <DateInput value={form.last_service_date || ''} onChange={e => handleChange('last_service_date', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>שם טכנאי / חברה מטפלת</Label>
            <Input value={form.technician_name || ''} onChange={e => handleChange('technician_name', e.target.value)} onClear={() => handleChange('technician_name', '')} />
          </div>
          <div>
            <Label>טלפון טכנאי</Label>
            <Input type="tel" inputMode="tel" value={form.technician_phone || ''} onChange={e => handleChange('technician_phone', e.target.value.replace(/[^0-9\-+\s]/g, ''))} placeholder="05X-XXXXXXX" dir="ltr" />
          </div>
        </div>
      </Section>
    </div>
  );
}

/**
 * The generator-specific column names that AddVehicle / EditVehicle must
 * persist (on top of the shared columns nickname / manufacturer / model /
 * year / fuel_type / current_engine_hours). Exported so both save handlers
 * stay in sync with this form.
 */
export const GENERATOR_DB_COLUMNS = [
  'generator_type', 'generator_type_other', 'power_value', 'power_unit',
  'location', 'serial_number', 'has_hour_meter', 'work_hours_at_last_service',
  'has_ats', 'is_emergency_generator', 'connected_to_critical_systems',
  'critical_systems', 'requires_fire_dept_approval',
  'last_service_date', 'last_load_bank_test_date', 'last_safety_approval_date',
  'technician_name', 'technician_phone',
];

/** Empty-form defaults for the generator fields (spread into EMPTY_FORM). */
export const GENERATOR_EMPTY_FIELDS = {
  generator_type: '',
  generator_type_other: '',
  power_value: '',
  power_unit: '',
  location: '',
  serial_number: '',
  has_hour_meter: undefined,
  work_hours_at_last_service: '',
  has_ats: undefined,
  is_emergency_generator: undefined,
  connected_to_critical_systems: undefined,
  critical_systems: [],
  requires_fire_dept_approval: '',
  last_service_date: '',
  last_load_bank_test_date: '',
  last_safety_approval_date: '',
  technician_name: '',
  technician_phone: '',
};
