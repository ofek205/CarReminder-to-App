import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Check, Plus, X, Clock } from "lucide-react";
import { usesKm, usesHours } from "../shared/DateStatusUtils";
import { motion, AnimatePresence } from "framer-motion";

const PRESET_SMALL = ['החלפת שמן', 'החלפת פילטר שמן', 'החלפת פילטר אוויר', 'החלפת פילטר מזגן'];
const PRESET_LARGE = ['החלפת פלאגים', 'החלפת ציריות', 'החלפת רצועת טיימינג', 'החלפת בולמי זעזועים', 'החלפת רצועות', 'בדיקת בלמים', 'החלפת נוזל בלמים', 'החלפת מצבר'];

function AddCustomItemDialog({ open, onClose, onSave, user }) {
  const [form, setForm] = useState({
    name: '',
    service_type: 'small',
    reminder_type: 'none', // 'none' | 'km' | 'time'
    reminder_km: '',
    reminder_interval_value: '',
    reminder_interval_unit: 'חודשים',
  });

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave(form);
    setForm({ name: '', service_type: 'small', reminder_type: 'none', reminder_km: '', reminder_interval_value: '', reminder_interval_unit: 'חודשים' });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle>הוסף טיפול חדש</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div>
            <Label>שם הטיפול *</Label>
            <Input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="למשל: החלפת נוזל הגה"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="mb-2 block">סוג הטיפול</Label>
            <div className="grid grid-cols-2 gap-2">
              {['small', 'large'].map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, service_type: type }))}
                  className={`p-3 rounded-xl border-2 text-center transition-all text-sm font-medium ${
                    form.service_type === type
                      ? type === 'small' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {type === 'small' ? '🔵 קטן' : '🟠 גדול'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block">תזכורת עתידית</Label>
            <div className="space-y-2">
              {[
                { val: 'none', label: 'ללא תזכורת' },
                { val: 'km', label: 'לפי ק"מ' },
                { val: 'time', label: 'לפי זמן' },
              ].map(opt => (
                <label key={opt.val} className="flex items-center gap-2.5 cursor-pointer">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                    form.reminder_type === opt.val ? 'border-amber-600 bg-amber-600' : 'border-gray-300'
                  }`}>
                    {form.reminder_type === opt.val && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <input
                    type="radio"
                    value={opt.val}
                    checked={form.reminder_type === opt.val}
                    onChange={() => setForm(f => ({ ...f, reminder_type: opt.val }))}
                    className="sr-only"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>

            <AnimatePresence>
              {form.reminder_type === 'km' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden">
                  <Label className="text-xs text-gray-500">כל כמה ק"מ?</Label>
                  <Input
                    type="number"
                    value={form.reminder_km}
                    onChange={e => setForm(f => ({ ...f, reminder_km: e.target.value }))}
                    placeholder="למשל: 10000"
                    className="mt-1"
                  />
                </motion.div>
              )}
              {form.reminder_type === 'time' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden">
                  <Label className="text-xs text-gray-500 block mb-1">כל כמה זמן?</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={form.reminder_interval_value}
                      onChange={e => setForm(f => ({ ...f, reminder_interval_value: e.target.value }))}
                      placeholder="כמות"
                      className="w-24"
                    />
                    <Select value={form.reminder_interval_unit} onValueChange={v => setForm(f => ({ ...f, reminder_interval_unit: v }))}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="חודשים">חודשים</SelectItem>
                        <SelectItem value="שנים">שנים</SelectItem>
                        <SelectItem value="שבועות">שבועות</SelectItem>
                        <SelectItem value="ימים">ימים</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={!form.name.trim()} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white">
              שמור טיפול
            </Button>
            <Button variant="outline" onClick={onClose} className="flex-1">
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MaintenanceDialog({ open, onOpenChange, vehicle, logForm, setLogForm, saving, onSave, user }) {
  const [showAddCustom, setShowAddCustom] = useState(false);

  const allPreset = [...PRESET_SMALL, ...PRESET_LARGE];
  const customItems = (logForm.selected_items || []).filter(i => !allPreset.includes(i));
  const currentPreset = logForm.service_type === 'small' ? PRESET_SMALL : logForm.service_type === 'large' ? PRESET_LARGE : [];

  const toggleItem = (item) => {
    const items = logForm.selected_items || [];
    setLogForm(f => ({
      ...f,
      selected_items: items.includes(item) ? items.filter(i => i !== item) : [...items, item]
    }));
  };

  const handleAddCustom = async (form) => {
    setShowAddCustom(false);
    // Add item to selected immediately
    setLogForm(f => ({
      ...f,
      selected_items: [...(f.selected_items || []), form.name],
    }));
    // If user defined a reminder, save as a template
    if (form.reminder_type !== 'none' && user) {
      const templateData = {
        name: form.name,
        recurrence_enabled: true,
        scope: 'user',
        owner_user_id: user.id,
        is_active: true,
      };
      if (form.reminder_type === 'time' && form.reminder_interval_value) {
        templateData.interval_unit = form.reminder_interval_unit;
        templateData.interval_value = Number(form.reminder_interval_value);
      }
      try {
        const { base44 } = await import('@/api/base44Client');
        await base44.entities.MaintenanceTemplate.create(templateData);
      } catch(e) {}
    }
  };

  return (
    <>
      <AddCustomItemDialog open={showAddCustom} onClose={() => setShowAddCustom(false)} onSave={handleAddCustom} user={user} />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg w-full max-h-[92vh] overflow-y-auto p-0" dir="rtl">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between">
            <div>
              <DialogTitle className="text-lg font-bold text-gray-900">
                הוספת טיפול
              </DialogTitle>
              <p className="text-xs text-gray-400 mt-0.5">{vehicle?.manufacturer} {vehicle?.model}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100 mt-0.5"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-5 py-5 space-y-6">

            {/* ── Service Type Cards ── */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-gray-700">סוג הטיפול</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'small', emoji: '🔵', title: 'טיפול קטן', desc: 'שמן, פילטרים, מזגן', activeClass: 'border-blue-500 bg-blue-50', checkClass: 'bg-blue-500' },
                  { key: 'large', emoji: '🟠', title: 'טיפול גדול', desc: 'פלאגים, טיימינג, בולמים', activeClass: 'border-orange-500 bg-orange-50', checkClass: 'bg-orange-500' },
                ].map(opt => {
                  const active = logForm.service_type === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setLogForm(f => ({ ...f, service_type: opt.key, selected_items: [] }))}
                      className={`relative p-4 rounded-2xl border-2 text-right transition-all duration-200 active:scale-95 ${
                        active ? opt.activeClass + ' shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      {active && (
                        <span className={`absolute top-2.5 left-2.5 w-5 h-5 rounded-full ${opt.checkClass} flex items-center justify-center shadow-sm`}>
                          <Check className="h-3 w-3 text-white" strokeWidth={3} />
                        </span>
                      )}
                      <div className="text-3xl mb-2">{opt.emoji}</div>
                      <p className="font-bold text-sm text-gray-900">{opt.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Actions Checklist ── */}
            <AnimatePresence>
              {logForm.service_type && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  <p className="text-sm font-semibold text-gray-700">מה בוצע בטיפול?</p>

                  {/* Chips grid */}
                  <div className="flex flex-wrap gap-2">
                    {currentPreset.map(item => {
                      const checked = logForm.selected_items?.includes(item) || false;
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggleItem(item)}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all duration-150 active:scale-95 ${
                            checked
                              ? 'bg-amber-600 border-amber-600 text-white shadow-sm'
                              : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300 hover:bg-amber-50'
                          }`}
                        >
                          {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                          {item}
                        </button>
                      );
                    })}
                    {/* Custom items */}
                    {customItems.map(item => (
                      <div
                        key={item}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-amber-600 border-amber-600 text-white shadow-sm text-sm font-medium"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        {item}
                        <button
                          type="button"
                          onClick={() => setLogForm(f => ({ ...f, selected_items: (f.selected_items || []).filter(i => i !== item) }))}
                          className="mr-0.5 hover:opacity-70"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Add new custom */}
                  <button
                    type="button"
                    onClick={() => setShowAddCustom(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50/30 transition-all text-sm"
                  >
                    <Plus className="h-4 w-4" />
                    הוסף טיפול שלא קיים ברשימה
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Details card ── */}
            <div className="bg-gray-50 rounded-2xl p-4 space-y-4">
              <p className="text-sm font-semibold text-gray-700">פרטי הטיפול</p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-500">תאריך ביצוע *</Label>
                  <DateInput
                    value={logForm.performed_at}
                    onChange={e => setLogForm(f => ({ ...f, performed_at: e.target.value }))}
                    className="mt-1 bg-white"
                    required
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">בוצע על ידי</Label>
                  <Select value={logForm.performed_by} onValueChange={v => setLogForm(f => ({ ...f, performed_by: v }))}>
                    <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="אני">אני</SelectItem>
                      <SelectItem value="מוסך">מוסך</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {usesKm(vehicle?.vehicle_type, vehicle?.nickname) && (
                <div>
                  <Label className="text-xs text-gray-500">קילומטראז׳ בעת הביצוע</Label>
                  <Input
                    type="number"
                    value={logForm.km_at_service}
                    onChange={e => setLogForm(f => ({ ...f, km_at_service: e.target.value }))}
                    placeholder="למשל: 50000"
                    className="mt-1 bg-white"
                  />
                </div>
              )}

              {usesHours(vehicle?.vehicle_type, vehicle?.nickname) && (
                <div>
                  <Label className="text-xs text-gray-500">שעות מנוע בעת הביצוע</Label>
                  <Input
                    type="number"
                    value={logForm.engine_hours_at_service}
                    onChange={e => setLogForm(f => ({ ...f, engine_hours_at_service: e.target.value }))}
                    placeholder="למשל: 150"
                    className="mt-1 bg-white"
                  />
                </div>
              )}

              <div>
                <Label className="text-xs text-gray-500">עלות (אופציונלי)</Label>
                <Input
                  type="number"
                  value={logForm.cost}
                  onChange={e => setLogForm(f => ({ ...f, cost: e.target.value }))}
                  placeholder="₪"
                  className="mt-1 bg-white"
                />
              </div>

              <div>
                <Label className="text-xs text-gray-500">הערות / פירוט נוסף</Label>
                <Textarea
                  value={logForm.notes}
                  onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="הערות נוספות..."
                  className="mt-1 min-h-[70px] bg-white"
                />
              </div>
            </div>

          </div>

          {/* ── Save button — sticky footer so it stays above the mobile keyboard ── */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
            <Button
              onClick={onSave}
              disabled={saving || !logForm.service_type}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white h-12 text-base font-semibold rounded-2xl shadow-sm"
            >
              {saving ? <Clock className="h-5 w-5 animate-spin" /> : logForm.id ? 'עדכן טיפול' : 'שמור טיפול'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}