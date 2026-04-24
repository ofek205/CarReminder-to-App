/**
 * /MaintenanceTemplates. per-user reminder settings for maintenance + repairs.
 *
 * UX direction (after the "מבולגן" complaint):
 *   - Every row is 2 lines, same height, no inline-expand. Editing opens
 *     a Bottom Sheet with a full form, so the list stays calm no matter
 *     how many items are being edited.
 *   - Single-row filter (<Select> + search input) replaces the chip row.
 *   - "+ חדש" is a small floating button in the page header, not a huge
 *     green bar at the bottom.
 *   - Info banner removed. replaced by a single gray hint under the list.
 *
 * Source of truth for the built-in catalog stays in code
 * (src/components/shared/MaintenanceCatalog.jsx). The DB only stores
 * overrides + user-added customs.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import ConfirmDeleteDialog from "@/components/shared/ConfirmDeleteDialog";
import { Plus, Wrench, Settings, Trash2, Loader2, Check, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/shared/GuestContext";
import { MAINTENANCE_CATALOG, MAINTENANCE_CATEGORIES, getCatalogForVehicleType } from "@/components/shared/MaintenanceCatalog";
import { C } from '@/lib/designTokens';

// 
// Guest view (unchanged from prior version. keep the marketing teaser)
// 

export default function MaintenanceTemplates() {
  const { isGuest } = useAuth();
  if (isGuest) return <GuestView />;
  return <AuthenticatedView />;
}

function GuestView() {
  const demoItems = [
    { name: 'טיפול שמן מנוע', interval: 'כל 12 חודשים · 10,000 ק"מ' },
    { name: 'החלפת מסנן אוויר', interval: 'כל 24 חודשים · 20,000 ק"מ' },
    { name: 'בדיקת בלמים', interval: 'כל 12 חודשים · 15,000 ק"מ' },
  ];
  return (
    <div dir="rtl">
      <PageHeader title="סוגי טיפולים" subtitle="תזכורות פר סוג" icon={Wrench} />
      <div className="space-y-2 mb-6">
        {demoItems.map(item => (
          <div key={item.name} className="rounded-2xl p-4"
            style={{ background: '#fff', border: `1.5px solid ${C.border}`, opacity: 0.7 }}>
            <p className="text-sm font-bold">{item.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{item.interval}</p>
          </div>
        ))}
      </div>
      <Card className="p-6 text-center rounded-2xl">
        <p className="text-sm font-medium text-gray-500 mb-3">הרשמה חינם כדי להגדיר תזכורות</p>
        <Button onClick={() => window.location.href = '/Auth'}
          className="rounded-2xl font-bold" style={{ background: C.yellow, color: C.primary }}>
          הרשמה
        </Button>
      </Card>
    </div>
  );
}

// 
// Authenticated view. the real page
// 

function AuthenticatedView() {
  const [userId, setUserId] = useState(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null)); }, []);

  const qc = useQueryClient();
  const { data: prefs = [], isLoading: prefsLoading } = useQuery({
    queryKey: ['maint-prefs', userId],
    queryFn: () => db.maintenance_reminder_prefs.filter({ user_id: userId }),
    enabled: !!userId,
  });
  const { data: repairs = [], isLoading: repairsLoading } = useQuery({
    queryKey: ['repair-types', userId],
    queryFn: () => db.repair_types.filter({ owner_user_id: userId, is_active: true }),
    enabled: !!userId,
  });
  const { data: vehicles = [] } = useQuery({
    queryKey: ['my-vehicles-for-templates', userId],
    queryFn: () => db.vehicles.list(),
    enabled: !!userId,
  });

  // Maintenance history. used to show "בוצע לפני X" next to each row.
  // We read ALL logs the user can see (RLS already filters by account
  // membership) and build a name → latest-date map below.
  const { data: logs = [] } = useQuery({
    queryKey: ['my-maintenance-logs', userId],
    queryFn: () => db.maintenance_logs.list(),
    enabled: !!userId,
  });

  // Map: normalised item name → most recent performed_at across ALL logs.
  // A log can contribute via its title AND via any name in selected_items.
  // Normalisation = lowercase + collapse whitespace so fuzzy matches hit
  // (e.g. "טיפול שמן" vs "טיפול  שמן מנוע").
  const lastDoneByName = useMemo(() => {
    const map = new Map();
    const bump = (name, dateStr) => {
      if (!name || !dateStr) return;
      const key = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) return;
      const prev = map.get(key);
      if (!prev || new Date(dateStr) > new Date(prev)) map.set(key, dateStr);
    };
    for (const log of logs) {
      const date = log.performed_at || log.date || log.created_at;
      if (log.title) bump(log.title, date);
      const items = Array.isArray(log.selected_items) ? log.selected_items : [];
      for (const item of items) bump(item, date);
    }
    return map;
  }, [logs]);

  // Best-effort lookup. tries exact match first, then substring match
  // in either direction. Returns the date string or null.
  const findLastDone = React.useCallback((catalogName) => {
    if (!catalogName) return null;
    const norm = catalogName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (lastDoneByName.has(norm)) return lastDoneByName.get(norm);
    let best = null;
    for (const [key, date] of lastDoneByName) {
      if (key.includes(norm) || norm.includes(key)) {
        if (!best || new Date(date) > new Date(best)) best = date;
      }
    }
    return best;
  }, [lastDoneByName]);

  const userVehicleTypes = useMemo(() => {
    const s = new Set();
    vehicles.forEach(v => v.vehicle_type && s.add(v.vehicle_type));
    if (s.size === 0) s.add('רכב');
    return Array.from(s);
  }, [vehicles]);

  // Most-owned vehicle type. used as the default filter so a user with
  // 10 cars and 1 boat lands on "רכב", not on the noisy "הכל" mix.
  const dominantVehicleType = useMemo(() => {
    if (!vehicles.length) return null;
    const counts = {};
    for (const v of vehicles) {
      const t = v.vehicle_type || 'רכב';
      counts[t] = (counts[t] || 0) + 1;
    }
    let best = null, bestCount = -1;
    for (const [type, count] of Object.entries(counts)) {
      if (count > bestCount) { best = type; bestCount = count; }
    }
    return best;
  }, [vehicles]);

  const merged = useMemo(() => {
    const prefByKey = Object.fromEntries(
      prefs.filter(p => !p.is_custom && p.catalog_key).map(p => [p.catalog_key, p])
    );
    const out = [];
    for (const vType of userVehicleTypes) {
      const catalog = getCatalogForVehicleType(vType) || [];
      for (const item of catalog) {
        const key = `${vType}::${item.name}`;
        const pref = prefByKey[key];
        out.push({
          key,
          catalog_key: key,
          name: item.name,
          vehicle_type: vType,
          category: item.category || 'כללי',
          interval_months: pref?.interval_months ?? item.months,
          interval_km:     pref?.interval_km     ?? item.km,
          remind_days_before: pref?.remind_days_before ?? 14,
          enabled: pref ? pref.enabled : true,
          is_custom: false,
          pref_id: pref?.id || null,
          // service_size lives on the pref (user classification) if set;
          // otherwise fall back to the catalog item's hint (useful for the
          // default oil-change / brake-fluid entries that naturally map to
          // small/big). Null = unclassified, applies to both.
          service_size: pref?.service_size ?? item.service_size ?? null,
        });
      }
    }
    for (const p of prefs.filter(p => p.is_custom)) {
      out.push({
        key: `custom::${p.id}`,
        catalog_key: null,
        name: p.custom_name,
        vehicle_type: p.vehicle_type || null,
        category: 'אישיים',
        interval_months: p.interval_months,
        interval_km:     p.interval_km,
        remind_days_before: p.remind_days_before,
        enabled: p.enabled,
        is_custom: true,
        pref_id: p.id,
        service_size: p.service_size ?? null,
      });
    }
    return out;
  }, [prefs, userVehicleTypes]);

  //  Filters: vehicle-type Select + search input. one row, compact 
  // Default to the dominant vehicle type (most-owned). User can change
  // freely; once they do, we stop auto-syncing (respect their choice).
  const [vehicleFilter, setVehicleFilter] = useState(null);
  const userTouchedFilterRef = React.useRef(false);

  useEffect(() => {
    if (userTouchedFilterRef.current) return;
    if (dominantVehicleType) setVehicleFilter(dominantVehicleType);
    else setVehicleFilter('all');
  }, [dominantVehicleType]);

  const changeVehicleFilter = (val) => {
    userTouchedFilterRef.current = true;
    setVehicleFilter(val);
  };

  const [search, setSearch] = useState('');
  // Service-size chip filter: 'all' | 'small' | 'big'. Applied on top of the
  // vehicle-type + search filters below. 'all' shows everything including
  // unclassified entries; 'small' / 'big' only show templates explicitly
  // tagged with that size.
  const [sizeFilter, setSizeFilter] = useState('all');
  const visibleList = useMemo(() => {
    let list = merged;
    if (vehicleFilter === 'custom') list = list.filter(m => m.is_custom);
    else if (vehicleFilter !== 'all') list = list.filter(m => m.vehicle_type === vehicleFilter);
    if (sizeFilter !== 'all') list = list.filter(m => m.service_size === sizeFilter);
    const q = search.trim();
    if (q) list = list.filter(m => m.name.includes(q));
    return list;
  }, [merged, vehicleFilter, sizeFilter, search]);

  // Group visible items by category so the UI can render section headers.
  // Sort categories by the global MAINTENANCE_CATEGORIES order; custom
  // items land in 'אישיים' which appears last.
  const groupedByCategory = useMemo(() => {
    const groups = {};
    for (const item of visibleList) {
      const cat = item.category || 'כללי';
      (groups[cat] ||= []).push(item);
    }
    const knownOrder = [...MAINTENANCE_CATEGORIES, 'אישיים'];
    return Object.entries(groups).sort(([a], [b]) => {
      const ai = knownOrder.indexOf(a);
      const bi = knownOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [visibleList]);

  //  Editor sheet + create dialog state 
  const [editing, setEditing] = useState(null);   // item being edited in the sheet
  const [createOpen, setCreateOpen] = useState(false);
  const [createRepairOpen, setCreateRepairOpen] = useState(false);

  const customCount = merged.filter(m => m.is_custom).length;

  if (!userId || prefsLoading) return <LoadingSpinner />;

  return (
    <div dir="rtl" className="pb-24">
      <PageHeader
        title="סוגי טיפולים"
        subtitle={`${merged.length} סוגים${customCount ? ` · ${customCount} אישיים` : ''}`}
        icon={Wrench}
      />

      <Tabs defaultValue="maintenance" className="w-full">
        <TabsList className="w-full rounded-2xl bg-gray-100 p-1 mb-4 h-auto">
          <TabsTrigger value="maintenance" className="flex-1 rounded-xl gap-2">
            <Settings className="w-4 h-4" /> טיפולים
          </TabsTrigger>
          <TabsTrigger value="repairs" className="flex-1 rounded-xl gap-2">
            <Wrench className="w-4 h-4" /> תיקונים
          </TabsTrigger>
        </TabsList>

        {/*  Maintenance tab  */}
        <TabsContent value="maintenance" className="m-0">

          {/* Single-row filter + search */}
          <div dir="rtl" className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש..."
                className="pr-9 rounded-xl h-10 text-sm"
                dir="rtl"
              />
            </div>
            {(userVehicleTypes.length > 1 || customCount > 0) && vehicleFilter !== null && (
              <Select value={vehicleFilter} onValueChange={changeVehicleFilter}>
                <SelectTrigger className="w-[120px] h-10 rounded-xl text-sm shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all">הכל</SelectItem>
                  {userVehicleTypes.map(vt => (
                    <SelectItem key={vt} value={vt}>{vt}</SelectItem>
                  ))}
                  {customCount > 0 && <SelectItem value="custom">אישיים בלבד</SelectItem>}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={() => setCreateOpen(true)}
              size="icon"
              className="h-10 w-10 rounded-xl shrink-0"
              style={{ background: C.primary, color: 'white' }}
              title="הוסף סוג משלי">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Service-size chip filter — mirrors the "טיפול קטן / טיפול גדול"
              split the user sees when adding maintenance inside a vehicle. */}
          <div dir="rtl" className="flex items-center gap-1 mb-4 bg-white border border-gray-100 rounded-xl p-1 w-fit shadow-sm">
            {[
              { val: 'all',   label: 'הכל' },
              { val: 'small', label: 'טיפול קטן' },
              { val: 'big',   label: 'טיפול גדול' },
            ].map(opt => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setSizeFilter(opt.val)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: sizeFilter === opt.val ? C.primary : 'transparent',
                  color: sizeFilter === opt.val ? '#fff' : C.muted,
                }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* List. grouped by category */}
          {visibleList.length === 0 ? (
            <EmptyState search={search} onAdd={() => setCreateOpen(true)} />
          ) : (
            <div className="space-y-4">
              {groupedByCategory.map(([category, items]) => (
                <section key={category}>
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 px-1 flex items-center gap-2">
                    <span>{category}</span>
                    <span className="text-gray-300">·</span>
                    <span className="text-gray-400 font-normal">{items.length}</span>
                  </h3>
                  <div className="rounded-2xl overflow-hidden"
                    style={{ background: '#fff', border: `1.5px solid ${C.border}` }}>
                    {items.map((item, idx) => (
                      <MaintenanceRow
                        key={item.key}
                        item={item}
                        isLast={idx === items.length - 1}
                        userId={userId}
                        lastDoneDate={findLastDone(item.name)}
                        onEdit={() => setEditing(item)}
                        onQueryInvalidate={() => qc.invalidateQueries({ queryKey: ['maint-prefs', userId] })}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <p className="text-[11px] text-gray-400 text-center mt-4">
            מנוע התזכורות יופעל בגרסה הבאה. ההגדרות כאן נשמרות.
          </p>
        </TabsContent>

        {/*  Repairs tab  */}
        <TabsContent value="repairs" className="m-0">
          <div className="flex items-center justify-end mb-4">
            <Button
              onClick={() => setCreateRepairOpen(true)}
              size="sm"
              className="gap-2 rounded-xl h-10"
              style={{ background: C.primary, color: 'white' }}>
              <Plus className="w-4 h-4" /> סוג תיקון
            </Button>
          </div>

          {repairsLoading ? (
            <LoadingSpinner />
          ) : repairs.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-10 rounded-2xl bg-white border">
              אין סוגי תיקונים שמורים.<br />
              <span className="text-[11px] text-gray-400">הוסף סוגים שאתה משתמש בהם לעתים קרובות כדי למצוא אותם מהר בהוספת תיקון לרכב.</span>
            </p>
          ) : (
            <div className="rounded-2xl overflow-hidden"
              style={{ background: '#fff', border: `1.5px solid ${C.border}` }}>
              {repairs.map((r, idx) => (
                <RepairRow key={r.id} repair={r} isLast={idx === repairs.length - 1} userId={userId}
                  onQueryInvalidate={() => qc.invalidateQueries({ queryKey: ['repair-types', userId] })} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Editor sheet */}
      <MaintenanceEditorSheet
        item={editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        userId={userId}
      />

      {/* Create-custom dialog */}
      <CreateMaintenanceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        userId={userId}
        vehicleTypes={userVehicleTypes}
      />

      {/* Create-repair dialog */}
      <CreateRepairDialog
        open={createRepairOpen}
        onClose={() => setCreateRepairOpen(false)}
        userId={userId}
      />
    </div>
  );
}

// 
// Row components
// 

function MaintenanceRow({ item, isLast, userId, lastDoneDate, onEdit, onQueryInvalidate }) {
  const [pending, setPending] = useState(false);

  // Toggle enabled directly without opening the sheet. most common action.
  const handleToggle = async (value) => {
    setPending(true);
    try {
      await upsertPref({ ...item, pref_id: item.pref_id, user_id: userId, enabled: value });
      onQueryInvalidate();
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    } finally {
      setPending(false);
    }
  };

  // Row uses a <div> with role=button rather than a real <button>, so the
  // Radix Switch (which is itself a button) never ends up as a descendant
  // of another button. fixes the validateDOMNesting warning. The Switch
  // stops event propagation so clicking the toggle doesn't also open the
  // editor sheet.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } }}
      dir="rtl"
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50 focus:outline-none focus-visible:bg-gray-50 ${isLast ? '' : 'border-b border-gray-100'}`}
      style={{ opacity: item.enabled ? 1 : 0.5 }}>
      <div className="flex-1 min-w-0 text-right">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-sm font-bold truncate" style={{ color: C.text }}>{item.name}</span>
          {item.service_size === 'small' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: '#DBEAFE', color: '#1E40AF' }}>טיפול קטן</span>
          )}
          {item.service_size === 'big' && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: '#FEF3C7', color: '#92400E' }}>טיפול גדול</span>
          )}
          {item.is_custom && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{ background: '#E0E7FF', color: '#3730A3' }}>אישי</span>
          )}
        </div>
        <span className="text-xs text-gray-500 truncate block">
          {buildIntervalText(item.interval_months, item.interval_km)}
          {item.vehicle_type && !item.is_custom && ` · ${item.vehicle_type}`}
        </span>
        {lastDoneDate && (
          <LastDoneLine
            lastDoneDate={lastDoneDate}
            intervalMonths={item.interval_months}
            enabled={item.enabled}
          />
        )}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Switch
          checked={item.enabled}
          disabled={pending}
          onCheckedChange={handleToggle}
        />
      </div>
    </div>
  );
}

function RepairRow({ repair, isLast, userId, onQueryInvalidate }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const handleDelete = async () => {
    try {
      await db.repair_types.delete(repair.id);
      onQueryInvalidate();
      toast.success('נמחק');
    } catch (e) {
      toast.error(`מחיקה נכשלה: ${e.message}`);
    }
  };
  return (
    <>
      <div dir="rtl" className={`flex items-center gap-3 px-4 py-3 ${isLast ? '' : 'border-b border-gray-100'}`}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{repair.name}</p>
          {repair.description && <p className="text-xs text-gray-500 truncate">{repair.description}</p>}
        </div>
        <Button variant="ghost" size="icon"
          onClick={() => setConfirmDelete(true)}
          className="rounded-xl text-red-600 hover:bg-red-50 h-9 w-9 shrink-0">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={handleDelete}
        title="מחיקת סוג תיקון"
        description={`למחוק את "${repair.name}" מהרשימה?`}
      />
    </>
  );
}

function EmptyState({ search, onAdd }) {
  if (search) {
    return (
      <div className="text-center py-12 rounded-2xl bg-white border border-dashed border-gray-200">
        <p className="text-sm text-gray-500">לא נמצא טיפול בשם "{search}"</p>
        <button onClick={onAdd} className="text-xs text-emerald-700 font-bold mt-2 underline">
          להוסיף כסוג משלי
        </button>
      </div>
    );
  }
  return (
    <div className="text-center py-12 rounded-2xl bg-white border border-dashed border-gray-200">
      <p className="text-sm text-gray-500 mb-2">אין סוגי טיפולים להצגה</p>
      <button onClick={onAdd} className="text-xs font-bold underline" style={{ color: C.primary }}>
        + הוסף סוג משלי
      </button>
    </div>
  );
}

// 
// Edit bottom sheet
// 

function MaintenanceEditorSheet({ item, open, onClose, userId }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ interval_months: '', interval_km: '', remind_days_before: 14, enabled: true, service_size: null });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!item) return;
    setForm({
      interval_months: item.interval_months ?? '',
      interval_km: item.interval_km ?? '',
      remind_days_before: item.remind_days_before ?? 14,
      enabled: item.enabled,
      service_size: item.service_size ?? null,
    });
  }, [item?.key]);

  if (!item) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertPref({
        pref_id: item.pref_id,
        user_id: userId,
        catalog_key: item.catalog_key,
        is_custom: item.is_custom,
        custom_name: item.is_custom ? item.name : null,
        vehicle_type: item.vehicle_type,
        interval_months: form.interval_months === '' ? null : Number(form.interval_months),
        interval_km: form.interval_km === '' ? null : Number(form.interval_km),
        remind_days_before: Number(form.remind_days_before) || 14,
        enabled: form.enabled,
        service_size: form.service_size,
      });
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
      toast.success('נשמר');
      onClose();
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!item.pref_id || !item.is_custom) return;
    try {
      await db.maintenance_reminder_prefs.delete(item.pref_id);
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
      toast.success('נמחק');
      onClose();
    } catch (e) {
      toast.error(`מחיקה נכשלה: ${e.message}`);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" dir="rtl"
        className="rounded-t-3xl max-h-[85vh] overflow-y-auto"
        style={{ background: '#fff' }}>
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center gap-2">
            {item.name}
            {item.is_custom && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: '#FEF3C7', color: '#92400E' }}>אישי</span>
            )}
          </SheetTitle>
          {item.vehicle_type && !item.is_custom && (
            <p className="text-xs text-gray-500">{item.vehicle_type}</p>
          )}
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Size classification — same split as the per-vehicle add-maintenance flow. */}
          <div>
            <label className="text-sm font-medium block mb-1.5" style={{ color: C.muted }}>סיווג</label>
            <div className="flex gap-2 mt-1.5">
              {[
                { val: null,    label: 'ללא' },
                { val: 'small', label: 'טיפול קטן' },
                { val: 'big',   label: 'טיפול גדול' },
              ].map(opt => (
                <button
                  key={String(opt.val)}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, service_size: opt.val }))}
                  className="flex-1 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: form.service_size === opt.val ? C.primary : '#fff',
                    color: form.service_size === opt.val ? '#fff' : C.muted,
                    border: `1.5px solid ${form.service_size === opt.val ? C.primary : C.border}`,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="כל X חודשים" value={form.interval_months}
              onChange={v => setForm(f => ({ ...f, interval_months: v }))}
              suffix="חודשים" type="number" />
            <Field label="או כל X ק״מ" value={form.interval_km}
              onChange={v => setForm(f => ({ ...f, interval_km: v }))}
              suffix="ק״מ" type="number" placeholder="אופציונלי" />
          </div>
          <Field label="התראה כמה ימים מראש" value={form.remind_days_before}
            onChange={v => setForm(f => ({ ...f, remind_days_before: v }))}
            suffix="ימים" type="number" />

          <div className="flex items-center justify-between rounded-xl px-4 py-3 bg-gray-50">
            <span className="text-sm font-medium">הפעל תזכורת</span>
            <Switch checked={form.enabled} onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))} />
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 pt-2">
          {item.is_custom && (
            <Button variant="outline" onClick={() => setConfirmDelete(true)}
              className="rounded-xl text-red-600 hover:bg-red-50 gap-2">
              <Trash2 className="w-4 h-4" />
              מחק
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="rounded-xl">ביטול</Button>
          <Button onClick={handleSave} disabled={saving}
            className="rounded-xl gap-2 flex-1" style={{ background: C.primary, color: 'white' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            שמור
          </Button>
        </SheetFooter>

        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onConfirm={handleDelete}
          title="מחיקת סוג טיפול אישי"
          description={`למחוק את "${item.name}"? זה לא ישפיע על היסטוריית טיפולים קיימת.`}
        />
      </SheetContent>
    </Sheet>
  );
}

// 
// Create dialogs (custom maintenance / repair)
// 

function CreateMaintenanceDialog({ open, onClose, userId, vehicleTypes }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    custom_name: '', vehicle_type: vehicleTypes[0] || '',
    interval_months: 12, interval_km: '', remind_days_before: 14,
    service_size: null,  // 'small' | 'big' | null (unclassified)
  });

  useEffect(() => {
    if (open) setForm({
      custom_name: '', vehicle_type: vehicleTypes[0] || '',
      interval_months: 12, interval_km: '', remind_days_before: 14,
      service_size: null,
    });
  }, [open]);

  const handleSave = async () => {
    if (!form.custom_name.trim()) { toast.error('יש להזין שם'); return; }
    if (!form.interval_months || Number(form.interval_months) <= 0) { toast.error('יש להזין מרווח חודשים'); return; }
    setSaving(true);
    try {
      await db.maintenance_reminder_prefs.create({
        user_id: userId,
        is_custom: true,
        custom_name: form.custom_name.trim(),
        vehicle_type: form.vehicle_type || null,
        interval_months: Number(form.interval_months),
        interval_km: form.interval_km === '' ? null : Number(form.interval_km),
        remind_days_before: Number(form.remind_days_before) || 14,
        service_size: form.service_size,  // null = unclassified, applies to both
        enabled: true,
      });
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
      toast.success('נוסף');
      onClose();
    } catch (e) {
      if (String(e.message || '').includes('duplicate')) {
        toast.error('כבר יש לך טיפול בשם הזה');
      } else {
        toast.error(`שמירה נכשלה: ${e.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>סוג טיפול חדש</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="שם הטיפול" value={form.custom_name}
            onChange={v => setForm(f => ({ ...f, custom_name: v }))}
            placeholder="לדוגמה: החלפת נוזל הידראולי" />
          {/* Service size classification — matches the "טיפול קטן / טיפול גדול"
              split in the per-vehicle maintenance flow. Optional: leave null
              if the template applies to both. */}
          <div>
            <label className="text-sm font-medium block mb-1.5" style={{ color: C.muted }}>סיווג</label>
            <div className="flex gap-2 mt-1.5">
              {[
                { val: null,   label: 'ללא סיווג' },
                { val: 'small', label: 'טיפול קטן' },
                { val: 'big',   label: 'טיפול גדול' },
              ].map(opt => (
                <button
                  key={String(opt.val)}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, service_size: opt.val }))}
                  className="flex-1 px-3 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{
                    background: form.service_size === opt.val ? C.primary : '#fff',
                    color: form.service_size === opt.val ? '#fff' : C.muted,
                    border: `1.5px solid ${form.service_size === opt.val ? C.primary : C.border}`,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="כל X חודשים" value={form.interval_months}
              onChange={v => setForm(f => ({ ...f, interval_months: v }))}
              suffix="חודשים" type="number" />
            <Field label="או כל X ק״מ" value={form.interval_km}
              onChange={v => setForm(f => ({ ...f, interval_km: v }))}
              suffix="ק״מ" type="number" placeholder="אופציונלי" />
          </div>
          <Field label="התראה כמה ימים מראש" value={form.remind_days_before}
            onChange={v => setForm(f => ({ ...f, remind_days_before: v }))}
            suffix="ימים" type="number" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">ביטול</Button>
          <Button onClick={handleSave} disabled={saving}
            className="rounded-xl gap-2" style={{ background: C.primary, color: 'white' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRepairDialog({ open, onClose, userId }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => { if (open) { setName(''); setDescription(''); } }, [open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error('יש להזין שם'); return; }
    setSaving(true);
    try {
      await db.repair_types.create({
        owner_user_id: userId,
        scope: 'user',
        is_active: true,
        name: name.trim(),
        description: description.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ['repair-types', userId] });
      toast.success('נוסף');
      onClose();
    } catch (e) {
      if (String(e.message || '').includes('duplicate')) toast.error('כבר יש לך תיקון בשם הזה');
      else toast.error(`שמירה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>סוג תיקון חדש</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="שם" value={name} onChange={setName} placeholder="לדוגמה: תיקון מזגן" />
          <Field label="תיאור (אופציונלי)" value={description} onChange={setDescription}
            placeholder="הערה קצרה לזיהוי" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">ביטול</Button>
          <Button onClick={handleSave} disabled={saving}
            className="rounded-xl gap-2" style={{ background: C.primary, color: 'white' }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 
// Helpers
// 

function Field({ label, value, onChange, suffix, type = 'text', placeholder }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      <div className="relative">
        <Input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} dir="rtl" className="rounded-xl pl-14" />
        {suffix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a "בוצע לפני X · ייעשה שוב בעוד Y" status line under the
 * interval. Colour-coded: red if overdue, amber if due soon (≤30d),
 * gray otherwise. Only shown when the user has actually logged this
 * maintenance before.
 */
function LastDoneLine({ lastDoneDate, intervalMonths, enabled }) {
  const now = new Date();
  const last = new Date(lastDoneDate);
  const daysSince = Math.floor((now - last) / (1000 * 60 * 60 * 24));
  if (isNaN(daysSince) || daysSince < 0) return null;

  // Translate days → human phrase.
  let timeAgo;
  if (daysSince < 7)       timeAgo = `לפני ${daysSince} ימים`;
  else if (daysSince < 30) timeAgo = `לפני ${Math.round(daysSince / 7)} שבועות`;
  else if (daysSince < 365) timeAgo = `לפני ${Math.round(daysSince / 30)} חודשים`;
  else                     timeAgo = `לפני ${Math.round(daysSince / 365)} שנים`;

  // Compute next-due only if an interval is configured.
  let colour = '#6B7280';
  let urgency = null;
  if (intervalMonths && enabled) {
    const daysInterval = intervalMonths * 30;
    const daysLeft = daysInterval - daysSince;
    if (daysLeft < 0) {
      colour = '#DC2626';
      urgency = `באיחור ${-daysLeft} ימים`;
    } else if (daysLeft <= 30) {
      colour = '#D97706';
      urgency = `עוד ${daysLeft} ימים`;
    }
  }

  return (
    <span className="text-[11px] truncate block mt-0.5" style={{ color: colour }}>
      בוצע {timeAgo}{urgency ? ` · ${urgency}` : ''}
    </span>
  );
}

function buildIntervalText(months, km) {
  const parts = [];
  if (months) parts.push(`כל ${months} חודשים`);
  if (km)     parts.push(`${Number(km).toLocaleString('he-IL')} ק״מ`);
  return parts.length ? parts.join(' · ') : 'ללא מועד קבוע';
}

async function upsertPref({ pref_id, user_id, catalog_key, is_custom, custom_name, vehicle_type,
                           interval_months, interval_km, remind_days_before, enabled, service_size,
                           name /* row may pass full item */ }) {
  // Allow callers to pass the full row (includes `name`). we ignore
  // extras so handleToggle at the row level can just spread the item.
  const payload = {
    user_id,
    is_custom: !!is_custom,
    catalog_key: is_custom ? null : catalog_key,
    custom_name: is_custom ? (custom_name || name) : null,
    vehicle_type: vehicle_type || null,
    interval_months: interval_months ?? null,
    interval_km: interval_km ?? null,
    remind_days_before: remind_days_before ?? 14,
    enabled: enabled === undefined ? true : enabled,
    service_size: service_size ?? null,
  };
  if (pref_id) return db.maintenance_reminder_prefs.update(pref_id, payload);
  return db.maintenance_reminder_prefs.create(payload);
}
