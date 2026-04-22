import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

//  Common car manufacturers in Israel 
const CAR_MANUFACTURERS = [
  'Toyota', 'Hyundai', 'Kia', 'Mazda', 'Skoda', 'Suzuki', 'Mitsubishi',
  'Nissan', 'Honda', 'Subaru', 'Volkswagen', 'Ford', 'Chevrolet', 'Peugeot',
  'Citroën', 'Renault', 'Seat', 'Cupra', 'BMW', 'Mercedes-Benz', 'Audi',
  'Volvo', 'Lexus', 'Infiniti', 'Tesla', 'MG', 'BYD', 'Chery', 'Geely',
  'Dacia', 'Fiat', 'Jeep', 'Land Rover', 'Mini', 'Opel', 'Isuzu',
  'Porsche', 'Jaguar', 'Alfa Romeo',
].sort();

//  Combobox with search and custom add 
function ManufacturerCombobox({ manufacturers, selectedName, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = manufacturers.filter(n => n.toLowerCase().includes(search.toLowerCase()));
  const showAddCustom = search.trim() && !manufacturers.some(n => n.toLowerCase() === search.trim().toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className={selectedName ? 'text-gray-900' : 'text-gray-400'}>
            {selectedName || 'בחר יצרן...'}
          </span>
          <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" dir="rtl" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="חפש או הקלד שם יצרן..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-56" onWheel={e => e.stopPropagation()}>
            {filtered.length === 0 && !showAddCustom && (
              <CommandEmpty>לא נמצא יצרן</CommandEmpty>
            )}
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map(name => (
                  <CommandItem
                    key={name}
                    value={name}
                    onSelect={() => { onChange(null, name); setOpen(false); setSearch(''); }}
                  >
                    <Check className={cn('ml-2 h-4 w-4 shrink-0', selectedName === name ? 'opacity-100' : 'opacity-0')} />
                    {name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {showAddCustom && (
              <CommandGroup>
                <CommandItem
                  value={`__custom__${search.trim()}`}
                  onSelect={() => { onChange(null, search.trim()); setOpen(false); setSearch(''); }}
                  className="text-[#2D5233] font-medium"
                >
                  <Plus className="ml-2 h-4 w-4 shrink-0" />
                  הוסף "{search.trim()}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

//  Main export 
export default function ManufacturerSelector({ value, selectedName, onChange, accountId, quickManufacturers }) {
  // Non-car categories with a known list
  if (quickManufacturers && quickManufacturers.length > 0) {
    return <ManufacturerCombobox manufacturers={quickManufacturers} selectedName={selectedName} onChange={onChange} />;
  }
  // Default: car manufacturers
  return <ManufacturerCombobox manufacturers={CAR_MANUFACTURERS} selectedName={selectedName} onChange={onChange} />;
}
