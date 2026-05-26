/**
 * VehicleCompletionSheet — post-save bonus prompt for vehicles created
 * via /VehicleCheck (the "look up a plate at gov.il, save it" flow).
 *
 * Why this exists:
 *   gov.il returns the technical spec (manufacturer, model, year, test
 *   date, fuel type, ownership history…) but never the *personal*
 *   layer: nickname, photo, insurance company, insurance renewal date,
 *   sometimes current_km. Users were saving the vehicle in two seconds
 *   and forgetting to come back to fill the rest — reminders never
 *   fired, the dashboard card showed "רכב #X" instead of a photo, and
 *   tire/maintenance baselines were 0 (triggering false alerts).
 *
 *   This sheet appears the FIRST TIME a vehicle is saved from
 *   /VehicleCheck and offers to fill the gaps. Everything is optional;
 *   the vehicle is already in the DB at this point. The user can dismiss
 *   with the X / drag-down / outside-tap / "דלג, הכל טוב" — same outcome.
 *
 * Dynamic field list:
 *   We only ask for what gov.il DIDN'T return. Always-asked fields are
 *   `vehicle_photo`, `nickname`, `insurance_due_date`, `insurance_company`
 *   (gov.il never has these). Conditionally-asked: `current_km` (most
 *   vehicles get it from the last test, vessels/aviation/old cars
 *   sometimes don't).
 *
 * Lifecycle:
 *   1. Sheet opens → stamps `completion_prompted_at = now()` on the row
 *      (best-effort). Re-rendering the same vehicle never re-opens this
 *      sheet, even after a logout/reinstall — the column is persistent.
 *   2. User fills + "שמור והמשך" → UPDATE the row, success toast, close.
 *   3. User clicks "דלג, הכל טוב" / X / drag → close, NO update.
 *   4. Photo upload runs through useFileUpload and writes to Storage —
 *      the legacy base64 column is no longer touched (Sprint A migration).
 *
 * Designed with the design + ux skills 2026-05-26. See CLAUDE.md.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Check, X, Loader2 } from 'lucide-react';
import useFileUpload from '@/hooks/useFileUpload';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { compressImage } from '@/lib/imageCompress';
import { validateUploadFile } from '@/lib/securityUtils';
import { C } from '@/lib/designTokens';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';

// Insurance company lists — mirrors AddVehicle.jsx so the same vocab
// is presented across both flows. If AddVehicle's list changes, mirror
// the change here (or extract to a shared helper in a future refactor).
function getInsuranceCompanies(categoryLabel) {
  if (categoryLabel === 'כלי שייט')
    return ['הכשרה', 'כלל', 'הפניקס', 'הראל', 'איילון', 'מגדל', 'שירביט', 'AIG', 'אחר'];
  if (categoryLabel === 'אופנועים')
    return ['הפול', 'הפניקס', 'הראל', 'מנורה מבטחים', 'כלל', 'AIG', 'אחר'];
  if (categoryLabel === 'משאיות')
    return ['הכשרה', 'הפניקס', 'כלל', 'הראל', 'מגדל', 'איילון', 'שירביט', 'מנורה מבטחים', 'AIG', 'אחר'];
  if (categoryLabel === 'כלי שטח')
    return ['הפניקס', 'כלל', 'הראל', 'מגדל', 'איילון', 'AIG', 'שירביט', 'אחר'];
  return ['הפניקס', 'כלל', 'ישיר', 'מגדל', 'הראל', 'איילון', 'ליברה', 'AIG', 'שומרה', 'הכשרה', 'מנורה מבטחים', 'שירביט', 'אחר'];
}

/**
 * Compute which optional fields to render based on what gov.il actually
 * returned. The `result` shape is whatever lookupVehicleQuickCheck()
 * produced — we read the same paths VehicleCheck.jsx + the insert
 * payload reads.
 */
function computeMissingFields(result, savedVehicle) {
  // Vehicle is already saved. Read the SAVED row for ground truth of
  // what columns ended up populated. Fall back to the gov.il `result`
  // shape if the saved row didn't expose them.
  const km =
    savedVehicle?.current_km ??
    result?.kmData?.km ??
    result?.basicInfo?.km ??
    null;

  return {
    // ALWAYS shown — gov.il has no concept of personal photo/nickname
    photo:     true,
    nickname:  true,
    insurance: true,   // both date + company
    // CONDITIONALLY shown
    currentKm: km == null || km === 0,
  };
}

// Stamp `completion_prompted_at` once per row so the sheet never
// re-opens for the same vehicle. Best-effort — failing here doesn't
// block the user from continuing.
async function stampPrompted(vehicleId) {
  if (!vehicleId) return;
  try {
    await supabase
      .from('vehicles')
      .update({ completion_prompted_at: new Date().toISOString() })
      .eq('id', vehicleId);
  } catch {
    // Worst case: user gets one extra prompt on their next visit. No
    // user-visible error.
  }
}

export default function VehicleCompletionSheet({
  open,
  onClose,
  vehicleId,
  accountId,
  result,
  savedVehicle,
  vehicleCategoryLabel, // e.g. 'רכב פרטי' / 'כלי שייט' — for insurance list
  onSaved,
}) {
  const fields = useMemo(
    () => computeMissingFields(result, savedVehicle),
    [result, savedVehicle],
  );

  const [form, setForm] = useState({
    nickname: '',
    vehicle_photo: '',
    vehicle_photo_storage_path: '',
    current_km: '',
    insurance_due_date: '',
    insurance_company: '',
    insurance_company_other: '',
  });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const { upload: uploadPhotoToStorage } = useFileUpload({
    accountId,
    kind: 'vehicle-photo',
    folder: 'vehicles',
  });

  // Stamp the "prompted" timestamp the moment we open. Even if the user
  // dismisses without saving anything, we won't ask again.
  useEffect(() => {
    if (open && vehicleId) stampPrompted(vehicleId);
  }, [open, vehicleId]);

  const handleChange = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handlePhotoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const v = validateUploadFile(file, 'photo', 10);
    if (!v.ok) {
      toastError(v.error, { action: 'completion_sheet_photo_validate' });
      e.target.value = '';
      return;
    }
    setPhotoUploading(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.85 });
      const { fileUrl, storagePath } = await uploadPhotoToStorage(compressed);
      setForm(prev => ({
        ...prev,
        vehicle_photo: fileUrl,
        vehicle_photo_storage_path: storagePath,
      }));
    } catch (err) {
      toastError(err?.message || 'שגיאה בהעלאת התמונה', { action: 'completion_sheet_photo_upload', err });
    } finally {
      setPhotoUploading(false);
      e.target.value = '';
    }
  };

  const hasAnyValue = useMemo(() => {
    return Boolean(
      form.nickname ||
      form.vehicle_photo ||
      form.current_km ||
      form.insurance_due_date ||
      (form.insurance_company && form.insurance_company !== 'אחר') ||
      (form.insurance_company === 'אחר' && form.insurance_company_other),
    );
  }, [form]);

  const handleSave = async () => {
    if (saving || !vehicleId) return;
    if (!hasAnyValue) {
      // Nothing to update — treat as skip so the user never lands here twice.
      onClose?.();
      return;
    }
    setSaving(true);
    try {
      const patch = {};
      if (form.nickname.trim()) patch.nickname = form.nickname.trim();
      if (form.vehicle_photo) patch.vehicle_photo = form.vehicle_photo;
      if (form.vehicle_photo_storage_path) patch.vehicle_photo_storage_path = form.vehicle_photo_storage_path;
      if (form.current_km !== '' && form.current_km !== null) {
        const kmNum = Number(form.current_km);
        if (Number.isFinite(kmNum) && kmNum >= 0) patch.current_km = kmNum;
      }
      if (form.insurance_due_date) patch.insurance_due_date = form.insurance_due_date;
      if (form.insurance_company) {
        patch.insurance_company = form.insurance_company === 'אחר'
          ? form.insurance_company_other.trim() || null
          : form.insurance_company;
      }
      await db.vehicles.update(vehicleId, patch);
      toast.success('הפרטים נשמרו');
      onSaved?.();
    } catch (err) {
      toastError('שמירת הפרטים נכשלה — אפשר להמשיך לערוך מהרכב', { action: 'completion_sheet_save', err });
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = () => {
    if (saving) return;
    onClose?.();
  };

  const companies = getInsuranceCompanies(vehicleCategoryLabel);

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) handleSkip(); }}>
      <DrawerContent dir="rtl" className="max-h-[90vh]">
        {/* Hero — the "saved!" affirmation. Designer brief: warm, optimistic. */}
        <div
          className="px-5 pt-2 pb-4"
          style={{ background: C.successSubtle, borderBottom: `1px solid ${C.successLight}` }}
        >
          <DrawerHeader className="p-0 text-right">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: C.successBright, color: '#fff' }}
              >
                <Check className="w-5 h-5" strokeWidth={3} />
              </div>
              <DrawerTitle className="text-lg font-extrabold" style={{ color: C.successDark }}>
                הרכב שלך אצלנו
              </DrawerTitle>
            </div>
            <DrawerDescription className="text-sm mt-1.5" style={{ color: C.gray700 }}>
              רוצה להוסיף עוד פרטים? <span className="font-bold">הכל אופציונלי</span> — נעזור לזכור תזכורות וטיפולים.
            </DrawerDescription>
          </DrawerHeader>
        </div>

        {/* Body — dynamic fields */}
        <div className="px-5 pt-4 pb-2 overflow-y-auto space-y-4">
          {/* Photo + Nickname row */}
          {(fields.photo || fields.nickname) && (
            <div className="flex items-start gap-3">
              {fields.photo && (
                <label
                  className="relative shrink-0 cursor-pointer"
                  style={{ width: 110, height: 110 }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoPick}
                    disabled={photoUploading || saving}
                  />
                  <div
                    className="w-full h-full rounded-2xl flex items-center justify-center overflow-hidden"
                    style={{
                      background: form.vehicle_photo ? 'transparent' : C.light,
                      border: `2px dashed ${form.vehicle_photo ? 'transparent' : C.borderAlt}`,
                    }}
                  >
                    {photoUploading ? (
                      <Loader2 className="w-7 h-7 animate-spin" style={{ color: C.primary }} />
                    ) : form.vehicle_photo ? (
                      <img src={form.vehicle_photo} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center px-1">
                        <Camera className="w-6 h-6 mx-auto mb-1" style={{ color: C.primary }} />
                        <span className="text-[11px] font-bold" style={{ color: C.primary }}>תמונה</span>
                      </div>
                    )}
                  </div>
                </label>
              )}
              {fields.nickname && (
                <div className="flex-1 min-w-0">
                  <Label className="text-xs font-bold mb-1.5 block" style={{ color: C.gray700 }}>
                    כינוי <span className="font-normal" style={{ color: C.gray400 }}>(אופציונלי)</span>
                  </Label>
                  <Input
                    value={form.nickname}
                    onChange={(e) => handleChange('nickname', e.target.value)}
                    placeholder="הקורולה שלי"
                    maxLength={50}
                    disabled={saving}
                  />
                </div>
              )}
            </div>
          )}

          {/* Current km — only when gov.il didn't return it */}
          {fields.currentKm && (
            <div>
              <Label className="text-xs font-bold mb-1.5 block" style={{ color: C.gray700 }}>
                ק&quot;מ נוכחי <span className="font-normal" style={{ color: C.gray400 }}>(אופציונלי)</span>
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                value={form.current_km}
                onChange={(e) => handleChange('current_km', e.target.value)}
                placeholder="0"
                disabled={saving}
              />
            </div>
          )}

          {/* Insurance — always shown (date + company) */}
          {fields.insurance && (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-bold mb-1.5 block" style={{ color: C.gray700 }}>
                    חידוש ביטוח
                  </Label>
                  <DateInput
                    value={form.insurance_due_date}
                    onChange={(v) => handleChange('insurance_due_date', v)}
                    placeholder="בחר תאריך"
                  />
                </div>
                <div>
                  <Label className="text-xs font-bold mb-1.5 block" style={{ color: C.gray700 }}>
                    חברת ביטוח
                  </Label>
                  <Select
                    value={form.insurance_company}
                    onValueChange={(v) => handleChange('insurance_company', v)}
                    disabled={saving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר חברה" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.insurance_company === 'אחר' && (
                <Input
                  value={form.insurance_company_other}
                  onChange={(e) => handleChange('insurance_company_other', e.target.value)}
                  placeholder="שם חברת הביטוח"
                  maxLength={60}
                  disabled={saving}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer — actions */}
        <div className="px-5 pt-4 pb-6 mt-2 border-t" style={{ borderColor: C.gray100 }}>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving || photoUploading}
              className="flex-1 h-12 text-base font-bold"
              style={{ background: C.primary, color: '#fff' }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שמור והמשך'}
            </Button>
            <button
              onClick={handleSkip}
              disabled={saving}
              className="text-sm font-bold py-2 px-2"
              style={{ color: C.gray500 }}
            >
              דלג, הכל טוב
            </button>
          </div>
        </div>

        {/* Tiny X for users who reach for the corner — same outcome as skip */}
        <button
          onClick={handleSkip}
          disabled={saving}
          aria-label="סגירה"
          className="absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: C.gray100, color: C.gray500 }}
        >
          <X className="w-4 h-4" />
        </button>
      </DrawerContent>
    </Drawer>
  );
}
