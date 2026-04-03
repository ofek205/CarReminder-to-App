import React, { useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const COUNTRIES = [
  { code: 'IL', flag: '🇮🇱', name: 'ישראל' },
  { code: 'CY', flag: '🇨🇾', name: 'קפריסין' },
  { code: 'GR', flag: '🇬🇷', name: 'יוון' },
  { code: 'TR', flag: '🇹🇷', name: 'טורקיה' },
  { code: 'IT', flag: '🇮🇹', name: 'איטליה' },
  { code: 'HR', flag: '🇭🇷', name: 'קרואטיה' },
  { code: 'ME', flag: '🇲🇪', name: 'מונטנגרו' },
  { code: 'ES', flag: '🇪🇸', name: 'ספרד' },
  { code: 'FR', flag: '🇫🇷', name: 'צרפת' },
  { code: 'PT', flag: '🇵🇹', name: 'פורטוגל' },
  { code: 'MT', flag: '🇲🇹', name: 'מלטה' },
  { code: 'GB', flag: '🇬🇧', name: 'בריטניה' },
  { code: 'US', flag: '🇺🇸', name: 'ארצות הברית' },
  { code: 'PA', flag: '🇵🇦', name: 'פנמה' },
  { code: 'MH', flag: '🇲🇭', name: 'איי מרשל' },
  { code: 'BM', flag: '🇧🇲', name: 'ברמודה' },
  { code: 'KY', flag: '🇰🇾', name: 'איי קיימן' },
  { code: 'BS', flag: '🇧🇸', name: 'בהאמה' },
  { code: 'LR', flag: '🇱🇷', name: 'ליבריה' },
  { code: 'MC', flag: '🇲🇨', name: 'מונקו' },
  { code: 'GI', flag: '🇬🇮', name: 'גיברלטר' },
  { code: 'NL', flag: '🇳🇱', name: 'הולנד' },
  { code: 'DE', flag: '🇩🇪', name: 'גרמניה' },
  { code: 'NO', flag: '🇳🇴', name: 'נורווגיה' },
  { code: 'SE', flag: '🇸🇪', name: 'שוודיה' },
  { code: 'DK', flag: '🇩🇰', name: 'דנמרק' },
  { code: 'FI', flag: '🇫🇮', name: 'פינלנד' },
  { code: 'AU', flag: '🇦🇺', name: 'אוסטרליה' },
  { code: 'NZ', flag: '🇳🇿', name: 'ניו זילנד' },
  { code: 'TH', flag: '🇹🇭', name: 'תאילנד' },
  { code: 'AE', flag: '🇦🇪', name: 'איחוד האמירויות' },
  { code: 'EG', flag: '🇪🇬', name: 'מצרים' },
  { code: 'BR', flag: '🇧🇷', name: 'ברזיל' },
  { code: 'MX', flag: '🇲🇽', name: 'מקסיקו' },
];

export default function CountryFlagSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = COUNTRIES.find(c => c.code === value);
  const filtered = COUNTRIES.filter(c =>
    c.name.includes(search) || c.code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between font-normal h-11">
          <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
            {selected ? `${selected.flag} ${selected.name}` : 'בחר מדינת דגל...'}
          </span>
          <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" dir="rtl" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="חפש מדינה..." value={search} onValueChange={setSearch} />
          <CommandList className="max-h-60" onWheel={e => e.stopPropagation()}>
            {filtered.length === 0 && <CommandEmpty>לא נמצאה מדינה</CommandEmpty>}
            <CommandGroup>
              {filtered.map(c => (
                <CommandItem key={c.code} value={c.code}
                  onSelect={() => { onChange(c.code); setOpen(false); setSearch(''); }}>
                  <Check className={cn('ml-2 h-4 w-4', value === c.code ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-lg ml-2">{c.flag}</span>
                  <span>{c.name}</span>
                  <span className="text-xs text-gray-400 mr-auto">{c.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { COUNTRIES };
