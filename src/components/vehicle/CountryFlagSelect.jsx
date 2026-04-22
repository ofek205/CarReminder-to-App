import React, { useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const COUNTRIES = [
  //  Middle East 
  { code: 'IL', flag: '🇮🇱', name: 'ישראל' },
  { code: 'AE', flag: '🇦🇪', name: 'איחוד האמירויות' },
  { code: 'SA', flag: '🇸🇦', name: 'ערב הסעודית' },
  { code: 'JO', flag: '🇯🇴', name: 'ירדן' },
  { code: 'EG', flag: '🇪🇬', name: 'מצרים' },
  { code: 'LB', flag: '🇱🇧', name: 'לבנון' },
  { code: 'IQ', flag: '🇮🇶', name: 'עיראק' },
  { code: 'IR', flag: '🇮🇷', name: 'איראן' },
  { code: 'KW', flag: '🇰🇼', name: 'כווית' },
  { code: 'QA', flag: '🇶🇦', name: 'קטאר' },
  { code: 'BH', flag: '🇧🇭', name: 'בחריין' },
  { code: 'OM', flag: '🇴🇲', name: 'עומאן' },
  { code: 'YE', flag: '🇾🇪', name: 'תימן' },
  { code: 'SY', flag: '🇸🇾', name: 'סוריה' },
  //  Europe 
  { code: 'GB', flag: '🇬🇧', name: 'בריטניה' },
  { code: 'FR', flag: '🇫🇷', name: 'צרפת' },
  { code: 'DE', flag: '🇩🇪', name: 'גרמניה' },
  { code: 'IT', flag: '🇮🇹', name: 'איטליה' },
  { code: 'ES', flag: '🇪🇸', name: 'ספרד' },
  { code: 'PT', flag: '🇵🇹', name: 'פורטוגל' },
  { code: 'NL', flag: '🇳🇱', name: 'הולנד' },
  { code: 'BE', flag: '🇧🇪', name: 'בלגיה' },
  { code: 'LU', flag: '🇱🇺', name: 'לוקסמבורג' },
  { code: 'CH', flag: '🇨🇭', name: 'שוויץ' },
  { code: 'AT', flag: '🇦🇹', name: 'אוסטריה' },
  { code: 'IE', flag: '🇮🇪', name: 'אירלנד' },
  { code: 'SE', flag: '🇸🇪', name: 'שוודיה' },
  { code: 'NO', flag: '🇳🇴', name: 'נורווגיה' },
  { code: 'DK', flag: '🇩🇰', name: 'דנמרק' },
  { code: 'FI', flag: '🇫🇮', name: 'פינלנד' },
  { code: 'IS', flag: '🇮🇸', name: 'איסלנד' },
  { code: 'PL', flag: '🇵🇱', name: 'פולין' },
  { code: 'CZ', flag: '🇨🇿', name: 'צ׳כיה' },
  { code: 'SK', flag: '🇸🇰', name: 'סלובקיה' },
  { code: 'HU', flag: '🇭🇺', name: 'הונגריה' },
  { code: 'RO', flag: '🇷🇴', name: 'רומניה' },
  { code: 'BG', flag: '🇧🇬', name: 'בולגריה' },
  { code: 'GR', flag: '🇬🇷', name: 'יוון' },
  { code: 'CY', flag: '🇨🇾', name: 'קפריסין' },
  { code: 'MT', flag: '🇲🇹', name: 'מלטה' },
  { code: 'HR', flag: '🇭🇷', name: 'קרואטיה' },
  { code: 'SI', flag: '🇸🇮', name: 'סלובניה' },
  { code: 'RS', flag: '🇷🇸', name: 'סרביה' },
  { code: 'BA', flag: '🇧🇦', name: 'בוסניה והרצגובינה' },
  { code: 'ME', flag: '🇲🇪', name: 'מונטנגרו' },
  { code: 'MK', flag: '🇲🇰', name: 'צפון מקדוניה' },
  { code: 'AL', flag: '🇦🇱', name: 'אלבניה' },
  { code: 'XK', flag: '🇽🇰', name: 'קוסובו' },
  { code: 'EE', flag: '🇪🇪', name: 'אסטוניה' },
  { code: 'LV', flag: '🇱🇻', name: 'לטביה' },
  { code: 'LT', flag: '🇱🇹', name: 'ליטא' },
  { code: 'UA', flag: '🇺🇦', name: 'אוקראינה' },
  { code: 'MD', flag: '🇲🇩', name: 'מולדובה' },
  { code: 'BY', flag: '🇧🇾', name: 'בלארוס' },
  { code: 'RU', flag: '🇷🇺', name: 'רוסיה' },
  { code: 'TR', flag: '🇹🇷', name: 'טורקיה' },
  { code: 'GE', flag: '🇬🇪', name: 'גאורגיה' },
  { code: 'AM', flag: '🇦🇲', name: 'ארמניה' },
  { code: 'AZ', flag: '🇦🇿', name: 'אזרבייג׳ן' },
  { code: 'MC', flag: '🇲🇨', name: 'מונקו' },
  { code: 'GI', flag: '🇬🇮', name: 'גיברלטר' },
  { code: 'AD', flag: '🇦🇩', name: 'אנדורה' },
  { code: 'LI', flag: '🇱🇮', name: 'ליכטנשטיין' },
  { code: 'SM', flag: '🇸🇲', name: 'סן מרינו' },
  //  North America 
  { code: 'US', flag: '🇺🇸', name: 'ארצות הברית' },
  { code: 'CA', flag: '🇨🇦', name: 'קנדה' },
  { code: 'MX', flag: '🇲🇽', name: 'מקסיקו' },
  //  Central America & Caribbean 
  { code: 'PA', flag: '🇵🇦', name: 'פנמה' },
  { code: 'CR', flag: '🇨🇷', name: 'קוסטה ריקה' },
  { code: 'GT', flag: '🇬🇹', name: 'גואטמלה' },
  { code: 'HN', flag: '🇭🇳', name: 'הונדורס' },
  { code: 'SV', flag: '🇸🇻', name: 'אל סלבדור' },
  { code: 'NI', flag: '🇳🇮', name: 'ניקרגואה' },
  { code: 'BZ', flag: '🇧🇿', name: 'בליז' },
  { code: 'CU', flag: '🇨🇺', name: 'קובה' },
  { code: 'JM', flag: '🇯🇲', name: 'ג׳מייקה' },
  { code: 'DO', flag: '🇩🇴', name: 'הרפובליקה הדומיניקנית' },
  { code: 'HT', flag: '🇭🇹', name: 'האיטי' },
  { code: 'TT', flag: '🇹🇹', name: 'טרינידד וטובגו' },
  { code: 'BS', flag: '🇧🇸', name: 'בהאמה' },
  { code: 'BB', flag: '🇧🇧', name: 'ברבדוס' },
  { code: 'BM', flag: '🇧🇲', name: 'ברמודה' },
  { code: 'KY', flag: '🇰🇾', name: 'איי קיימן' },
  { code: 'VG', flag: '🇻🇬', name: 'איי הבתולה הבריטיים' },
  { code: 'VI', flag: '🇻🇮', name: 'איי הבתולה האמריקניים' },
  { code: 'PR', flag: '🇵🇷', name: 'פוארטו ריקו' },
  //  South America 
  { code: 'BR', flag: '🇧🇷', name: 'ברזיל' },
  { code: 'AR', flag: '🇦🇷', name: 'ארגנטינה' },
  { code: 'CL', flag: '🇨🇱', name: 'צ׳ילה' },
  { code: 'CO', flag: '🇨🇴', name: 'קולומביה' },
  { code: 'PE', flag: '🇵🇪', name: 'פרו' },
  { code: 'VE', flag: '🇻🇪', name: 'ונצואלה' },
  { code: 'EC', flag: '🇪🇨', name: 'אקוודור' },
  { code: 'UY', flag: '🇺🇾', name: 'אורוגוואי' },
  { code: 'PY', flag: '🇵🇾', name: 'פרגוואי' },
  { code: 'BO', flag: '🇧🇴', name: 'בוליביה' },
  { code: 'GY', flag: '🇬🇾', name: 'גיאנה' },
  { code: 'SR', flag: '🇸🇷', name: 'סורינאם' },
  //  East Asia 
  { code: 'CN', flag: '🇨🇳', name: 'סין' },
  { code: 'JP', flag: '🇯🇵', name: 'יפן' },
  { code: 'KR', flag: '🇰🇷', name: 'דרום קוריאה' },
  { code: 'KP', flag: '🇰🇵', name: 'צפון קוריאה' },
  { code: 'TW', flag: '🇹🇼', name: 'טייוואן' },
  { code: 'MN', flag: '🇲🇳', name: 'מונגוליה' },
  { code: 'HK', flag: '🇭🇰', name: 'הונג קונג' },
  { code: 'MO', flag: '🇲🇴', name: 'מקאו' },
  //  Southeast Asia 
  { code: 'TH', flag: '🇹🇭', name: 'תאילנד' },
  { code: 'VN', flag: '🇻🇳', name: 'וייטנאם' },
  { code: 'ID', flag: '🇮🇩', name: 'אינדונזיה' },
  { code: 'MY', flag: '🇲🇾', name: 'מלזיה' },
  { code: 'SG', flag: '🇸🇬', name: 'סינגפור' },
  { code: 'PH', flag: '🇵🇭', name: 'הפיליפינים' },
  { code: 'MM', flag: '🇲🇲', name: 'מיאנמר' },
  { code: 'KH', flag: '🇰🇭', name: 'קמבודיה' },
  { code: 'LA', flag: '🇱🇦', name: 'לאוס' },
  { code: 'BN', flag: '🇧🇳', name: 'ברוניי' },
  //  South Asia 
  { code: 'IN', flag: '🇮🇳', name: 'הודו' },
  { code: 'PK', flag: '🇵🇰', name: 'פקיסטן' },
  { code: 'BD', flag: '🇧🇩', name: 'בנגלדש' },
  { code: 'LK', flag: '🇱🇰', name: 'סרי לנקה' },
  { code: 'NP', flag: '🇳🇵', name: 'נפאל' },
  { code: 'MV', flag: '🇲🇻', name: 'מלדיביים' },
  //  Central Asia 
  { code: 'KZ', flag: '🇰🇿', name: 'קזחסטן' },
  { code: 'UZ', flag: '🇺🇿', name: 'אוזבקיסטן' },
  { code: 'TM', flag: '🇹🇲', name: 'טורקמניסטן' },
  { code: 'KG', flag: '🇰🇬', name: 'קירגיזסטן' },
  { code: 'TJ', flag: '🇹🇯', name: 'טג׳יקיסטן' },
  { code: 'AF', flag: '🇦🇫', name: 'אפגניסטן' },
  //  Africa 
  { code: 'ZA', flag: '🇿🇦', name: 'דרום אפריקה' },
  { code: 'NG', flag: '🇳🇬', name: 'ניגריה' },
  { code: 'KE', flag: '🇰🇪', name: 'קניה' },
  { code: 'ET', flag: '🇪🇹', name: 'אתיופיה' },
  { code: 'GH', flag: '🇬🇭', name: 'גאנה' },
  { code: 'TZ', flag: '🇹🇿', name: 'טנזניה' },
  { code: 'MA', flag: '🇲🇦', name: 'מרוקו' },
  { code: 'TN', flag: '🇹🇳', name: 'תוניסיה' },
  { code: 'DZ', flag: '🇩🇿', name: 'אלג׳יריה' },
  { code: 'LY', flag: '🇱🇾', name: 'לוב' },
  { code: 'SD', flag: '🇸🇩', name: 'סודן' },
  { code: 'UG', flag: '🇺🇬', name: 'אוגנדה' },
  { code: 'RW', flag: '🇷🇼', name: 'רואנדה' },
  { code: 'CM', flag: '🇨🇲', name: 'קמרון' },
  { code: 'CI', flag: '🇨🇮', name: 'חוף השנהב' },
  { code: 'SN', flag: '🇸🇳', name: 'סנגל' },
  { code: 'MG', flag: '🇲🇬', name: 'מדגסקר' },
  { code: 'MZ', flag: '🇲🇿', name: 'מוזמביק' },
  { code: 'AO', flag: '🇦🇴', name: 'אנגולה' },
  { code: 'ZM', flag: '🇿🇲', name: 'זמביה' },
  { code: 'ZW', flag: '🇿🇼', name: 'זימבבואה' },
  { code: 'BW', flag: '🇧🇼', name: 'בוצוואנה' },
  { code: 'NA', flag: '🇳🇦', name: 'נמיביה' },
  { code: 'MU', flag: '🇲🇺', name: 'מאוריציוס' },
  { code: 'SC', flag: '🇸🇨', name: 'סיישל' },
  { code: 'LR', flag: '🇱🇷', name: 'ליבריה' },
  { code: 'MH', flag: '🇲🇭', name: 'איי מרשל' },
  //  Oceania 
  { code: 'AU', flag: '🇦🇺', name: 'אוסטרליה' },
  { code: 'NZ', flag: '🇳🇿', name: 'ניו זילנד' },
  { code: 'FJ', flag: '🇫🇯', name: 'פיג׳י' },
  { code: 'PG', flag: '🇵🇬', name: 'פפואה גינאה החדשה' },
  { code: 'WS', flag: '🇼🇸', name: 'סמואה' },
  { code: 'TO', flag: '🇹🇴', name: 'טונגה' },
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
          <span className={selected ? 'text-gray-900 flex items-center gap-1.5' : 'text-gray-400'}>
            {selected ? (
              <>
                <span className="text-lg leading-none">{selected.flag}</span>
                <span>{selected.name}</span>
                <span className="text-xs text-gray-400">{selected.code}</span>
              </>
            ) : 'בחר מדינת דגל...'}
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
                  <span className="text-lg leading-none ml-2">{c.flag}</span>
                  <span className="font-medium">{c.name}</span>
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
