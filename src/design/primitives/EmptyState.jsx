import React from 'react';

/**
 * <EmptyState> — replaces the legacy src/components/shared/EmptyState.jsx.
 *
 * Why a new one?
 *   - Legacy version uses amber colors (off-brand)
 *   - Hard-coded 16x16 icon container
 *   - No tone variants
 *
 * Tones:
 *   neutral   — default, gray icon container
 *   brand     — brand-soft icon container (encourages action)
 *   warning   — amber container (dimmed warning state)
 *
 * Action: pass a <CTAButton> or <Link>. The empty state itself does
 * NOT render a button — composition over options.
 *
 * Smart empty states (sprint 4): pages should pass a meaningful action
 * like "הוסף רכב ראשון" instead of a generic "+ Add".
 */

const toneClasses = {
  neutral: { bg: 'bg-cr-surface-subtle',     fg: 'text-cr-text-muted'    },
  brand:   { bg: 'bg-cr-surface-brand-soft', fg: 'text-cr-brand-primary' },
  warning: { bg: 'bg-cr-status-warn-bg',     fg: 'text-cr-status-warn-fg'},
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  className = '',
}) {
  const t = toneClasses[tone] || toneClasses.neutral;

  return (
    <div
      dir="rtl"
      className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}
      role="status"
    >
      {Icon && (
        <div
          className={`w-16 h-16 rounded-cr-xl flex items-center justify-center mb-4 ${t.bg}`}
          aria-hidden="true"
        >
          <Icon className={`w-7 h-7 ${t.fg}`} strokeWidth={1.8} />
        </div>
      )}
      <h3 className="text-cr-lg font-cr-semibold text-cr-text-primary leading-tight">
        {title}
      </h3>
      {description && (
        <p className="text-cr-sm text-cr-text-secondary mt-1.5 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
