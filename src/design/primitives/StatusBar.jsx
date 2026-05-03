import React from 'react';

/**
 * <StatusBar> — the 3-up status summary used everywhere.
 *
 * Replaces the copy-paste pattern across Dashboard, Vehicles, Notifications,
 * Accidents, Fleet, BusinessDashboard. Each currently spells out the
 * same grid of ok/warn/danger cards with hand-picked hex values.
 *
 * Items contract:
 *   { key, label, count, status: 'ok'|'warn'|'danger'|'info', icon, onClick? }
 *
 * Behavior:
 *   - Active item gets a stronger ring (no background-flip — that
 *     made the cards look like radio buttons, not summary tiles).
 *   - Disabled (count === 0) is dimmed and unclickable.
 *   - Auto-grid: 2 items → 2 cols, 3 → 3, 4 → 4 (capped).
 */

const statusBgMap = {
  ok:     'bg-cr-status-ok-bg     text-cr-status-ok-fg',
  warn:   'bg-cr-status-warn-bg   text-cr-status-warn-fg',
  danger: 'bg-cr-status-danger-bg text-cr-status-danger-fg',
  info:   'bg-cr-status-info-bg   text-cr-status-info-fg',
};

const statusActiveRingMap = {
  ok:     'ring-cr-status-ok-solid/40',
  warn:   'ring-cr-status-warn-solid/40',
  danger: 'ring-cr-status-danger-solid/40',
  info:   'ring-cr-status-info-solid/40',
};

export default function StatusBar({ items, activeKey, onChange, className = '' }) {
  if (!items || items.length === 0) return null;

  const cols = Math.min(items.length, 4);
  const colsCls = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[cols] || 'grid-cols-3';

  return (
    <div dir="rtl" className={`grid ${colsCls} gap-2 ${className}`}>
      {items.map(item => {
        const Icon = item.icon;
        const clickable = !!onChange && item.count > 0;
        const isActive = activeKey === item.key;
        const bg = statusBgMap[item.status] || statusBgMap.info;
        const ring = statusActiveRingMap[item.status] || statusActiveRingMap.info;

        return (
          <button
            key={item.key}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onChange(isActive ? null : item.key)}
            aria-pressed={isActive}
            aria-label={`${item.count} ${item.label}`}
            className={[
              'rounded-cr-lg py-3 px-2',
              'flex flex-col items-center justify-center gap-1',
              'transition-all',
              'active:scale-[0.97] disabled:active:scale-100',
              'disabled:opacity-60 disabled:cursor-default',
              clickable ? 'cursor-pointer' : '',
              bg,
              isActive ? `ring-2 ${ring}` : '',
            ].filter(Boolean).join(' ')}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-cr-2xl font-cr-bold leading-none">{item.count}</span>
              {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
            </div>
            <span className="text-cr-xs font-cr-semibold">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
