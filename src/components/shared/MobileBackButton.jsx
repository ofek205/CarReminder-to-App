import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { C } from '@/lib/designTokens';

export default function MobileBackButton({ label = 'חזרה' }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="lg:hidden inline-flex items-center gap-1.5 mb-3 text-sm font-bold active:scale-[0.98] transition-transform"
      style={{ color: C.primary }}
      aria-label={label}
    >
      <ArrowRight className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}
