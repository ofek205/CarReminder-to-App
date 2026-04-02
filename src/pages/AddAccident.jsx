import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Loader2, Search, CheckCircle2, X, ChevronLeft, AlertTriangle, Phone, User, Car, MapPin, FileText, Shield, Calendar, ZoomIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { lookupVehicleByPlate } from '../services/vehicleLookup';
import { toast } from 'sonner';
import { useAuth } from '../components/shared/GuestContext';
import { DEMO_ACCIDENTS, DEMO_VEHICLE } from '../components/shared/demoVehicleData';
import useAccountRole from '@/hooks/useAccountRole';
import { isViewOnly } from '@/lib/permissions';
import { C } from '@/lib/designTokens';
import ImageViewer from '../components/shared/ImageViewer';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import LoadingSpinner from '../components/shared/LoadingSpinner';

const INSURANCE_COMPANIES = [
  'הראל', 'מגדל', 'כלל', 'הפניקס', 'מנורה מבטחים', 'איילון', 'שלמה ביטוח',
  'הכשרה', 'ביטוח ישיר', 'AIG', 'שומרה', 'אליהו', 'אחר',
];

const EMPTY_FORM = {
  vehicle_id: '',
  date: '',
  location: '',
  description: '',
  status: 'פתוח',
  photos: [],
  other_driver_name: '',
  other_driver_phone: '',
  other_driver_plate: '',
  other_driver_manufacturer: '',
  other_driver_model: '',
  other_driver_year: '',
  other_driver_insurance_company: '',
  other_driver_insurance_company_other: '',
  other_driver_insurance_photo: '',
};

function AutofillHint({ name, autofillFields }) {
  if (!autofillFields.has(name)) return null;
  return (
    <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      מולא אוטומטית (ניתן לערוך)
    </p>
  );
}

function autofillCls(name, autofillFields) {
  return autofillFields.has(name) ? 'bg-[#E8F8F0] border-green-300 focus:border-green-500' : '';
}

export default function AddAccident() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, isGuest, user, guestVehicles, guestAccidents,
    addGuestAccident, updateGuestAccident } = useAuth();
  const { role, isGuest: isGuestRole } = useAccountRole();

  const urlParams = new URLSearchParams(window.location.search);
  const editId = urlParams.get('id');
  const isEdit = !!editId;

  const [saving, setSaving] = useState(false);
  const [accountId, setAccountId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [autofillFields, setAutofillFields] = useState(new Set());
  const [lookupStatus, setLookupStatus] = useState('idle');
  const [plateQuery, setPlateQuery] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Load account for authenticated users
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function init() {
      const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
      if (members.length > 0) setAccountId(members[0].account_id);
    }
    init();
  }, [isAuthenticated, user]);

  // Fetch vehicles
  const { data: authVehicles = [] } = useQuery({
    queryKey: ['vehicles', accountId],
    queryFn: () => db.vehicles.filter({ account_id: accountId }),
    enabled: !!accountId,
  });
  const vehicles = isGuest ? [...guestVehicles, DEMO_VEHICLE] : authVehicles;

  // Load existing accident for edit mode
  useEffect(() => {
    if (!isEdit) return;
    async function loadAccident() {
      try {
        if (isGuest) {
          const existing = guestAccidents?.find(a => a.id === editId)
            || DEMO_ACCIDENTS.find(a => a.id === editId);
          if (existing) {
            setForm({ ...EMPTY_FORM, ...existing });
            if (existing.other_driver_plate) setPlateQuery(existing.other_driver_plate);
          }
        } else if (accountId) {
          const results = await db.accidents.filter({ account_id: accountId });
          const existing = results.find(a => a.id === editId);
          if (existing) {
            setForm({ ...EMPTY_FORM, ...existing });
            if (existing.other_driver_plate) setPlateQuery(existing.other_driver_plate);
          }
        }
      } catch (err) {
        console.error('Error loading accident:', err);
      } finally {
        setLoading(false);
      }
    }
    loadAccident();
  }, [isEdit, editId, isGuest, guestAccidents, accountId]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  // Plate lookup for other driver
  const handleLookup = async () => {
    if (!plateQuery.trim()) return;
    setLookupStatus('loading');
    try {
      const fields = await lookupVehicleByPlate(plateQuery.trim());
      if (!fields) { setLookupStatus('not_found'); return; }
      const updates = {
        other_driver_plate: fields.license_plate || '',
        other_driver_manufacturer: fields.manufacturer || '',
        other_driver_model: fields.model || '',
        other_driver_year: fields.year || '',
      };
      setForm(prev => ({ ...prev, ...updates }));
      const filled = new Set(
        Object.entries(updates).filter(([, v]) => v !== '').map(([k]) => k)
      );
      setAutofillFields(filled);
      setLookupStatus('found');
    } catch (_) {
      setLookupStatus('error');
    }
  };

  // Photo handling (placeholder — storage not yet migrated)
  const handlePhotoCapture = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('קובץ גדול מדי (מקס 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setForm(prev => ({ ...prev, photos: [...(prev.photos || []), reader.result] }));
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (index) => {
    setForm(prev => ({
      ...prev,
      photos: prev.photos.filter((_, i) => i !== index),
    }));
  };

  const handleInsurancePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('קובץ גדול מדי (מקס 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      handleChange('other_driver_insurance_photo', reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.vehicle_id) { toast.error('יש לבחור רכב'); return; }
    if (!form.date) { toast.error('יש להזין תאריך'); return; }

    setSaving(true);
    try {
      const data = { ...form };
      // Clean insurance company
      if (data.other_driver_insurance_company === 'אחר' && data.other_driver_insurance_company_other) {
        data.other_driver_insurance_company = data.other_driver_insurance_company_other;
      }
      delete data.other_driver_insurance_company_other;
      // Remove empty strings
      Object.keys(data).forEach(k => { if (data[k] === '') delete data[k]; });
      // Keep photos array and status
      data.photos = form.photos || [];
      data.status = form.status || 'פתוח';

      if (isGuest) {
        if (isEdit) {
          updateGuestAccident(editId, data);
        } else {
          addGuestAccident(data);
        }
      } else {
        data.account_id = accountId;
        if (isEdit) {
          await db.accidents.update(editId, data);
        } else {
          await db.accidents.create(data);
        }
        queryClient.invalidateQueries({ queryKey: ['accidents'] });
      }

      toast.success(isEdit ? 'התאונה עודכנה בהצלחה' : 'התאונה נשמרה בהצלחה');
      navigate(createPageUrl('Accidents'));
    } catch (err) {
      console.error('Error saving accident:', err);
      toast.error('שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  if (!isGuestRole && isViewOnly(role)) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-2xl p-6 max-w-sm" style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }}>
          <p className="font-bold text-lg mb-2" style={{ color: '#1E40AF' }}>אין לך הרשאה לתעד תאונה</p>
          <p className="text-sm mb-4" style={{ color: '#1E40AF' }}>הצטרפת כחבר — תצוגה בלבד</p>
          <button onClick={() => navigate(-1)} className="px-6 py-2 rounded-xl font-bold text-sm text-white" style={{ background: '#2563EB' }}>חזרה</button>
        </div>
      </div>
    );
  }

  const isDemo = form._isDemo === true;
  const selectedVehicle = vehicles.find(v => v.id === form.vehicle_id);

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to={createPageUrl('Accidents')}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: C.light }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </div>
        </Link>
        <h1 className="font-black text-xl" style={{ color: C.text }}>
          {isDemo ? 'תאונה לדוגמה' : isEdit ? 'עריכת תאונה' : 'תיעוד תאונה חדשה'}
        </h1>
      </div>

      {isDemo && (
        <div className="rounded-2xl p-3 mb-1 flex items-center gap-2 text-xs font-medium"
          style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>זוהי תאונה לדוגמה בלבד — הנתונים אינם אמיתיים</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Vehicle selector ── */}
        <div className="rounded-2xl p-4" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <Label className="font-bold text-sm mb-2 block" style={{ color: C.text }}>
            <Car className="w-4 h-4 inline ml-1" />
            באיזה רכב מדובר?
          </Label>
          <Select value={form.vehicle_id} onValueChange={v => handleChange('vehicle_id', v)}>
            <SelectTrigger className="rounded-xl">
              <SelectValue placeholder="בחר רכב" />
            </SelectTrigger>
            <SelectContent>
              {vehicles.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  {v.nickname || [v.manufacturer, v.model].filter(Boolean).join(' ') || 'רכב'}
                  {v.license_plate ? ` (${v.license_plate})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* ── Date & location ── */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="w-4 h-4" style={{ color: C.primary }} />
            <span className="font-bold text-sm" style={{ color: C.text }}>מתי ואיפה</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>תאריך התאונה *</Label>
              <DateInput value={form.date} onChange={v => handleChange('date', v)} className="rounded-xl" />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>מיקום</Label>
              <Input
                value={form.location}
                onChange={e => handleChange('location', e.target.value)}
                placeholder="כתובת / צומת / כביש"
                className="rounded-xl"
              />
            </div>
          </div>
        </div>

        {/* ── Accident photos ── */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-1">
            <Camera className="w-4 h-4" style={{ color: C.primary }} />
            <span className="font-bold text-sm" style={{ color: C.text }}>תמונות מהתאונה</span>
          </div>
          <p className="text-xs" style={{ color: C.muted }}>צלם את הנזק, מיקום הרכבים, שלטי דרך וכל פרט רלוונטי</p>

          {/* Photo grid */}
          <div className="flex flex-wrap gap-2">
            {(form.photos || []).map((photo, i) => (
              <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border cursor-pointer group" style={{ borderColor: C.border }}
                onClick={() => { setViewerIndex(i); setViewerOpen(true); }}>
                <img src={photo} alt={`תמונה ${i + 1}`} className="w-full h-full object-cover" />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <ZoomIn className="w-4 h-4 text-white drop-shadow" />
                </div>
                {!isDemo && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                    className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.6)' }}>
                    <X className="w-3 h-3 text-white" />
                  </button>
                )}
              </div>
            ))}

            {/* Add photo button */}
            <label className="w-20 h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors hover:bg-white/50"
              style={{ borderColor: C.border, color: C.muted }}>
              <Camera className="w-5 h-5 mb-0.5" />
              <span className="text-[10px] font-medium">הוסף</span>
              <input type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} className="hidden" />
            </label>
          </div>
        </div>

        {/* ── Other driver section ── */}
        <div className="rounded-2xl p-4 space-y-4" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4" style={{ color: C.primary }} />
            <span className="font-bold text-sm" style={{ color: C.text }}>פרטי הנהג השני</span>
          </div>

          {/* Plate lookup — single field that also saves the plate number */}
          <div>
            <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>מספר רכב של הנהג השני</Label>
            <div className="flex gap-2">
              <Input
                value={plateQuery}
                onChange={e => {
                  setPlateQuery(e.target.value);
                  handleChange('other_driver_plate', e.target.value);
                  if (lookupStatus !== 'idle' && lookupStatus !== 'loading') setLookupStatus('idle');
                }}
                placeholder="הזן מספר רכב (XX-XXX-XX)"
                className={`rounded-xl flex-1 ${autofillCls('other_driver_plate', autofillFields)}`}
                dir="ltr"
              />
              <Button type="button" onClick={handleLookup}
                disabled={lookupStatus === 'loading' || !plateQuery.trim()}
                className="rounded-xl px-4 shrink-0"
                style={{ background: C.primary, color: '#fff' }}>
                {lookupStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[11px] mt-1" style={{ color: C.muted }}>
              <Search className="w-3 h-3 inline ml-0.5" style={{ verticalAlign: '-2px' }} />
              לחץ על החיפוש כדי למלא פרטים אוטומטית ממאגר משרד התחבורה
            </p>
            {lookupStatus === 'found' && (
              <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> נמצא! פרטי הרכב מולאו אוטומטית
              </p>
            )}
            {lookupStatus === 'not_found' && (
              <p className="text-xs text-amber-600 mt-1">לא נמצא במאגר — המספר יישמר כמו שהוא</p>
            )}
            {lookupStatus === 'error' && (
              <p className="text-xs text-red-600 mt-1">שגיאה בחיפוש — המספר יישמר כמו שהוא</p>
            )}
          </div>

          {/* Driver name & phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>שם הנהג</Label>
              <Input
                value={form.other_driver_name}
                onChange={e => handleChange('other_driver_name', e.target.value)}
                placeholder="שם מלא"
                className="rounded-xl"
              />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>טלפון</Label>
              <Input
                value={form.other_driver_phone}
                onChange={e => handleChange('other_driver_phone', e.target.value)}
                placeholder="050-0000000"
                className="rounded-xl"
                dir="ltr"
                type="tel"
              />
            </div>
          </div>

          {/* Vehicle details (manufacturer, model, year — filled by lookup or manually) */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>יצרן</Label>
              <Input
                value={form.other_driver_manufacturer}
                onChange={e => handleChange('other_driver_manufacturer', e.target.value)}
                placeholder="יצרן"
                className={`rounded-xl ${autofillCls('other_driver_manufacturer', autofillFields)}`}
              />
              <AutofillHint name="other_driver_manufacturer" autofillFields={autofillFields} />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>דגם</Label>
              <Input
                value={form.other_driver_model}
                onChange={e => handleChange('other_driver_model', e.target.value)}
                placeholder="דגם"
                className={`rounded-xl ${autofillCls('other_driver_model', autofillFields)}`}
              />
              <AutofillHint name="other_driver_model" autofillFields={autofillFields} />
            </div>
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>שנה</Label>
              <Input
                value={form.other_driver_year}
                onChange={e => handleChange('other_driver_year', e.target.value)}
                placeholder="2024"
                className={`rounded-xl ${autofillCls('other_driver_year', autofillFields)}`}
                dir="ltr"
              />
              <AutofillHint name="other_driver_year" autofillFields={autofillFields} />
            </div>
          </div>
        </div>

        {/* ── Other driver insurance ── */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4" style={{ color: C.primary }} />
            <span className="font-bold text-sm" style={{ color: C.text }}>ביטוח הנהג השני</span>
          </div>

          <div>
            <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>חברת ביטוח</Label>
            <Select
              value={form.other_driver_insurance_company}
              onValueChange={v => handleChange('other_driver_insurance_company', v)}>
              <SelectTrigger className="rounded-xl">
                <SelectValue placeholder="בחר חברת ביטוח" />
              </SelectTrigger>
              <SelectContent>
                {INSURANCE_COMPANIES.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {form.other_driver_insurance_company === 'אחר' && (
            <div>
              <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>שם חברת הביטוח</Label>
              <Input
                value={form.other_driver_insurance_company_other}
                onChange={e => handleChange('other_driver_insurance_company_other', e.target.value)}
                placeholder="הזן שם חברה"
                className="rounded-xl"
              />
            </div>
          )}

          {/* Insurance document photo */}
          <div>
            <Label className="text-xs font-medium mb-1 block" style={{ color: C.muted }}>צילום תעודת ביטוח</Label>
            <div className="flex items-center gap-3">
              {form.other_driver_insurance_photo ? (
                <div className="relative w-24 h-16 rounded-xl overflow-hidden border" style={{ borderColor: C.border }}>
                  <img src={form.other_driver_insurance_photo} alt="תעודת ביטוח" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => handleChange('other_driver_insurance_photo', '')}
                    className="absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.6)' }}>
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed cursor-pointer transition-colors hover:bg-white/50"
                  style={{ borderColor: C.border, color: C.muted }}>
                  <Camera className="w-4 h-4" />
                  <span className="text-xs font-medium">צלם תעודת ביטוח</span>
                  <input type="file" accept="image/*" capture="environment" onChange={handleInsurancePhoto} className="hidden" />
                </label>
              )}
            </div>
          </div>
        </div>

        {/* ── Description ── */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4" style={{ color: C.primary }} />
            <span className="font-bold text-sm" style={{ color: C.text }}>תיאור התאונה</span>
          </div>
          <textarea
            value={form.description}
            onChange={e => handleChange('description', e.target.value)}
            placeholder="תאר מה קרה — איך הגעת, מי פגע במי, נזקים שנגרמו..."
            className="w-full rounded-xl border p-3 text-sm min-h-[100px] resize-y"
            style={{ borderColor: C.border }}
            dir="rtl"
          />
        </div>

        {/* ── Status ── */}
        <div className="rounded-2xl p-4" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
          <Label className="font-bold text-sm mb-2 block" style={{ color: C.text }}>סטטוס</Label>
          <Select value={form.status} onValueChange={v => handleChange('status', v)}>
            <SelectTrigger className="rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="פתוח">פתוח</SelectItem>
              <SelectItem value="בטיפול">בטיפול</SelectItem>
              <SelectItem value="סגור">סגור</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Submit ── */}
        {!isDemo && (
          <button type="submit" disabled={saving}
            className="w-full py-3.5 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{ background: C.yellow, color: C.greenDark, boxShadow: `0 4px 16px ${C.yellow}50` }}>
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {isEdit ? 'עדכן תאונה' : 'שמור תאונה'}
          </button>
        )}
      </form>

      {/* Image Viewer */}
      <ImageViewer
        images={form.photos || []}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        title="תמונות תאונה"
      />
    </div>
  );
}
