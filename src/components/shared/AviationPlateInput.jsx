import React from 'react';

// AviationPlateInput — input for Israeli ICAO aircraft registration marks.
//
// Israeli civil aviation plates are always "4X-XXX" (4X- prefix + exactly
// 3 uppercase letters). We render "4X-" as a static, non-editable visual
// prefix so the user only types the 3-letter suffix. Stripping the prefix
// from any pasted/typed value (in case the user pastes the whole mark)
// keeps state clean — onChange always receives the full "4X-XXX" string.
//
// Visual language is deliberately different from the yellow Israeli
// car-plate input: white background, dark text, mono font. An aircraft
// reg mark IS visually a metal plate but not a road plate, and forcing
// it into the yellow design would mislead users.
export default function AviationPlateInput({ value, onChange, onEnter, disabled, autoFocus = false }) {
  const inputRef = React.useRef(null);

  // value coming in is the canonical "4X-XXX" form (or a partial like
  // "4X-AI"). The input only ever displays the 3-letter suffix; we
  // extract it on render and rebuild the full mark on each keystroke.
  // Strip the "4X-" prefix first so a user who pastes the FULL mark
  // ("4X-AIU") still ends up with just the suffix in the input — without
  // the prefix-strip first, the digit-removal regex would leave "XAIU"
  // and slice to "XAI" (wrong).
  const suffix = String(value || '').toUpperCase().replace(/^4X-?/, '').replace(/[^A-Z]/g, '').slice(0, 3);

  const handleChange = (e) => {
    // Same order as `suffix` derivation: strip the optional "4X-" prefix
    // BEFORE removing non-letters. Otherwise paste of "4X-AIU" loses the
    // '4' and '-' first, leaving "XAIU" → sliced to "XAI". Same logic
    // also tolerates pasting "4XAIU" (no dash) or "4x-aiu" (lowercase).
    const raw = String(e.target.value || '').toUpperCase().replace(/^4X-?/, '');
    const next = raw.replace(/[^A-Z]/g, '').slice(0, 3);
    onChange?.(next ? `4X-${next}` : '');
  };

  // Clicking on the visual "4X-" prefix should focus the input — without
  // this, users who tap the prefix (it looks like part of the same field)
  // get no feedback and the input never gains focus.
  const focusInput = () => { if (!disabled) inputRef.current?.focus(); };

  return (
    <div className="space-y-1.5">
      <div
        className="relative flex items-stretch border-2 rounded-2xl overflow-hidden shadow-sm h-14 bg-white cursor-text"
        style={{ borderColor: '#2D5233' }}
        dir="ltr"
        onClick={focusInput}
      >
        <div
          className="flex items-center justify-center px-3 font-mono font-bold text-2xl tabular-nums select-none"
          style={{ color: '#6B7280', background: '#F3F4F6', letterSpacing: '0.04em' }}
        >
          4X-
        </div>
        <input
          ref={inputRef}
          value={suffix}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={handleChange}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="AIU"
          aria-label="סימן רישום של כלי טיס"
          maxLength={3}
          // No type=text/lang restrictions on Hebrew keyboards beyond the
          // regex-strip, but UI hints (uppercase + mono + placeholder
          // "AIU") make it obvious that English letters are required.
          className="flex-1 bg-transparent text-center font-mono font-bold text-2xl tabular-nums tracking-[0.15em] text-gray-900 placeholder:text-gray-300 outline-none disabled:opacity-60 uppercase"
        />
      </div>
      <p className="text-xs text-gray-500 text-right" dir="rtl">
        3 אותיות אנגליות (לדוגמה: AIU, EKS, HRX). אם המקלדת בעברית — החלף ל-English.
      </p>
    </div>
  );
}
