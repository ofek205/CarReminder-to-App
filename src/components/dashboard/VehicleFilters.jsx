import React, { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);

  const toggle = (val) => {
    if (selected.includes(val)) {
      onChange(selected.filter(v => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all
          ${selected.length > 0
            ? 'border-[#2D5233] bg-[#E8F2EA] text-[#2D5233] font-medium'
            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
          }`}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-[#2D5233] text-white rounded-full px-1.5 py-0.5 text-xs leading-none">
            {selected.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[160px] max-h-52 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">אין אפשרויות</div>
            ) : (
              options.map(opt => (
                <label key={opt} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm" dir="rtl">
                  <Checkbox
                    checked={selected.includes(opt)}
                    onCheckedChange={() => toggle(opt)}
                  />
                  <span>{opt}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function VehicleFilters({ vehicles, onFilter }) {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [selManufacturers, setSelManufacturers] = useState([]);
  const [selModels, setSelModels] = useState([]);
  const [selNicknames, setSelNicknames] = useState([]);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [testExpired, setTestExpired] = useState(false);
  const [insuranceExpired, setInsuranceExpired] = useState(false);

  const manufacturers = useMemo(() =>
    [...new Set(vehicles.map(v => v.manufacturer).filter(Boolean))].sort(),
    [vehicles]
  );

  const models = useMemo(() => {
    const base = selManufacturers.length > 0
      ? vehicles.filter(v => selManufacturers.includes(v.manufacturer))
      : vehicles;
    return [...new Set(base.map(v => v.model).filter(Boolean))].sort();
  }, [vehicles, selManufacturers]);

  const nicknames = useMemo(() =>
    [...new Set(vehicles.map(v => v.nickname).filter(Boolean))].sort(),
    [vehicles]
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hasActiveFilters =
    appliedSearch || selManufacturers.length || selModels.length ||
    selNicknames.length || yearFrom || yearTo || testExpired || insuranceExpired;

  const activeCount = [
    appliedSearch ? 1 : 0,
    selManufacturers.length,
    selModels.length,
    selNicknames.length,
    yearFrom || yearTo ? 1 : 0,
    testExpired ? 1 : 0,
    insuranceExpired ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const applyFilters = () => {
    setAppliedSearch(searchInput.trim());
    const q = searchInput.trim().toLowerCase();

    const filtered = vehicles.filter(v => {
      // Free text search
      if (q) {
        const haystack = [v.manufacturer, v.model, v.nickname, v.year, v.license_plate]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Multi-select filters
      if (selManufacturers.length && !selManufacturers.includes(v.manufacturer)) return false;
      if (selModels.length && !selModels.includes(v.model)) return false;
      if (selNicknames.length && !selNicknames.includes(v.nickname)) return false;
      // Year range
      if (yearFrom && v.year < parseInt(yearFrom)) return false;
      if (yearTo && v.year > parseInt(yearTo)) return false;
      // Status
      if (testExpired) {
        if (!v.test_due_date || new Date(v.test_due_date) >= today) return false;
      }
      if (insuranceExpired) {
        if (!v.insurance_due_date || new Date(v.insurance_due_date) >= today) return false;
      }
      return true;
    });

    onFilter(filtered);
  };

  const clearAll = () => {
    setSearchInput('');
    setAppliedSearch('');
    setSelManufacturers([]);
    setSelModels([]);
    setSelNicknames([]);
    setYearFrom('');
    setYearTo('');
    setTestExpired(false);
    setInsuranceExpired(false);
    onFilter(vehicles);
  };

  return (
    <div className="mb-4 space-y-2" dir="rtl">
      {/* Search bar */}
      <div className="flex gap-2 flex-wrap">
        <Input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilters()}
          placeholder="חפש לפי יצרן, דגם, כינוי או שנה…"
          className="flex-1 min-w-0"
          dir="rtl"
        />
        <Button onClick={applyFilters} className="bg-[#2D5233] hover:bg-[#1E3D24] text-white px-3 sm:px-4 shrink-0">
          <Search className="h-4 w-4" />
          <span className="mr-1 hidden sm:inline">חפש</span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowFilters(f => !f)}
          className={`px-3 shrink-0 ${showFilters || activeCount > 0 ? 'border-[#2D5233] text-[#2D5233]' : ''}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeCount > 0 && (
            <span className="mr-1 bg-[#2D5233] text-white rounded-full px-1.5 py-0.5 text-xs leading-none">
              {activeCount}
            </span>
          )}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" onClick={clearAll} className="px-3 text-gray-500 shrink-0">
            <X className="h-4 w-4" />
            <span className="mr-1 text-sm hidden sm:inline">נקה</span>
          </Button>
        )}
      </div>

      {/* Expanded filter panel */}
      {showFilters && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
          {/* Dropdowns row */}
          <div className="flex flex-wrap gap-2">
            <MultiSelect
              label="יצרן"
              options={manufacturers}
              selected={selManufacturers}
              onChange={v => { setSelManufacturers(v); if (v.length === 0) setSelModels([]); }}
            />
            <MultiSelect
              label="דגם"
              options={models}
              selected={selModels}
              onChange={setSelModels}
            />
            {nicknames.length > 0 && (
              <MultiSelect
                label="כינוי"
                options={nicknames}
                selected={selNicknames}
                onChange={setSelNicknames}
              />
            )}
          </div>

          {/* Year range */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 shrink-0">שנת ייצור:</span>
            <Input
              type="number"
              placeholder="משנה"
              value={yearFrom}
              onChange={e => setYearFrom(e.target.value)}
              className="w-24 text-center"
              min="1900" max="2100"
            />
            <span className="text-gray-400">-</span>
            <Input
              type="number"
              placeholder="עד שנה"
              value={yearTo}
              onChange={e => setYearTo(e.target.value)}
              className="w-24 text-center"
              min="1900" max="2100"
            />
          </div>

          {/* Status checkboxes */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <Checkbox
                checked={testExpired}
                onCheckedChange={v => setTestExpired(!!v)}
              />
              <span>טסט עבר תאריך</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
              <Checkbox
                checked={insuranceExpired}
                onCheckedChange={v => setInsuranceExpired(!!v)}
              />
              <span>ביטוח עבר תאריך</span>
            </label>
          </div>

          <Button
            onClick={() => { applyFilters(); setShowFilters(false); }}
            className="bg-[#2D5233] hover:bg-[#1E3D24] text-white w-full"
          >
            החל סינון
          </Button>
        </div>
      )}
    </div>
  );
}