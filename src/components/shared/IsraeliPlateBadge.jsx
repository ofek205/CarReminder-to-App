import React from 'react';

/**
 * Israeli license-plate IL strip — the blue panel on the LTR-leading edge
 * of every Israeli plate, containing:
 *   - "IL" (top)
 *   - "ישראל" (middle)
 *   - The Israeli flag (bottom)
 *
 * Single source of truth so every plate surface in the app (the read-only
 * <LicensePlate /> badge and the editable <VehicleCheckPlateInput />)
 * renders the same strip. Future tweaks happen here once.
 *
 * Layout: width and inner sizes derive from the parent plate's `height`
 * so the strip stays proportional whether it's a tiny sm chip or the
 * dashboard's lg hero plate.
 *
 * Usage:
 *   <IsraeliPlateBadge height={30} />          // standalone, sized
 *   <IsraeliPlateBadge fill />                 // absolute fill of parent
 */
export default function IsraeliPlateBadge({ height, fill = false }) {
  // Width is ~85% of height — this matches the proportions of a real
  // Israeli plate's IL panel and looks right at every size we ship.
  const h = height || 30;
  const stripWidth = Math.round(h * 0.86);

  // Type/flag sizes scale with strip height. Floors keep the smaller
  // sizes legible-ish (or at least visually identifiable) instead of
  // collapsing to 0.
  const ilFont   = Math.max(6,    Math.round(h * 0.28));
  const isrFont  = Math.max(4,    Math.round(h * 0.16));
  const flagW    = Math.max(9,    Math.round(stripWidth * 0.62));
  const flagH    = Math.max(6,    Math.round(flagW * 0.70));

  // Two layout flavours: standalone block (used in display LicensePlate)
  // or absolute-fill (used inside the input wrapper which controls its
  // own height via input padding).
  const baseClass = 'bg-[#0A3A78] border-r border-[#072A56] flex flex-col items-center justify-center';
  const positionStyle = fill
    ? { position: 'absolute', top: 0, bottom: 0, left: 0, width: stripWidth }
    : { width: stripWidth, height: h };

  return (
    <div className={baseClass} style={positionStyle}>
      <span
        className="text-white leading-none font-bold"
        style={{ fontSize: ilFont }}
      >
        IL
      </span>
      <span
        className="text-white leading-none font-bold"
        style={{ fontSize: isrFont, marginTop: 1, marginBottom: 1 }}
      >
        ישראל
      </span>
      <svg
        viewBox="0 0 60 40"
        style={{ width: flagW, height: flagH, display: 'block', borderRadius: 1 }}
        aria-label="דגל ישראל"
      >
        <rect width="60" height="40" fill="#FFFFFF" />
        <rect y="4"  width="60" height="5" fill="#003DA5" />
        <rect y="31" width="60" height="5" fill="#003DA5" />
        <polygon points="30,10 34.5,21 25.5,21" fill="none" stroke="#003DA5" strokeWidth="2" />
        <polygon points="30,26 25.5,15 34.5,15" fill="none" stroke="#003DA5" strokeWidth="2" />
      </svg>
    </div>
  );
}
