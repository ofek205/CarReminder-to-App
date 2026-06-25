import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Building2 } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { LEASING_COMPANIES, canonicalizeLeasingCompany } from '@/constants/leasingCompanies';

const OTHER = '__other__';

/**
 * Shared leasing-company picker for the vehicle add/edit forms.
 *
 * The value is a single free-text column (`leasing_company`). The picker
 * shows a dropdown of known Israeli leasing companies plus an "אחר" option
 * that reveals a free-text input for anything not listed. An empty value
 * means "not leased".
 *
 * @param {string}  value      current company name ('' = none)
 * @param {(v:string)=>void} onChange
 * @param {boolean} highlight  true when the registry says the vehicle is
 *                             leased — highlights the field + shows a hint.
 */
export default function LeasingCompanyField({ value = '', onChange, highlight = false }) {
  const known = LEASING_COMPANIES.includes(value);
  // "Other" mode: a non-empty value that isn't one of the known companies.
  const [isOther, setIsOther] = useState(!!value && !known);

  const selectValue = isOther ? OTHER : (known ? value : '');

  const handleSelect = (e) => {
    const v = e.target.value;
    if (v === OTHER) { setIsOther(true); onChange(''); }
    else { setIsOther(false); onChange(v); }
  };

  return (
    <div>
      <label className="block text-xs font-bold mb-1.5" style={{ color: C.gray700 }}>
        <Building2 className="w-3.5 h-3.5 inline ml-1" style={{ color: highlight ? C.warn : C.primary }} />
        חברת ליסינג
      </label>
      <select
        value={selectValue}
        onChange={handleSelect}
        dir="rtl"
        className="w-full h-10 rounded-xl border px-3 text-sm bg-white focus:outline-none"
        style={{ borderColor: highlight ? C.warn : C.border }}
      >
        <option value="">ללא / לא בליסינג</option>
        {LEASING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
        <option value={OTHER}>אחר…</option>
      </select>
      {isOther && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 60))}
          onBlur={() => {
            const c = canonicalizeLeasingCompany(value);
            if (c !== value) onChange(c);
            if (LEASING_COMPANIES.includes(c)) setIsOther(false);
          }}
          placeholder="שם חברת הליסינג"
          className="mt-2 h-10 rounded-xl text-sm"
          maxLength={60}
          autoFocus
        />
      )}
      {highlight && (
        <p className="text-[10px] mt-1" style={{ color: C.warn }}>
          המאגר מציין שהרכב בליסינג — אפשר לבחור חברה
        </p>
      )}
    </div>
  );
}
