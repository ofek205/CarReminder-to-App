import React from 'react';

// Custom off-road vehicle icons matching lucide style (24x24 viewBox, stroke-based)

export function AtvIcon({ className = '', size = 16, strokeWidth = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} {...rest}>
      {/* 4 wheels */}
      <circle cx="5" cy="17" r="2.5" />
      <circle cx="19" cy="17" r="2.5" />
      <circle cx="5" cy="17" r="0.5" fill="currentColor" />
      <circle cx="19" cy="17" r="0.5" fill="currentColor" />
      {/* Body */}
      <path d="M3 13h2l1-3h12l1 3h2" />
      {/* Handlebars */}
      <path d="M9 8l3-2 3 2" />
      <path d="M12 6v4" />
      {/* Seat */}
      <path d="M9 10h6v3" />
    </svg>
  );
}

export function JeepIcon({ className = '', size = 16, strokeWidth = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} {...rest}>
      {/* Boxy body */}
      <path d="M2 16V9a1 1 0 0 1 1-1h4l2-3h6l2 3h4a1 1 0 0 1 1 1v7" />
      {/* Bumper line */}
      <path d="M2 16h20" />
      {/* Windshield + grille */}
      <path d="M5 8v3" />
      <path d="M19 8v3" />
      <path d="M9 5v3" />
      <path d="M15 5v3" />
      {/* Wheels */}
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

export function BuggyIcon({ className = '', size = 16, strokeWidth = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} {...rest}>
      {/* Roll cage */}
      <path d="M5 14V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6" />
      <path d="M5 8h14" />
      {/* Body floor */}
      <path d="M3 14h18v3H3z" />
      {/* Wheels (larger - off-road tires) */}
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      {/* Headlights */}
      <circle cx="20" cy="11" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function DirtBikeIcon({ className = '', size = 16, strokeWidth = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} {...rest}>
      {/* 2 chunky knobby wheels */}
      <circle cx="5" cy="17" r="3" />
      <circle cx="19" cy="17" r="3" />
      {/* Frame */}
      <path d="M5 17l4-7h6l-2 3h6" />
      {/* Handlebars (raised - dirt bike style) */}
      <path d="M14 6l3 1" />
      <path d="M16 6.5L19 7l-1 3" />
      {/* Front fender */}
      <path d="M17 11l-3-2" />
      {/* Seat */}
      <path d="M9 10l-1-2" />
    </svg>
  );
}

export function DuneBuggyIcon({ className = '', size = 16, strokeWidth = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} {...rest}>
      {/* Open-top frame */}
      <path d="M4 14V9c0-1.1 1-2 2-2h2l1-2h6l1 2h2c1 0 2 .9 2 2v5" />
      {/* Cross bar */}
      <path d="M8 9h8" />
      {/* Body bottom */}
      <path d="M3 14h18l-1 3H4z" />
      {/* Big sand wheels */}
      <circle cx="6" cy="18" r="2.8" />
      <circle cx="18" cy="18" r="2.8" />
    </svg>
  );
}
