/**
 * KpiTile — vivid colored surface for a single KPI.
 *
 * Each `tone` carries its own gradient surface, border, text, and
 * shadow color. The eye instantly connects color → meaning:
 *   emerald = healthy / active / counted
 *   amber   = financial / pending / warning
 *   blue    = info / neutral data
 *   red     = problem / critical
 *
 * Optional `spark` renders a 6-point sparkline below the value. Use
 * for trended metrics (expenses, tasks over time) — NOT for static
 * counts. The chart color matches the tile's value text.
 *
 * The optional `to` makes the whole tile a Link.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import Sparkline from './Sparkline';

const TONES = {
  emerald: {
    surface: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
    border:  '#A7F3D0',
    label:   '#047857',
    value:   '#065F46',
    shadow:  '0 4px 12px rgba(16,185,129,0.12)',
    hover:   '0 8px 20px rgba(16,185,129,0.20)',
  },
  amber: {
    surface: 'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
    border:  '#FCD34D',
    label:   '#B45309',
    value:   '#78350F',
    shadow:  '0 4px 12px rgba(245,158,11,0.12)',
    hover:   '0 8px 20px rgba(245,158,11,0.20)',
  },
  blue: {
    surface: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
    border:  '#93C5FD',
    label:   '#1D4ED8',
    value:   '#1E3A8A',
    shadow:  '0 4px 12px rgba(59,130,246,0.12)',
    hover:   '0 8px 20px rgba(59,130,246,0.20)',
  },
  red: {
    surface: 'linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)',
    border:  '#FCA5A5',
    label:   '#B91C1C',
    value:   '#7F1D1D',
    shadow:  '0 4px 12px rgba(239,68,68,0.12)',
    hover:   '0 8px 20px rgba(239,68,68,0.20)',
  },
  purple: {
    surface: 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)',
    border:  '#D8B4FE',
    label:   '#7E22CE',
    value:   '#581C87',
    shadow:  '0 4px 12px rgba(168,85,247,0.12)',
    hover:   '0 8px 20px rgba(168,85,247,0.20)',
  },
};

export default function KpiTile({
  label,
  value,
  sub = null,
  subTone = 'neutral',
  tone = 'emerald',
  spark = null,
  to,
}) {
  const t = TONES[tone] || TONES.emerald;

  const subColor = {
    neutral: t.label,
    red:     '#B91C1C',
    green:   '#047857',
  }[subTone] || t.label;

  const inner = (
    <div
      className="rounded-2xl p-3.5 transition-all hover:scale-[1.02] active:scale-[0.99] border h-full"
      style={{
        background: t.surface,
        borderColor: t.border,
        boxShadow: t.shadow,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = t.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = t.shadow; }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.12em] font-bold mb-1.5"
        style={{ color: t.label }}
      >
        {label}
      </p>
      <p
        className="font-black tabular-nums leading-none"
        style={{
          color: t.value,
          fontSize: 'clamp(1.5rem, 3.5vw, 2rem)',
          fontWeight: 900,
          letterSpacing: '-0.02em',
        }}
        dir={typeof value === 'string' && /[֐-׿]/.test(value) ? 'rtl' : 'ltr'}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-1.5 font-bold" style={{ color: subColor }}>
          {sub}
        </p>
      )}
      {Array.isArray(spark) && spark.length >= 2 && (
        <div className="mt-2 -mx-1 opacity-90">
          <Sparkline data={spark} color={t.value} height={26} />
        </div>
      )}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}
