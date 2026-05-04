import React, { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import Combobox from '@/components/shared/Combobox';
import { ISRAEL_CITIES } from '@/lib/israelCities';
import { fetchCities, fetchStreetsByCityCode } from '@/lib/govDataApi';

/**
 * Structured address input — three fields:
 *
 *   • עיר / יישוב — interactive combobox backed by data.gov.il
 *     (resource 9ad3862c…). 1,300+ Israeli localities. Falls back to
 *     the hardcoded ISRAEL_CITIES list (~210 cities) when the API is
 *     unreachable so the form never blocks.
 *   • רחוב — combobox of streets in the chosen city, fetched lazily
 *     by city code from the same dataset. Falls back to free-text
 *     input if the API fails or the city has no streets in the
 *     dataset (small yishuv, rural area).
 *   • מס׳ בית — numeric, optional.
 *
 * Storage stays as a single `address_text` string (concatenated at
 * submit by composeAddressText). No DB schema change.
 *
 * The caller owns the strings (city name, street, house number) and
 * receives `onChange(field, value)` where field is one of:
 * 'city' | 'street' | 'house_number'.
 */
export default function AddressInput({
  city,
  street,
  houseNumber,
  onChange,
  cityPlaceholder = 'בחר עיר / יישוב',
  streetPlaceholder = 'בחר רחוב או הקלד שם מקום',
  numberPlaceholder = '100',
  disabled = false,
}) {
  // Cities: fetched once, cached in localStorage by govDataApi.
  // null = loading / unknown; [] = loaded empty; array = loaded.
  const [cities, setCities] = useState(null);
  const [citiesFailed, setCitiesFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await fetchCities();
      if (cancelled) return;
      if (list && list.length > 0) {
        setCities(list);
      } else {
        // API failed → fall back to hardcoded names. Same shape so the
        // combobox renders without conditional logic.
        setCities(ISRAEL_CITIES.map((name) => ({ code: null, name })));
        setCitiesFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Streets: refetched whenever the chosen city changes.
  const [streets, setStreets] = useState(null); // null = not fetched yet
  const [streetsLoading, setStreetsLoading] = useState(false);
  const [streetsFailed, setStreetsFailed] = useState(false);

  useEffect(() => {
    if (!city || !cities || cities.length === 0) {
      setStreets(null);
      setStreetsFailed(false);
      return;
    }
    const match = cities.find((c) => c.name === city.trim());
    if (!match || !match.code) {
      // City was free-typed (not on list) OR fallback list (no codes).
      // We can't fetch streets — let the user type freely.
      setStreets(null);
      setStreetsFailed(true);
      return;
    }
    let cancelled = false;
    setStreetsLoading(true);
    setStreetsFailed(false);
    (async () => {
      const list = await fetchStreetsByCityCode(match.code);
      if (cancelled) return;
      setStreetsLoading(false);
      if (list === null) {
        setStreets(null);
        setStreetsFailed(true);
      } else {
        setStreets(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [city, cities]);

  // City combobox options — name-only display.
  const cityOptions = (cities || []).map((c) => ({ value: c.name, label: c.name }));

  // Street combobox options — flat list of names.
  const streetOptions = (streets || []).map((s) => ({ value: s, label: s }));

  // Street picker is "ready" only when there's a city + we have data.
  // When the city is free-typed or streets failed, fall back to plain Input.
  const streetUseFallback = !city || streetsFailed || streets === null;

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-[11px] font-bold text-gray-600 mb-1">עיר / יישוב</label>
        <Combobox
          value={city || ''}
          onChange={(v) => onChange('city', v)}
          options={cityOptions}
          placeholder={cities === null ? 'טוען רשימת ערים...' : cityPlaceholder}
          loading={cities === null}
          emptyText="אין יישוב תואם — אפשר להקליד ידנית"
          disabled={disabled}
        />
        {citiesFailed && (
          <p className="text-[10px] text-amber-700 mt-1">
            לא הצלחנו לטעון את רשימת הערים מהשרת — מציג רשימה מקומית מצומצמת.
          </p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_90px] gap-2">
        <div>
          <label className="block text-[11px] font-bold text-gray-600 mb-1">רחוב</label>
          {streetUseFallback ? (
            // Fallback: free-text input. Used when no city is picked, the
            // city was free-typed (not in dataset), or the streets fetch
            // failed. Lets the user always save *something*.
            <Input
              value={street || ''}
              onChange={(e) => onChange('street', e.target.value)}
              placeholder={!city ? 'בחר עיר קודם' : streetPlaceholder}
              disabled={disabled || !city}
              className="h-10 rounded-xl text-sm"
            />
          ) : (
            <Combobox
              value={street || ''}
              onChange={(v) => onChange('street', v)}
              options={streetOptions}
              placeholder={streetPlaceholder}
              loading={streetsLoading}
              emptyText="אין רחוב תואם — אפשר להקליד ידנית"
              disabled={disabled}
            />
          )}
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
 */
export function composeAddressText({ city, street, house_number } = {}) {
  const c = (city || '').trim();
  const s = (street || '').trim();
  const n = (house_number || '').trim();
  const streetPart = [s, n].filter(Boolean).join(' ');
  return [streetPart, c].filter(Boolean).join(', ');
}
