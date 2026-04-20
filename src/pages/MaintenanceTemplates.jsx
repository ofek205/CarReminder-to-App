/**
 * /MaintenanceTemplates — per-user reminder settings for maintenance + repairs.
 *
 * Reshaped per PM decision (Option B + custom escape hatch):
 *   - Source of truth for the built-in catalog stays in
 *     src/components/shared/MaintenanceCatalog.jsx.
 *   - This page merges the catalog with the user's overrides +
 *     user-added custom types (table: maintenance_reminder_prefs).
 *   - Repairs tab is a simple name list (table: repair_types) with no
 *     recurring reminder — per explicit user decision.
 *   - The actual reminder dispatch (cron / push / email) is Phase B.
 *     For now the UI shows "התזכורות יופעלו בהמשך" so expectations are
 *     clear. The toggle + interval fields still persist correctly.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/shared/PageHeader";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import ConfirmDeleteDialog from "@/components/shared/ConfirmDeleteDialog";
import { Plus, Wrench, Settings, Trash2, Loader2, Save, Edit3, Clock, Info } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/shared/GuestContext";
import { MAINTENANCE_CATALOG, getCatalogForVehicleType } from "@/components/shared/MaintenanceCatalog";
import { C } from '@/lib/designTokens';

// ═══════════════════════════════════════════════════════════════════════════
// Guest view — marketing teaser, no persistence.
// ═══════════════════════════════════════════════════════════════════════════

export default function MaintenanceTemplates() {
  const { isGuest } = useAuth();
  if (isGuest) return <GuestView />;
  return <AuthenticatedView />;
}

function GuestView() {
  const demoItems = [
    { name: 'טיפול שמן מנוע', interval: 'כל 12 חודשים / 10,000 ק"מ' },
    { name: 'החלפת מסנן אוויר', interval: 'כל 24 חודשים / 20,000 ק"מ' },
    { name: 'בדיקת בלמים', interval: 'כל 12 חודשים / 15,000 ק"מ' },
  ];
  return (
    <div dir="rtl">
      <PageHeader title="סוגי טיפולים ותיקונים" subtitle="נהל טיפולים ותזכורות" icon={Wrench} />
      <div className="mb-4 rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: 'linear-gradient(135deg, #FEF3C7, #FFF8E1)', border: '1.5px solid #FDE68A' }}>
        <span className="text-lg">👀</span>
        <div className="flex-1">
          <p className="text-sm font-black" style={{ color: '#92400E' }}>דוגמה בלבד</p>
          <p className="text-xs" style={{ color: '#B45309' }}>הרשמה חינם כדי להגדיר תזכורות לטיפולים בפועל</p>
        </div>
      </div>
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
          הרשמה בחינם
        </Button>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Authenticated view — real CRUD against Supabase.
// ═══════════════════════════════════════════════════════════════════════════

function AuthenticatedView() {
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, []);

  // ── Data loads ─────────────────────────────────────────────────────────
  const { data: prefs = [], isLoading: prefsLoading } = useQuery({
    queryKey: ['maint-prefs', userId],
    queryFn: () => db.maintenance_reminder_prefs.filter({ user_id: userId }),
    enabled: !!userId,
  });

  const { data: repairs = [], isLoading: repairsLoading } = useQuery({
    queryKey: ['repair-types', userId],
    queryFn: () => db.repair_types.filter({ user_id: userId }),
    enabled: !!userId,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['my-vehicles-for-templates', userId],
    queryFn: () => db.vehicles.list(),
    enabled: !!userId,
  });

  // Narrow the catalog to the vehicle-types the user actually owns — a car-
  // only user shouldn't see 74 items, just the ~10 relevant to their car.
  // Default to 'רכב' if we can't determine.
  const userVehicleTypes = useMemo(() => {
    const set = new Set();
    vehicles.forEach(v => { if (v.vehicle_type) set.add(v.vehicle_type); });
    if (set.size === 0) set.add('רכב');
    return Array.from(set);
  }, [vehicles]);

  // Merge catalog + user prefs into a single flat list.
  // Each entry: { key, name, vehicle_type, interval_months, interval_km,
  //               remind_days_before, enabled, is_custom, pref_id? }
  const merged = useMemo(() => {
    const prefByKey = Object.fromEntries(
      prefs.filter(p => !p.is_custom && p.catalog_key).map(p => [p.catalog_key, p])
    );
    const out = [];
    // Built-in items filtered to user's vehicle types.
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
          interval_months: pref?.interval_months ?? item.months,
          interval_km:     pref?.interval_km     ?? item.km,
          remind_days_before: pref?.remind_days_before ?? 14,
          enabled: pref ? pref.enabled : true,
          is_custom: false,
          pref_id: pref?.id || null,
        });
      }
    }
    // User-added customs.
    for (const p of prefs.filter(p => p.is_custom)) {
      out.push({
        key: `custom::${p.id}`,
        catalog_key: null,
        name: p.custom_name,
        vehicle_type: p.vehicle_type || null,
        interval_months: p.interval_months,
        interval_km:     p.interval_km,
        remind_days_before: p.remind_days_before,
        enabled: p.enabled,
        is_custom: true,
        pref_id: p.id,
      });
    }
    return out;
  }, [prefs, userVehicleTypes]);

  // ── Filters ────────────────────────────────────────────────────────────
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState('all');
  const visibleList = useMemo(() => {
    if (vehicleTypeFilter === 'all') return merged;
    if (vehicleTypeFilter === 'custom') return merged.filter(m => m.is_custom);
    return merged.filter(m => m.vehicle_type === vehicleTypeFilter);
  }, [merged, vehicleTypeFilter]);

  // ── Loading state ──────────────────────────────────────────────────────
  if (!userId || prefsLoading) return <LoadingSpinner />;

  return (
    <div dir="rtl" className="pb-24">
      <PageHeader
        title="סוגי טיפולים ותיקונים"
        subtitle="הגדר תזכורות לטיפולים וסוגי תיקונים"
        icon={Wrench}
      />

      <Tabs defaultValue="maintenance" className="w-full">
        <TabsList className="w-full rounded-2xl bg-gray-100 p-1 mb-4 h-auto">
          <TabsTrigger value="maintenance" className="flex-1 rounded-xl gap-2">
            <Settings className="w-4 h-4" />
            טיפולים
          </TabsTrigger>
          <TabsTrigger value="repairs" className="flex-1 rounded-xl gap-2">
            <Wrench className="w-4 h-4" />
            תיקונים
          </TabsTrigger>
        </TabsList>

        {/* ── Maintenance tab ────────────────────────────────────────── */}
        <TabsContent value="maintenance" className="m-0">
          <InfoBanner />

          {/* Vehicle-type chips (only show if user has >1 type) */}
          {userVehicleTypes.length > 1 && (
            <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
              <FilterChip active={vehicleTypeFilter === 'all'} onClick={() => setVehicleTypeFilter('all')}>
                הכל ({merged.length})
              </FilterChip>
              {userVehicleTypes.map(vt => (
                <FilterChip key={vt} active={vehicleTypeFilter === vt} onClick={() => setVehicleTypeFilter(vt)}>
                  {vt}
                </FilterChip>
              ))}
              {merged.some(m => m.is_custom) && (
                <FilterChip active={vehicleTypeFilter === 'custom'} onClick={() => setVehicleTypeFilter('custom')}>
                  אישיים ({merged.filter(m => m.is_custom).length})
                </FilterChip>
              )}
            </div>
          )}

          <div className="space-y-2">
            {visibleList.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-10">
                אין טיפולים להצגה. הוסף סוג משלך כדי להתחיל.
              </p>
            ) : (
              visibleList.map(item => (
                <MaintenanceRow key={item.key} item={item} userId={userId} />
              ))
            )}
          </div>

          <AddCustomMaintenanceButton userId={userId} vehicleTypes={userVehicleTypes} />
        </TabsContent>

        {/* ── Repairs tab ────────────────────────────────────────────── */}
        <TabsContent value="repairs" className="m-0">
          <p className="text-xs text-gray-500 mb-4 px-1">
            תיקונים נרשמים בעת הצורך (ללא תזכורת חוזרת). שמור כאן סוגי תיקונים שאתה משתמש בהם לעיתים קרובות כדי למצוא אותם בהוספה מהירה.
          </p>
          <div className="space-y-2">
            {repairsLoading ? (
              <LoadingSpinner />
            ) : repairs.length === 0 ? (
              <p className="text-center text-sm text-gray-500 py-10">
                אין סוגי תיקונים שמורים עדיין.
              </p>
            ) : (
              repairs.map(r => <RepairRow key={r.id} repair={r} userId={userId} />)
            )}
          </div>

          <AddRepairTypeButton userId={userId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Presentational bits
// ═══════════════════════════════════════════════════════════════════════════

function InfoBanner() {
  return (
    <div className="mb-4 rounded-2xl p-3 flex items-start gap-2.5"
      style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
      <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#1E40AF' }} />
      <div className="text-xs leading-relaxed" style={{ color: '#1E40AF' }}>
        כאן אתה מגדיר <strong>כל כמה זמן</strong> לעשות כל סוג טיפול ומתי להזכיר לך.
        ההגדרות ישפיעו על התזכורות הבאות ברכבים שלך.
        <span className="text-[11px] text-gray-500 mr-1">(מנוע התזכורות יופעל בגרסה הבאה.)</span>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`text-xs font-bold px-3 py-1.5 rounded-full shrink-0 transition-colors ${
        active ? 'text-white' : 'text-gray-600 bg-gray-100'
      }`}
      style={active ? { background: C.primary } : undefined}>
      {children}
    </button>
  );
}

// Each row in the maintenance list — collapsed summary + expand-to-edit.
function MaintenanceRow({ item, userId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState({
    interval_months: item.interval_months ?? '',
    interval_km: item.interval_km ?? '',
    remind_days_before: item.remind_days_before ?? 14,
    enabled: item.enabled,
  });

  useEffect(() => {
    setForm({
      interval_months: item.interval_months ?? '',
      interval_km: item.interval_km ?? '',
      remind_days_before: item.remind_days_before ?? 14,
      enabled: item.enabled,
    });
  }, [item.key, item.interval_months, item.interval_km, item.remind_days_before, item.enabled]);

  const handleToggleEnabled = async (value) => {
    // Optimistic update of local state; persist.
    setForm(f => ({ ...f, enabled: value }));
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
        enabled: value,
      });
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
      setForm(f => ({ ...f, enabled: !value }));  // revert
    }
  };

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
      });
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
      toast.success('נשמר');
      setOpen(false);
    } catch (e) {
      toast.error(`שמירה נכשלה: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCustom = async () => {
    if (!item.pref_id) return;
    try {
      await db.maintenance_reminder_prefs.delete(item.pref_id);
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
      toast.success('נמחק');
    } catch (e) {
      toast.error(`מחיקה נכשלה: ${e.message}`);
    }
  };

  const intervalText = buildIntervalText(form.interval_months, form.interval_km);

  return (
    <>
      <div className="rounded-2xl"
        style={{ background: '#fff', border: `1.5px solid ${C.border}`, opacity: form.enabled ? 1 : 0.55 }}>
        <button onClick={() => setOpen(o => !o)}
          className="w-full p-3.5 flex items-center gap-3 text-right">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: item.is_custom ? '#FEF3C7' : '#F4F7F3' }}>
            <Clock className="w-4 h-4" style={{ color: item.is_custom ? '#92400E' : C.primary }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold truncate" style={{ color: C.text }}>{item.name}</p>
              {item.is_custom && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: '#FEF3C7', color: '#92400E' }}>אישי</span>
              )}
              {item.vehicle_type && !item.is_custom && (
                <span className="text-[10px] text-gray-400">· {item.vehicle_type}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{intervalText}</p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={handleToggleEnabled}
            onClick={(e) => e.stopPropagation()}
          />
          <Edit3 className="w-4 h-4 text-gray-400 shrink-0" />
        </button>

        {open && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label="כל X חודשים" value={form.interval_months}
                onChange={v => setForm(f => ({ ...f, interval_months: v }))}
                suffix="חודשים" type="number" />
              <LabeledInput label="או כל X ק״מ" value={form.interval_km}
                onChange={v => setForm(f => ({ ...f, interval_km: v }))}
                suffix="ק״מ" type="number" />
            </div>
            <LabeledInput label="התראה כמה ימים מראש" value={form.remind_days_before}
              onChange={v => setForm(f => ({ ...f, remind_days_before: v }))}
              suffix="ימים" type="number" />
            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving}
                className="flex-1 gap-1.5 rounded-xl" style={{ background: C.primary, color: 'white' }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                שמור
              </Button>
              {item.is_custom && (
                <Button variant="outline" onClick={() => setConfirmDelete(true)}
                  className="rounded-xl text-red-600 hover:bg-red-50">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={handleDeleteCustom}
        title="מחיקת סוג טיפול אישי"
        description={`למחוק את "${item.name}"? זה רק מסיר אותו מהרשימה שלך, ולא ישפיע על היסטוריית טיפולים קיימת.`}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Add custom maintenance + repair buttons
// ═══════════════════════════════════════════════════════════════════════════

function AddCustomMaintenanceButton({ userId, vehicleTypes }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    custom_name: '',
    vehicle_type: vehicleTypes[0] || '',
    interval_months: 12,
    interval_km: '',
    remind_days_before: 14,
  });

  useEffect(() => { if (vehicleTypes[0] && !form.vehicle_type) setForm(f => ({ ...f, vehicle_type: vehicleTypes[0] })); }, [vehicleTypes, form.vehicle_type]);

  const handleSave = async () => {
    if (!form.custom_name.trim()) { toast.error('יש להזין שם לטיפול'); return; }
    if (!form.interval_months || Number(form.interval_months) <= 0) { toast.error('יש להזין מרווח חודשים תקין'); return; }
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
        enabled: true,
      });
      qc.invalidateQueries({ queryKey: ['maint-prefs', userId] });
      toast.success('נוסף');
      setOpen(false);
      setForm({ custom_name: '', vehicle_type: vehicleTypes[0] || '', interval_months: 12, interval_km: '', remind_days_before: 14 });
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
    <>
      <Button
        onClick={() => setOpen(true)}
        className="w-full mt-4 gap-2 rounded-2xl h-11 font-bold"
        style={{ background: C.primary, color: 'white' }}>
        <Plus className="w-4 h-4" />
        הוסף סוג טיפול משלי
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>סוג טיפול חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <LabeledInput label="שם הטיפול" value={form.custom_name}
              onChange={v => setForm(f => ({ ...f, custom_name: v }))}
              placeholder="לדוגמה: החלפת נוזל הידראולי" />
            <div className="grid grid-cols-2 gap-3">
              <LabeledInput label="כל X חודשים" value={form.interval_months}
                onChange={v => setForm(f => ({ ...f, interval_months: v }))}
                suffix="חודשים" type="number" />
              <LabeledInput label="או כל X ק״מ" value={form.interval_km}
                onChange={v => setForm(f => ({ ...f, interval_km: v }))}
                suffix="ק״מ" type="number" placeholder="אופציונלי" />
            </div>
            <LabeledInput label="התראה כמה ימים מראש" value={form.remind_days_before}
              onChange={v => setForm(f => ({ ...f, remind_days_before: v }))}
              suffix="ימים" type="number" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">ביטול</Button>
            <Button onClick={handleSave} disabled={saving}
              className="rounded-xl gap-2" style={{ background: C.primary, color: 'white' }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RepairRow({ repair, userId }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async () => {
    try {
      await db.repair_types.delete(repair.id);
      qc.invalidateQueries({ queryKey: ['repair-types', userId] });
      toast.success('נמחק');
    } catch (e) {
      toast.error(`מחיקה נכשלה: ${e.message}`);
    }
  };

  return (
    <>
      <div className="rounded-2xl p-3.5 flex items-center gap-3"
        style={{ background: '#fff', border: `1.5px solid ${C.border}` }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#FEF3C7' }}>
          <Wrench className="w-4 h-4" style={{ color: '#92400E' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{repair.name}</p>
          {repair.description && <p className="text-xs text-gray-500 truncate">{repair.description}</p>}
        </div>
        <Button variant="ghost" size="sm"
          onClick={() => setConfirmDelete(true)}
          className="rounded-xl text-red-600 hover:bg-red-50 shrink-0">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      <ConfirmDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={handleDelete}
        title="מחיקת סוג תיקון"
        description={`למחוק את "${repair.name}" מהרשימה שלך?`}
      />
    </>
  );
}

function AddRepairTypeButton({ userId }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSave = async () => {
    if (!name.trim()) { toast.error('יש להזין שם'); return; }
    setSaving(true);
    try {
      await db.repair_types.create({
        user_id: userId,
        name: name.trim(),
        description: description.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ['repair-types', userId] });
      toast.success('נוסף');
      setName(''); setDescription(''); setOpen(false);
    } catch (e) {
      if (String(e.message || '').includes('duplicate')) {
        toast.error('כבר יש לך תיקון בשם הזה');
      } else {
        toast.error(`שמירה נכשלה: ${e.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}
        className="w-full mt-4 gap-2 rounded-2xl h-11 font-bold"
        style={{ background: C.primary, color: 'white' }}>
        <Plus className="w-4 h-4" />
        הוסף סוג תיקון
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>סוג תיקון חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <LabeledInput label="שם התיקון" value={name} onChange={setName}
              placeholder="לדוגמה: תיקון מזגן" />
            <LabeledInput label="תיאור (אופציונלי)" value={description} onChange={setDescription}
              placeholder="הערה קצרה שתעזור לזהות" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-xl">ביטול</Button>
            <Button onClick={handleSave} disabled={saving}
              className="rounded-xl gap-2" style={{ background: C.primary, color: 'white' }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function LabeledInput({ label, value, onChange, suffix, type = 'text', placeholder }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-700 block mb-1">{label}</label>
      <div className="relative">
        <Input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} dir="rtl"
          className="rounded-xl pl-14" />
        {suffix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function buildIntervalText(months, km) {
  const parts = [];
  if (months) parts.push(`כל ${months} חודשים`);
  if (km)     parts.push(`${Number(km).toLocaleString('he-IL')} ק״מ`);
  return parts.length ? parts.join(' / ') : 'ללא מועד קבוע';
}

// Persist a single pref row — works for built-in overrides and customs.
// Uses upsert semantics: if pref_id exists → update; otherwise → insert.
async function upsertPref({ pref_id, user_id, catalog_key, is_custom, custom_name, vehicle_type,
                           interval_months, interval_km, remind_days_before, enabled }) {
  const payload = {
    user_id,
    is_custom,
    catalog_key: is_custom ? null : catalog_key,
    custom_name: is_custom ? custom_name : null,
    vehicle_type: vehicle_type || null,
    interval_months: interval_months ?? null,
    interval_km: interval_km ?? null,
    remind_days_before,
    enabled,
  };
  if (pref_id) {
    await db.maintenance_reminder_prefs.update(pref_id, payload);
  } else {
    await db.maintenance_reminder_prefs.create(payload);
  }
}
