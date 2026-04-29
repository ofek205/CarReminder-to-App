import React from 'react';

/**
 * <Hero> — the ONE place gradients are allowed.
 *
 * Used for: dashboard landing, urgent/promotional callouts, welcome
 * surfaces. NOT to be used as a page header — that's <PageHeader>.
 *
 * Why "the one"?
 *   In the audit we found ~140 places using `linear-gradient(135deg…)`
 *   plus decorative circles. When every container is hero-ish, no
 *   container actually feels important. Reserving gradient for one
 *   primitive restores hierarchy.
 *
 * Tones:
 *   brand   — green gradient (default, vehicle context)
 *   amber   — warm amber (achievement, celebration)
 *   marine  — teal (vessels)
 *   neutral — gray gradient (subdued)
 *
 * Vehicle theming:
 *   Wrap in a <div data-theme="marine"> or "earth" to re-bind brand
 *   tokens. The brand variant will then render teal/brown instead.
 *   This keeps the same component visually consistent with the
 *   active vehicle context.
 */

const toneStyles = {
  brand: {
    background: 'linear-gradient(135deg, var(--cr-green-700) 0%, var(--cr-green-500) 100%)',
    color: '#FFFFFF',
  },
  amber: {
    background: 'linear-gradient(135deg, var(--cr-amber-700) 0%, var(--cr-amber-500) 100%)',
    color: '#FFFFFF',
  },
  marine: {
    background: 'linear-gradient(135deg, var(--cr-marine-600) 0%, var(--cr-marine-500) 100%)',
    color: '#FFFFFF',
  },
  neutral: {
    background: 'linear-gradient(135deg, var(--cr-gray-800) 0%, var(--cr-gray-600) 100%)',
    color: '#FFFFFF',
  },
};

export default function Hero({
  tone = 'brand',
  size = 'md',     // 'sm' | 'md' | 'lg'
  className = '',
  children,
}) {
  const style = toneStyles[tone] || toneStyles.brand;
  const padding = { sm: 'p-4', md: 'p-5', lg: 'p-7' }[size] || 'p-5';

  return (
    <section
      dir="rtl"
      className={`rounded-cr-xl ${padding} relative overflow-hidden ${className}`}
      style={style}
    >
      {/* Subtle inner highlight on top edge — adds depth without
          decorative circles. ~1% of the brightness budget.
          Stays for ALL hero variants for visual cohesion. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)' }}
      />
      <div className="relative">{children}</div>
    </section>
  );
}
