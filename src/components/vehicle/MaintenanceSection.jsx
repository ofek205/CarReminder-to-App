import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '@/components/shared/GuestContext';
import { Wrench, Plus, Calendar, Trash2, AlertTriangle, Settings, Camera, Image, X, Sparkles, Loader2 } from 'lucide-react';
import { getTheme } from '@/lib/designTokens';
import { isVessel as checkVessel } from '../shared/DateStatusUtils';
import { Anchor } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { formatDateHe } from '../shared/DateStatusUtils';

export default function MaintenanceSection({ vehicle }) {
  const T = getTheme(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer);
  const vesselMode = checkVessel(vehicle.vehicle_type, vehicle.nickname);
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState('טיפול'); // 'טיפול' or 'תיקון'
  const [saving, setSaving] = useState(false);
  const [serviceSize, setServiceSize] = useState('small');
  const [receiptPhoto, setReceiptPhoto] = useState(null);
  const [aiScanning, setAiScanning] = useState(false);
  const [garageDropdownOpen, setGarageDropdownOpen] = useState(false);

  // Saved garages - persisted per user in localStorage
  const GARAGES_KEY = 'saved_garages';
  const getSavedGarages = () => {
    try { return JSON.parse(localStorage.getItem(GARAGES_KEY) || '[]'); } catch { return []; }
  };
  const saveGarage = (name) => {
    if (!name?.trim()) return;
    const garages = getSavedGarages();
    if (!garages.includes(name.trim())) {
      garages.unshift(name.trim());
      localStorage.setItem(GARAGES_KEY, JSON.stringify(garages.slice(0, 20)));
    }
  };
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

  // AI receipt scanner - uses proxy to avoid exposing API key
  const scanReceipt = async (base64) => {
    setAiScanning(true);
    try {
      const { aiRequest } = await import('@/lib/aiProxy');
      const mediaType = base64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const imageData = base64.split(',')[1];
      const json = await aiRequest({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
          { type: 'text', text: 'סרוק את הקבלה/חשבונית הזו וחלץ: 1) שם המוסך/עסק 2) סכום לתשלום 3) תאריך 4) תיאור קצר של העבודה. החזר JSON בלבד: {"garage":"","cost":"","date":"YYYY-MM-DD","description":""}. אם לא ניתן לזהות שדה - השאר ריק.' }
        ]}],
      });
      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        // Sanitize parsed values
        const safeStr = (v) => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim().slice(0, 100) : '';
        setForm(f => ({
          ...f,
          garage_name: safeStr(parsed.garage) || f.garage_name,
          cost: safeStr(parsed.cost) || f.cost,
          date: (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : '') || f.date,
          title: safeStr(parsed.description) || f.title,
        }));
      }
    } catch (err) {
      console.error('Receipt scan error:', err);
    } finally { setAiScanning(false); }
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
    setServiceSize(vesselMode ? 'engine' : 'small');
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
        type: dialogType === 'תיקון' ? 'תיקון'
          : vesselMode ? (serviceSize === 'hull' ? 'טיפול גוף' : 'טיפול מנוע')
          : (serviceSize === 'big' ? 'טיפול גדול' : 'טיפול קטן'),
        title: form.title.trim(),
        date: form.date || null,
        cost: form.cost ? Number(form.cost) : null,
        notes: form.notes.trim() || null,
      };
      if (form.km_at_service) row.km_at_service = Number(form.km_at_service);
      if (form.garage_name?.trim()) { row.garage_name = form.garage_name.trim(); saveGarage(row.garage_name); }
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
    } catch (err) {
      console.error('Delete maintenance error:', err);
      alert('שגיאה במחיקת טיפול');
    }
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
            {/* Service type selector - only for טיפול */}
            {dialogType === 'טיפול' && (
              <div>
                <Label className="mb-2 block">סוג הטיפול</Label>
                <div className={`grid gap-2 ${vesselMode ? 'grid-cols-2' : 'grid-cols-2'}`}>
                  {vesselMode ? (
                    <>
                      {/* Vessel: engine vs hull */}
                      <button type="button" onClick={() => { setServiceSize('engine'); setForm(f => ({ ...f, title: '' })); }}
                        className="rounded-xl p-3 text-center transition-all border-2"
                        style={{ background: serviceSize === 'engine' ? T.light : '#fff', borderColor: serviceSize === 'engine' ? T.primary : '#E5E7EB' }}>
                        <div className="w-8 h-8 rounded-full mx-auto mb-1.5 flex items-center justify-center"
                          style={{ background: serviceSize === 'engine' ? T.primary : '#E5E7EB' }}>
                          <Settings className="w-4 h-4" style={{ color: serviceSize === 'engine' ? '#fff' : '#9CA3AF' }} />
                        </div>
                        <p className="text-sm font-bold" style={{ color: serviceSize === 'engine' ? T.primary : '#6B7280' }}>מנוע</p>
                        <p className="text-[10px]" style={{ color: T.muted }}>שמן, פילטרים, אנודות</p>
                      </button>
                      <button type="button" onClick={() => { setServiceSize('hull'); setForm(f => ({ ...f, title: '' })); }}
                        className="rounded-xl p-3 text-center transition-all border-2"
                        style={{ background: serviceSize === 'hull' ? '#E0F7FA' : '#fff', borderColor: serviceSize === 'hull' ? '#0097A7' : '#E5E7EB' }}>
                        <div className="w-8 h-8 rounded-full mx-auto mb-1.5 flex items-center justify-center"
                          style={{ background: serviceSize === 'hull' ? '#0097A7' : '#E5E7EB' }}>
                          <Anchor className="w-4 h-4" style={{ color: serviceSize === 'hull' ? '#fff' : '#9CA3AF' }} />
                        </div>
                        <p className="text-sm font-bold" style={{ color: serviceSize === 'hull' ? '#0097A7' : '#6B7280' }}>גוף / שלד</p>
                        <p className="text-[10px]" style={{ color: T.muted }}>ניקוי תחתית, מפרשים, צבע</p>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Cars: small vs big */}
                      <button type="button" onClick={() => { setServiceSize('small'); setForm(f => ({ ...f, title: '' })); }}
                        className="rounded-xl p-3 text-center transition-all border-2"
                        style={{ background: serviceSize === 'small' ? T.light : '#fff', borderColor: serviceSize === 'small' ? T.primary : '#E5E7EB' }}>
                        <div className="w-8 h-8 rounded-full mx-auto mb-1.5 flex items-center justify-center"
                          style={{ background: serviceSize === 'small' ? T.primary : '#E5E7EB' }}>
                          <Wrench className="w-4 h-4" style={{ color: serviceSize === 'small' ? '#fff' : '#9CA3AF' }} />
                        </div>
                        <p className="text-sm font-bold" style={{ color: serviceSize === 'small' ? T.primary : '#6B7280' }}>טיפול קטן</p>
                        <p className="text-[10px]" style={{ color: T.muted }}>שמן, פילטרים, מזגן</p>
                      </button>
                      <button type="button" onClick={() => { setServiceSize('big'); setForm(f => ({ ...f, title: '' })); }}
                        className="rounded-xl p-3 text-center transition-all border-2"
                        style={{ background: serviceSize === 'big' ? '#FFF7ED' : '#fff', borderColor: serviceSize === 'big' ? '#F59E0B' : '#E5E7EB' }}>
                        <div className="w-8 h-8 rounded-full mx-auto mb-1.5 flex items-center justify-center"
                          style={{ background: serviceSize === 'big' ? '#F59E0B' : '#E5E7EB' }}>
                          <Settings className="w-4 h-4" style={{ color: serviceSize === 'big' ? '#fff' : '#9CA3AF' }} />
                        </div>
                        <p className="text-sm font-bold" style={{ color: serviceSize === 'big' ? '#D97706' : '#6B7280' }}>טיפול גדול</p>
                        <p className="text-[10px]" style={{ color: T.muted }}>פלאגים, תזמון, בלמים</p>
                      </button>
                    </>
                  )}
                </div>
                {/* Quick-pick chips */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Label className="w-full text-xs mb-0.5">מה בוצע?</Label>
                  {(vesselMode
                    ? (serviceSize === 'engine'
                      ? ['החלפת שמן מנוע', 'החלפת פילטר שמן', 'החלפת פילטר דלק', 'החלפת אנודות', 'החלפת מאייד מים', 'בדיקת רמת שמן', 'שטיפת מערכת קירור']
                      : ['ניקוי תחתית', 'צביעת אנטי פאולינג', 'החלפת מפרשים', 'תיקון ג\'לקוט', 'שימון ונצ\'ים', 'בדיקת חיבורי שלד', 'ליטוש גוף', 'החלפת חבלים'])
                    : (serviceSize === 'small'
                      ? ['החלפת שמן', 'החלפת פילטר שמן', 'החלפת פילטר אוויר', 'החלפת פילטר מזגן']
                      : ['החלפת פלאגים', 'החלפת חגורות תזמון', 'החלפת בלמים', 'החלפת מצמד', 'החלפת רפידות', 'טיפול במערכת קירור'])
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
                <Label>{vesselMode ? 'שעות מנוע בזמן הטיפול' : 'ק"מ בזמן הטיפול'}</Label>
                <Input type="number" value={form.km_at_service} onChange={e => setForm(f => ({ ...f, km_at_service: e.target.value }))} placeholder="0" dir="ltr" />
              </div>
              <div className="relative">
                <Label>מוסך / מבצע</Label>
                <Input
                  value={form.garage_name}
                  onChange={e => { setForm(f => ({ ...f, garage_name: e.target.value })); setGarageDropdownOpen(true); }}
                  onFocus={() => setGarageDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setGarageDropdownOpen(false), 200)}
                  placeholder="שם המוסך..."
                />
                {garageDropdownOpen && (() => {
                  const saved = getSavedGarages();
                  const filtered = saved.filter(g => !form.garage_name || g.includes(form.garage_name));
                  if (filtered.length === 0) return null;
                  return (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl bg-white border shadow-lg max-h-32 overflow-y-auto"
                      style={{ borderColor: T.border }}>
                      {filtered.map(g => (
                        <button key={g} type="button"
                          onMouseDown={(e) => { e.preventDefault(); setForm(f => ({ ...f, garage_name: g })); setGarageDropdownOpen(false); }}
                          className="w-full text-right px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                          style={{ color: T.text }}>
                          {g}
                        </button>
                      ))}
                    </div>
                  );
                })()}
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
