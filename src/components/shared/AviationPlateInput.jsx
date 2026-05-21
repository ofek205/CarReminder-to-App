import React from 'react';

// AviationPlateInput — free-form identifier for Israeli civil aircraft.
//
// The registry indexes records by TWO fields the user might know:
//   • Expr1 = registration mark "4X-XXX" (the tail number painted on
//     the aircraft — 100% letter format across all 547 records)
//   • MSPR_SIDORI_MTOS = manufacturer serial number, mixed format
//     ("172-65629", "0022-1115", "01-05-51-047", "S-01071794", "0338E",
//     plain digits, alphanumeric — no single pattern works)
//
// Earlier iteration locked the input to "4X-" + 3 letters. Owners who
// know their serial but not their registration (common for buyers
// inheriting paperwork) couldn't search at all. Now: free-form ASCII
// alphanumeric + dash, uppercase-on-render. The lookup tier inspects
// the value and routes to the right column (Expr1 vs serial).
//
// Visual language is deliberately different from the yellow Israeli
// car-plate input: white background, dark mono text. Aircraft IDs are
// not road plates.
export default function AviationPlateInput({ value, onChange, onEnter, disabled, autoFocus = false }) {
  const inputRef = React.useRef(null);
  const display = String(value || '').toUpperCase();

  const handleChange = (e) => {
    // Permit Latin letters, digits, and dashes only — strips Hebrew,
    // spaces, punctuation, anything else. Length cap at 20 covers the
    // longest seen in the registry ("01-01-51-047" is 12, S-prefixed
    // serials go to ~12, generous headroom). Uppercase normalises so
    // the lookup-tier regex (`^4X-[A-Z]{3}$`) sees a stable form.
    const next = String(e.target.value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    onChange?.(next);
  };

  const focusInput = () => { if (!disabled) inputRef.current?.focus(); };

  return (
    <div className="space-y-1.5">
      <div
        className="relative border-2 rounded-2xl overflow-hidden shadow-sm h-14 bg-white cursor-text"
        style={{ borderColor: '#2D5233' }}
        dir="ltr"
        onClick={focusInput}
      >
        <input
          ref={inputRef}
          value={display}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="4X-AIU או 172-65629"
          aria-label="סימן רישום או מספר סידורי של כלי טיס"
          className="w-full h-full bg-transparent text-center font-mono font-bold text-xl tabular-nums tracking-wider text-gray-900 placeholder:text-gray-300 placeholder:font-normal outline-none disabled:opacity-60 uppercase px-3"
        />
      </div>
      <p className="text-xs text-gray-500 text-right" dir="rtl">
        סימן רישום (4X-AIU) או מספר סידורי (172-65629). אותיות אנגליות, ספרות, מקפים.
      </p>
    </div>
  );
}
