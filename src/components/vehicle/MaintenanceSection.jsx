import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import { Wrench, Plus, Calendar, Trash2, AlertTriangle } from 'lucide-react';
import { getTheme } from '@/lib/designTokens';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { formatDateHe } from '../shared/DateStatusUtils';

export default function MaintenanceSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState('טיפול'); // 'טיפול' or 'תיקון'
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', date: '', cost: '', notes: '', km_at_service: '', garage_name: '', performed_by: '' });

  // Fetch logs from Supabase (or empty for guest)
  const { data: logs = [] } = useQuery({
    queryKey: ['maintenance-logs-v2', vehicle.id],
    queryFn: async () => {
      try {
        const { data } = await (await import('@/lib/supabase')).supabase
          .from('maintenance_logs')
          .select('*')
          .eq('vehicle_id', vehicle.id)
          .order('date', { ascending: false });
        return data || [];
      } catch { return []; }
    },
    enabled: !isGuest && !!vehicle.id,
  });

  const openDialog = (type) => {
    setDialogType(type);
    setForm({ title: '', date: new Date().toISOString().split('T')[0], cost: '', notes: '', km_at_service: '', garage_name: '', performed_by: '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { alert('יש להזין כותרת'); return; }
    setSaving(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const row = {
        vehicle_id: vehicle.id,
        type: dialogType,
        title: form.title.trim(),
        date: form.date || null,
        cost: form.cost ? Number(form.cost) : null,
        notes: form.notes.trim() || null,
      };
      if (form.km_at_service) row.km_at_service = Number(form.km_at_service);
      if (form.garage_name?.trim()) row.garage_name = form.garage_name.trim();
      if (form.performed_by?.trim()) row.performed_by = form.performed_by.trim();
      await supabase.from('maintenance_logs').insert(row);
      queryClient.invalidateQueries({ queryKey: ['maintenance-logs-v2', vehicle.id] });
      setDialogOpen(false);
    } catch (err) {
      alert('שגיאה בשמירה: ' + (err?.message || 'נסה שוב'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const { supabase } = await import('@/lib/supabase');
      await supabase.from('maintenance_logs').delete().eq('id', id);
      queryClient.invalidateQueries({ queryKey: ['maintenance-logs-v2', vehicle.id] });
    } catch {}
  };

  return (
    <>
      <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1.5px solid ${T.border}` }} dir="rtl">
        {/* Header with action buttons */}
        <div className="flex items-center justify-between px-4 py-3" style={{ background: T.light }}>
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4" style={{ color: T.primary }} />
            <span className="text-sm font-black" style={{ color: T.text }}>טיפולים ותיקונים</span>
            {logs.length > 0 && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: T.primary, color: '#fff' }}>{logs.length}</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => openDialog('טיפול')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.95]"
              style={{ background: T.primary, color: '#fff' }}>
              טיפול <Plus className="w-3 h-3" />
            </button>
            <button onClick={() => openDialog('תיקון')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.95]"
              style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
              תיקון <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Log list */}
        {logs.length === 0 ? (
          <div className="py-8 text-center px-4">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: T.light }}>
              <Wrench className="w-7 h-7" style={{ color: T.primary, opacity: 0.5 }} />
            </div>
            <p className="text-sm font-bold mb-1" style={{ color: T.text }}>עדיין לא תועדו טיפולים</p>
            <p className="text-xs mb-4" style={{ color: T.muted }}>תעד טיפולים ותיקונים כדי לעקוב אחרי התחזוקה</p>
            <div className="flex justify-center gap-2">
              <button onClick={() => openDialog('טיפול')}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.95]"
                style={{ background: T.primary, color: '#fff' }}>
                הוסף טיפול <Plus className="w-4 h-4" />
              </button>
              <button onClick={() => openDialog('תיקון')}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.95]"
                style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                הוסף תיקון <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: `${T.border}60` }}>
            {logs.slice(0, 10).map(log => (
              <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: log.type === 'תיקון' ? '#FEF2F2' : T.light }}>
                  {log.type === 'תיקון'
                    ? <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                    : <Wrench className="w-3.5 h-3.5" style={{ color: T.primary }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: T.text }}>{log.title}</p>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: log.type === 'תיקון' ? '#FEF2F2' : T.light, color: log.type === 'תיקון' ? '#DC2626' : T.primary }}>
                      {log.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {log.date && <span className="text-[11px]" style={{ color: T.muted }}>{formatDateHe(log.date)}</span>}
                    {log.cost && <span className="text-[11px]" style={{ color: T.muted }}>₪{Number(log.cost).toLocaleString()}</span>}
                    {log.km_at_service && <span className="text-[11px]" style={{ color: T.muted }}>{Number(log.km_at_service).toLocaleString()} ק"מ</span>}
                    {log.garage_name && <span className="text-[11px]" style={{ color: T.muted }}>{log.garage_name}</span>}
                  </div>
                  {log.notes && <p className="text-xs mt-1 leading-relaxed" style={{ color: T.muted }}>{log.notes}</p>}
                </div>
                <button onClick={(e) => { e.preventDefault(); handleDelete(log.id); }}
                  className="w-6 h-6 rounded flex items-center justify-center shrink-0 hover:bg-red-50 transition-all mt-0.5">
                  <Trash2 className="w-3 h-3" style={{ color: '#DC2626' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">
              {dialogType === 'תיקון' ? 'הוספת תיקון' : 'הוספת טיפול'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>כותרת *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={dialogType === 'תיקון' ? 'למשל: החלפת בלמים' : 'למשל: טיפול 10,000'} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>תאריך</Label>
                <DateInput value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <Label>עלות (₪)</Label>
                <Input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0" dir="ltr" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>ק"מ בזמן הטיפול</Label>
                <Input type="number" value={form.km_at_service} onChange={e => setForm(f => ({ ...f, km_at_service: e.target.value }))} placeholder="0" dir="ltr" />
              </div>
              <div>
                <Label>מוסך / מבצע</Label>
                <Input value={form.garage_name} onChange={e => setForm(f => ({ ...f, garage_name: e.target.value }))} placeholder="שם המוסך..." />
              </div>
            </div>
            <div>
              <Label>הערות</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="פרטים נוספים..." rows={2} />
            </div>
            <Button onClick={handleSave} disabled={saving} className="w-full h-11 rounded-2xl font-bold"
              style={{ background: dialogType === 'תיקון' ? '#DC2626' : T.primary, color: '#fff' }}>
              {saving ? 'שומר...' : dialogType === 'תיקון' ? 'שמור תיקון' : 'שמור טיפול'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
