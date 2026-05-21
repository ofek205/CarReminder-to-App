import React from 'react';
import IsraeliPlateBadge from './IsraeliPlateBadge';

// Shared plate input used by VehicleCheck and Dashboard hero. The IL strip
// (IL + ישראל + flag) is delegated to <IsraeliPlateBadge /> so the same
// markup powers the read-only <LicensePlate /> display elsewhere.
//
// Smart-mode behavior (2026-05-21): a single input handles both Israeli
// ground-vehicle plates AND aircraft identifiers. We detect which mode
// the user is in by whether the typed value contains Latin letters:
//   • Digits-only → existing yellow IL plate behaviour, formatted with
//     2-3-2 or 3-2-3 dashes, capped at 8 digits, numeric keyboard.
//   • Contains letters → aviation: preserve alphanumeric + dash as-is,
//     uppercase on render, cap at 20 chars, text keyboard. The yellow
//     plate visual stays — slightly off-theme for aircraft but keeps
//     the page UX simple (one box, one button, no mode toggle).
// The lookup tier (vehicleLookup) sniffs the value the same way and
// routes to the right registry (ground cascade vs aircraft tier).
export default function VehicleCheckPlateInput({ value, onChange, onEnter, disabled, compact = false, autoFocus = false }) {
  const rawValue = String(value || '');
  const isAviation = /[A-Za-z]/.test(rawValue);

  const formatPlate = (raw) => {
    if (raw.length <= 2) return raw;
    if (raw.length === 8) return `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5, 8)}`;
    return `${raw.slice(0, 2)}-${raw.slice(2, 5)}-${raw.slice(5, 7)}`.replace(/-$/, '');
  };

  const display = isAviation
    ? rawValue.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)
    : formatPlate(rawValue.replace(/\D/g, '').slice(0, 8));

  const handleInput = (e) => {
    const v = String(e.target.value || '');
    // The hand-off uses the typed string, not the displayed (formatted)
    // string — so backspace into a dash works the same as backspacing
    // into a digit (formatPlate re-derives dashes from the canonical
    // digits each render).
    if (/[A-Za-z]/.test(v)) {
      onChange(v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20));
    } else {
      onChange(v.replace(/\D/g, '').slice(0, 8));
    }
  };

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
        onChange={handleInput}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        // text inputMode covers both digits and letters; numeric-only
        // would hide letters from mobile keyboards and prevent aviation
        // users from typing.
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="הזן מספר רישוי או 4X-AIU"
        aria-label="מספר רישוי או סימן רישום של כלי טיס"
        className={`w-full h-full bg-transparent text-center font-bold tabular-nums text-black placeholder:text-black/50 placeholder:font-normal outline-none disabled:opacity-60 uppercase ${
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
