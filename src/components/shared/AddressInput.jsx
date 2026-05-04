import React, { useId } from 'react';
import { ISRAEL_CITIES } from '@/lib/israelCities';
import { Input } from '@/components/ui/input';

/**
 * Structured address input — three fields:
 *   • City    — text input bound to a <datalist> of Israeli cities.
 *               Native autocomplete handles the search; not strict, so
 *               the user can type a kibbutz / moshav / neighbourhood
 *               that isn't on the list.
 *   • Street  — free-text. Doubles as "place name" when there's no
 *               street (e.g. "נמל אשדוד", "שוק מחנה יהודה").
 *   • Number  — numeric, optional.
 *
 * Storage stays as a single concatenated `address_text` so existing
 * RPC, RouteDetail, FleetMap, and Nominatim geocoding all keep
 * working with no migration. The CreateRoute form computes the
 * concat from these three fields at submit time.
 *
 * Caller passes a unified `onChange(field, value)` callback where
 * `field` is one of: 'city' | 'street' | 'house_number'.
 */
export default function AddressInput({
  city,
  street,
  houseNumber,
  onChange,
  cityPlaceholder = 'התחל להקליד עיר...',
  streetPlaceholder = 'לדוגמה: דיזנגוף',
  numberPlaceholder = '100',
  disabled = false,
}) {
  // useId gives a stable, unique id even when AddressInput is rendered
  // inside a list (multiple stops). Without it, all <datalist>s would
  // share an id and the second one would be ignored by the browser.
  const dataListId = useId() + '-cities';

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold text-gray-600 mb-1">עיר / יישוב</label>
        <input
          list={dataListId}
          value={city || ''}
          onChange={(e) => onChange('city', e.target.value)}
          placeholder={cityPlaceholder}
          disabled={disabled}
          dir="rtl"
          className="w-full h-10 rounded-xl border border-gray-200 bg-white text-sm px-3 outline-none transition-colors focus:border-[#2D5233] focus:ring-2 focus:ring-[#2D5233]/20 disabled:opacity-60"
          autoComplete="off"
        />
        <datalist id={dataListId}>
          {ISRAEL_CITIES.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>

      <div className="grid grid-cols-[1fr_90px] gap-2">
        <div>
          <label className="block text-[11px] font-bold text-gray-600 mb-1">רחוב</label>
          <Input
            value={street || ''}
            onChange={(e) => onChange('street', e.target.value)}
            placeholder={streetPlaceholder}
            disabled={disabled}
            className="h-10 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-gray-600 mb-1">מס׳ בית</label>
          <Input
            type="text"
            inputMode="numeric"
            value={houseNumber || ''}
            onChange={(e) => onChange('house_number', e.target.value)}
            placeholder={numberPlaceholder}
            disabled={disabled}
            dir="ltr"
            className="h-10 rounded-xl text-sm text-center"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Build the canonical address_text string from the three structured
 * parts. Used at form-submit time (CreateRoute) and on the fly by the
 * collapsed StopCard preview.
 *
 *   {street: 'דיזנגוף', house_number: '100', city: 'תל אביב'}
 *   →  'דיזנגוף 100, תל אביב'
 *
 *   {street: 'נמל אשדוד', city: 'אשדוד'}
 *   →  'נמל אשדוד, אשדוד'
 *
 *   {city: 'תל אביב'}
 *   →  'תל אביב'
 *
 *   {} → ''
 */
export function composeAddressText({ city, street, house_number } = {}) {
  const c = (city || '').trim();
  const s = (street || '').trim();
  const n = (house_number || '').trim();
  const streetPart = [s, n].filter(Boolean).join(' ');
  return [streetPart, c].filter(Boolean).join(', ');
}
