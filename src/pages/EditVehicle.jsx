import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { validateUploadFile } from '@/lib/securityUtils';
import { compressImage } from '@/lib/imageCompress';
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
import VehicleTypeSelector, { OFFROAD_EQUIPMENT, OFFROAD_USAGE_TYPES, MANUFACTURERS_BY_SUBCATEGORY } from "../components/vehicle/VehicleTypeSelector";
import ManufacturerSelector from "../components/vehicle/ManufacturerSelector";
import { trackUserAction } from "../components/shared/ReviewManager";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import { C, getTheme, isVesselType } from '@/lib/designTokens';
import useAccountRole from '@/hooks/useAccountRole';
import { isViewOnly } from '@/lib/permissions';
import CountryFlagSelect from '../components/vehicle/CountryFlagSelect';
import AiDateScan from '../components/shared/AiDateScan';

export default function EditVehicle() {
  const urlParams = new URLSearchParams(window.location.search);
  const vehicleId = urlParams.get('id');
  const highlightField = urlParams.get('field');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isGuest, guestVehicles, updateGuestVehicle } = useAuth();
  const { role, isGuest: isGuestRole } = useAccountRole();

  // Guard: no id → friendly fallback instead of loading a form with no target
  if (!vehicleId) {
    return (
      <div dir="rtl" className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="text-7xl mb-4" role="img" aria-hidden="true">✏️</div>
          <h1 className="text-xl font-black mb-2" style={{ color: '#1C2E20' }}>לא בחרנו רכב לעריכה</h1>
          <p className="text-sm mb-6" style={{ color: '#6B7280' }}>
            בחר רכב מהרשימה כדי לערוך אותו.
          </p>
          <button
            onClick={() => navigate('/Vehicles')}
            className="w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #2D5233 0%, #4B7A53 100%)', color: '#fff' }}>
            חזרה לרשימת הרכבים
          </button>
        </div>
      </div>
    );
  }
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [form, setForm] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [usageMetric, setUsageMetric] = useState('קילומטרים');
  const [tireQuestion, setTireQuestion] = useState(null);
  const [shipyardQuestion, setShipyardQuestion] = useState(null);

  // Security: only treat as a guest vehicle if the current user IS actually a guest.
  // An authenticated user crafting a URL with ?id=guest_xxx must NOT get guest-mode access -
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
    fire_extinguishers: v.fire_extinguishers || null,
    life_raft_expiry_date: v.life_raft_expiry_date || '',
    // Vessel engine + flag
    engine_manufacturer: v.engine_manufacturer || '',
    flag_country: v.flag_country || '',
    marina: v.marina || '',
    marina_abroad: v.marina_abroad || false,
    // Vessel shipyard
    last_shipyard_date: v.last_shipyard_date || '',
    hours_since_shipyard: v.hours_since_shipyard || '',
    // Off-road
    offroad_equipment: v.offroad_equipment || [],
    offroad_usage_type: v.offroad_usage_type || '',
    last_offroad_service_date: v.last_offroad_service_date || '',
    // Technical spec (from gov API)
    model_code: v.model_code || '',
    trim_level: v.trim_level || '',
    vin: v.vin || '',
    pollution_group: v.pollution_group || '',
    vehicle_class: v.vehicle_class || '',
    safety_rating: v.safety_rating || '',
    horsepower: v.horsepower || '',
    engine_cc: v.engine_cc || '',
    drivetrain: v.drivetrain || '',
    total_weight: v.total_weight || '',
    doors: v.doors || '',
    seats: v.seats || '',
    airbags: v.airbags || '',
    transmission: v.transmission || '',
    body_type: v.body_type || '',
    country_of_origin: v.country_of_origin || '',
    co2: v.co2 || '',
    green_index: v.green_index || '',
    tow_capacity: v.tow_capacity || '',
  });

  useEffect(() => {
    async function load() {
      try {
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
      } catch (err) {
        console.error('EditVehicle load error:', err);
        toast.error('שגיאה בטעינת פרטי הרכב');
        setLoading(false);
      }
    }
    load();
  }, [vehicleId, isGuestVehicle]);

  // Scroll to & highlight the target field when navigated with ?field=xxx
  useEffect(() => {
    if (!highlightField || !form || loading) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-field="${highlightField}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('field-highlight');
      setTimeout(() => el.classList.remove('field-highlight'), 2500);
    }, 400);
    return () => clearTimeout(timer);
  }, [highlightField, form, loading]);

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
    const validation = validateUploadFile(file, 'photo', 10);
    if (!validation.ok) { toast.error(validation.error); e.target.value = ''; return; }
    try {
      // Shared compressor — WebP when supported, JPEG fallback. Keeps the
      // final data URL small so the row fits comfortably.
      const small = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.75 });
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = (ev) => resolve(ev.target.result);
        r.onerror = reject;
        r.readAsDataURL(small);
      });
      setPhotoPreview(base64);
      handleChange('vehicle_photo', base64);
      toast.success('התמונה נטענה');
    } catch (err) {
      console.error('Photo load error:', err);
      toast.error('שגיאה בטעינת התמונה');
    }
    e.target.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Compute vesselMode locally (same as render-level computation)
    const vesselMode = isVesselType(form.vehicle_type, form.nickname);

    // Check for duplicate license plate (excluding self). Skip the check if
    // the plate is empty — also skip for vessels (letter-based IDs get
    // stripped to nothing by normalizePlate and would falsely match any car).
    const normalizedNew = normalizePlate(form.license_plate);
    if (normalizedNew && accountId && !isGuest) {
      try {
        const allVehicles = await db.vehicles.filter({ account_id: accountId });
        const duplicate = allVehicles.find(v =>
          v.id !== vehicleId &&
          normalizePlate(v.license_plate_normalized || v.license_plate || '') === normalizedNew
        );
        if (duplicate) {
          const dupName = duplicate.nickname || duplicate.license_plate || 'רכב אחר';
          toast.error(`מספר הרישוי כבר קיים ב"${dupName}" — אי אפשר להזין פעמיים`);
          setSaving(false);
          return;
        }
      } catch (dupErr) {
        console.warn('Duplicate plate check failed:', dupErr?.message);
      }
    }

    setSaving(true);

    // Only send columns that exist in Supabase
    const DB_COLUMNS = ['vehicle_type','manufacturer','model','year',
      'nickname','license_plate','test_due_date','insurance_due_date','insurance_company',
      'current_km','current_engine_hours','vehicle_photo','fuel_type',
      'last_tire_change_date','km_since_tire_change',
      'flag_country','marina','marina_abroad','engine_manufacturer',
      'pyrotechnics_expiry_date','fire_extinguisher_expiry_date','fire_extinguishers',
      'life_raft_expiry_date','last_shipyard_date','hours_since_shipyard',
      'front_tire','rear_tire','engine_model','color','last_test_date','first_registration_date','ownership',
      'model_code','trim_level','vin','pollution_group','vehicle_class','safety_rating',
      'horsepower','engine_cc','drivetrain','total_weight','doors','seats','airbags',
      'transmission','body_type','country_of_origin','co2','green_index','tow_capacity',
      'offroad_equipment','offroad_usage_type','last_offroad_service_date'];

    const data = {};
    DB_COLUMNS.forEach(k => { if (form[k] !== undefined && form[k] !== null) data[k] = form[k]; });
    // Type conversions
    if (form.year) {
      const yearNum = Number(form.year);
      if (isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 2) {
        toast.error('שנת ייצור לא תקינה');
        setSaving(false);
        return;
      }
      data.year = yearNum;
    }
    if (form.current_km) data.current_km = Number(form.current_km);
    if (form.current_engine_hours) data.current_engine_hours = Number(form.current_engine_hours);
    if (form.km_since_tire_change) data.km_since_tire_change = Number(form.km_since_tire_change);
    if (form.insurance_company === 'אחר') data.insurance_company = form.insurance_company_other;
    // Remove empty strings
    Object.keys(data).forEach(k => { if (data[k] === '') delete data[k]; });
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
      navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`), { replace: true });
      return;
    }

    if (!accountId) { setSaving(false); return; }
    try {
      await db.vehicles.update(vehicleId, data);
      // Invalidate all cached reads of this vehicle + the vehicles list so the
      // detail page + dashboard reflect the new marine insurance / engine
      // hours / any other edited field immediately instead of showing stale
      // cached data. Without this, users see "I saved but it didn't update".
      await queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(vesselMode ? 'פרטי כלי השייט עודכנו בהצלחה' : 'פרטי הרכב עודכנו בהצלחה');
      navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`), { replace: true });
    } catch (firstErr) {
      console.error('Vehicle update error (full):', firstErr);
      // Retry: save core fields first, then spec fields one by one
      try {
        const CORE = ['vehicle_type','manufacturer','model','year','nickname','license_plate',
          'test_due_date','insurance_due_date','insurance_company','current_km','current_engine_hours',
          'vehicle_photo','fuel_type','is_vintage','last_tire_change_date','km_since_tire_change',
          'flag_country','marina','marina_abroad','engine_manufacturer',
          'pyrotechnics_expiry_date','fire_extinguisher_expiry_date','fire_extinguishers',
          'life_raft_expiry_date','last_shipyard_date','hours_since_shipyard',
          'front_tire','rear_tire','engine_model','color','last_test_date','first_registration_date','ownership',
          'offroad_equipment','offroad_usage_type','last_offroad_service_date'];
        const coreData = {};
        CORE.forEach(k => { if (data[k] !== undefined) coreData[k] = data[k]; });
        await db.vehicles.update(vehicleId, coreData);
        // Try spec fields one by one (columns may not exist yet) - collect failures
        const specKeys = Object.keys(data).filter(k => !CORE.includes(k));
        const failedFields = [];
        for (const k of specKeys) {
          try { await db.vehicles.update(vehicleId, { [k]: data[k] }); }
          catch (e) { failedFields.push(k); console.warn(`Spec field "${k}" save failed:`, e?.message); }
        }
        if (failedFields.length > 0 && failedFields.length < specKeys.length) {
          // Some spec fields failed but core saved - partial success
          toast.warning('הפרטים העיקריים נשמרו, אך חלק מהמפרט הטכני לא נשמר');
        } else {
          toast.success(vesselMode ? 'פרטי כלי השייט עודכנו בהצלחה' : 'פרטי הרכב עודכנו בהצלחה');
        }
        // Same cache invalidation as the happy path above
        await queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
        await queryClient.invalidateQueries({ queryKey: ['vehicles'] });
        await queryClient.invalidateQueries({ queryKey: ['documents'] });
        navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`), { replace: true });
      } catch (retryErr) {
        console.error('Vehicle update error (retry):', retryErr);
        const msg = retryErr?.message || retryErr?.error_description || '';
        if (msg.includes('too large') || msg.includes('payload')) {
          toast.error('התמונה גדולה מדי. נסה תמונה קטנה יותר.');
        } else if (msg.includes('permission') || msg.includes('policy')) {
          toast.error('אין לך הרשאה לעדכן רכב זה');
        } else {
          toast.error(`שגיאה בעדכון: ${msg.slice(0, 80) || 'נסה שוב בעוד רגע'}`);
        }
        setSaving(false);
      }
    }
  };

  if (loading || !form) return <LoadingSpinner />;

  if (!isGuestRole && isViewOnly(role)) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-2xl p-6 max-w-sm" style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }}>
          <p className="font-bold text-lg mb-2" style={{ color: '#1E40AF' }}>אין לך הרשאה לערוך רכב</p>
          <p className="text-sm mb-4" style={{ color: '#1E40AF' }}>הצטרפת כחבר, תצוגה בלבד</p>
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
      {/* ── Hero Header ── */}
      <div className="rounded-3xl p-4 pb-5 mb-5 relative overflow-hidden"
        style={{ background: T.grad || C.grad, boxShadow: `0 8px 32px ${T.primary}30` }}>
        <div className="absolute -top-12 -left-12 w-40 h-40 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }} />
        <div className="absolute -bottom-6 -right-6 w-28 h-28 rounded-full" style={{ background: 'rgba(255,191,0,0.15)' }} />
        <div className="absolute top-8 right-1/3 w-2 h-2 rounded-full bg-white/25 animate-pulse" />
        <div className="absolute top-14 right-1/4 w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,191,0,0.5)' }} />
        <div className="relative z-10 flex items-center gap-3">
          <button onClick={() => navigate(createPageUrl(`VehicleDetail?id=${vehicleId}`), { replace: true })}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-black text-white">{vesselMode ? 'עריכת כלי שייט' : 'עריכת רכב'}</h1>
            <p className="text-[11px] font-medium truncate" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {form.nickname || [form.manufacturer, form.model].filter(Boolean).join(' ') || 'עדכון פרטים'}
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: '#FFBF00', boxShadow: '0 4px 16px rgba(255,191,0,0.45)' }}>
            <PenLine className="w-5 h-5" style={{ color: T.primary }} />
          </div>
        </div>
      </div>

      {/* Sync button removed — data is fetched once on AddVehicle */}

      {/* ── Photo ── */}
      <div className="flex flex-col items-center gap-2.5 mb-6">
        {photoPreview ? (
          <img src={photoPreview} alt="" className="w-28 h-28 rounded-2xl object-cover"
            style={{ border: `2.5px solid ${T.primary}30`, boxShadow: `0 4px 20px ${T.primary}15` }} />
        ) : (
          <div className="w-28 h-28 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5"
            style={{ borderColor: T.border, background: `${T.primary}06` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.primary }}>
              <Camera className="h-5 w-5 text-white" />
            </div>
            <span className="text-[11px] font-bold" style={{ color: T.primary }}>תמונת רכב</span>
          </div>
        )}
        <div className="flex gap-2">
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
            style={{ background: T.primary, color: '#fff' }}>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
            <Camera className="h-3.5 w-3.5" /> צלם
          </label>
          <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
            style={{ background: '#F3F4F6', color: T.primary, border: `1px solid ${T.border}` }}>
            <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            📁 גלריה
          </label>
        </div>
      </div>

      {/* ── Form ── */}
      <div className="p-4 sm:p-6 rounded-3xl" style={{ background: '#FAFAF8', border: `1.5px solid ${T.border || '#E8E0D4'}`, boxShadow: '0 2px 16px rgba(0,0,0,0.04)' }}>
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* כינוי */}
          <div data-field="nickname" className="rounded-xl p-1 -m-1 transition-all">
            <Label>{vesselMode ? 'כינוי כלי השייט' : 'כינוי לרכב'}</Label>
            <Input value={form.nickname} onChange={e => handleChange('nickname', e.target.value)}
              placeholder={vesselMode ? 'למשל: היאכטה שלי' : 'למשל: הקורולה של אבא'} />
          </div>

          {/* מספר רישוי - full width */}
          <div data-field="license_plate" className="rounded-xl p-1 -m-1 transition-all">
            <Label>{vesselMode ? 'מספר זיהוי כלי שייט *' : 'מספר רישוי *'}</Label>
            <Input value={form.license_plate} onChange={e => handleChange('license_plate', e.target.value)} required dir="ltr" placeholder={vesselMode ? 'IL-12345' : '00-000-00'} />
          </div>

          {/* יצרן + דגם - 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div data-field="manufacturer" className="rounded-xl p-1 -m-1 transition-all">
              <Label>יצרן</Label>
              <ManufacturerSelector
                value={form.manufacturer_id}
                selectedName={form.manufacturer}
                onChange={handleManufacturerChange}
                accountId={accountId}
                quickManufacturers={MANUFACTURERS_BY_SUBCATEGORY[form.vehicle_type] || null}
              />
            </div>
            <div data-field="model" className="rounded-xl p-1 -m-1 transition-all">
              <Label>דגם</Label>
              <Input value={form.model} onChange={e => handleChange('model', e.target.value)} />
            </div>
          </div>

          {/* שנה + דלק/יצרן מנוע - 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div data-field="year" className="rounded-xl p-1 -m-1 transition-all">
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
              {vesselMode ? (
                <>
                  <Label>יצרן מנוע</Label>
                  <Select value={form.engine_manufacturer} onValueChange={v => handleChange('engine_manufacturer', v)}>
                    <SelectTrigger><SelectValue placeholder="בחר יצרן..." /></SelectTrigger>
                    <SelectContent>
                      {['Yamaha', 'Mercury', 'Volvo Penta', 'Yanmar', 'Honda Marine', 'Suzuki Marine', 'Tohatsu', 'Evinrude', 'Mercruiser', 'Cummins', 'Caterpillar', 'Nanni', 'Vetus', 'אחר'].map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <>
                  <Label>סוג דלק / הנעה</Label>
                  <Select value={form.fuel_type} onValueChange={v => handleChange('fuel_type', v)}>
                    <SelectTrigger><SelectValue placeholder="בחר" /></SelectTrigger>
                    <SelectContent>
                      {['בנזין', 'סולר', 'חשמלי', 'היברידי', 'גז'].map(f => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          </div>

          {/* טסט + ביטוח - 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div data-field="test_due_date" className="rounded-xl p-1 -m-1 transition-all">
              <Label>{vesselMode ? 'כושר שייט' : 'תאריך טסט'}</Label>
              <DateInput value={form.test_due_date} onChange={e => handleChange('test_due_date', e.target.value)} />
            </div>
            <div data-field="insurance_due_date" className="rounded-xl p-1 -m-1 transition-all">
              <Label>{vesselMode ? 'תוקף ביטוח ימי' : 'חידוש ביטוח'}</Label>
              <DateInput value={form.insurance_due_date} onChange={e => handleChange('insurance_due_date', e.target.value)} />
            </div>
          </div>

          {/* ק"מ/שעות + חברת ביטוח - 2 columns */}
          <div className="grid grid-cols-2 gap-3">
            <div data-field={vesselMode || usageMetric === 'שעות מנוע' ? 'current_engine_hours' : 'current_km'} className="rounded-xl p-1 -m-1 transition-all">
              <div className="flex items-center justify-between mb-1">
                <Label className="mb-0">{vesselMode || usageMetric === 'שעות מנוע' ? 'שעות מנוע' : 'קילומטראז׳'}</Label>
                {offroadMode && (
                  <button type="button"
                    onClick={() => setUsageMetric(m => m === 'קילומטרים' ? 'שעות מנוע' : 'קילומטרים')}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full transition-all active:scale-95"
                    style={{ background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0' }}>
                    {usageMetric === 'קילומטרים' ? 'עבור לשעות מנוע' : 'עבור לק"מ'}
                  </button>
                )}
              </div>
              <Input type="number" dir="ltr" placeholder="0"
                value={vesselMode || usageMetric === 'שעות מנוע' ? form.current_engine_hours : form.current_km}
                onChange={e => handleChange(vesselMode || usageMetric === 'שעות מנוע' ? 'current_engine_hours' : 'current_km', e.target.value)} />
            </div>
            <div>
              <Label>{vesselMode ? 'חברת ביטוח ימי' : 'חברת ביטוח'}</Label>
              <Select value={form.insurance_company} onValueChange={v => handleChange('insurance_company', v)}>
                <SelectTrigger><SelectValue placeholder="בחר חברה..." /></SelectTrigger>
                <SelectContent>
                  {(vesselMode
                    ? ['הכשרה','כלל','הפניקס','הראל','איילון','מגדל','שירביט','AIG','אחר']
                    : ['הפניקס','כלל','ישיר','מגדל','הראל','איילון','ליברה','AIG','שומרה','הכשרה','מנורה מבטחים','שירביט','אחר']
                  ).map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.insurance_company === 'אחר' && (
                <Input className="mt-2" placeholder="שם החברה" value={form.insurance_company_other} onChange={e => handleChange('insurance_company_other', e.target.value)} />
              )}
            </div>
          </div>

          {/* דגל + מרינה - vessels only */}
          {vesselMode && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>דגל מדינה</Label>
                <CountryFlagSelect value={form.flag_country} onChange={v => handleChange('flag_country', v)} />
              </div>
              <div>
                <Label>מרינת עגינה</Label>
                {!form.marina_abroad ? (
                  <Select value={form.marina} onValueChange={v => {
                    if (v === '__abroad') { handleChange('marina', ''); handleChange('marina_abroad', true); }
                    else { handleChange('marina', v); handleChange('marina_abroad', false); }
                  }}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="בחר מרינה..." /></SelectTrigger>
                    <SelectContent dir="rtl">
                      {['מרינה הרצליה','מרינה אשקלון','מרינה אשדוד','מרינה יפו','מרינה עתלית','מרינה חיפה','מרינה עכו','מרינה אילת','מרינה קיסריה','מרינה נתניה'].map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                      <SelectItem value="__abroad">🌍 מרינה בחו"ל...</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="space-y-1.5">
                    <Input placeholder="שם המרינה בחו״ל..." value={form.marina} onChange={e => handleChange('marina', e.target.value)} className="h-11" />
                    <button type="button" onClick={() => { handleChange('marina', ''); handleChange('marina_abroad', false); }}
                      className="text-[10px] font-bold underline text-gray-400">
                      חזרה לרשימת מרינות בישראל
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Safety equipment - vessels only */}
          {vesselMode && (
            <div className="border border-cyan-200 bg-cyan-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">⚓</span>
                <span className="font-semibold text-cyan-800 text-sm">בטיחות וציוד</span>
                <span className="text-xs text-cyan-600 font-normal">(אופציונלי)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div data-field="pyrotechnics_expiry_date" className="rounded-xl p-1 -m-1 transition-all">
                  <Label className="text-cyan-900 text-xs font-semibold">🔴 תוקף ציוד פירוטכניקה</Label>
                  <DateInput value={form.pyrotechnics_expiry_date} onChange={e => handleChange('pyrotechnics_expiry_date', e.target.value)} className="mt-1 bg-white border-cyan-200" />
                  <AiDateScan onDateExtracted={d => handleChange('pyrotechnics_expiry_date', d)} label="📷 סרוק תוקף" />
                </div>
                <div data-field="fire_extinguisher_expiry_date" className="col-span-1 sm:col-span-2 rounded-xl p-1 -m-1 transition-all">
                  <Label className="text-cyan-900 text-xs font-semibold">🧯 מטפי כיבוי</Label>
                  {(form.fire_extinguishers || [{ date: form.fire_extinguisher_expiry_date || '' }]).map((ext, i) => (
                    <div key={i} className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] font-bold text-cyan-700 shrink-0">מטף {i + 1}</span>
                      <DateInput
                        value={ext.date || ''}
                        onChange={e => {
                          const list = [...(form.fire_extinguishers || [{ date: form.fire_extinguisher_expiry_date || '' }])];
                          list[i] = { ...list[i], date: e.target.value };
                          handleChange('fire_extinguishers', list);
                          if (i === 0) handleChange('fire_extinguisher_expiry_date', e.target.value);
                        }}
                        className="bg-white border-cyan-200 flex-1"
                      />
                      {i > 0 && (
                        <button type="button" onClick={() => {
                          const list = [...(form.fire_extinguishers || [])];
                          list.splice(i, 1);
                          handleChange('fire_extinguishers', list);
                        }} className="text-red-400 text-xs font-bold px-1">✕</button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-3 mt-2">
                    <button type="button" onClick={() => {
                      const list = [...(form.fire_extinguishers || [{ date: form.fire_extinguisher_expiry_date || '' }])];
                      list.push({ date: '' });
                      handleChange('fire_extinguishers', list);
                    }} className="text-[11px] font-bold text-cyan-700 flex items-center gap-1">
                      + הוסף מטף נוסף
                    </button>
                    <AiDateScan onDateExtracted={d => {
                      const list = [...(form.fire_extinguishers || [{ date: form.fire_extinguisher_expiry_date || '' }])];
                      const emptyIdx = list.findIndex(e => !e.date);
                      if (emptyIdx >= 0) { list[emptyIdx] = { date: d }; }
                      else { list.push({ date: d }); }
                      handleChange('fire_extinguishers', list);
                      if (list[0]?.date) handleChange('fire_extinguisher_expiry_date', list[0].date);
                    }} label="📷 סרוק תוקף מטף" />
                  </div>
                </div>
                <div data-field="life_raft_expiry_date" className="rounded-xl p-1 -m-1 transition-all">
                  <Label className="text-cyan-900 text-xs font-semibold">🛟 תוקף אסדת הצלה</Label>
                  <DateInput value={form.life_raft_expiry_date} onChange={e => handleChange('life_raft_expiry_date', e.target.value)} className="mt-1 bg-white border-cyan-200" />
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-cyan-600 mt-0.5">תוקף ל-3 שנים ממועד הרכישה</p>
                    <AiDateScan onDateExtracted={d => handleChange('life_raft_expiry_date', d)} label="📷 סרוק תוקף" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shipyard - vessels / Tires - cars */}
          {vesselMode ? (
            <div className="border border-cyan-200 rounded-xl p-4 space-y-3 bg-cyan-50">
              <p className="font-medium text-cyan-800">🚢 האם כלי השייט היה במספנה לאחרונה?</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShipyardQuestion('yes')}
                  className={`px-5 py-2 rounded-lg text-sm font-medium border transition-all ${shipyardQuestion === 'yes' ? 'bg-cyan-100 text-cyan-700 border-cyan-300' : 'bg-white text-gray-600 border-gray-200'}`}>
                  כן
                </button>
                <button type="button" onClick={() => setShipyardQuestion('no')}
                  className={`px-5 py-2 rounded-lg text-sm font-medium border transition-all ${shipyardQuestion === 'no' ? 'bg-gray-200 text-gray-700 border-gray-300' : 'bg-white text-gray-600 border-gray-200'}`}>
                  לא
                </button>
              </div>
              {shipyardQuestion === 'yes' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div><Label>מתי הייתה הביקור האחרון במספנה?</Label><DateInput value={form.last_shipyard_date} onChange={e => handleChange('last_shipyard_date', e.target.value)} /></div>
                  <div><Label>כמה שעות מנוע מאז? (אופציונלי)</Label><Input type="number" dir="ltr" value={form.hours_since_shipyard} onChange={e => handleChange('hours_since_shipyard', e.target.value)} placeholder="שעות מנוע" /></div>
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
                  <div><Label>ק"מ בעת ההחלפה</Label><Input type="number" dir="ltr" value={form.km_since_tire_change} onChange={e => handleChange('km_since_tire_change', e.target.value)} placeholder="0" /></div>
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
            className="w-full h-14 rounded-2xl font-black text-base transition-all active:scale-[0.96] flex items-center justify-center gap-2.5 disabled:opacity-50"
            style={{ background: T.grad || T.primary, color: '#fff', boxShadow: `0 6px 24px ${T.primary}35` }}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            {saving ? 'שומר...' : offroadMode ? 'עדכן כלי שטח' : vesselMode ? 'עדכן כלי שייט' : 'שמור שינויים'}
          </button>
        </form>
      </div>
    </div>
  );
}