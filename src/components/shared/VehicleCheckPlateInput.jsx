import React from 'react';
import IsraeliPlateBadge from './IsraeliPlateBadge';

// Shared plate input used by VehicleCheck and Dashboard hero. The IL strip
// (IL + ישראל + flag) is delegated to <IsraeliPlateBadge /> so the same
// markup powers the read-only <LicensePlate /> display elsewhere.
export default function VehicleCheckPlateInput({ value, onChange, onEnter, disabled, compact = false, autoFocus = false }) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  const formatPlate = (raw) => {
    if (raw.length <= 2) return raw;
    if (raw.length === 8) return `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5, 8)}`;
    return `${raw.slice(0, 2)}-${raw.slice(2, 5)}-${raw.slice(5, 7)}`.replace(/-$/, '');
  };
  const display = formatPlate(digits);
  const inputHeightPx = compact ? 40 : 56; // matches h-10 / h-14

  return (
    <div
      className={`relative overflow-hidden border-2 border-[#1B1B1B] bg-[#F7C300] shadow-[0_6px_14px_rgba(0,0,0,0.22)] ${compact ? 'max-w-lg mx-auto rounded-xl' : 'rounded-2xl'}`}
      dir="ltr"
      style={{ height: inputHeightPx }}
    >
      <IsraeliPlateBadge fill height={inputHeightPx} />
      <input
        value={display}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(String(e.target.value || '').replace(/\D/g, '').slice(0, 8))}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="12-345-67"
        aria-label="מספר רישוי"
        className={`w-full h-full bg-transparent text-center font-bold tabular-nums text-black placeholder:text-black/30 outline-none disabled:opacity-60 ${
          // Text size is ~50% of plate height — proportional to a real
          // Israeli plate. Previous values (29px / 34px) were 73%+ of
          // height and overflowed when the input sat next to a button
          // in narrow flex containers (AddVehicle, mobile Dashboard).
          // Padding-left clears the IL strip (86% of height + 6px gap).
          compact ? 'pl-[40px] pr-2 text-[22px] tracking-[0.05em]' : 'pl-[54px] pr-3 text-[30px] tracking-[0.06em]'
        }`}
      />
    </div>
  );
}
