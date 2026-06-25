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
import { Check } from 'lucide-react';
import Sparkline from './Sparkline';
import { C } from '@/lib/designTokens';

const TONES = {
  emerald: {
    surface: `linear-gradient(135deg, ${C.successSubtle} 0%, ${C.successLight} 100%)`,
    border:  C.successLighter,
    label:   '#047857',
    value:   C.successDark,
    shadow:  '0 4px 12px rgba(16,185,129,0.12)',
    hover:   '0 8px 20px rgba(16,185,129,0.20)',
  },
  amber: {
    surface: `linear-gradient(135deg, ${C.warnSubtle} 0%, ${C.warnBg} 100%)`,
    border:  '#FCD34D',
    label:   C.warnMid,
    value:   '#78350F',
    shadow:  '0 4px 12px rgba(245,158,11,0.12)',
    hover:   '0 8px 20px rgba(245,158,11,0.20)',
  },
  blue: {
    surface: `linear-gradient(135deg, ${C.infoSubtle} 0%, ${C.infoBg} 100%)`,
    border:  '#93C5FD',
    label:   '#1D4ED8',
    value:   '#1E3A8A',
    shadow:  '0 4px 12px rgba(59,130,246,0.12)',
    hover:   '0 8px 20px rgba(59,130,246,0.20)',
  },
  red: {
    surface: `linear-gradient(135deg, ${C.errorBg} 0%, ${C.errorLight} 100%)`,
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

// Neutral surface for a disabled tile (e.g. a clickable status filter whose
// count is 0). Strips the tone color so a healthy "דחוף 0" doesn't shout,
// and signals "nothing to filter here" instead of a dead-end click.
const NEUTRAL = {
  surface: '#F9FAFB',
  border:  '#E5E7EB',
  label:   '#9CA3AF',
  value:   '#6B7280',
  shadow:  'none',
  hover:   'none',
};

export default function KpiTile({
  label,
  value,
  sub = null,
  subTone = 'neutral',
  tone = 'emerald',
  spark = null,
  to,
  // Interactive mode — when `onClick` is set the tile renders as a real
  // <button> with aria-pressed, so it can act as a filter toggle.
  onClick,
  active = false,
  disabled = false,
  // Optional label style override (lets a screen tune density without
  // changing the shared default uppercase look used elsewhere).
  labelClassName = 'text-[10px] uppercase tracking-[0.12em] font-bold mb-1.5',
}) {
  const t = disabled ? NEUTRAL : (TONES[tone] || TONES.emerald);

  const subColor = {
    neutral: t.label,
    red:     '#B91C1C',
    green:   '#047857',
  }[subTone] || t.label;

  // Active = ring in the tone's own value color (NOT a green wash, which
  // would repaint a "דחוף" tile green and break color=meaning). The ring
  // stacks on top of the tone shadow.
  const ring = active ? `, 0 0 0 2px ${t.value}` : '';
  const canHover = !disabled;

  const inner = (
    <div
      className={`relative rounded-2xl p-3.5 transition-all border h-full ${canHover ? 'hover:scale-[1.02] active:scale-[0.99]' : 'opacity-70'}`}
      style={{
        background: t.surface,
        borderColor: active ? t.value : t.border,
        boxShadow: `${t.shadow}${ring}`,
      }}
      onMouseEnter={canHover ? (e) => { e.currentTarget.style.boxShadow = `${t.hover}${ring}`; } : undefined}
      onMouseLeave={canHover ? (e) => { e.currentTarget.style.boxShadow = `${t.shadow}${ring}`; } : undefined}
    >
      {active && (
        <span
          className="absolute top-2.5 left-2.5 flex items-center justify-center h-4 w-4 rounded-full"
          style={{ background: t.value }}
          aria-hidden="true"
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3} style={{ color: '#FFFFFF' }} />
        </span>
      )}
      <p
        className={labelClassName}
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

  if (to) return <Link to={to} className="block">{inner}</Link>;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-pressed={active}
        className="block w-full text-right rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-900 disabled:cursor-default"
      >
        {inner}
      </button>
    );
  }
  return inner;
}
