import React from 'react';

// Shared plate input used by VehicleCheck and Dashboard hero.
export default function VehicleCheckPlateInput({ value, onChange, onEnter, disabled, compact = false }) {
  return (
    <div
      className={`relative rounded-2xl border-2 border-[#1A3A5C] bg-[#FFBF00] shadow-lg overflow-hidden ${compact ? 'max-w-2xl mx-auto' : ''}`}
      dir="ltr"
    >
      <div className="absolute inset-y-0 left-0 w-12 bg-[#1A3A5C] flex flex-col items-center justify-center gap-1">
        <span className="text-white text-[10px] font-black">IL</span>
        <span className="w-5 h-3 bg-white rounded-sm" />
      </div>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
        inputMode="numeric"
        autoComplete="off"
        placeholder="12345678"
        aria-label="מספר רישוי"
        className={`w-full pl-14 pr-4 bg-transparent text-center font-black tracking-[0.18em] text-[#1A1A1A] placeholder:text-black/25 outline-none disabled:opacity-60 ${
          compact ? 'h-12 text-xl' : 'h-14 text-2xl'
        }`}
      />
    </div>
  );
}
