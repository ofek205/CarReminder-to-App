import React, { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/supabaseEntities';
import { validateUploadFile } from '@/lib/securityUtils';
import { useNavigate, Link } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectWithClear } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Camera, Loader2, FileText, PenLine, Search, CheckCircle2, AlertCircle, X, PartyPopper, Check, Plus, ChevronLeft, Car } from "lucide-react";
import { lookupVehicleByPlate } from "../services/vehicleLookup";
import PageHeader from "../components/shared/PageHeader";
import { normalizePlate, isVintageVehicle, isVessel, getVehicleLabels } from "../components/shared/DateStatusUtils";
import { cn } from "@/lib/utils";
import VehicleTypeSelector, { VEHICLE_CATEGORIES, SPECIAL_SUBCATEGORIES, MOTO_SUBCATEGORIES, BOAT_SUBCATEGORIES, OFFROAD_SUBCATEGORIES, OFFROAD_EQUIPMENT, OFFROAD_USAGE_TYPES, MANUFACTURERS_BY_SUBCATEGORY } from "../components/vehicle/VehicleTypeSelector";
import ManufacturerSelector from "../components/vehicle/ManufacturerSelector";
import { trackUserAction } from "../components/shared/ReviewManager";
import VehicleScanWizard from "../components/vehicle/VehicleScanWizard";
import VesselScanWizard from "../components/vehicle/VesselScanWizard";
import { toast } from "sonner";
import { useAuth } from "../components/shared/GuestContext";
import { C as defaultC, getTheme } from '@/lib/designTokens';
import SignUpPromptDialog from "../components/shared/SignUpPromptDialog";
import { useQueryClient } from '@tanstack/react-query';
import useAccountRole from '@/hooks/useAccountRole';
import { isViewOnly } from '@/lib/permissions';
import CountryFlagSelect from '../components/vehicle/CountryFlagSelect';

const EMPTY_FORM = {
  vehicle_type_id: '',
  vehicle_type: 'רכב',
  manufacturer_id: '',
  manufacturer: '',
  model: '',
  year: '',
  nickname: '',
  license_plate: '',
  test_due_date: '',
  insurance_due_date: '',
  insurance_company: '',
  insurance_company_other: '',
  current_km: '',
  current_engine_hours: '',
  vehicle_photo: '',
  last_tire_change_date: '',
  km_since_tire_change: '',
  fuel_type: '',
  is_vintage: false,
  // Vessel safety equipment
  pyrotechnics_expiry_date: '',
  fire_extinguisher_expiry_date: '',
  life_raft_expiry_date: '',
  // Vessel engine
  engine_manufacturer: '',
  // Vessel flag country
  flag_country: '',
  // Vessel shipyard
  last_shipyard_date: '',
  hours_since_shipyard: '',
  // Off-road
  offroad_equipment: [],
  offroad_usage_type: '',
  last_offroad_service_date: '',
};

// Autofill visual helper - renders "מולא אוטומטית" hint if field was autofilled
function AutofillHint({ name, autofillFields }) {
  if (!autofillFields.has(name)) return null;
  return (
    <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
      <CheckCircle2 className="h-3 w-3 shrink-0" />
      מולא אוטומטית (ניתן לערוך)
    </p>
  );
}

// Returns extra className for autofilled inputs
function autofillCls(name, autofillFields) {
  return autofillFields.has(name) ? 'bg-[#E8F8F0] border-green-300 focus:border-green-500' : '';
}

export default function AddVehicle() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, isGuest, user, addGuestVehicle, guestVehicles } = useAuth();
  const { role, isGuest: isGuestRole } = useAccountRole();
  const [saving, setSaving] = useState(false);
  const [accountId, setAccountId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [showScanWizard, setShowScanWizard] = useState(false);
  const [showVesselScanWizard, setShowVesselScanWizard] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showGuestSignup, setShowGuestSignup] = useState(false);
  const [existingVehicles, setExistingVehicles] = useState([]);
  const [duplicateVehicle, setDuplicateVehicle] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [usageMetric, setUsageMetric] = useState('קילומטרים');
  const [tireQuestion, setTireQuestion] = useState(null);
  const [shipyardQuestion, setShipyardQuestion] = useState(null);
  const [plateQuery, setPlateQuery] = useState('');
  const [lookupStatus, setLookupStatus] = useState('idle');
  const [selectedCategory, setSelectedCategory] = useState(null);    // one of VEHICLE_CATEGORIES
  const [selectedSubcategory, setSelectedSubcategory] = useState(null); // one of SPECIAL_SUBCATEGORIES
  const [customSubcategories, setCustomSubcategories] = useState({}); // { categoryLabel: [{label,dbName,usageMetric}] }
  const [showAddSub, setShowAddSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [selectedMethod, setSelectedMethod] = useState(null); // null | 'plate' | 'scan' | 'manual'
  const [autofillFields, setAutofillFields] = useState(new Set());
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const formRef = useRef(null);

  // Dynamic theme — switches to marine when כלי שייט is selected
  const isVesselCategory = selectedCategory?.label === 'כלי שייט';
  const isOffroadCategory = selectedCategory?.label === 'כלי שטח';
  const isJeepOffroad = selectedSubcategory?.dbName === "ג'יפ שטח";
  const [showOffroadSection, setShowOffroadSection] = useState(false);
  const T = isVesselCategory ? getTheme('כלי שייט') : defaultC;

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    async function init() {
      setUserId(user.id);
      try {
        const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
        if (members.length > 0) {
          setAccountId(members[0].account_id);
          const vs = await db.vehicles.filter({ account_id: members[0].account_id });
          setExistingVehicles(vs);
        } else {
          console.warn('AddVehicle: No active account_members found for user', user.id);
        }
      } catch (err) {
        console.error('AddVehicle: Failed to load account info', err);
      }
    }
    init();
  }, [isAuthenticated, user]);

  const resetAll = () => {
    setForm({ ...EMPTY_FORM });
    setAutofillFields(new Set());
    setLookupStatus('idle');
    setPlateQuery('');
    setTireQuestion(null);
    setShipyardQuestion(null);
    setPhotoPreview(null);
    setUsageMetric('קילומטרים');
    setSelectedCategory(null);
    setSelectedSubcategory(null);
  };

  const selectMethod = (method) => {
    if (selectedMethod === method) return;
    // Save category/subcategory before resetAll wipes them
    const cat = selectedCategory;
    const sub = selectedSubcategory;
    resetAll();
    setSelectedMethod(method);
    // Restore — category selection must survive method switch
    setSelectedCategory(cat);
    setSelectedSubcategory(sub);
    if (cat) setUsageMetric(sub?.usageMetric ?? cat.usageMetric);
    if (method === 'scan') {
      if (cat?.label === 'כלי שייט') {
        setShowVesselScanWizard(true);
      } else {
        setShowScanWizard(true);
      }
    } else {
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
  };

  const handleChange = (field, value) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Auto-detect vintage when year changes
      if (field === 'year') {
        next.is_vintage = isVintageVehicle(value);
      }
      return next;
    });
  };

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'photo', 5);
    if (!validation.ok) { alert(validation.error); e.target.value = ''; return; }
    setPhotoPreview(URL.createObjectURL(file));
    // TODO: migrate file upload to Supabase Storage
    toast.info('העלאת תמונות תתאפשר בקרוב');
    // handleChange('vehicle_photo', file_url);
  };

  const handleVehicleTypeChange = (typeId, typeName, metric) => {
    setForm(prev => ({ ...prev, vehicle_type_id: typeId, vehicle_type: typeName }));
    setUsageMetric(metric);
  };

  const handleManufacturerChange = (manufacturerId, manufacturerName) => {
    setForm(prev => ({ ...prev, manufacturer_id: manufacturerId, manufacturer: manufacturerName }));
  };

  // Called when VesselScanWizard returns extracted vessel fields
  const handleVesselScanExtracted = (fields) => {
    // Map vessel schema → form fields
    const updates = {
      license_plate:     fields.registration_number || '',   // vessel reg number goes to license_plate
      test_due_date:     fields.valid_until          || '',   // כושר שייט expiry
      nickname:          fields.vessel_name          || '',   // vessel name as nickname
      manufacturer:      fields.engine_details       || '',   // engine details → manufacturer field
      vehicle_type:      fields.vessel_type          || '',   // vessel type/category
    };

    // Only set fields that have actual values
    const filled = new Set(
      Object.entries(updates)
        .filter(([, v]) => v !== '')
        .map(([k]) => k)
    );

    setForm(prev => ({ ...prev, ...updates }));
    setAutofillFields(filled);
    setSelectedMethod('scan');

    // Store the scanned file URL for document creation on save
    if (fields._fileUrl) {
      setForm(prev => ({ ...prev, _vesselLicenseFileUrl: fields._fileUrl }));
    }

    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  // Called when VehicleScanWizard returns extracted fields
  const handleScanExtracted = (fields) => {
    const updates = {
      license_plate: fields.license_plate || '',
      manufacturer: fields.manufacturer || '',
      model: fields.model || '',
      year: fields.year || '',
      test_due_date: fields.test_due_date || '',
      vehicle_type: fields.vehicle_type || 'רכב',
      fuel_type: fields.fuel_type || '',
      is_vintage: isVintageVehicle(fields.year),
    };
    setForm(prev => ({ ...prev, ...updates }));
    const filled = new Set(Object.entries(updates).filter(([k, v]) => v && k !== 'is_vintage').map(([k]) => k));
    setAutofillFields(filled);
    setSelectedMethod('scan');
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  };

  const handleLookup = async () => {
    if (!plateQuery.trim()) return;
    setLookupStatus('loading');
    try {
      const fields = await lookupVehicleByPlate(plateQuery.trim());
      if (!fields) { setLookupStatus('not_found'); return; }
      const updates = {
        license_plate: fields.license_plate || '',
        manufacturer: fields.manufacturer || '',
        model: fields.model || '',
        year: fields.year || '',
        test_due_date: fields.test_due_date || '',
        fuel_type: fields.fuel_type || '',
        is_vintage: isVintageVehicle(fields.year),
      };
      setForm(prev => ({ ...prev, ...updates }));
      const filled = new Set(Object.entries(updates).filter(([k, v]) => v && k !== 'is_vintage').map(([k]) => k));
      setAutofillFields(filled);
      setLookupStatus('found');
      setSelectedMethod('plate');
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    } catch (_) {
      setLookupStatus('error');
    }
  };

  const handleSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();

    // vehicle_type is required by the backend — guard before saving
    if (!form.vehicle_type || form.vehicle_type.trim() === '') {
      alert('יש לבחור סוג כלי רכב לפני השמירה');
      return;
    }

    // Check for duplicate license plate
    if (form.license_plate) {
      const normalizedNew = normalizePlate(form.license_plate);
      const vehicles = isGuest ? guestVehicles : existingVehicles;
      const duplicate = vehicles.find(v =>
        (v.license_plate_normalized || normalizePlate(v.license_plate || '')) === normalizedNew
      );
      if (duplicate) {
        setDuplicateVehicle(duplicate);
        alert('רכב עם מספר רישוי זה כבר קיים במערכת');
        return;
      }
    }

    setSaving(true);

    const data = {
      ...form,
      license_plate_normalized: normalizePlate(form.license_plate),
      year: form.year ? Number(form.year) : undefined,
      current_km: form.current_km ? Number(form.current_km) : undefined,
      // km_baseline is set once at creation — used as the counting floor for service alerts
      // when no maintenance log exists yet (prevents counting from 0 on first add).
      km_baseline: form.current_km ? Number(form.current_km) : undefined,
      current_engine_hours: form.current_engine_hours ? Number(form.current_engine_hours) : undefined,
      engine_hours_baseline: form.current_engine_hours ? Number(form.current_engine_hours) : undefined,
      km_since_tire_change: form.km_since_tire_change ? Number(form.km_since_tire_change) : undefined,
      insurance_company: form.insurance_company === 'אחר' ? form.insurance_company_other : form.insurance_company,
    };
    delete data.insurance_company_other;
    if (tireQuestion !== 'yes') {
      delete data.last_tire_change_date;
      delete data.km_since_tire_change;
    }
    if (shipyardQuestion !== 'yes') {
      delete data.last_shipyard_date;
      delete data.hours_since_shipyard;
    }
    // Clean offroad fields if not applicable
    if (!isOffroadCategory && !(isJeepOffroad && showOffroadSection)) {
      delete data.offroad_equipment;
      delete data.offroad_usage_type;
      delete data.last_offroad_service_date;
    }
    if (data.offroad_equipment && data.offroad_equipment.length === 0) delete data.offroad_equipment;
    // _vesselLicenseFileUrl is internal — don't persist to DB
    const vesselLicenseFileUrl = data._vesselLicenseFileUrl;
    delete data._vesselLicenseFileUrl;
    Object.keys(data).forEach(k => { if (data[k] === '' || data[k] === undefined) delete data[k]; });

    if (isGuest) {
      // Block save — force registration
      setSaving(false);
      setShowGuestSignup(true);
      return;
    }

    try {
      if (!accountId) {
        alert('שגיאה: חשבון לא נמצא. נסה להתנתק ולהתחבר מחדש.');
        setSaving(false);
        return;
      }

      // Only keep known DB columns — strip everything else
      const DB_COLUMNS = ['account_id','vehicle_type_id','vehicle_type','manufacturer_id','manufacturer','model','year',
        'nickname','license_plate','license_plate_normalized','test_due_date','insurance_due_date','insurance_company',
        'current_km','current_engine_hours','km_baseline','engine_hours_baseline','vehicle_photo','fuel_type','is_vintage',
        'last_tire_change_date','km_since_tire_change',
        'flag_country','engine_manufacturer','pyrotechnics_expiry_date','fire_extinguisher_expiry_date',
        'life_raft_expiry_date','last_shipyard_date','hours_since_shipyard',
        'offroad_equipment','offroad_usage_type','last_offroad_service_date'];
      const cleanData = { account_id: accountId };
      DB_COLUMNS.forEach(k => { if (data[k] !== undefined && data[k] !== null && data[k] !== '') cleanData[k] = data[k]; });

      let savedVehicle;
      try {
        savedVehicle = await db.vehicles.create(cleanData);
      } catch (firstErr) {
        // Retry with even fewer fields
        const MINIMAL = ['account_id','vehicle_type','manufacturer','model','year','nickname','license_plate','license_plate_normalized'];
        const minData = {};
        MINIMAL.forEach(k => { if (cleanData[k] !== undefined) minData[k] = cleanData[k]; });
        savedVehicle = await db.vehicles.create(minData);
      }
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });

      try { if (user) await trackUserAction(user.id); } catch {}
      setSaving(false);
      setShowSuccess(true);
    } catch (err) {
      console.error('Vehicle save error:', err);
      const msg = err?.message || JSON.stringify(err) || 'שגיאה לא ידועה';
      alert('שגיאה בשמירת הרכב:\n' + msg);
      setSaving(false);
    }
  };

  const handleAddAnother = () => {
    setShowSuccess(false);
    resetAll(); // also resets selectedCategory
    setSelectedMethod(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isSelected = (method) => selectedMethod === method;
  // If category has subcategories, require one to be selected before showing step 2+
  const categoryReady = selectedCategory !== null &&
    (!selectedCategory.hasSubcategories || selectedSubcategory !== null);
  const formVisible = categoryReady && selectedMethod !== null;

  // Quick manufacturer list based on selected sub-category or category
  const quickManufacturers = selectedSubcategory
    ? (MANUFACTURERS_BY_SUBCATEGORY[selectedSubcategory.dbName] ?? null)
    : selectedCategory?.label === 'משאיות'
      ? MANUFACTURERS_BY_SUBCATEGORY['משאית']
      : null; // cars → use full DB-backed popover

  if (!isGuestRole && isViewOnly(role)) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-2xl p-6 max-w-sm" style={{ background: '#DBEAFE', border: '1px solid #93C5FD' }}>
          <p className="font-bold text-lg mb-2" style={{ color: '#1E40AF' }}>אין לך הרשאה להוסיף רכב</p>
          <p className="text-sm mb-4" style={{ color: '#1E40AF' }}>הצטרפת כחבר — תצוגה בלבד</p>
          <button onClick={() => navigate(-1)} className="px-6 py-2 rounded-xl font-bold text-sm text-white" style={{ background: '#2563EB' }}>חזרה</button>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl">
      <SignUpPromptDialog
        open={showSignUp}
        onClose={() => setShowSignUp(false)}
        reason="הירשם כדי לשמור רכבים לצמיתות ולגשת אליהם מכל מכשיר"
      />

      <VehicleScanWizard
        open={showScanWizard}
        onClose={() => {
          setShowScanWizard(false);
          if (selectedMethod === 'scan') setSelectedMethod(null);
        }}
        vehicles={existingVehicles}
        accountId={accountId}
        userId={userId}
        onUpdateVehicle={() => {}}
        onExtracted={handleScanExtracted}
      />

      <VesselScanWizard
        open={showVesselScanWizard}
        onClose={() => {
          setShowVesselScanWizard(false);
          if (selectedMethod === 'scan') setSelectedMethod(null);
        }}
        accountId={accountId}
        userId={userId}
        onExtracted={handleVesselScanExtracted}
      />

      {/* Duplicate plate dialog */}
      {duplicateVehicle && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
              <AlertCircle className="h-7 w-7 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">רכב קיים במערכת</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              רכב עם מספר הרישוי{' '}
              <span className="font-semibold text-gray-800" dir="ltr">{form.license_plate}</span>{' '}
              כבר קיים במערכת.
              האם ברצונך לעדכן את פרטיו?
            </p>
            <div className="space-y-2 pt-1">
              <Button
                onClick={() => {
                  setDuplicateVehicle(null);
                  navigate(createPageUrl('EditVehicle') + '?id=' + duplicateVehicle.id);
                }}
                className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white h-11"
              >
                כן, עדכן פרטים
              </Button>
              <Button
                onClick={() => setDuplicateVehicle(null)}
                variant="outline"
                className="w-full h-11 border-gray-200"
              >
                ביטול
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center space-y-4 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <PartyPopper className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">הרכב נוסף בהצלחה! 🎉</h2>
            <p className="text-gray-500 text-sm leading-relaxed">
              {form?.nickname || [form?.manufacturer, form?.model].filter(Boolean).join(' ') || 'הרכב החדש'} נוסף למערכת ועכשיו אפשר לעקוב אחרי טיפולים, טסטים וביטוחים
            </p>
            {isGuest && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                הירשם בחינם כדי לשמור את הרכב לצמיתות ולגשת אליו מכל מכשיר
              </p>
            )}
            <div className="space-y-2 pt-2">
              <Button
                onClick={() => navigate(createPageUrl('Dashboard'))}
                className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white h-11"
              >
                עבור למסך הבית שלי
              </Button>
              <Button
                onClick={handleAddAnother}
                variant="outline"
                className="w-full h-11 border-gray-200"
              >
                הוסף רכב נוסף
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Guest signup prompt — must register to save */}
      {showGuestSignup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-white rounded-3xl p-6 max-w-xs w-full text-center shadow-2xl space-y-4">
            <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center" style={{ background: '#FFF8E1' }}>
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className="text-lg font-black text-gray-900">הירשם כדי לשמור</h2>
            <p className="text-sm" style={{ color: '#6B7280' }}>
              הרשמה בחינם תוך שניות — ותוכל לשמור רכבים, לקבל תזכורות ולגשת מכל מכשיר
            </p>
            <Button
              onClick={() => { window.location.href = '/Auth'; }}
              className="w-full h-12 text-white rounded-2xl font-bold text-sm"
              style={{ background: C.yellow, color: C.greenDark }}
            >
              הירשם בחינם
            </Button>
            <button
              onClick={() => setShowGuestSignup(false)}
              className="w-full text-xs py-1 font-medium"
              style={{ color: '#D1D5DB' }}
            >
              חזרה
            </button>
          </div>
        </div>
      )}

      {/* ─── Premium Header ─── */}
      <div className="flex items-center justify-between mb-2" dir="rtl">
        <div className="flex items-center gap-3">
          <Link to={createPageUrl('Dashboard')}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: T.light }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </Link>
          <h1 className="font-black text-xl" style={{ color: T.text }}>סוג רכב</h1>
        </div>
        <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: T.grad, color: '#fff' }}>
          שלב 1 מתוך 3
        </span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#E8E0D4' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: !categoryReady ? '33%' : formVisible ? '100%' : '66%', background: T.yellow }} />
      </div>

      {/* ─── Step 1: Vehicle type ─── */}
      <div className="mb-6">
        <h2 className="font-black text-lg mb-3 text-center" style={{ color: '#1C2E20' }}>בחר סוג כלי רכב</h2>
        <VehicleTypeSelector
          variant="tabs"
          value={form.vehicle_type_id}
          onChange={handleVehicleTypeChange}
          accountId={accountId}
          selectedCategory={selectedCategory}
          onSelectCategory={(cat) => {
            setSelectedCategory(cat);
            setSelectedSubcategory(null);
            setShowAddSub(false);
            setNewSubName('');
            setUsageMetric(cat.usageMetric);
            // reset method if not allowed for this category
            if (selectedMethod && !cat.methods.includes(selectedMethod)) {
              setSelectedMethod(null);
            }
          }}
        />
        {!selectedCategory && (
          <p className="text-xs mt-2" style={{ color: T.muted }}>← בחר סוג כלי רכב כדי להמשיך</p>
        )}
        {/* Sub-category picker */}
        {selectedCategory?.hasSubcategories && (
          <div className="mt-4 rounded-2xl border-2 p-4 transition-all duration-300"
            style={{
              borderColor: !selectedSubcategory ? T.yellow : T.accent,
              background: !selectedSubcategory ? T.yellowSoft : T.light,
            }}>
            <div className="flex items-center gap-2 mb-3" dir="rtl">
              <div className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold shrink-0 transition-colors"
                style={{ background: !selectedSubcategory ? T.yellow : T.accent }}>
                {selectedSubcategory
                  ? <Check className="h-3 w-3" />
                  : '!'}
              </div>
              <span className="text-sm font-bold" style={{ color: T.text }}>
                בחר תת-קטגוריה
                {!selectedSubcategory && <span style={{ color: T.yellow }} className="mr-0.5">*</span>}
              </span>
              {!selectedSubcategory && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ color: T.primary, background: T.light, border: `1px solid ${T.border}` }}>
                  נדרש להמשך
                </span>
              )}
              {selectedSubcategory && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ color: T.primary, background: T.light, border: `1px solid ${T.border}` }}>
                  {selectedSubcategory.label} ✓
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ...(selectedCategory.label === 'אופנועים'
                  ? MOTO_SUBCATEGORIES
                  : selectedCategory.label === 'כלי שייט'
                    ? BOAT_SUBCATEGORIES
                    : selectedCategory.label === 'כלי שטח'
                      ? OFFROAD_SUBCATEGORIES
                      : SPECIAL_SUBCATEGORIES),
                ...(customSubcategories[selectedCategory.label] || []),
              ].map(sub => {
                const active = selectedSubcategory?.label === sub.label;
                return (
                  <button
                    key={sub.label}
                    type="button"
                    onClick={() => {
                      setSelectedSubcategory(sub);
                      setUsageMetric(sub.usageMetric);
                      handleVehicleTypeChange('', sub.dbName, sub.usageMetric);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all duration-150 active:scale-95"
                    style={active
                      ? { background: T.primary, borderColor: T.primary, color: '#fff', boxShadow: `0 2px 8px ${T.primary}30` }
                      : { background: '#fff', borderColor: '#D1D5DB', color: '#374151' }
                    }
                  >
                    {active && <Check className="h-3 w-3 shrink-0" />}
                    {sub.label}
                  </button>
                );
              })}

              {/* Add custom chip */}
              {showAddSub ? (
                <div className="flex items-center gap-1.5 bg-white border-2 border-[#2D5233] rounded-full px-2 py-0.5">
                  <input
                    autoFocus
                    value={newSubName}
                    onChange={e => setNewSubName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (!newSubName.trim()) return;
                        const newSub = { label: newSubName.trim(), dbName: newSubName.trim(), usageMetric: 'קילומטרים' };
                        setCustomSubcategories(prev => ({
                          ...prev,
                          [selectedCategory.label]: [...(prev[selectedCategory.label] || []), newSub],
                        }));
                        setSelectedSubcategory(newSub);
                        handleVehicleTypeChange('', newSub.dbName, newSub.usageMetric);
                        setNewSubName('');
                        setShowAddSub(false);
                      }
                      if (e.key === 'Escape') { setShowAddSub(false); setNewSubName(''); }
                    }}
                    placeholder="שם..."
                    className="text-sm w-24 outline-none bg-transparent text-[#2D5233] placeholder:text-[#2D5233]/40"
                  />
                  <button
                    type="button"
                    disabled={!newSubName.trim()}
                    onClick={() => {
                      if (!newSubName.trim()) return;
                      const newSub = { label: newSubName.trim(), dbName: newSubName.trim(), usageMetric: 'קילומטרים' };
                      setCustomSubcategories(prev => ({
                        ...prev,
                        [selectedCategory.label]: [...(prev[selectedCategory.label] || []), newSub],
                      }));
                      setSelectedSubcategory(newSub);
                      handleVehicleTypeChange('', newSub.dbName, newSub.usageMetric);
                      setNewSubName('');
                      setShowAddSub(false);
                    }}
                    className="text-[#2D5233] hover:text-[#1E3D24] disabled:opacity-30 font-bold text-xs"
                  >
                    ✓
                  </button>
                  <button type="button" onClick={() => { setShowAddSub(false); setNewSubName(''); }}
                    className="text-gray-400 hover:text-gray-600 text-xs">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddSub(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-gray-300 text-xs text-gray-500 hover:border-[#4B7A53] hover:text-[#4B7A53] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  הוסף
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Step 2: Method selection ─── */}
      <div className={`transition-all duration-300 ${categoryReady ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
      <h2 className="font-black text-lg mb-3 text-center" style={{ color: '#1C2E20' }}>איך תרצה להוסיף את הרכב?</h2>
      <div className="space-y-3 mb-6">

        {/* 1. Plate lookup — only if category supports it */}
        {selectedCategory?.methods.includes('plate') && (
        <div
          className={`rounded-2xl border-2 bg-white p-4 transition-all duration-200 ${isSelected('plate') ? 'border-[#003DA5] shadow-md' : 'border-gray-200 hover:border-blue-300 cursor-pointer'}`}
          onClick={() => !isSelected('plate') && setSelectedMethod('plate')}
        >
          {/* Compact header - same layout as cards 2 & 3 */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100">
              <Search className="h-5 w-5 text-[#003DA5]" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">🔍 חיפוש לפי מספר רכב</p>
              <p className="text-xs text-gray-500">ממלא את הפרטים אוטומטית</p>
            </div>
          </div>

          {/* Plate input - only shown when this card is selected */}
          {isSelected('plate') && (
            <div className="mt-4">
              <div className="flex gap-2 items-stretch">
                <div className="relative flex-1">
                  <div className="absolute right-0 top-0 bottom-0 w-9 rounded-r-lg bg-[#003DA5] flex flex-col items-center justify-center gap-0.5 pointer-events-none z-10">
                    <span className="text-white text-[8px] font-bold leading-none tracking-wider">IL</span>
                    <svg viewBox="0 0 60 40" className="w-5 h-3 mt-0.5">
                      <rect width="60" height="40" fill="white"/>
                      <rect y="4" width="60" height="5" fill="#003DA5"/>
                      <rect y="31" width="60" height="5" fill="#003DA5"/>
                      <polygon points="30,10 34.5,21 25.5,21" fill="none" stroke="#003DA5" strokeWidth="2"/>
                      <polygon points="30,26 25.5,15 34.5,15" fill="none" stroke="#003DA5" strokeWidth="2"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    dir="ltr"
                    value={plateQuery}
                    onChange={e => { setPlateQuery(e.target.value); setLookupStatus('idle'); }}
                    onKeyDown={e => e.key === 'Enter' && handleLookup()}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                    placeholder="12-345-67"
                    className="w-full h-12 pr-11 pl-3 text-center text-xl font-bold tracking-widest bg-[#FFD600] border-2 border-yellow-400 rounded-lg focus:outline-none focus:border-[#003DA5] placeholder:text-yellow-700/50"
                  />
                </div>
                <Button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleLookup(); }}
                  disabled={lookupStatus === 'loading' || !plateQuery.trim()}
                  className="bg-[#003DA5] hover:bg-[#002d7a] text-white h-12 px-4 gap-2 shrink-0"
                >
                  {lookupStatus === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  מצא רכב
                </Button>
              </div>
              <p className="text-[11px] text-gray-400 mt-2">הנתונים מגיעים ישירות ממשרד התחבורה</p>

              {lookupStatus === 'found' && (
                <div className="mt-2 flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  הפרטים מולאו אוטומטית - תוכל לערוך לפני השמירה
                </div>
              )}
              {lookupStatus === 'not_found' && (
                <div className="mt-2 flex items-center gap-2 text-sm text-amber-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  לא נמצאו נתונים לרכב הזה - ניתן למלא ידנית
                </div>
              )}
              {lookupStatus === 'error' && (
                <div className="mt-2 flex items-center gap-2 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  אירעה שגיאה בשליפת הנתונים, ניתן להזין ידנית
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* 2. AI scan */}
        {selectedCategory?.methods.includes('scan') && (
        <div
          className={`rounded-2xl border-2 bg-white p-4 transition-all duration-200 cursor-pointer ${isSelected('scan') ? 'border-amber-400 shadow-md' : 'border-gray-200 hover:border-amber-300'}`}
          onClick={() => selectMethod('scan')}
          dir="rtl"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
              style={{ background: '#FEF3C7', borderColor: '#FDE68A' }}>
              <FileText className="h-5 w-5" style={{ color: '#D97706' }} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-800 text-sm flex items-center gap-1.5">
                📷 סריקת רישיון רכב
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#FFBF00', color: '#2D5233' }}>AI</span>
              </p>
              <p className="text-xs text-gray-500">מילוי אוטומטי של הפרטים</p>
            </div>
            <ChevronLeft className="w-5 h-5 shrink-0 text-gray-400" />
          </div>
        </div>
        )}

        {/* 3. Manual */}
        <div
          className={`rounded-2xl border-2 bg-white p-4 transition-all duration-200 cursor-pointer ${isSelected('manual') ? 'border-gray-400 shadow-md' : 'border-gray-200 hover:border-gray-300'}`}
          onClick={() => selectMethod('manual')}
          dir="rtl"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 border border-gray-200">
              <PenLine className="h-5 w-5 text-gray-500" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-800 text-sm">✏️ הוספה ידנית</p>
              <p className="text-xs text-gray-500">הזנת פרטים באופן עצמאי</p>
            </div>
            <ChevronLeft className="w-5 h-5 shrink-0 text-gray-400" />
          </div>
        </div>
      </div>
      </div>{/* end step-2 wrapper */}

      {/* ─── Vehicle form (revealed after method selection) ─── */}
      <div
        ref={formRef}
        className={`transition-all duration-400 ${formVisible ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-4'}`}
        style={{ transitionProperty: 'opacity, transform' }}
      >
        {formVisible && (
          <>
            {/* Step header — premium */}
            <div className="flex items-center justify-between mb-1" dir="rtl">
              <h2 className="font-black text-xl" style={{ color: T.text }}>פרטי הרכב</h2>
              <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ background: T.grad, color: '#fff' }}>
                שלב 2 מתוך 3
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-1.5 rounded-full mb-5" style={{ background: '#E8E0D4' }}>
              <div className="h-full rounded-full" style={{ width: '66%', background: T.yellow }} />
            </div>
            <div className="flex items-center justify-between mb-4" dir="rtl">
              <p className="text-sm font-medium" style={{ color: '#7A8A7C' }}>
                {selectedMethod === 'plate' && 'מילוי לפי מספר רכב'}
                {selectedMethod === 'scan' && 'מילוי לפי סריקה'}
                {selectedMethod === 'manual' && 'הוספה ידנית'}
                {autofillFields.size > 0 && <span className="mr-2" style={{ color: '#3A7D44' }}>· {autofillFields.size} שדות מולאו</span>}
              </p>
              <button
                type="button"
                onClick={() => { resetAll(); setSelectedMethod(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="text-xs flex items-center gap-1 font-bold" style={{ color: '#7A8A7C' }}
              >
                <X className="h-3 w-3" />
                שנה שיטה
              </button>
            </div>

            <div className="p-4 sm:p-6 rounded-3xl" style={{ background: '#F5F1EB', border: '1px solid #E8E0D4' }}>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Photo */}
                <div className="flex justify-center">
                  <div className="relative">
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                      {photoPreview ? (
                        <img src={photoPreview} alt="" className="w-28 h-28 rounded-2xl object-cover border-2 border-dashed border-gray-200" />
                      ) : (
                        <div className="w-28 h-28 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 hover:border-[#4B7A53] transition-all duration-200">
                          <Camera className="h-6 w-6 mb-1" />
                          <span className="text-xs">גלריה</span>
                        </div>
                      )}
                    </label>
                    {/* Camera capture badge */}
                    <label className="absolute -bottom-2 -left-2 cursor-pointer bg-[#2D5233] text-white rounded-full p-2.5 shadow-md hover:bg-[#1E3D24] transition-colors" aria-label="צלם תמונה">
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                      <Camera className="h-3.5 w-3.5" />
                    </label>
                  </div>
                </div>

                {/* ── Nickname card (green) ── */}
                <div className="rounded-2xl p-4 mb-4 relative overflow-hidden"
                  style={{ background: T.grad }}>
                  <div className="absolute -top-6 -left-6 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  <div className="flex items-center gap-3 mb-3" dir="rtl">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.yellow }}>
                      <Car className="w-5 h-5" style={{ color: T.primary }} />
                    </div>
                    <div>
                      <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>כינוי לרכב</p>
                      <p className="text-white font-bold text-base">{form.nickname || 'הקורולה של אבא'}</p>
                    </div>
                    <button type="button" className="mr-auto" onClick={() => document.getElementById('nickname-input')?.focus()}>
                      <PenLine className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
                    </button>
                  </div>
                  <Input
                    id="nickname-input"
                    value={form.nickname}
                    onChange={e => handleChange('nickname', e.target.value)}
                    onClear={() => handleChange('nickname', '')}
                    placeholder='למשל: "הקורולה של אבא"'
                    className="!bg-white/10 !border-white/20 !text-white !placeholder:text-white/40 rounded-xl"
                  />
                </div>

                {/* ── Form fields ── */}
                <div className="space-y-4" dir="rtl">
                  {/* מספר רישוי + דגל (vessels) */}
                  <div className={isVesselCategory ? 'grid grid-cols-2 gap-3' : ''}>
                    <div>
                      <Label>{isVesselCategory ? 'מספר זיהוי *' : 'מספר רישוי *'}</Label>
                      <Input
                        value={form.license_plate}
                        onChange={e => handleChange('license_plate', e.target.value)}
                        onClear={() => handleChange('license_plate', '')}
                        dir="ltr" placeholder={isVesselCategory ? 'IL-12345' : '00-000-00'}
                        className={autofillCls('license_plate', autofillFields)}
                      />
                      <AutofillHint name="license_plate" autofillFields={autofillFields} />
                    </div>
                    {isVesselCategory && (
                      <div>
                        <Label>דגל מדינה</Label>
                        <CountryFlagSelect
                          value={form.flag_country}
                          onChange={v => handleChange('flag_country', v)}
                        />
                      </div>
                    )}
                  </div>

                  {/* יצרן + דגם — 2 columns */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>יצרן</Label>
                      {form.manufacturer && !form.manufacturer_id && !quickManufacturers ? (
                        <>
                          <div className="flex gap-2">
                            <Input
                              value={form.manufacturer}
                              onChange={e => handleChange('manufacturer', e.target.value)}
                              className={`flex-1 ${autofillCls('manufacturer', autofillFields)}`}
                            />
                            <Button
                              type="button" variant="outline" size="sm" className="shrink-0 text-xs"
                              onClick={() => { handleChange('manufacturer', ''); setAutofillFields(prev => { const s = new Set(prev); s.delete('manufacturer'); return s; }); }}
                            >שנה</Button>
                          </div>
                          <AutofillHint name="manufacturer" autofillFields={autofillFields} />
                        </>
                      ) : (
                        <ManufacturerSelector
                          value={form.manufacturer_id}
                          selectedName={form.manufacturer}
                          onChange={handleManufacturerChange}
                          accountId={accountId}
                          quickManufacturers={quickManufacturers}
                        />
                      )}
                    </div>
                    <div>
                      <Label>דגם</Label>
                      <Input
                        value={form.model}
                        onChange={e => handleChange('model', e.target.value)}
                        onClear={() => handleChange('model', '')}
                        className={autofillCls('model', autofillFields)}
                      />
                      <AutofillHint name="model" autofillFields={autofillFields} />
                    </div>
                  </div>

                  {/* Engine manufacturer — vessels only */}
                  {selectedCategory?.label === 'כלי שייט' && (
                    <div>
                      <Label>יצרן מנוע</Label>
                      <Input
                        value={form.engine_manufacturer}
                        onChange={e => handleChange('engine_manufacturer', e.target.value)}
                        placeholder="לדוגמה: Yamaha, Mercury, Volvo"
                      />
                    </div>
                  )}

                  {/* שנת ייצור + סוג דלק — 2 columns */}
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>שנת ייצור</Label>
                    <SelectWithClear
                      value={form.year ? String(form.year) : ''}
                      onValueChange={v => handleChange('year', v)}
                      onClear={() => handleChange('year', '')}
                      placeholder="בחר שנה"
                      triggerClassName={autofillCls('year', autofillFields)}
                    >
                      <SelectContent className="max-h-60">
                        {Array.from(
                          { length: new Date().getFullYear() - 1950 + 1 },
                          (_, i) => new Date().getFullYear() - i
                        ).map(y => (
                          <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </SelectWithClear>
                    <AutofillHint name="year" autofillFields={autofillFields} />
                    {form.is_vintage && !isVessel(form.vehicle_type) && (
                      <p className="text-xs text-purple-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        רכב אספנות - זוהה אוטומטית (טסט כל חצי שנה)
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>סוג דלק / הנעה</Label>
                    <SelectWithClear
                      value={form.fuel_type}
                      onValueChange={v => handleChange('fuel_type', v)}
                      onClear={() => handleChange('fuel_type', '')}
                      placeholder="בחר סוג דלק"
                      triggerClassName={autofillCls('fuel_type', autofillFields)}
                    >
                      <SelectContent>
                        {['בנזין', 'סולר', 'חשמלי', 'היברידי', 'גז'].map(f => (
                          <SelectItem key={f} value={f}>{f}</SelectItem>
                        ))}
                      </SelectContent>
                    </SelectWithClear>
                    <AutofillHint name="fuel_type" autofillFields={autofillFields} />
                  </div>
                  </div>{/* end grid שנה+דלק */}

                  {/* תאריך טסט + ביטוח — 2 columns */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{selectedCategory?.label === 'כלי שייט' ? 'תאריך כושר שייט' : 'תאריך טסט קרוב'}</Label>
                      <DateInput
                        value={form.test_due_date}
                        onChange={e => handleChange('test_due_date', e.target.value)}
                        className={autofillCls('test_due_date', autofillFields)}
                      />
                      <AutofillHint name="test_due_date" autofillFields={autofillFields} />
                    </div>
                    <div>
                      <Label>חידוש ביטוח קרוב</Label>
                      <DateInput
                        value={form.insurance_due_date}
                        onChange={e => handleChange('insurance_due_date', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* קילומטראז' */}
                  {usageMetric === 'קילומטרים' && (
                    <div>
                      <Label>קילומטראז׳ נוכחי</Label>
                      <Input type="number" value={form.current_km} onChange={e => handleChange('current_km', e.target.value)} placeholder="0" dir="ltr" />
                    </div>
                  )}
                  {usageMetric === 'שעות מנוע' && (
                    <div>
                      <Label>שעות מנוע</Label>
                      <Input type="number" value={form.current_engine_hours} onChange={e => handleChange('current_engine_hours', e.target.value)} placeholder="0" dir="ltr" />
                    </div>
                  )}

                  {/* חברת ביטוח */}
                  <div>
                    <Label>חברת ביטוח</Label>
                    <SelectWithClear
                      value={form.insurance_company}
                      onValueChange={v => handleChange('insurance_company', v)}
                      onClear={() => handleChange('insurance_company', '')}
                      placeholder="בחר חברה..."
                    >
                      <SelectContent>
                        {['ליברה', 'הפניקס', 'כלל', 'ישיר', 'מגדל', 'הראל', 'איילון', 'AIG', 'שומרה', 'אחר'].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </SelectWithClear>
                    {form.insurance_company === 'אחר' && (
                      <Input className="mt-2" placeholder="שם החברה" value={form.insurance_company_other} onChange={e => handleChange('insurance_company_other', e.target.value)} />
                    )}
                  </div>

                  {/* Safety Equipment — vessels only */}
                  {selectedCategory?.label === 'כלי שייט' && (
                    <div>
                      <div className="border border-cyan-200 bg-cyan-50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base">⚓</span>
                          <span className="font-semibold text-cyan-800 text-sm">בטיחות וציוד</span>
                          <span className="text-xs text-cyan-600 font-normal">(אופציונלי)</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label className="text-cyan-900 text-xs font-semibold">🔴 תוקף ציוד פירוטכניקה</Label>
                            <DateInput value={form.pyrotechnics_expiry_date} onChange={e => handleChange('pyrotechnics_expiry_date', e.target.value)} className="mt-1 bg-white border-cyan-200" />
                          </div>
                          <div>
                            <Label className="text-cyan-900 text-xs font-semibold">🧯 תוקף מטף</Label>
                            <DateInput value={form.fire_extinguisher_expiry_date} onChange={e => handleChange('fire_extinguisher_expiry_date', e.target.value)} className="mt-1 bg-white border-cyan-200" />
                          </div>
                          <div>
                            <Label className="text-cyan-900 text-xs font-semibold">🛟 תוקף אסדת הצלה</Label>
                            <DateInput value={form.life_raft_expiry_date} onChange={e => handleChange('life_raft_expiry_date', e.target.value)} className="mt-1 bg-white border-cyan-200" />
                            <p className="text-xs text-cyan-600 mt-0.5">תוקף ל-3 שנים ממועד הרכישה</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Tire question */}
                {selectedCategory?.label !== 'כלי שייט' && (
                  <div className="rounded-2xl p-5 space-y-3"
                    style={{ background: T.light, border: `1.5px solid ${T.border}` }}>
                    <div className="flex items-center gap-3" dir="rtl">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.primary }}>
                        <span style={{ fontSize: '18px', filter: 'grayscale(0)' }}>🔧</span>
                      </div>
                      <div>
                        <p className="font-bold text-sm" style={{ color: '#1C2E20' }}>החלפת צמיגים לאחרונה?</p>
                        <p className="text-xs" style={{ color: '#7A8A7C' }}>נעזור לך לעקוב אחר תקינותם</p>
                      </div>
                    </div>
                    <div className="flex gap-3" dir="rtl">
                      <button type="button" onClick={() => setTireQuestion('yes')}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                        style={{ background: tireQuestion === 'yes' ? T.yellow : '#fff', color: tireQuestion === 'yes' ? T.primary : '#7A8A7C', border: '1.5px solid ' + (tireQuestion === 'yes' ? T.yellow : T.border) }}>
                        כן
                      </button>
                      <button type="button" onClick={() => setTireQuestion('no')}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold transition-all"
                        style={{ background: tireQuestion === 'no' ? '#E5E7EB' : '#fff', color: tireQuestion === 'no' ? '#1C2E20' : '#7A8A7C', border: '1.5px solid ' + (tireQuestion === 'no' ? '#D1D5DB' : '#D8E5D9') }}>
                        לא
                      </button>
                    </div>
                    {tireQuestion === 'yes' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div>
                          <Label>מתי בוצעה ההחלפה האחרונה?</Label>
                          <DateInput value={form.last_tire_change_date} onChange={e => handleChange('last_tire_change_date', e.target.value)} />
                        </div>
                        <div>
                          <Label>כמה ק"מ נסעת מאז? (אופציונלי)</Label>
                          <Input type="number" value={form.km_since_tire_change} onChange={e => handleChange('km_since_tire_change', e.target.value)} placeholder="ק״מ" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Shipyard question — vessels only */}
                {selectedCategory?.label === 'כלי שייט' && (
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
                        <div>
                          <Label>מתי הייתה הביקור האחרון במספנה?</Label>
                          <DateInput value={form.last_shipyard_date} onChange={e => handleChange('last_shipyard_date', e.target.value)} />
                        </div>
                        <div>
                          <Label>כמה שעות מנוע מאז? (אופציונלי)</Label>
                          <Input
                            type="number"
                            value={form.hours_since_shipyard}
                            onChange={e => handleChange('hours_since_shipyard', e.target.value)}
                            placeholder="שעות מנוע"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Off-road equipment section ── */}
                {(isOffroadCategory || isJeepOffroad) && (
                  <div className="border border-green-200 bg-green-50 rounded-xl p-4 space-y-3">
                    {isJeepOffroad ? (
                      /* Jeep gets a checkbox to opt into off-road fields */
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={showOffroadSection}
                          onChange={e => setShowOffroadSection(e.target.checked)}
                          className="w-5 h-5 rounded border-green-300 text-green-700 focus:ring-green-500" />
                        <span className="font-semibold text-green-800 text-sm">🏔️ הוסף רובריקת שטח</span>
                      </label>
                    ) : (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">🏔️</span>
                        <span className="font-semibold text-green-800 text-sm">ציוד ושימוש שטח</span>
                        <span className="text-xs text-green-600 font-normal">(אופציונלי)</span>
                      </div>
                    )}

                    {(isJeepOffroad ? showOffroadSection : true) && (
                      <>
                        {/* Equipment chips */}
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
                                    selected
                                      ? 'bg-green-100 text-green-700 border-green-300'
                                      : 'bg-white text-gray-600 border-gray-200'
                                  }`}>
                                  {selected && '✓ '}{eq.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {/* Usage type */}
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
                        {/* Last off-road service date */}
                        <div>
                          <Label className="text-right block mb-1.5 text-green-800">תאריך טיפול שטח אחרון</Label>
                          <DateInput value={form.last_offroad_service_date}
                            onChange={e => handleChange('last_offroad_service_date', e.target.value)} />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving || (!form?.vehicle_type_id && !form?.vehicle_type)}
                  className="w-full h-14 rounded-2xl font-bold text-base transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                  style={{ background: T.yellow, color: T.primary, boxShadow: `0 4px 16px ${T.yellow}50` }}
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : 'שמור רכב'}
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}