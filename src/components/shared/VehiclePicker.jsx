/**
 * VehiclePicker — searchable, themed vehicle dropdown.
 *
 * Replaces every native <select> we used for "pick a vehicle" — those
 * options can't show an icon, can't show a nickname chip, can't show
 * the license plate as a secondary tag, and can't filter as the user
 * types. Native dropdowns also can't communicate the vehicle category
 * at a glance (Car / Ship / Bike / Truck), which matters in mixed
 * fleets.
 *
 * Originally lived inline in /CreateRoute. Lifted here so /Expenses,
 * /Reports filter, /DrivingLog filter, /ActivityLog filter, etc. all
 * use the same control with no per-page reinvention.
 *
 * Mobile/portal note:
 *   The dropdown is rendered into document.body via createPortal with
 *   position: fixed. Without this, the dropdown gets clipped by any
 *   ancestor with overflow: hidden/auto/scroll — most importantly the
 *   /Expenses dialog body. On a phone bottom-sheet, that previously
 *   meant only the top 2-3 vehicles were visible. Portal escapes the
 *   clipping context entirely.
 *
 * Props:
 *   vehicles      Array<{ id, nickname?, manufacturer?, model?, year?,
 *                          license_plate?, vehicle_type? }>
 *   value         Selected vehicle id (string), or '' for none
 *   onChange      (id: string) => void   — '' means "clear/all"
 *   placeholder   Header text when nothing is selected
 *   allowClear    If true, the dropdown shows a "כל הרכבים" row at the
 *                 top that maps to onChange(''). Use for filter contexts.
 *   size          'md' (default, used in forms) | 'sm' (used in
 *                 filter-bar contexts that share row height with date
 *                 inputs).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check, X, Car, Ship, Bike, Truck } from 'lucide-react';
import { getTheme, getVehicleCategory } from '@/lib/designTokens';
import { vehicleDisplayName } from './VehicleLabel';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };

// Touch-device detection for the auto-focus opt-out. Pointer-coarse
// targets phones/tablets even on landscape iPad-Pro. We only auto-focus
// the search field on coarse pointers when the user hasn't started
// scrolling yet — see the open effect below.
function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || false;
}

export default function VehiclePicker({
  vehicles = [],
  value = '',
  onChange,
  placeholder = 'בחר רכב מהצי...',
  allowClear = false,
  size = 'md',
  disabled = false,
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect]   = useState(null);          // trigger getBoundingClientRect
  const wrapRef           = useRef(null);
  const triggerRef        = useRef(null);
  const dropdownRef       = useRef(null);
  const searchRef         = useRef(null);

  const selected = vehicles.find(v => v.id === value);

  // Measure the trigger so the portal-mounted dropdown can position
  // itself with `position: fixed`. Re-measured on scroll/resize so the
  // dropdown follows if the page moves (rare — we close on outside
  // click — but covers virtual-keyboard reflow on mobile).
  const measure = () => {
    if (triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => measure();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);   // capture: catches inner scroll
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open]);

  // Close on outside click + esc. Outside = neither the trigger nor
  // the portal-mounted dropdown. dropdownRef points to the rendered
  // panel inside the portal.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const inWrap = wrapRef.current?.contains(e.target);
      const inDrop = dropdownRef.current?.contains(e.target);
      if (!inWrap && !inDrop) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auto-focus the search field when the menu opens — but only on
  // pointer-fine devices. On a phone, auto-focus would pop the
  // virtual keyboard immediately and shove the dropdown around; the
  // user just wants to scroll the list. They can tap the search box
  // themselves if they want to filter.
  useEffect(() => {
    if (open && !isTouchDevice()) {
      setTimeout(() => searchRef.current?.focus(), 30);
    } else if (!open) {
      setQuery('');
    }
  }, [open]);

  // Filter against any meaningful field — nickname, plate, manufacturer,
  // model, year. Case-insensitive substring match.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(v => {
      const haystack = [
        v.nickname, v.license_plate, v.manufacturer, v.model,
        v.year != null ? String(v.year) : '',
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [vehicles, query]);

  // Compose typography off the size knob. Match the other form inputs:
  // form fields are py-2.5/text-sm; filter rows are py-2/text-xs.
  // Bumped sm from py-1.5 → py-2 to clear iOS's 44px guideline.
  const sz = size === 'sm'
    ? { trigger: 'px-2.5 py-2 text-xs',   triggerName: 'text-xs', triggerPlate: 'text-[10px]' }
    : { trigger: 'px-3 py-2.5 text-sm',   triggerName: 'text-sm', triggerPlate: 'text-[11px]' };

  // Compute portal panel position. We expand the panel to the trigger's
  // width and clamp height so very tall lists (lots of vehicles) scroll
  // internally rather than overflow the viewport. If we'd overflow the
  // bottom edge — flip upward.
  const panelStyle = (() => {
    if (!rect) return { display: 'none' };
    const VIEWPORT_H = window.innerHeight;
    const SPACING    = 4;
    const MAX_HEIGHT = 360;      // total panel ceiling
    const spaceBelow = VIEWPORT_H - rect.bottom - SPACING;
    const spaceAbove = rect.top - SPACING;
    const height     = Math.min(MAX_HEIGHT, Math.max(spaceBelow, spaceAbove));
    const openUp     = spaceBelow < 220 && spaceAbove > spaceBelow;
    return {
      position:  'fixed',
      top:       openUp ? rect.top - height - SPACING : rect.bottom + SPACING,
      left:      rect.left,
      width:     rect.width,
      maxHeight: height,
      zIndex:    10100,
    };
  })();

  return (
    <div ref={wrapRef} className="relative w-full" dir="rtl">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 ${sz.trigger} rounded-lg border border-gray-200 bg-white text-right active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-[#2D5233]/30 disabled:opacity-60 disabled:cursor-not-allowed`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0 truncate">
          {selected ? (
            <SelectedChip vehicle={selected} nameClass={sz.triggerName} plateClass={sz.triggerPlate} />
          ) : (
            <span className="text-gray-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect && createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          dir="rtl"
          style={panelStyle}
          className="bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden flex flex-col"
        >
          {/* Search field — always visible, not behind another input. */}
          <div className="p-2 border-b border-gray-100 shrink-0">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חפש לפי יצרן, דגם, שנה, כינוי או מספר רישוי"
                className="w-full pr-8 pl-2 py-2 text-xs rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:border-gray-300 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            {/* Optional "clear / all" row for filter contexts. */}
            {allowClear && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-right border-b border-gray-50 transition-colors ${
                  !value ? 'bg-[#E8F2EA]' : 'hover:bg-gray-50 active:bg-gray-100'
                }`}
              >
                <X className={`shrink-0 h-3.5 w-3.5 ${!value ? 'text-[#2D5233]' : 'text-gray-400'}`} />
                <span className={`flex-1 text-xs ${!value ? 'font-bold text-[#2D5233]' : 'text-gray-700'}`}>
                  כל הרכבים
                </span>
                {!value && <Check className="shrink-0 h-3.5 w-3.5 text-[#2D5233]" />}
              </button>
            )}

            {filtered.length === 0 ? (
              <p className="text-center text-[11px] text-gray-400 py-6">לא נמצאו רכבים תואמים</p>
            ) : (
              filtered.map(v => (
                <VehicleRow
                  key={v.id}
                  vehicle={v}
                  selected={v.id === value}
                  onClick={() => { onChange(v.id); setOpen(false); }}
                />
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// Selected-vehicle chip shown inside the trigger — themed mini icon +
// title + plate badge. Mirrors the VehicleLabel composition but with
// styling tuned for sitting inside a button.
function SelectedChip({ vehicle, nameClass, plateClass }) {
  const cat  = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const Icon = ICON_MAP[cat] || Car;
  const T    = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  return (
    <span className="flex items-center gap-2">
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
        style={{ background: T.light, border: `1px solid ${T.border}` }}
        aria-hidden="true"
      >
        <Icon className="h-3 w-3" style={{ color: T.accent }} />
      </span>
      <span className={`font-bold text-gray-900 truncate ${nameClass}`}>{vehicleDisplayName(vehicle)}</span>
      {vehicle.license_plate && (
        <span
          className={`shrink-0 font-mono ${plateClass} px-1.5 py-0.5 rounded-md bg-gray-50 text-gray-600 border border-gray-100`}
          dir="ltr"
        >
          {vehicle.license_plate}
        </span>
      )}
    </span>
  );
}

// Single row in the dropdown list. Renders title + nickname chip + plate
// row, with a selected-state tint and check icon. py-3 to clear iOS's
// 44px touch target — the form-version was py-2.5 which is borderline.
function VehicleRow({ vehicle, selected, onClick }) {
  const cat  = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const Icon = ICON_MAP[cat] || Car;
  const T    = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-3 py-3 text-right border-b border-gray-50 last:border-0 transition-colors ${
        selected ? 'bg-[#E8F2EA]' : 'hover:bg-gray-50 active:bg-gray-100'
      }`}
    >
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: T.light, border: `1px solid ${T.border}` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: T.accent }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm truncate ${selected ? 'font-bold text-[#2D5233]' : 'font-bold text-gray-900'}`}>
            {vehicleDisplayName(vehicle)}
          </span>
          {vehicle.nickname && vehicle.nickname !== vehicleDisplayName(vehicle) && (
            <span className="px-1.5 py-0.5 rounded-md bg-[#E8F2EA] text-[#2D5233] text-[10px] font-bold">
              {vehicle.nickname}
            </span>
          )}
        </span>
        {vehicle.license_plate && (
          <span className="block text-[11px] text-gray-500 mt-0.5 font-mono" dir="ltr">
            {vehicle.license_plate}
          </span>
        )}
      </span>
      {selected && <Check className="shrink-0 h-4 w-4 text-[#2D5233] mt-1" />}
    </button>
  );
}
