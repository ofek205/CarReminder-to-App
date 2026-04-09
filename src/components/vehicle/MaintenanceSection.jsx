import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import { Wrench, Plus, Calendar, Trash2, AlertTriangle, Settings, Camera, Image, X, Sparkles, Loader2 } from 'lucide-react';
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
  const [serviceSize, setServiceSize] = useState('small');
  const [receiptPhoto, setReceiptPhoto] = useState(null);
  const [aiScanning, setAiScanning] = useState(false);
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

  // AI receipt scanner
  const scanReceipt = async (base64) => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) return;
    setAiScanning(true);
    try {
      const mediaType = base64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const imageData = base64.split(',')[1];
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
            { type: 'text', text: 'סרוק את הקבלה/חשבונית הזו וחלץ: 1) שם המוסך/עסק 2) סכום לתשלום 3) תאריך 4) תיאור קצר של העבודה. החזר JSON בלבד: {"garage":"","cost":"","date":"YYYY-MM-DD","description":""}. אם לא ניתן לזהות שדה — השאר ריק.' }
          ]}],
        }),
      });
      const json = await res.json();
      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        setForm(f => ({
          ...f,
          garage_name: parsed.garage || f.garage_name,
          cost: parsed.cost || f.cost,
          date: parsed.date || f.date,
          title: parsed.description || f.title,
        }));
      }
    } catch {} finally { setAiScanning(false); }
  };

  const handleReceiptUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const base64 = ev.target.result;
      setReceiptPhoto(base64);
      scanReceipt(base64);
    };
    reader.readAsDataURL(file);
  };

  const openDialog = (type) => {
    setDialogType(type);
    setForm({ title: '', date: new Date().toISOString().split('T')[0], cost: '', notes: '', km_at_service: '', garage_name: '', performed_by: '' });
    setReceiptPhoto(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { alert('יש להזין כותרת'); return; }
    setSaving(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const row = {
        vehicle_id: vehicle.id,
        type: dialogType === 'טיפול' ? (serviceSize === 'big' ? 'טיפול גדול' : 'טיפול קטן') : 'תיקון',
        title: form.title.trim(),
        date: form.date || null,
        cost: form.cost ? Number(form.cost) : null,
        notes: form.notes.trim() || null,
      };
      if (form.km_at_service) row.km_at_service = Number(form.km_at_service);
      if (form.garage_name?.trim()) row.garage_name = form.garage_name.trim();
      if (form.performed_by?.trim()) row.performed_by = form.performed_by.trim();
      if (receiptPhoto) row.receipt_photo = receiptPhoto;
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
            {/* Service size selector — only for טיפול */}
            {dialogType === 'טיפול' && (
              <div>
                <Label className="mb-2 block">סוג הטיפול</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setServiceSize('small'); setForm(f => ({ ...f, title: '' })); }}
                    className="rounded-xl p-3 text-center transition-all border-2"
                    style={{
                      background: serviceSize === 'small' ? T.light : '#fff',
                      borderColor: serviceSize === 'small' ? T.primary : '#E5E7EB',
                    }}>
                    <div className="w-8 h-8 rounded-full mx-auto mb-1.5 flex items-center justify-center"
                      style={{ background: serviceSize === 'small' ? T.primary : '#E5E7EB' }}>
                      <Wrench className="w-4 h-4" style={{ color: serviceSize === 'small' ? '#fff' : '#9CA3AF' }} />
                    </div>
                    <p className="text-sm font-bold" style={{ color: serviceSize === 'small' ? T.primary : '#6B7280' }}>טיפול קטן</p>
                    <p className="text-[10px]" style={{ color: T.muted }}>שמן, פילטרים, מזגן</p>
                  </button>
                  <button type="button" onClick={() => { setServiceSize('big'); setForm(f => ({ ...f, title: '' })); }}
                    className="rounded-xl p-3 text-center transition-all border-2"
                    style={{
                      background: serviceSize === 'big' ? '#FFF7ED' : '#fff',
                      borderColor: serviceSize === 'big' ? '#F59E0B' : '#E5E7EB',
                    }}>
                    <div className="w-8 h-8 rounded-full mx-auto mb-1.5 flex items-center justify-center"
                      style={{ background: serviceSize === 'big' ? '#F59E0B' : '#E5E7EB' }}>
                      <Settings className="w-4 h-4" style={{ color: serviceSize === 'big' ? '#fff' : '#9CA3AF' }} />
                    </div>
                    <p className="text-sm font-bold" style={{ color: serviceSize === 'big' ? '#D97706' : '#6B7280' }}>טיפול גדול</p>
                    <p className="text-[10px]" style={{ color: T.muted }}>פלאגים, תזמון, בלמים</p>
                  </button>
                </div>
                {/* Quick-pick chips */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Label className="w-full text-xs mb-0.5">מה בוצע?</Label>
                  {(serviceSize === 'small'
                    ? ['החלפת שמן', 'החלפת פילטר שמן', 'החלפת פילטר אוויר', 'החלפת פילטר מזגן']
                    : ['החלפת פלאגים', 'החלפת חגורות תזמון', 'החלפת בלמים', 'החלפת מצמד', 'החלפת רפידות', 'טיפול במערכת קירור']
                  ).map(item => (
                    <button key={item} type="button"
                      onClick={() => setForm(f => {
                        const parts = (f.title || '').split(', ').filter(Boolean);
                        const has = parts.includes(item);
                        const next = has ? parts.filter(p => p !== item) : [...parts, item];
                        return { ...f, title: next.join(', ') };
                      })}
                      className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all active:scale-[0.95]"
                      style={{
                        background: form.title?.includes(item) ? T.light : '#fff',
                        borderColor: form.title?.includes(item) ? T.primary : '#E5E7EB',
                        color: form.title?.includes(item) ? T.primary : '#6B7280',
                      }}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <Label>{dialogType === 'טיפול' ? 'תיאור (או הוסף ידנית)' : 'כותרת *'}</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder={dialogType === 'תיקון' ? 'למשל: החלפת בלמים' : 'טיפול שלא קיים ברשימה...'} />
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

            {/* Receipt photo + AI scan */}
            <div>
              <Label className="flex items-center gap-1.5">
                צילום קבלה / חשבונית
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                  style={{ background: '#F0F4FF', color: '#6366F1', border: '1px solid #C7D2FE' }}>
                  <Sparkles className="w-2.5 h-2.5" /> AI
                </span>
              </Label>

              {receiptPhoto ? (
                <div className="relative mt-1.5">
                  <img src={receiptPhoto} alt="קבלה" className="w-full h-36 object-cover rounded-xl border" style={{ borderColor: T.border }} />
                  {aiScanning && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#6366F1' }} />
                      <span className="text-xs font-bold" style={{ color: '#6366F1' }}>סורק קבלה...</span>
                    </div>
                  )}
                  <button type="button" onClick={() => { setReceiptPhoto(null); setAiScanning(false); }}
                    className="absolute top-2 left-2 w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 rounded-xl p-3 text-center"
                  style={{ background: '#F8FAFC', border: `2px dashed ${T.border}` }}>
                  <p className="text-[11px] mb-2" style={{ color: T.muted }}>
                    צלם קבלה וה-AI ימלא את הפרטים אוטומטית
                  </p>
                  <div className="flex gap-2 justify-center">
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={handleReceiptUpload} />
                      <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.95]"
                        style={{ background: '#fff', color: T.primary, border: `1.5px solid ${T.border}` }}>
                        <Image className="w-3.5 h-3.5" /> גלריה
                      </div>
                    </label>
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleReceiptUpload} />
                      <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.95]"
                        style={{ background: T.primary, color: '#fff' }}>
                        <Camera className="w-3.5 h-3.5" /> צלם קבלה
                      </div>
                    </label>
                  </div>
                </div>
              )}
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
