import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Quick combobox (non-car categories with known manufacturer lists) ────────
function ManufacturerQuickCombobox({ quickManufacturers, selectedName, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const isCustom = selectedName && !quickManufacturers.includes(selectedName);
  const filtered = quickManufacturers.filter(n => n.toLowerCase().includes(search.toLowerCase()));
  const showAddCustom = search.trim() && !quickManufacturers.some(n => n.toLowerCase() === search.trim().toLowerCase());

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

// ─── Popover/Command mode (cars — DB-backed list) ────────────────────────────
function ManufacturerPopover({ value, onChange, accountId }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newManufacturer, setNewManufacturer] = useState({ name: '' });
  const [saving, setSaving] = useState(false);

  const { data: globalManufacturers = [], refetch: refetchGlobal } = useQuery({
    queryKey: ['manufacturers-global'],
    queryFn: () => base44.entities.Manufacturer.filter({ scope: 'global', is_active: true }),
    enabled: !!accountId,
  });

  const { data: accountManufacturers = [], refetch: refetchAccount } = useQuery({
    queryKey: ['manufacturers-account', accountId],
    queryFn: () => base44.entities.Manufacturer.filter({ scope: 'account', account_id: accountId, is_active: true }),
    enabled: !!accountId,
  });

  const allManufacturers = [...globalManufacturers, ...accountManufacturers].sort((a, b) => a.name.localeCompare(b.name));
  const refetch = async () => { await refetchGlobal(); await refetchAccount(); };

  const filteredManufacturers = allManufacturers.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.name_en && m.name_en.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedManufacturer = allManufacturers.find(m => m.id === value);

  const handleAddNew = async () => {
    if (!newManufacturer.name.trim()) return;
    setSaving(true);
    const created = await base44.entities.Manufacturer.create({
      name: newManufacturer.name.trim(),
      scope: 'account',
      account_id: accountId,
      is_active: true,
    });
    await refetch();
    onChange(created.id, created.name);
    setShowAddDialog(false);
    setOpen(false);
    setSaving(false);
    setNewManufacturer({ name: '' });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            {selectedManufacturer ? selectedManufacturer.name : "בחר יצרן..."}
            <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" dir="rtl">
          <Command shouldFilter={false}>
            <CommandInput placeholder="חפש יצרן..." value={search} onValueChange={setSearch} />
            <CommandList onWheel={e => e.stopPropagation()}>
              {filteredManufacturers.length === 0 ? (
                <CommandEmpty>
                  <div className="py-6 text-center">
                    <p className="text-sm text-gray-500 mb-3">לא נמצא יצרן</p>
                    <Button size="sm" onClick={() => { setNewManufacturer({ name: search }); setShowAddDialog(true); setOpen(false); }} className="gap-2">
                      <Plus className="h-4 w-4" />הוסף יצרן חדש
                    </Button>
                  </div>
                </CommandEmpty>
              ) : (
                <CommandGroup className="max-h-64 overflow-auto">
                  {filteredManufacturers.map(manufacturer => (
                    <CommandItem key={manufacturer.id} value={manufacturer.name} onSelect={() => { onChange(manufacturer.id, manufacturer.name); setOpen(false); }}>
                      <Check className={cn("ml-2 h-4 w-4", value === manufacturer.id ? "opacity-100" : "opacity-0")} />
                      {manufacturer.name}
                      {manufacturer.scope === 'account' && <span className="mr-2 text-xs text-gray-400">(מותאם אישית)</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
          {filteredManufacturers.length > 0 && (
            <div className="border-t p-2">
              <Button size="sm" variant="ghost" onClick={() => { setNewManufacturer({ name: '' }); setShowAddDialog(true); setOpen(false); }} className="w-full gap-2 justify-end">
                <Plus className="h-4 w-4" />הוסף יצרן חדש
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader><DialogTitle>הוספת יצרן חדש</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>שם היצרן *</Label>
              <Input value={newManufacturer.name} onChange={e => setNewManufacturer(prev => ({ ...prev, name: e.target.value }))} placeholder="למשל: הונדה, טויוטה..." autoFocus />
            </div>
            <Button onClick={handleAddNew} disabled={saving || !newManufacturer.name.trim()} className="w-full">
              {saving ? 'שומר...' : 'הוסף יצרן'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
export default function ManufacturerSelector({ value, selectedName, onChange, accountId, quickManufacturers }) {
  // Non-car categories with a known list
  if (quickManufacturers && quickManufacturers.length > 0) {
    return <ManufacturerQuickCombobox quickManufacturers={quickManufacturers} selectedName={selectedName} onChange={onChange} />;
  }
  // Guests have no accountId — DB queries would fail. Fall back to the quick
  // combobox with an empty seed list so any typed name becomes "הוסף X".
  if (!accountId) {
    return <ManufacturerQuickCombobox quickManufacturers={[]} selectedName={selectedName} onChange={onChange} />;
  }
  // Authenticated users — full DB-backed popover with save
  return <ManufacturerPopover value={value} onChange={onChange} accountId={accountId} />;
}
