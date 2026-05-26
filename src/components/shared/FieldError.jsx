import React from 'react';
import { C } from '@/lib/designTokens';

export default function FieldError({ message }) {
  if (!message) return null;
  return (
    <p className="text-[11px] font-bold mt-1 flex items-center gap-1 field-error-appear" style={{ color: C.error }}>
      <span className="shrink-0">⚠</span>
      {message}
    </p>
  );
}
