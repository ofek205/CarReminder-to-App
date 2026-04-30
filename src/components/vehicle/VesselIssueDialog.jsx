import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Calendar, Bell } from 'lucide-react';
import { getTheme } from '@/lib/designTokens';

const M = getTheme('כלי שייט');

const CATEGORIES = [
  { value: 'hull',       label: 'גוף/שלד' },
  { value: 'engine',     label: 'מנוע' },
  { value: 'electrical', label: 'חשמל' },
  { value: 'plumbing',   label: 'אינסטלציה' },
  { value: 'safety',     label: 'ציוד בטיחות' },
  { value: 'rigging',    label: 'ציוד הפלגה' },
  { value: 'other',      label: 'אחר' },
];

const PRIORITIES = [
  { value: 'low',    label: 'נמוכה',  color: '#6B7280' },
  { value: 'medium', label: 'בינונית', color: '#2563EB' },
  { value: 'high',   label: 'גבוהה',  color: '#D97706' },
  { value: 'urgent', label: 'דחופה',  color: '#DC2626' },
];

const STATUSES = [
  { value: 'open',        label: 'פתוח' },
  { value: 'in-progress', label: 'בטיפול' },
  { value: 'done',        label: 'הושלם' },
];

const DEFAULT_FORM = {
  title: '',
  category: '',
  priority: 'medium',
  status: 'open',
  description: '',
  target_date: '',
  has_reminder: false,
};

export default function VesselIssueDialog({ open, onOpenChange, issue, onSave }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (issue) {
        setForm({
          title: issue.title || '',
          category: issue.category || '',
          priority: issue.priority || 'medium',
          status: issue.status || 'open',
          description: issue.description || '',
          target_date: issue.target_date || '',
          has_reminder: !!issue.target_date,
        });
      } else {
        setForm(DEFAULT_FORM);
      }
    }
  }, [open, issue]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title: form.title.trim(),
        category: form.category || null,
        priority: form.priority,
        status: form.status,
        description: form.description.trim() || null,
        target_date: form.has_reminder && form.target_date ? form.target_date : null,
        ...(form.status === 'done' && !issue?.completed_date ? { completed_date: new Date().toISOString().split('T')[0] } : {}),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold" style={{ color: M.text }}>
            {issue ? 'עריכת תקלה' : 'תקלה חדשה'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Title */}
          <div>
            <label className="text-sm font-bold mb-1.5 block" style={{ color: M.text }}>כותרת *</label>
            <Input
              placeholder="למשל: חלודה בגוף התחתון"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="rounded-xl"
            />
          </div>

          {/* Category + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-bold mb-1.5 block" style={{ color: M.text }}>קטגוריה</label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="בחר קטגוריה" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-bold mb-1.5 block" style={{ color: M.text }}>עדיפות</label>
              <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {PRIORITIES.map(p => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                        {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status */}
          {issue && (
            <div>
              <label className="text-sm font-bold mb-1.5 block" style={{ color: M.text }}>סטטוס</label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div>
            <label className="text-sm font-bold mb-1.5 block" style={{ color: M.text }}>תיאור</label>
            <Textarea
              placeholder="תאר את התקלה בפירוט..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="rounded-xl min-h-[80px]"
            />
          </div>

          {/* Target date + reminder toggle */}
          <div className="rounded-xl p-3" style={{ background: M.light, border: `1px solid ${M.border}` }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4" style={{ color: M.primary }} />
                <span className="text-sm font-bold" style={{ color: M.text }}>תזכורת לטיפול</span>
              </div>
              <Switch
                checked={form.has_reminder}
                onCheckedChange={v => setForm(f => ({ ...f, has_reminder: v }))}
              />
            </div>
            {form.has_reminder && (
              <div className="flex items-center gap-2 mt-2">
                <Calendar className="w-4 h-4 shrink-0" style={{ color: M.primary }} />
                <input
                  type="date"
                  value={form.target_date}
                  onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: '#B2EBF2' }}
                />
              </div>
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={!form.title.trim() || saving}
            className="w-full py-3.5 rounded-2xl font-bold text-base transition-all active:scale-[0.98] disabled:opacity-50 text-white"
            style={{ background: M.primary, boxShadow: `0 4px 16px ${M.primary}4D` }}>
            {saving ? 'שומר...' : issue ? 'עדכן תקלה' : 'הוסף תקלה'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
