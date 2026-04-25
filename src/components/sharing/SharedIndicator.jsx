/**
 * SharedIndicator — small clickable badge showing a vehicle's share state.
 *
 * Two display modes:
 *   - Owner viewing their own vehicle that has shares    →  "👥 N"
 *   - Recipient viewing a vehicle shared with them       →  "משותף איתי"
 *
 * Click behavior is delegated to the parent (passes onClick) — the
 * common pattern is to open <VehicleAccessModal> with the same vehicle.
 *
 * Designed to layer cleanly on top of vehicle cards (Dashboard) and on
 * the VehicleDetail hero header. Pure presentational; the parent owns
 * the share-count fetch.
 */

import React from 'react';
import { Users, ArrowRightLeft } from 'lucide-react';

export default function SharedIndicator({
  // Number of accepted shares on this vehicle (relevant for owner view)
  shareCount = 0,
  // True when the current user is the recipient, not the owner
  isSharedWithMe = false,
  // Optional click handler — opens the access modal in the parent
  onClick,
  // 'sm' (16px icon) for cards, 'md' (18px) for headers
  size = 'sm',
  // Render as a button when onClick is provided, span otherwise
  className = '',
}) {
  if (!isSharedWithMe && shareCount <= 0) return null;

  const Icon = isSharedWithMe ? ArrowRightLeft : Users;
  // Copywriter pass: "משותף · N" reads like metadata; "שותף עם N"
  // is conversational. "שותפ/ה איתי" gender-neutralizes the recipient
  // case (the owner could be male or female).
  const label = isSharedWithMe ? 'שותפ/ה איתי' : `שותף עם ${shareCount}`;
  // Color tokens — soft teal for owner shares, warm amber for recipient
  // so the two cases are visually distinct at a glance.
  const palette = isSharedWithMe
    ? { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' }
    : { bg: '#E0F2FE', color: '#075985', border: '#BAE6FD' };

  const iconSize = size === 'md' ? 14 : 12;
  const padding = size === 'md' ? 'px-2.5 py-1' : 'px-2 py-0.5';
  const fontSize = size === 'md' ? 'text-[12px]' : 'text-[10px]';

  const baseClass = `inline-flex items-center gap-1 rounded-full font-bold transition-all ${padding} ${fontSize} ${className}`;
  const style = {
    background: palette.bg,
    color: palette.color,
    border: `1px solid ${palette.border}`,
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
        className={`${baseClass} active:scale-[0.95] hover:brightness-95`}
        style={style}
        aria-label={label}
        dir="rtl">
        <Icon style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }
  return (
    <span className={baseClass} style={style} dir="rtl">
      <Icon style={{ width: iconSize, height: iconSize }} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
