import React from 'react';

export default function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="text-[11px] font-bold mt-1 flex items-center gap-1 field-error-appear" style={{ color: '#DC2626' }}>
      <span className="shrink-0">⚠</span>
      {message}
    </p>
  );
}
