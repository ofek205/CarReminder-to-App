import React from 'react';

// Shared plate input used by VehicleCheck and Dashboard hero.
export default function VehicleCheckPlateInput({ value, onChange, onEnter, disabled, compact = false }) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  const formatPlate = (raw) => {
    if (raw.length <= 2) return raw;
    if (raw.length === 8) return `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5, 8)}`;
    return `${raw.slice(0, 2)}-${raw.slice(2, 5)}-${raw.slice(5, 7)}`.replace(/-$/, '');
  };
  const display = formatPlate(digits);

  return (
    <div
      className={`relative overflow-hidden border-2 border-[#1B1B1B] bg-[#F7C300] shadow-[0_6px_14px_rgba(0,0,0,0.22)] ${compact ? 'max-w-lg mx-auto rounded-xl' : 'rounded-2xl'}`}
      dir="ltr"
    >
      <div className="absolute inset-y-0 left-0 w-[38px] bg-[#0A3A78] border-r border-[#072A56] flex flex-col items-center justify-center">
        <span className="text-white text-[9px] leading-none font-black">IL</span>
        <span className="text-white text-[6px] leading-none font-bold mt-0.5 mb-0.5">ישראל</span>
        <span className="w-4 h-3 rounded-[2px] bg-white border border-[#D9D9D9]" />
      </div>
      <input
        value={display}
        disabled={disabled}
        onChange={(e) => onChange(String(e.target.value || '').replace(/\D/g, '').slice(0, 8))}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="12-345-67"
        aria-label="מספר רישוי"
        className={`w-full bg-transparent text-center font-black tabular-nums text-black placeholder:text-black/30 outline-none disabled:opacity-60 ${
          compact ? 'h-10 pl-[44px] pr-2 text-[29px] tracking-[0.08em]' : 'h-14 pl-[46px] pr-3 text-[34px] tracking-[0.09em]'
        }`}
      />
    </div>
  );
}
