import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Check, Plus, Car, Truck, Bus, Ship, Star, Bike, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Sub-categories for "כלי שייט" ──────────────────────────────────────────
export const BOAT_SUBCATEGORIES = [
  { label: 'מפרשית',       dbName: 'מפרשית',       usageMetric: 'שעות מנוע' },
  { label: 'מנועית',       dbName: 'סירה מנועית',  usageMetric: 'שעות מנוע' },
  { label: 'אופנוע ים',   dbName: 'אופנוע ים',    usageMetric: 'שעות מנוע' },
  { label: 'סירת גומי',   dbName: 'סירת גומי',    usageMetric: 'שעות מנוע' },
];

// ─── Sub-categories for "אופנועים" ──────────────────────────────────────────
export const MOTO_SUBCATEGORIES = [
  { label: 'אופנוע כביש',  dbName: 'אופנוע כביש',  usageMetric: 'קילומטרים' },
  { label: 'אופנוע שטח',  dbName: 'אופנוע שטח',   usageMetric: 'קילומטרים' },
  { label: 'קטנוע',        dbName: 'קטנוע',         usageMetric: 'קילומטרים' },
];

// ─── Sub-categories for "מיוחדים" ───────────────────────────────────────────
export const SPECIAL_SUBCATEGORIES = [
  { label: 'טרקטורונים',                   dbName: 'טרקטורון',                      usageMetric: 'קילומטרים' },
  { label: 'רכב אספנות',                   dbName: 'רכב אספנות',                    usageMetric: 'קילומטרים' },
  { label: 'טרקטור',                        dbName: 'טרקטור',                         usageMetric: 'שעות מנוע'  },
  { label: 'רכבים תפעוליים',               dbName: 'רכב תפעולי',                    usageMetric: 'קילומטרים' },
  { label: 'נגררים, גרורים ונתמכים',       dbName: 'נגרר',                           usageMetric: 'ללא'        },
  { label: 'מלגזה',                         dbName: 'מלגזה',                          usageMetric: 'שעות מנוע'  },
  { label: 'רכב צמ"ה',                      dbName: 'רכב צמ"ה',                       usageMetric: 'שעות מנוע'  },
  { label: 'קראוונים ממונעים ונגררים',     dbName: 'קרוואן',                         usageMetric: 'קילומטרים' },
  { label: 'מחרשה',                         dbName: 'מחרשה',                          usageMetric: 'שעות מנוע'  },
  { label: 'אוטובוס ומיניבוס',             dbName: 'אוטובוס',                        usageMetric: 'קילומטרים' },
];

// ─── Manufacturers per sub-category (for non-car categories) ────────────────
export const MANUFACTURERS_BY_SUBCATEGORY = {
  'אופנוע כביש':  ['Honda', 'Yamaha', 'SYM', 'Kawasaki', 'Suzuki', 'KTM', 'BMW Motorrad', 'Ducati', 'Harley-Davidson', 'Triumph', 'Royal Enfield', 'Aprilia'],
  'אופנוע שטח':   ['KTM', 'Husqvarna', 'Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'GasGas', 'Beta', 'Sherco', 'TM Racing', 'Fantic'],
  'קטנוע':        ['Honda', 'Yamaha', 'SYM', 'Kymco', 'Vespa', 'Aprilia', 'Suzuki', 'Kawasaki', 'Peugeot'],
  'מפרשית':       ['Beneteau', 'Jeanneau', 'Bavaria', 'Dufour', 'Hanse', 'Catalina', 'Hunter', 'Hallberg-Rassy', 'Oyster', 'Swan', 'Dehler', 'J/Boats'],
  'סירה מנועית':  ['Beneteau', 'Sea Ray', 'Boston Whaler', 'Bayliner', 'Chaparral', 'Jeanneau', 'Yamaha', 'Grady-White', 'Sunseeker', 'Riva', 'MasterCraft', 'Cobalt'],
  'אופנוע ים':    ['Sea-Doo', 'Yamaha', 'Kawasaki'],
  'סירת גומי':    ['Zodiac', 'Highfield', 'BRIG', 'AB Inflatables', 'Avon', 'Pirelli', 'Zar Formenti', 'Capelli', 'Walker Bay'],
  'טרקטורון':     ['Can-Am', 'Yamaha', 'Honda', 'Polaris', 'Kawasaki', 'Suzuki', 'CFMOTO', 'Arctic Cat', 'Linhai'],
  'טרקטור':       ['John Deere', 'New Holland', 'Case IH', 'Massey Ferguson', 'Kubota', 'Fendt', 'Deutz-Fahr', 'Claas', 'Valtra', 'Mahindra', 'Landini'],
  'מלגזה':        ['Toyota', 'Linde', 'Jungheinrich', 'Crown', 'Hyster', 'Yale', 'Komatsu', 'Mitsubishi', 'Nissan', 'Clark'],
  'אוטובוס':      ['Volvo', 'Mercedes-Benz', 'MAN', 'Scania', 'Iveco', 'Isuzu', 'Temsa', 'Otokar', 'Yutong', 'King Long'],
  'קרוואן':       ['Knaus', 'Hobby', 'Adria', 'Airstream', 'Bürstner', 'Weinsberg', 'Bailey', 'Trigano', 'Caravelair'],
  'רכב אספנות':   ['Ferrari', 'Porsche', 'Jaguar', 'Ford', 'Chevrolet', 'Mercedes-Benz', 'Aston Martin', 'Lamborghini', 'Alfa Romeo', 'BMW', 'Triumph', 'MG'],
  'משאית':        ['Mercedes-Benz', 'Volvo', 'Scania', 'MAN', 'DAF', 'Iveco', 'Renault', 'Ford', 'Isuzu', 'Mitsubishi Fuso'],
};

// ─── The 6 main categories (fixed, maps to DB by keyword) ───────────────────
export const VEHICLE_CATEGORIES = [
  {
    label: 'פרטיים ומסחריים',
    icon: Car,
    keywords: ['רכב', 'פרטי', 'מסחרי', 'ג\'יפ', 'SUV'],
    dbName: 'רכב פרטי',
    usageMetric: 'קילומטרים',
    methods: ['plate', 'scan', 'manual'],
  },
  {
    label: 'אופנועים',
    icon: Bike,
    keywords: ['אופנוע', 'קטנוע'],
    dbName: 'אופנוע',
    usageMetric: 'קילומטרים',
    methods: ['plate', 'scan', 'manual'],
    hasSubcategories: true,
  },
  {
    label: 'משאיות',
    icon: Truck,
    keywords: ['משאית', 'טנדר', 'רכב מסחרי'],
    dbName: 'משאית',
    usageMetric: 'קילומטרים',
    methods: ['plate', 'scan', 'manual'],
  },
  {
    label: 'כלי שייט',
    icon: Ship,
    keywords: ['שייט', 'ספינה', 'סירה', 'יאכטה'],
    dbName: 'כלי שייט',
    usageMetric: 'שעות מנוע',
    methods: ['scan', 'manual'],
    hasSubcategories: true,
  },
  {
    label: 'מיוחדים',
    icon: Star,
    keywords: ['מיוחד', 'טרקטור', 'קלנוע', 'אחר'],
    dbName: 'רכב מיוחד',
    usageMetric: 'קילומטרים',
    methods: ['scan', 'manual'],
    hasSubcategories: true,               // opens sub-category picker
  },
];

// Find the best matching DB type for a category
function findDbType(allTypes, category) {
  return allTypes.find(t =>
    category.keywords.some(kw => t.name.toLowerCase().includes(kw.toLowerCase()))
  ) || allTypes.find(t => t.name === category.dbName);
}

// ─── Tab-strip variant (used in AddVehicle) ──────────────────────────────────
function TabVariant({ allTypes, isLoading, selectedCategory, onSelectCategory }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {VEHICLE_CATEGORIES.map(cat => {
        const Icon = cat.icon;
        const active = selectedCategory?.label === cat.label;
        return (
          <button
            key={cat.label}
            type="button"
            onClick={() => onSelectCategory(cat)}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl border-2 transition-all duration-200 focus:outline-none select-none',
              active
                ? 'border-[#2D5233] bg-[#E8F2EA] shadow-md'
                : 'border-gray-200 bg-white hover:border-[#8B5E3C] hover:bg-[#FBF5EF] active:scale-95'
            )}
          >
            <div className={cn(
              'w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
              active ? 'bg-[#2D5233]' : 'bg-gray-100'
            )}>
              {isLoading
                ? <div className="w-4 h-4 rounded bg-gray-300 animate-pulse" />
                : <Icon className={cn('h-4 w-4', active ? 'text-white' : 'text-gray-500')} />
              }
            </div>
            <span className={cn(
              'text-[10px] sm:text-xs font-semibold text-center leading-tight',
              active ? 'text-[#2D5233]' : 'text-gray-600'
            )}>
              {cat.label}
            </span>
            {active && (
              <div className="w-1.5 h-1.5 rounded-full bg-[#2D5233]" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Cards variant (horizontal scroll, legacy) ───────────────────────────────
function CardVariant({ allTypes, isLoading, value, onChange, onAddNew }) {
  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1">
        {[1,2,3,4,5,6].map(i => (
          <div key={i} className="shrink-0 w-[76px] h-[88px] rounded-2xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
      {allTypes.map(type => {
        const selected = value === type.id;
        return (
          <button
            key={type.id}
            type="button"
            onClick={() => onChange(type.id, type.name, type.usage_metric)}
            className={cn(
              'flex flex-col items-center gap-1.5 min-w-[72px] max-w-[80px] px-2 py-3 rounded-2xl border-2 transition-all duration-200 shrink-0',
              selected ? 'border-[#2D5233] bg-[#E8F2EA] shadow-md' : 'border-gray-200 bg-white hover:border-gray-300'
            )}
          >
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', selected ? 'bg-[#2D5233]' : 'bg-gray-100')}>
              <Car className={cn('h-5 w-5', selected ? 'text-white' : 'text-gray-500')} />
            </div>
            <span className={cn('text-[11px] font-semibold text-center leading-tight', selected ? 'text-[#2D5233]' : 'text-gray-600')}>
              {type.name}
            </span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAddNew}
        className="flex flex-col items-center gap-1.5 min-w-[72px] px-2 py-3 rounded-2xl border-2 border-dashed border-gray-300 bg-white hover:border-[#2D5233] transition-all shrink-0"
      >
        <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-gray-100">
          <Plus className="h-5 w-5 text-gray-400" />
        </div>
        <span className="text-[11px] font-semibold text-gray-400 text-center leading-tight">הוסף סוג</span>
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function VehicleTypeSelector({
  value,
  onChange,
  accountId,
  variant = 'popover',        // 'popover' | 'tabs' | 'cards'
  selectedCategory,           // for tabs variant: the full category object
  onSelectCategory,           // for tabs variant: (category) => void
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newType, setNewType] = useState({ name: '', usage_metric: 'קילומטרים' });
  const [saving, setSaving] = useState(false);

  const { data: globalTypes = [], isLoading: loadingGlobal, refetch: refetchGlobal } = useQuery({
    queryKey: ['vehicle-types-global'],
    queryFn: () => base44.entities.VehicleType.filter({ scope: 'global', is_active: true }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: accountTypes = [], refetch: refetchAccount } = useQuery({
    queryKey: ['vehicle-types-account', accountId],
    queryFn: () => base44.entities.VehicleType.filter({ scope: 'account', account_id: accountId, is_active: true }),
    enabled: !!accountId,
  });

  const allTypes = [...globalTypes, ...accountTypes].sort((a, b) => a.name.localeCompare(b.name));
  const refetch = async () => { await refetchGlobal(); if (accountId) await refetchAccount(); };

  const filteredTypes = allTypes.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const selectedType = allTypes.find(t => t.id === value);

  const handleAddNew = async () => {
    if (!newType.name.trim()) return;
    setSaving(true);
    const created = await base44.entities.VehicleType.create({
      name: newType.name.trim(),
      usage_metric: newType.usage_metric,
      scope: accountId ? 'account' : 'global',
      account_id: accountId || undefined,
      is_active: true,
    });
    await refetch();
    onChange(created.id, created.name, created.usage_metric);
    setShowAddDialog(false);
    setOpen(false);
    setSaving(false);
    setNewType({ name: '', usage_metric: 'קילומטרים' });
  };

  // ── Tab variant: resolve DB type on category select ──
  const handleCategorySelect = (cat) => {
    if (onSelectCategory) onSelectCategory(cat);
    // Find matching DB type
    const dbType = findDbType(allTypes, cat);
    if (dbType) {
      onChange(dbType.id, dbType.name, dbType.usage_metric);
    } else {
      // Fallback: use category label as vehicle_type string (no DB id)
      onChange('', cat.dbName, cat.usageMetric);
    }
  };

  // ── Render ──
  if (variant === 'tabs') {
    return (
      <TabVariant
        allTypes={allTypes}
        isLoading={loadingGlobal}
        selectedCategory={selectedCategory}
        onSelectCategory={handleCategorySelect}
      />
    );
  }

  if (variant === 'cards') {
    return (
      <CardVariant
        allTypes={allTypes}
        isLoading={loadingGlobal}
        value={value}
        onChange={onChange}
        onAddNew={() => setShowAddDialog(true)}
      />
    );
  }

  // ── Default: popover ──
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            {selectedType ? selectedType.name : "בחר סוג כלי רכב..."}
            <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" dir="rtl">
          <Command shouldFilter={false}>
            <CommandInput placeholder="חפש סוג כלי..." value={search} onValueChange={setSearch} />
            <CommandList>
              {filteredTypes.length === 0 ? (
                <CommandEmpty>
                  <div className="py-6 text-center">
                    <p className="text-sm text-gray-500 mb-3">לא נמצא סוג מתאים</p>
                    <Button size="sm" onClick={() => { setNewType({ name: search, usage_metric: 'קילומטרים' }); setShowAddDialog(true); setOpen(false); }} className="gap-2">
                      <Plus className="h-4 w-4" />הוסף סוג חדש
                    </Button>
                  </div>
                </CommandEmpty>
              ) : (
                <CommandGroup className="max-h-64 overflow-auto">
                  {filteredTypes.map(type => (
                    <CommandItem key={type.id} value={type.name} onSelect={() => { onChange(type.id, type.name, type.usage_metric); setOpen(false); }}>
                      <Check className={cn("ml-2 h-4 w-4", value === type.id ? "opacity-100" : "opacity-0")} />
                      {type.name}
                      {type.scope === 'account' && <span className="mr-2 text-xs text-gray-400">(מותאם אישית)</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          {filteredTypes.length > 0 && (
            <div className="border-t p-2">
              <Button size="sm" variant="ghost" onClick={() => { setNewType({ name: '', usage_metric: 'קילומטרים' }); setShowAddDialog(true); setOpen(false); }} className="w-full gap-2 justify-end">
                <Plus className="h-4 w-4" />הוסף סוג חדש
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>הוספת סוג כלי חדש</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם סוג הכלי *</Label>
              <Input value={newType.name} onChange={e => setNewType(prev => ({ ...prev, name: e.target.value }))} placeholder="למשל: טרקטור, קלנועית..." autoFocus />
            </div>
            <div>
              <Label>סוג מדידה</Label>
              <Select value={newType.usage_metric} onValueChange={v => setNewType(prev => ({ ...prev, usage_metric: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="קילומטרים">קילומטרים</SelectItem>
                  <SelectItem value="שעות מנוע">שעות מנוע</SelectItem>
                  <SelectItem value="ללא">ללא</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddNew} disabled={saving || !newType.name.trim()} className="w-full">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />שומר...</> : 'הוסף סוג'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
