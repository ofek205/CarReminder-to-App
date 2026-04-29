import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { createPageUrl } from '@/utils';

/**
 * <PageHeader> — clean, flat page header. The new default.
 *
 * Replaces the legacy src/components/shared/PageHeader.jsx which used
 * a gradient + 2 decorative circles on every page. This one is flat:
 *   - title / subtitle (left, in RTL: right)
 *   - optional back button (right, in RTL: left, lucide ArrowRight)
 *   - optional icon next to the title (small brand-soft tile)
 *   - optional actions slot (right side)
 *
 * Use the legacy version is being phased out in sprint 2. The legacy
 * `<Hero>` primitive is for landing surfaces only.
 *
 * Props:
 *   title         — required, string (Hebrew, no emoji)
 *   subtitle      — optional, short string
 *   backTo        — optional, page name (string passed to createPageUrl)
 *                   OR full path string starting with `/`
 *   icon          — optional lucide icon component
 *   actions       — optional ReactNode (CTA buttons, etc)
 *   sticky        — optional, makes the header sticky to the top
 */
export default function PageHeader({
  title,
  subtitle,
  backTo,
  icon: Icon,
  actions,
  sticky = false,
  className = '',
}) {
  const backHref = backTo
    ? (backTo.startsWith('/') ? backTo : createPageUrl(backTo))
    : null;

  return (
    <header
      dir="rtl"
      className={[
        'flex items-center gap-3 py-4 mb-4',
        sticky ? 'sticky top-0 z-cr-sticky bg-cr-surface-canvas' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {backHref && (
        <Link
          to={backHref}
          aria-label="חזרה"
          className="w-10 h-10 rounded-cr-md flex items-center justify-center shrink-0 text-cr-text-secondary hover:bg-cr-surface-subtle transition-colors"
        >
          <ArrowRight className="w-5 h-5" aria-hidden="true" />
        </Link>
      )}

      {Icon && !backHref && (
        <div
          aria-hidden="true"
          className="w-10 h-10 rounded-cr-md flex items-center justify-center shrink-0 bg-cr-surface-brand-soft"
        >
          <Icon className="w-5 h-5 text-cr-brand-primary" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <h1 className="text-cr-xl font-cr-bold text-cr-text-primary truncate leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-cr-sm text-cr-text-secondary mt-0.5 truncate">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
