import React from 'react';
import { Car, Ship, Bike, Truck, Mountain } from 'lucide-react';
import { AtvIcon, JeepIcon, BuggyIcon, DirtBikeIcon, DuneBuggyIcon } from './OffroadIcons';
import { getVehicleVisual } from '@/lib/designTokens';

const ICONS = {
  car: Car,
  ship: Ship,
  truck: Truck,
  'bike-road': Bike,
  'dirt-bike': DirtBikeIcon,
  atv: AtvIcon,
  'jeep-off': JeepIcon,
  buggy: BuggyIcon,
  'dune-buggy': DuneBuggyIcon,
  mountain: Mountain,
};

/**
 * Render the correct icon for any vehicle.
 * Usage:
 *   <VehicleIcon vehicle={v} className="w-4 h-4" style={{ color: T.primary }} />
 *
 * For a chip/badge with theme:
 *   const { theme } = getVehicleVisual(vehicle);
 *   <div style={{ background: theme.light }}>
 *     <VehicleIcon vehicle={vehicle} style={{ color: theme.primary }} />
 *   </div>
 */
export default function VehicleIcon({ vehicle, iconKey: forceKey, className = 'w-4 h-4', style, ...rest }) {
  const { iconKey } = vehicle ? getVehicleVisual(vehicle) : { iconKey: forceKey || 'car' };
  const key = forceKey || iconKey;
  const Icon = ICONS[key] || Car;
  return <Icon className={className} style={style} {...rest} />;
}
