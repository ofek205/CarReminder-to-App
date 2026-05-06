import React from 'react';
import { Star } from 'lucide-react';

// Brand SVG marks. Inlined to avoid extra asset requests; same source as the
// previous inline copies in FindGarage.jsx.
export const GoogleMapsMark = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2C7.58 2 4 5.58 4 10c0 7 8 12 8 12s8-5 8-12c0-4.42-3.58-8-8-8z"
      fill="#EA4335"
    />
    <circle cx="12" cy="10" r="3" fill="#fff" />
  </svg>
);

export const WazeMark = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 3a8 8 0 0 1 8 8c0 1.5-.3 2.4-.8 3.2-.5.8-1 1.3-1 2.3 0 .8.2 1.3.2 1.8 0 .8-.6 1.2-1.3 1.2-.8 0-1.4-.4-2-1-.6-.5-1.2-1-2.1-1H9c-1 0-1.7.5-2.3 1-.6.5-1.2 1-2 1-.7 0-1.3-.4-1.3-1.2 0-.5.2-1 .2-1.8 0-1-.5-1.5-1-2.3S2 12.5 2 11a8 8 0 0 1 8-8h2z"
      fill="#33CCFF"
    />
    <circle cx="9" cy="11" r="1.2" fill="#fff" />
    <circle cx="15" cy="11" r="1.2" fill="#fff" />
    <path
      d="M9 14.5c.8.8 2 1.2 3 1.2s2.2-.4 3-1.2"
      stroke="#fff"
      strokeWidth="1.2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

// External-link helpers. All deep links open in a new tab/native app via
// `window.open(_, '_blank')` — Capacitor's WebView routes these to the OS,
// so Waze / Google Maps open natively when installed.
export const openGoogleNav = (lat, lon) =>
  window.open(
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,
    '_blank'
  );

export const openWazeNav = (lat, lon) =>
  window.open(`https://waze.com/ul?ll=${lat},${lon}&navigate=yes`, '_blank');

export const openGoogleSearch = (name, lat, lon) =>
  window.open(
    `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lon},17z`,
    '_blank'
  );

/**
 * Compact two-button row for popups inside the map.
 * Auto-stops propagation so a click doesn't trigger marker close handlers.
 */
export function NavButtonsCompact({ lat, lon }) {
  return (
    <div className="flex gap-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          openGoogleNav(lat, lon);
        }}
        className="flex-1 flex items-center justify-center gap-1 text-xs rounded-lg px-2 py-1.5 font-bold"
        style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#202124' }}
      >
        <GoogleMapsMark size={13} /> Google Maps
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          openWazeNav(lat, lon);
        }}
        className="flex-1 flex items-center justify-center gap-1 text-xs rounded-lg px-2 py-1.5 font-bold"
        style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#0A73B8' }}
      >
        <WazeMark size={13} /> Waze
      </button>
    </div>
  );
}

/**
 * Larger row with optional rating-search button. Used on result cards
 * outside the map (FindGarage list).
 */
export function NavButtonsRow({ lat, lon, name, includeRating = false }) {
  return (
    <div className="flex gap-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          openGoogleNav(lat, lon);
        }}
        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.95]"
        style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#202124' }}
      >
        <GoogleMapsMark size={14} />
        Google Maps
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          openWazeNav(lat, lon);
        }}
        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.95]"
        style={{ background: '#fff', border: '1px solid #E5E7EB', color: '#0A73B8' }}
      >
        <WazeMark size={14} />
        Waze
      </button>
      {includeRating && name && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            openGoogleSearch(name, lat, lon);
          }}
          className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-[0.95]"
          style={{ background: '#FFF8E1', color: '#F57F17' }}
        >
          <Star className="w-3 h-3" style={{ color: '#FBBC04' }} />
          דירוג
        </button>
      )}
    </div>
  );
}
