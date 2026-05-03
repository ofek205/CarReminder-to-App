import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, Info } from 'lucide-react';

/**
 * <StatusPill> — semantic status indicator.
 *
 * Replaces the dozens of ad-hoc inline-styled badges scattered across
 * Dashboard / Vehicles / Notifications / Accidents / Fleet that each
 * spelled out their own bg/fg/border hex values.
 *
 * Statuses (intent-based, not color-based):
 *   ok      — תקין / completed / valid
 *   warn    — בקרוב / approaching / soft alert
 *   danger  — באיחור / overdue / failure
 *   info    — לידיעה / informational / neutral
 *
 * Sizes:
 *   sm  — 22px tall, dense rows
 *   md  — 28px tall, default
 *
 * Composability: pass `icon={false}` to hide the auto-icon, or
 * `icon={SomeLucideIcon}` to override.
 */

const statusMap = {
  ok:     { bg: 'bg-cr-status-ok-bg',     fg: 'text-cr-status-ok-fg',     border: 'border-cr-status-ok-border',     icon: CheckCircle2 },
  warn:   { bg: 'bg-cr-status-warn-bg',   fg: 'text-cr-status-warn-fg',   border: 'border-cr-status-warn-border',   icon: Clock },
  danger: { bg: 'bg-cr-status-danger-bg', fg: 'text-cr-status-danger-fg', border: 'border-cr-status-danger-border', icon: AlertTriangle },
  info:   { bg: 'bg-cr-status-info-bg',   fg: 'text-cr-status-info-fg',   border: 'border-cr-status-info-border',   icon: Info },
};

const sizeClasses = {
  sm: 'h-[22px] px-2 text-[11px] gap-1',
  md: 'h-7 px-2.5 text-cr-xs gap-1.5',
};

const iconSizes = { sm: 11, md: 13 };

export default function StatusPill({
  status = 'info',
  size = 'md',
  icon,
  className = '',
  children,
}) {
  const meta = statusMap[status] || statusMap.info;
  const s = sizeClasses[size] || sizeClasses.md;
  const showIcon = icon !== false;
  const Icon = (typeof icon === 'function') ? icon : meta.icon;

  return (
    <span
      className={[
        'inline-flex items-center rounded-cr-full border font-cr-semibold whitespace-nowrap',
        meta.bg,
        meta.fg,
        meta.border,
        s,
        className,
      ].filter(Boolean).join(' ')}
    >
      {showIcon && Icon && <Icon size={iconSizes[size] || iconSizes.md} aria-hidden="true" />}
      {children}
    </span>
  );
}
