/**
 * ActionTile — call-to-action button card.
 *
 * Two variants:
 *   • primary   = gradient emerald with glow shadow + icon spin on hover.
 *                 Used for the most important action on a page (e.g. "צור משימה").
 *   • secondary = white surface with mint icon and emerald border on hover.
 *                 Used for the supporting actions.
 *
 * Always 1:1 layout: icon top, label below. Bigger touch target than
 * a pill. Designed to read as a confident call rather than a chip.
 */
import React from 'react';
import { Link } from 'react-router-dom';

export default function ActionTile({ to, icon: Icon, label, primary = false }) {
  if (primary) {
    return (
      <Link
        to={to}
        className="rounded-2xl p-3 flex flex-col items-start gap-2 transition-all hover:scale-[1.03] active:scale-[0.98] group"
        style={{
          background: 'linear-gradient(135deg, #065F46 0%, #10B981 80%, #34D399 100%)',
          boxShadow: '0 8px 20px rgba(16,185,129,0.32), 0 2px 6px rgba(16,185,129,0.18)',
        }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-transform group-hover:rotate-3"
          style={{ background: 'rgba(255,255,255,0.25)', backdropFilter: 'blur(4px)' }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
        <span className="text-sm font-bold text-white">{label}</span>
      </Link>
    );
  }
  return (
    <Link
      to={to}
      className="rounded-2xl p-3 flex flex-col items-start gap-2 border transition-all hover:scale-[1.03] active:scale-[0.98] group"
      style={{
        background: '#FFFFFF',
        borderColor: '#D1FAE5',
        boxShadow: '0 2px 8px rgba(15,40,28,0.04)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#10B981';
        e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,185,129,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#D1FAE5';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(15,40,28,0.04)';
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: '#ECFDF5', color: '#10B981' }}
      >
        <Icon className="w-4 h-4" />
      </div>
      <span className="text-sm font-bold" style={{ color: '#0B2912' }}>{label}</span>
    </Link>
  );
}
