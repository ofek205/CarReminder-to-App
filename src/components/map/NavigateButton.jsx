import React, { useState } from 'react';
import { Navigation, X } from 'lucide-react';
import { GoogleMapsMark, WazeMark } from './NavButtons';
import {
  getNavPreference,
  setNavPreference,
  buildNavUrl,
  openNav,
} from '@/lib/navPreference';

/**
 * Single-button "Navigate" CTA for the driver.
 *
 * Behaviour:
 *   - First tap: if the driver has already chosen a preferred nav app,
 *     opens it directly (Waze or Google Maps).
 *   - Otherwise: opens a bottom-sheet chooser with both apps + a
 *     "remember my choice" checkbox. Picking an app opens it; if
 *     "remember" was ticked, the choice is persisted to localStorage
 *     and future taps go straight through.
 *
 * Destination shape: { lat?: number, lng?: number, address?: string }.
 * Coordinates are preferred when available; address is the fallback.
 */
export default function NavigateButton({
  destination,
  variant = 'solid',     // 'solid' | 'compact' | 'pill'
  label = 'נווט',
  className = '',
  disabled = false,
}) {
  const [chooserOpen, setChooserOpen] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    const pref = getNavPreference();
    if (pref) {
      openNav(pref, destination);
      return;
    }
    setChooserOpen(true);
  };

  const buttonClass = (() => {
    if (variant === 'compact') {
      return 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold border border-[#2D5233]/30 bg-[#E8F2EA] text-[#2D5233] active:scale-[0.97] disabled:opacity-50';
    }
    if (variant === 'pill') {
      return 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-[#2D5233] text-white active:scale-[0.97] disabled:opacity-50';
    }
    return 'flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-[#2D5233] text-white active:scale-[0.97] disabled:opacity-50';
  })();

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`${buttonClass} ${className}`}
      >
        <Navigation className={variant === 'compact' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {label}
      </button>
      {chooserOpen && (
        <NavChooser
          destination={destination}
          onClose={() => setChooserOpen(false)}
        />
      )}
    </>
  );
}

// Bottom-sheet chooser — only mounted when the driver has no saved
// preference yet. Tapping an app opens the deep link + (optionally)
// remembers the pick.
function NavChooser({ destination, onClose }) {
  const [remember, setRemember] = useState(true);

  const choose = (app) => {
    if (remember) setNavPreference(app);
    openNav(app, destination);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-900">איך לנווט?</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="p-1 rounded-full hover:bg-gray-100"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">
          בחר את אפליקציית הניווט שתפעל עם המשימות שלך.
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => choose('waze')}
            className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl border border-[#33CCFF]/30 bg-[#33CCFF]/10 text-[#0A8FB3] active:scale-[0.99]"
          >
            <WazeMark size={20} />
            <span className="text-sm font-bold">נווט עם Waze</span>
          </button>
          <button
            type="button"
            onClick={() => choose('google')}
            className="w-full flex items-center gap-2.5 px-3 py-3 rounded-xl border border-gray-200 bg-white text-gray-800 active:scale-[0.99]"
          >
            <GoogleMapsMark size={20} />
            <span className="text-sm font-bold">נווט עם Google Maps</span>
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-[11px] text-gray-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          זכור את הבחירה שלי
        </label>
        {!destination && (
          <p className="mt-2 text-[10px] text-amber-700">
            לא הוגדרה כתובת לתחנה — הניווט עלול להיפתח ריק.
          </p>
        )}
        {destination && !destination.lat && (
          <p className="mt-2 text-[10px] text-gray-500">
            הכתובת לא אומתה במפה — האפליקציה תחפש לפי הטקסט.
          </p>
        )}
        {/* Hidden preview link — keeps the URL inspectable for debug */}
        {destination && (
          <span className="hidden">{buildNavUrl('waze', destination)}</span>
        )}
      </div>
    </div>
  );
}
