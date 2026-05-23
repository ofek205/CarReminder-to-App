import React from 'react';

const WheelchairSvg = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="4" r="2" />
    <path d="M12 8a2 2 0 0 0-2 2v4H6a6 6 0 1 0 4.9 9.4l-1.64-1.15A4 4 0 1 1 6 16h5a2 2 0 0 0 2-2v-2h3.5L19 18h2l-3-7h-4v-1a2 2 0 0 0-2-2z" />
  </svg>
);

export default function DisabilityPermitBadge({ type = 'permanent', variant = 'full' }) {
  const isTemporary = type === 'temporary';
  const label = isTemporary ? 'תו נכה זמני' : 'תו נכה';
  const ariaLabel = isTemporary
    ? 'לרכב זה יש תו חניה לנכה זמני'
    : 'לרכב זה יש תו חניה לנכה';

  if (variant === 'icon') {
    return (
      <span
        role="img"
        aria-label={ariaLabel}
        title={label}
        className="inline-flex items-center justify-center"
        style={{ opacity: 0.85 }}
      >
        <WheelchairSvg size={14} color="#2563EB" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 animate-in fade-in duration-200"
      dir="rtl"
      style={{
        background: 'rgba(37, 99, 235, 0.85)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        borderRadius: '999px',
        padding: '3px 8px 3px 6px',
        lineHeight: 1,
      }}
    >
      <WheelchairSvg size={12} color="white" />
      <span style={{ fontSize: 11, fontWeight: 700, color: 'white', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </span>
  );
}
