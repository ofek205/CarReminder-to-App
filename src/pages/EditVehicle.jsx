import React, { useState, useEffect } from 'react';
import { db } from '@/lib/supabaseEntities';
import { validateUploadFile } from '@/lib/securityUtils';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Camera, Loader2, CheckCircle2, Car, Ship, PenLine } from "lucide-react";
import { Link } from 'react-router-dom';
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import { normalizePlate, usesKm, usesHours, isVintageVehicle, isVessel, isOffroad, getVehicleLabels } from "../components/shared/DateStatusUtils";
import { getCatalogForVehicleType } from "../components/shared/MaintenanceCatalog";
import VehicleTypeSelector, { OFFROAD_EQUIPMENT, OFFROAD_USAGE_TYPES } from "../components/vehicle/VehicleTypeSelector";
import ManufacturerSelector from "../components/vehicle/ManufacturerSelector";
import { trackUserAction } from "../components/shared/ReviewManager";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import { getTheme, isVesselType } from '@/lib/designTokens';
import useAccountRole from '@/hooks/useAccountRole';
import { isViewOnly } from '@/lib/permissions';
import CountryFlagSelect from '../components/vehicle/CountryFlagSelect';

export default function EditVehicle() {
  const urlParams = new URLSearchParams(window.location.search);
  const vehicleId = urlParams.get('id');
  const navigate = useNavigate();
  const { isGuest, guestVehicles, updateGuestVehicle } = useAuth();
  const { role, isGuest: isGuestRole } = useAccountRole();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [form, setForm] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [usageMetric, setUsageMetric] = useState('קילומטרים');
  const [tireQuestion, setTireQuestion] = useState(null);
  const [shipyardQuestion, setShipyardQuestion] = useState(null);

  // Security: only treat as a guest vehicle if the current user IS actually a guest.
  // An authenticated user crafting a URL with ?id=guest_xxx must NOT get guest-mode access —
  // they would find no vehicle in their authenticated account data, and the form stays empty.
  const isGuestVehicle = isGuest && (vehicleId?.startsWith('guest_') || vehicleId?.startsWith('demo_'));

  const buildForm = (v) => ({
    vehicle_type_id: v.vehicle_type_id || '',
    vehicle_type: v.vehicle_type || '',
    manufacturer_id: v.manufacturer_id || '',
    manufacturer: v.manufacturer || '',
    model: v.model || '',
    year: v.year || '',
    nickname: v.nickname || '',
    license_plate: v.license_plate || '',
    test_due_date: v.test_due_date || '',
    insurance_due_date: v.insurance_due_date || '',
    insurance_company: v.insurance_company || '',
    insurance_company_other: v.insurance_company === 'אחר' ? (v.insurance_company_text || '') : '',
    current_km: v.current_km || '',
    current_engine_hours: v.current_engine_hours || '',
    vehicle_photo: v.vehicle_photo || '',
    last_tire_change_date: v.last_tire_change_date || '',
    km_since_tire_change: v.km_since_tire_change || '',
    fuel_type: v.fuel_type || '',
    is_vintage: v.is_vintage ?? isVintageVehicle(v.year),
    // Vessel safety equipment
    pyrotechnics_expiry_date: v.pyrotechnics_expiry_date || '',
    fire_extinguisher_expiry_date: v.fire_extinguisher_expiry_date || '',
    life_raft_expiry_date: v.life_raft_expiry_date || '',
    // Vessel engine + flag
    engine_manufacturer: v.engine_manufacturer || '',
    flag_country: v.flag_country || '',
    // Vessel shipyard
    last_shipyard_date: v.last_shipyard_date || '',
    hours_since_shipyard: v.hours_since_shipyard || '',
    // Off-road
    offroad_equipment: v.offroad_equipment || [],
    offroad_usage_type: v.offroad_usage_type || '',
    last_offroad_service_date: v.last_offroad_service_date || '',
  });

  useEffect(() => {
    async function load() {
      // Guest vehicle - load from local state
      if (isGuestVehicle) {
        const v = guestVehicles.find(v => v.id === vehicleId);
        if (v) {
          setForm(buildForm(v));
          setTireQuestion(v.last_tire_change_date ? 'yes' : null);
          setShipyardQuestion(v.last_shipyard_date ? 'yes' : null);
          setPhotoPreview(v.vehicle_photo || null);
        }
        setLoading(false);
        return;
      }

      const { data: { user: supaUser } } = await (await import('@/lib/supabase')).supabase.auth.getUser();
      if (!supaUser) { setLoading(false); return; }
      const members = await db.account_members.filter({ user_id: supaUser.id, status: 'פעיל' });
      const userAccountIds = members.map(m => m.account_id);

      let found = null;
      for (const aid of userAccountIds) {
        const results = await db.vehicles.filter({ id: vehicleId, account_id: aid });
        if (results.length > 0) { found = results[0]; break; }
      }
      if (found) {
        const v = found;
        setAccountId(v.account_id);

        // TODO: migrate VehicleType to Supabase
        if (v.vehicle_type) {
          setUsageMetric(v.vehicle_type === 'כלי שייט' ? 'שעות מנוע' : 'קילומטרים');
        }

        setForm(buildForm(v));
        setTireQuestion(v.last_tire_change_date ? 'yes' : null);
        setShipyardQuestion(v.last_shipyard_date ? 'yes' : null);
        setPhotoPreview(v.vehicle_photo || null);
      }
      setLoading(false);
    }
    load();
  }, [vehicleId, isGuestVehicle]);

  const handleChange = (field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'year') {
        next.is_vintage = isVintageVehicle(value);
      }
      return next;
    });
  };

  const handleVehicleTypeChange = (typeId, typeName, metric) => {
    setForm(prev => ({ ...prev, vehicle_type_id: typeId, vehicle_type: typeName }));
    setUsageMetric(metric);
  };

  const handleManufacturerChange = (manufacturerId, manufacturerName) => {
    setForm(prev => ({ ...prev, manufacturer_id: manufacturerId, manufacturer: manufacturerName }));
  };

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'photo', 5);
    if (!validation.ok) { alert(validation.error); e.target.value = ''; return; }
    setPhotoPreview(URL.createObjectURL(file));
    // TODO: migrate file upload to Supabase Storage
    toast.info('העלאת תמונות תתאפשר בקרוב');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    const data = {
      ...form,
      license_plate_normalized: normalizePlate(form.license_plate),
      year: form.year ? Number(form.year) : undefined,
      current_km: form.current_km ? Number(form.current_km) : undefined,
      current_engine_hours: form.current_engine_hours ? Number(form.current_engine_hours) : undefined,
      km_since_tire_change: form.km_since_tire_change ? Number(form.km_since_tire_change) : undefined,
      insurance_company: form.insurance_company === 'אחר' ? form.insurance_company_other : form.insurance_company,
    };
    delete data.insurance_company_other;
    if (tireQuestion !== 'yes') {
      data.last_tire_change_date = null;
      data.km_since_tire_change = null;
    }
    if (shipyardQuestion !== 'yes') {
      data.last_shipyard_date = null;
      data.hours_since_shipyard = null;
    }
    Object.keys(data).forEach(k => { if (data[k] === '' || data[k] === undefined) delete data[k]; });

    // Guest vehicle - save locally
    if (isGuestVehicle) {
      updateGuestVehicle(vehicleId, data);
      toast.success(vesselMode ? 'פרטי כלי השייט עודכנו בהצלחה' : 'פרטי הרכב עודכנו בהצלחה');
      navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`));
      return;
    }

    if (!accountId) { setSaving(false); return; }
    await db.vehicles.update(vehicleId, data);
    toast.success(vesselMode ? 'פרטי כלי השייט עודכנו בהצלחה' : 'פרטי הרכב עודכנו בהצלחה');
    navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`));
  };

  if (loading || !form) return <LoadingSpinner />;

  if (!isGuestRole && isViewOnly(role)) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-2xl p-6 max-w-sm" style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }}>
          <p className="font-bold text-lg mb-2" style={{ color: '#1E40AF' }}>אין לך הרשאה לערוך רכב</p>
          <p className="text-sm mb-4" style={{ color: '#1E40AF' }}>הצטרפת כחבר — תצוגה בלבד</p>
          <button onClick={() => navigate(-1)} className="px-6 py-2 rounded-xl font-bold text-sm text-white" style={{ background: '#2563EB' }}>חזרה</button>
        </div>
      </div>
    );
  }

  const T = getTheme(form.vehicle_type, form.nickname, form.manufacturer);
  const vesselMode = isVesselType(form.vehicle_type, form.nickname);
  const offroadMode = isOffroad(form.vehicle_type);
  const hasOffroadData = (form.offroad_equipment?.length > 0 || form.offroad_usage_type || form.last_offroad_service_date);

  const VehicleIcon = vesselMode ? Ship : Car;

  return (
    <div dir="rtl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Link to={createPageUrl(`VehicleDetail?id=${vehicleId}`)}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: T.light }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </Link>
          <h1 className="font-black text-xl" style={{ color: T.text }}>{vesselMode ? 'עריכת כלי שייט' : 'עריכת רכב'}</h1>
        </div>
      </div>

      {/* ── Nickname Card (green/marine) ── */}
      <div className="rounded-2xl p-4 mb-5 relative overflow-hidden" style={{ background: T.grad }}>
        <div className="absolute -top-6 -left-6 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.yellow }}>
            <VehicleIcon className="w-5 h-5" style={{ color: T.primary }} />
          </div>
          <div>
            <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>{vesselMode ? 'כינוי כלי השייט' : 'כינוי לרכב'}</p>
            <p className="text-white font-bold text-base">{form.nickname || (vesselMode ? 'היאכטה שלי' : 'הקורולה של אבא')}</p>
          </div>
          <button type="button" className="mr-auto" onClick={() => document.getElementById('edit-nickname')?.focus()}>
            <PenLine className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>
        <Input
          id="edit-nickname"
          value={form.nickname}
          onChange={e => handleChange('nickname', e.target.value)}
          placeholder={vesselMode ? 'למשל: "היאכטה של אבא"' : 'למשל: "הקורולה של אבא"'}
          className="!bg-white/10 !border-white/20 !text-white !placeholder:text-white/40 rounded-xl"
        />
      </div>

      {/* ── Photo ── */}
      <div className="flex justify-center mb-5">
        <div className="relative">
          <label className="cursor-pointer">
            <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            {photoPreview ? (
              <img src={photoPreview} alt="" className="w-24 h-24 rounded-2xl object-cover border-2 border-dashed" style={{ borderColor: T.border }} />
            ) : (
              <div className="w-24 h-24 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center transition-colors" style={{ borderColor: T.border, color: T.muted }}>
                <Camera className="h-5 w-5 mb-1" />
                <span className="text-xs">גלריה</span>
              </div>
            )}
          </label>
          <label className="absolute -bottom-2 -left-2 cursor-pointer text-white rounded-full p-2 shadow-md transition-colors" style={{ background: T.primary }} aria-label="צלם תמונה">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
            <Camera className="h-3.5 w-3.5" />
          </label>
        </div>
      </div>

      {/* ── Form ── */}
      <div className="p-4 sm:p-6 rounded-3xl" style={{ background: '#F5F1EB', border: `1px solid ${T.border}` }}>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* מספר רישוי — full width */}
          <div>
            <Label>{vesselMode ? 'מספר זיהוי כלי שייט *' : 'מספר רישוי *'}</Label>
            <Input value={form.license_plate} onChange={e => handleChange('license_plate', e.target.value)} required dir="ltr" placeholder={vesselMode ? 'IL-12345' : '00-000-00'} />
          </div>

          {/* יצרן + דגם — 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>יצרן</Label>
              <ManufacturerSelector value={form.manufacturer_id} onChange={handleManufacturerChange} accountId={accountId} />
            </div>
            <div>
              <Label>דגם</Label>
              <Input value={form.model} onChange={e => handleChange('model', e.target.value)} />
            </div>
          </div>

          {/* שנה + דלק — 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>שנת ייצור</Label>
              <Select value={form.year ? String(form.year) : ''} onValueChange={v => handleChange('year', v)}>
                <SelectTrigger><SelectValue placeholder="בחר שנה" /></SelectTrigger>
                <SelectContent className="max-h-60">
                  {Array.from({ length: new Date().getFullYear() - 1950 + 1 }, (_, i) => new Date().getFullYear() - i).map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>סוג דלק / הנעה</Label>
              <Select value={form.fuel_type} onValueChange={v => handleChange('fuel_type', v)}>
                <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
                <SelectContent>
                  {['בנזין', 'סולר', 'חשמלי', 'היברידי', 'גז'].map(f => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Engine manufacturer + flag — vessels */}
          {vesselMode && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>יצרן מנוע</Label>
                <Input value={form.engine_manufacturer} onChange={e => handleChange('engine_manufacturer', e.target.value)} placeholder="Yamaha, Mercury, Volvo" />
              </div>
              <div>
                <Label>דגל מדינה (רישום)</Label>
                <CountryFlagSelect value={form.flag_country} onChange={v => handleChange('flag_country', v)} />
              </div>
            </div>
          )}

          {/* טסט + ביטוח — 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{vesselMode ? 'תאריך כושר שייט' : 'תאריך טסט קרוב'}</Label>
              <DateInput value={form.test_due_date} onChange={e => handleChange('test_due_date', e.target.value)} />
            </div>
            <div>
              <Label>{vesselMode ? 'תוקף ביטוח ימי' : 'חידוש ביטוח קרוב'}</Label>
              <DateInput value={form.insurance_due_date} onChange={e => handleChange('insurance_due_date', e.target.value)} />
            </div>
          </div>

          {/* קילומטראז' / שעות מנוע */}
          <div>
            <Label>{vesselMode ? 'שעות מנוע' : 'קילומטראז׳ נוכחי'}</Label>
            <Input type="number" dir="ltr" placeholder="0"
              value={vesselMode ? form.current_engine_hours : form.current_km}
              onChange={e => handleChange(vesselMode ? 'current_engine_hours' : 'current_km', e.target.value)} />
          </div>

          {/* חברת ביטוח */}
          <div>
            <Label>חברת ביטוח</Label>
            <Select value={form.insurance_company} onValueChange={v => handleChange('insurance_company', v)}>
              <SelectTrigger><SelectValue placeholder="בחר חברה..." /></SelectTrigger>
              <SelectContent>
                {['ליברה','הפניקס','כלל','ישיר','מגדל','הראל','איילון','AIG','שומרה','אחר'].map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.insurance_company === 'אחר' && (
              <Input className="mt-2" placeholder="שם החברה" value={form.insurance_company_other} onChange={e => handleChange('insurance_company_other', e.target.value)} />
            )}
          </div>

          {/* Safety equipment — vessels only */}
          {vesselMode && (
            <div className="rounded-2xl p-4 space-y-3" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">⚓</span>
                <span className="font-bold text-sm" style={{ color: T.primary }}>בטיחות וציוד</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>תוקף פירוטכניקה</Label><DateInput value={form.pyrotechnics_expiry_date} onChange={e => handleChange('pyrotechnics_expiry_date', e.target.value)} /></div>
                <div><Label>תוקף מטף</Label><DateInput value={form.fire_extinguisher_expiry_date} onChange={e => handleChange('fire_extinguisher_expiry_date', e.target.value)} /></div>
                <div className="col-span-2"><Label>תוקף אסדת הצלה</Label><DateInput value={form.life_raft_expiry_date} onChange={e => handleChange('life_raft_expiry_date', e.target.value)} /></div>
              </div>
            </div>
          )}

          {/* Shipyard — vessels / Tires — cars */}
          {vesselMode ? (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.primary }}>
                  <span className="text-lg">🚢</span>
                </div>
                <div>
                  <p className="font-bold text-sm" style={{ color: T.text }}>טיפול מנוע</p>
                  <p className="text-xs" style={{ color: T.muted }}>האם כלי השייט עבר טיפול מנוע לאחרונה?</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShipyardQuestion('yes')}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: shipyardQuestion === 'yes' ? T.yellow : '#fff', color: shipyardQuestion === 'yes' ? T.primary : T.muted, border: `1.5px solid ${shipyardQuestion === 'yes' ? T.yellow : T.border}` }}>
                  כן
                </button>
                <button type="button" onClick={() => setShipyardQuestion('no')}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: shipyardQuestion === 'no' ? '#E5E7EB' : '#fff', color: shipyardQuestion === 'no' ? T.text : T.muted, border: `1.5px solid ${shipyardQuestion === 'no' ? '#D1D5DB' : T.border}` }}>
                  לא
                </button>
              </div>
              {shipyardQuestion === 'yes' && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div><Label>תאריך טיפול אחרון</Label><DateInput value={form.last_shipyard_date} onChange={e => handleChange('last_shipyard_date', e.target.value)} /></div>
                  <div><Label>שעות מנוע מאז</Label><Input type="number" dir="ltr" value={form.hours_since_shipyard} onChange={e => handleChange('hours_since_shipyard', e.target.value)} placeholder="0" /></div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl p-5 space-y-3" style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.primary }}>
                  <span className="text-lg">🔧</span>
                </div>
                <div>
                  <p className="font-bold text-sm" style={{ color: T.text }}>החלפת צמיגים לאחרונה?</p>
                  <p className="text-xs" style={{ color: T.muted }}>נעזור לך לעקוב אחר תקינותם</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setTireQuestion('yes')}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: tireQuestion === 'yes' ? T.yellow : '#fff', color: tireQuestion === 'yes' ? T.primary : T.muted, border: `1.5px solid ${tireQuestion === 'yes' ? T.yellow : T.border}` }}>
                  כן
                </button>
                <button type="button" onClick={() => setTireQuestion('no')}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: tireQuestion === 'no' ? '#E5E7EB' : '#fff', color: tireQuestion === 'no' ? T.text : T.muted, border: `1.5px solid ${tireQuestion === 'no' ? '#D1D5DB' : T.border}` }}>
                  לא
                </button>
              </div>
              {tireQuestion === 'yes' && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div><Label>תאריך החלפה</Label><DateInput value={form.last_tire_change_date} onChange={e => handleChange('last_tire_change_date', e.target.value)} /></div>
                  <div><Label>ק"מ מאז</Label><Input type="number" dir="ltr" value={form.km_since_tire_change} onChange={e => handleChange('km_since_tire_change', e.target.value)} placeholder="0" /></div>
                </div>
              )}
            </div>
          )}

          {/* ── Off-road equipment section ── */}
          {(offroadMode || hasOffroadData) && (
            <div className="border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">🏔️</span>
                <span className="font-semibold text-green-800 text-sm">ציוד ושימוש שטח</span>
              </div>
              <div>
                <Label className="text-right block mb-1.5 text-green-800">ציוד מותקן</Label>
                <div className="flex flex-wrap gap-2">
                  {OFFROAD_EQUIPMENT.map(eq => {
                    const selected = (form.offroad_equipment || []).includes(eq.key);
                    return (
                      <button key={eq.key} type="button"
                        onClick={() => {
                          const current = form.offroad_equipment || [];
                          const next = selected ? current.filter(k => k !== eq.key) : [...current, eq.key];
                          handleChange('offroad_equipment', next);
                        }}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                          selected ? 'bg-green-100 text-green-700 border-green-300' : 'bg-white text-gray-600 border-gray-200'
                        }`}>
                        {selected && '✓ '}{eq.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-right block mb-1.5 text-green-800">סוג שימוש</Label>
                <Select value={form.offroad_usage_type} onValueChange={v => handleChange('offroad_usage_type', v)}>
                  <SelectTrigger><SelectValue placeholder="בחר סוג שימוש..." /></SelectTrigger>
                  <SelectContent>
                    {OFFROAD_USAGE_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-right block mb-1.5 text-green-800">תאריך טיפול שטח אחרון</Label>
                <DateInput value={form.last_offroad_service_date}
                  onChange={e => handleChange('last_offroad_service_date', e.target.value)} />
              </div>
            </div>
          )}

          <button type="submit" disabled={saving}
            className="w-full h-14 rounded-2xl font-bold text-base transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: T.yellow, color: T.primary, boxShadow: `0 4px 16px ${T.yellow}50` }}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : offroadMode ? 'עדכן כלי שטח' : vesselMode ? 'עדכן כלי שייט' : 'עדכן רכב'}
          </button>
        </form>
      </div>
    </div>
  );
}