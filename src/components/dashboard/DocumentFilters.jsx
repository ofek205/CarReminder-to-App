import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const docTypes = ['רישיון רכב', 'ביטוח חובה', 'ביטוח מקיף', 'צד ג', 'רישיון נהיגה', 'מסמך אחר'];

export default function DocumentFilters({ documents, vehicles, onFilter }) {
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [docType, setDocType] = useState('הכל');
  const [validity, setValidity] = useState('הכל');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const hasActiveFilters = appliedSearch || docType !== 'הכל' || validity !== 'הכל';

  const applyFilters = (search = appliedSearch, type = docType, val = validity) => {
    const q = search.trim().toLowerCase();
    const filtered = documents.filter(doc => {
      // Free text
      if (q) {
        const vehicle = vehicles.find(v => v.id === doc.vehicle_id);
        const vehicleName = vehicle ? [vehicle.nickname, vehicle.manufacturer, vehicle.model, vehicle.license_plate].filter(Boolean).join(' ') : '';
        const haystack = [doc.title, doc.document_type, vehicleName].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Doc type
      if (type !== 'הכל' && doc.document_type !== type) return false;
      // Validity
      if (val === 'פג תוקף') {
        if (!doc.expiry_date || new Date(doc.expiry_date) >= today) return false;
      } else if (val === 'בתוקף') {
        if (!doc.expiry_date || new Date(doc.expiry_date) < today) return false;
      }
      return true;
    });
    onFilter(filtered);
  };

  const handleSearch = () => {
    setAppliedSearch(searchInput.trim());
    applyFilters(searchInput.trim(), docType, validity);
  };

  const handleTypeChange = (val) => {
    setDocType(val);
    applyFilters(appliedSearch, val, validity);
  };

  const handleValidityChange = (val) => {
    setValidity(val);
    applyFilters(appliedSearch, docType, val);
  };

  const clearAll = () => {
    setSearchInput('');
    setAppliedSearch('');
    setDocType('הכל');
    setValidity('הכל');
    onFilter(documents);
  };

  return (
    <div className="mb-4 space-y-2" dir="rtl">
      {/* Search row */}
      <div className="flex gap-2">
        <Input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="חפש לפי שם מסמך, סוג או רכב…"
          className="flex-1"
          dir="rtl"
        />
        <Button onClick={handleSearch} className="bg-[#2D5233] hover:bg-[#1E3D24] text-white px-4 shrink-0">
          <Search className="h-4 w-4" />
          <span className="mr-1">חפש</span>
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" onClick={clearAll} className="px-3 text-gray-500 shrink-0">
            <X className="h-4 w-4" />
            <span className="mr-1 text-sm">נקה</span>
          </Button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={docType} onValueChange={handleTypeChange}>
          <SelectTrigger className={`w-44 ${docType !== 'הכל' ? 'border-[#2D5233] text-[#2D5233]' : ''}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="הכל">כל הסוגים</SelectItem>
            {docTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {['הכל', 'בתוקף', 'פג תוקף'].map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => handleValidityChange(opt)}
              className={`px-3 py-1.5 transition-all ${validity === opt
                ? 'bg-[#2D5233] text-white font-medium'
                : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}