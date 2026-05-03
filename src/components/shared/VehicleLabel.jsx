/**
 * VehicleLabel — compact, interactive, themed vehicle representation.
 *
 * Used in lists, tables, KPI cards, and anywhere we used to dump a
 * raw license plate. Three concerns:
 *
 *   1. Visual hook   — small typed icon (car / vessel / motorcycle /
 *                      truck) tinted by the vehicle's theme so the eye
 *                      can scan a wall of rows by category.
 *   2. Recognizable  — title is the user-meaningful name (nickname
 *                      first, manufacturer+model otherwise). Plate is
 *                      a secondary chip — present, but not the headline.
 *   3. Interactive   — by default the whole row links to /VehicleDetail.
 *                      Pass `interactive={false}` for read-only contexts
 *                      (KPI subtitles where the parent KPI is the action,
 *                      <option> in a native <select>, etc).
 *
 * Sizes: 'sm' (table cell) · 'md' (KPI subtitle, side panel) · 'lg' (full row).
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Car, Ship, Bike, Truck } from 'lucide-react';
import { getTheme, getVehicleCategory } from '@/lib/designTokens';
import { createPageUrl } from '@/utils';

const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };

// Pull the user-meaningful name out of a vehicle row. Mirrors the
// pattern from Dashboard's VehicleRow and the one we open-coded all
// over the place; centralized here so a single change propagates.
export function vehicleDisplayName(v) {
  if (!v) return 'רכב לא ידוע';
  const fromManufacturer = [v.manufacturer, v.model].filter(Boolean).join(' ').trim();
  return v.nickname || fromManufacturer || v.license_plate || 'רכב';
}

// Plain-text two-part rendering used by native <select> options and
// CSV/Excel exports. "Mazda 3 · 82068903" — readable in any context
// where rich UI isn't available.
export function vehicleDisplayText(v) {
  if (!v) return 'רכב לא ידוע';
  const name  = v.nickname || [v.manufacturer, v.model, v.year].filter(Boolean).join(' ').trim();
  const plate = v.license_plate;
  if (name && plate) return `${name} · ${plate}`;
  return name || plate || 'רכב';
}

export default function VehicleLabel({
  vehicle,
  size = 'sm',
  interactive = true,
  showPlate = true,
  showSubtitle = true,
  className = '',
}) {
  if (!vehicle) {
    return <span className="text-gray-400 text-xs">רכב לא ידוע</span>;
  }

  const category = getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const Icon     = ICON_MAP[category] || Car;
  const T        = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);

  const title    = vehicleDisplayName(vehicle);
  // Subtitle: model+year ONLY when nickname is the title (otherwise the
  // title already says model). For "Mazda 3" title (no nickname), we
  // show year if available — otherwise nothing, the row stays clean.
  const subtitleParts = [];
  if (vehicle.nickname) {
    if (vehicle.manufacturer || vehicle.model) {
      subtitleParts.push([vehicle.manufacturer, vehicle.model].filter(Boolean).join(' '));
    }
    if (vehicle.year) subtitleParts.push(vehicle.year);
  } else if (vehicle.year) {
    subtitleParts.push(vehicle.year);
  }
  const subtitle = subtitleParts.join(' · ');

  // Size dial — tweaks icon box, font, and gap. Keep this compact;
  // every variation we add here means a separate decision the next
  // user of the component has to make.
  const sizes = {
    sm: { box: 'w-7 h-7',  icon: 'h-3.5 w-3.5', title: 'text-xs',  sub: 'text-[10px]', plate: 'text-[10px]', gap: 'gap-2' },
    md: { box: 'w-9 h-9',  icon: 'h-4 w-4',     title: 'text-sm',  sub: 'text-[11px]', plate: 'text-[11px]', gap: 'gap-2.5' },
    lg: { box: 'w-11 h-11', icon: 'h-5 w-5',    title: 'text-base', sub: 'text-xs',    plate: 'text-xs',    gap: 'gap-3' },
  }[size] || { box: 'w-7 h-7', icon: 'h-3.5 w-3.5', title: 'text-xs', sub: 'text-[10px]', plate: 'text-[10px]', gap: 'gap-2' };

  const inner = (
    <div className={`flex items-center ${sizes.gap} min-w-0 ${className}`} dir="rtl">
      <span
        className={`${sizes.box} rounded-lg flex items-center justify-center shrink-0`}
        style={{ background: T.light, border: `1px solid ${T.border}` }}
        aria-hidden="true"
      >
        <Icon className={sizes.icon} style={{ color: T.accent }} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block ${sizes.title} font-bold text-gray-900 truncate`} title={title}>
          {title}
        </span>
        {showSubtitle && subtitle && (
          <span className={`block ${sizes.sub} text-gray-500 truncate`} title={subtitle}>
            {subtitle}
          </span>
        )}
      </span>
      {showPlate && vehicle.license_plate && (
        <span
          className={`shrink-0 font-mono ${sizes.plate} px-1.5 py-0.5 rounded-md bg-gray-50 text-gray-600 border border-gray-100`}
          dir="ltr"
          title={`מספר רישוי: ${vehicle.license_plate}`}
        >
          {vehicle.license_plate}
        </span>
      )}
    </div>
  );

  if (!interactive || !vehicle.id) return inner;

  return (
    <Link
      to={`${createPageUrl('VehicleDetail')}?id=${vehicle.id}`}
      className="block hover:bg-gray-50 active:bg-gray-100 rounded-lg -mx-1 px-1 py-0.5 transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </Link>
  );
}
