import React from 'react';

// AviationPlateBadge — display-only badge for an aircraft registration
// mark. Used in VehicleDetail header, SummaryCard, and anywhere we'd
// normally render <LicensePlate /> but the plate is "4X-XXX" form.
// White background + dark monospace text, no yellow plate styling —
// matches the AviationPlateInput visual language.
export default function AviationPlateBadge({ value, size = 'md' }) {
  const display = String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const sizeClasses = {
    sm: 'text-sm px-2 py-0.5 h-7',
    md: 'text-base px-3 py-1 h-9',
    lg: 'text-lg px-4 py-1.5 h-11',
  }[size] || 'text-base px-3 py-1 h-9';

  return (
    <span
      dir="ltr"
      className={`inline-flex items-center justify-center font-mono font-bold tabular-nums tracking-wider bg-white border-2 rounded-lg shadow-sm text-gray-900 ${sizeClasses}`}
      style={{ borderColor: '#2D5233', letterSpacing: '0.08em' }}
    >
      {display || '4X-???'}
    </span>
  );
}
