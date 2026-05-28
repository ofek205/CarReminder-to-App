/**
 * VehicleCompletionSheet — post-save bonus prompt for vehicles created
 * via /VehicleCheck (the "look up a plate at gov.il, save it" flow).
 *
 * Why this exists:
 *   gov.il returns the technical spec (manufacturer, model, year, test
 *   date, fuel type, ownership history…) but never the *personal*
 *   layer: nickname, photo, insurance company, insurance renewal date,
 *   tire change history, sometimes current_km. Users were saving the
 *   vehicle in two seconds and forgetting to come back to fill the
 *   rest — reminders never fired, the dashboard card showed "רכב #X"
 *   instead of a photo, and tire/maintenance baselines were 0
 *   (triggering false alerts).
 *
 *   This sheet appears the FIRST TIME a vehicle is saved from
 *   /VehicleCheck and offers to fill the gaps. Everything is optional;
 *   the vehicle is already in the DB at this point. The user can dismiss
 *   with the X / drag-down / outside-tap / "דלג, אסיים אחר-כך" — same
 *   outcome.
 *
 * Dynamic field list:
 *   We only ask for what gov.il DIDN'T return. Always-asked fields are
 *   `vehicle_photo`, `nickname`, `insurance_due_date`, `insurance_company`,
 *   `last_tire_change_date`. Conditionally-asked: `current_km` (most
 *   vehicles get it from the last test, vessels/aviation/old cars
 *   sometimes don't).
 *
 * Visual direction (designer round 2):
 *   • "Warm-confident welcome card" — the rectangle is the vehicle,
 *     not the form. No checkmark icon, no emoji glyphs — typography
 *     carries the affirmation.
 *   • Hero band ~96px tall with the license plate chip + vehicle name
 *     as the memorable element.
 *   • Photo placeholder is a centred 140×140 card (inset shadow, no
 *     dashed border) — feels like "your photo's place", not "upload".
 *   • Buttons balanced 1:1 — primary and "skip" carry equal weight.
 *   • Subtitle replaces the "(אופציונלי)" tag: "ארבעה פרטים שיעזרו
 *     לנו לעזור לך" — the optional-ness is implicit in the tone.
 *
 * Lifecycle:
 *   1. Sheet opens → stamps `completion_prompted_at = now()` on the row
 *      (best-effort). Re-rendering the same vehicle never re-opens this
 *      sheet, even after a logout/reinstall — the column is persistent.
 *   2. User fills + "שמור והמשך" → UPDATE the row, success toast, close.
 *   3. User dismisses any way → close, NO update beyond the prompted stamp.
 *   4. Photo upload runs through useFileUpload and writes to Storage —
 *      the legacy base64 column is no longer touched (Sprint A migration).
 *
 * Designed with the pm + ux + designer skills 2026-05-26. See CLAUDE.md.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Image as ImageIcon, X as XIcon, Loader2 } from 'lucide-react';
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
  return ['הפניקס', 'כלל', 'ישיר', 'מגדל', 'הראל', 'איילון', 'ליברה', 'שלמה ביטוח', 'ווישור', 'AIG', 'שומרה', 'הכשרה', 'מנורה מבטחים', 'ביטוח חקלאי', 'שירביט', 'אחר'];
}

// Decide which optional fields to render based on what gov.il actually
// returned. The `result` shape is whatever lookupVehicleQuickCheck()
// produced — we read the same paths VehicleCheck.jsx + the insert
// payload reads.
//
// Field behavior:
//   • photo/nickname/insurance/tires — always asked (gov.il has none).
//   • current_km — only asked when gov.il DID return a value. We
//     pre-fill it from the last-test reading and invite the user to
//     refine it ("ק"מ מהטסט האחרון, ניתן לעדכן"). When gov.il didn't
//     return km (vessels, aviation, plate not in the registry) we
//     omit the field entirely — without a baseline the user has
//     nothing useful to compare against and it just becomes noise.
function computeMissingFields(result, savedVehicle) {
  const km =
    savedVehicle?.current_km ??
    result?.kmData?.km ??
    result?.basicInfo?.km ??
    null;
  const hasApiKm = typeof km === 'number' && km > 0;
  return {
    photo:     true,
    nickname:  true,
    insurance: true,
    tires:     true,
    currentKm: hasApiKm,
    apiKmValue: hasApiKm ? km : null,
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

// Build the display label for the hero — manufacturer + model + year
// when available, falling back to whatever we have. Trimmed defensively
// so an empty result doesn't render a blank string.
function buildVehicleLabel(result, savedVehicle) {
  const v = savedVehicle || {};
  const parts = [
    v.manufacturer || result?.basicInfo?.manufacturer,
    v.model || result?.basicInfo?.model,
    v.year || result?.basicInfo?.year,
  ].filter(Boolean);
  if (parts.length) return parts.join(' ');
  return v.license_plate || result?.basicInfo?.licensePlate || 'הרכב שלך';
}

export default function VehicleCompletionSheet({
  open,
  onClose,
  vehicleId,
  accountId,
  result,
  savedVehicle,
  vehicleCategoryLabel,
  onSaved,
}) {
  const fields = useMemo(
    () => computeMissingFields(result, savedVehicle),
    [result, savedVehicle],
  );
  const vehicleLabel = useMemo(
    () => buildVehicleLabel(result, savedVehicle),
    [result, savedVehicle],
  );
  const plateDisplay = savedVehicle?.license_plate || result?.basicInfo?.licensePlate || '';

  // Form state. `current_km` is pre-filled with the API value when
  // available so the user can either confirm or refine it. The save
  // path only writes a column if the value actually changed from the
  // pre-fill, so a confirm-without-edit doesn't trip an UPDATE.
  const [form, setForm] = useState({
    nickname: '',
    vehicle_photo: '',
    vehicle_photo_storage_path: '',
    current_km: fields.apiKmValue != null ? String(fields.apiKmValue) : '',
    insurance_due_date: '',
    insurance_company: '',
    insurance_company_other: '',
    last_tire_change_date: '',
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

  // "Has the user actually filled anything?" — drives the save-vs-skip
  // shortcut. current_km is pre-filled from the API, so a literal
  // truthy check would always return true. We compare against the
  // pre-fill: km only counts as "changed" if it differs from what
  // gov.il gave us.
  const hasAnyValue = useMemo(() => {
    const kmChanged = (() => {
      if (form.current_km === '' || form.current_km == null) return false;
      const n = Number(form.current_km);
      if (!Number.isFinite(n)) return false;
      return fields.apiKmValue == null || n !== fields.apiKmValue;
    })();
    return Boolean(
      form.nickname ||
      form.vehicle_photo ||
      kmChanged ||
      form.insurance_due_date ||
      (form.insurance_company && form.insurance_company !== 'אחר') ||
      (form.insurance_company === 'אחר' && form.insurance_company_other) ||
      form.last_tire_change_date,
    );
  }, [form, fields.apiKmValue]);

  const handleSave = async () => {
    if (saving || !vehicleId) return;
    if (!hasAnyValue) {
      onClose?.();
      return;
    }
    setSaving(true);
    try {
      const patch = {};
      if (form.nickname.trim()) patch.nickname = form.nickname.trim();
      if (form.vehicle_photo) patch.vehicle_photo = form.vehicle_photo;
      if (form.vehicle_photo_storage_path) patch.vehicle_photo_storage_path = form.vehicle_photo_storage_path;
      // current_km — only write if the user actually changed the
      // pre-filled value. The pre-fill came from gov.il and is
      // already on the row; rewriting it would no-op the DB but
      // still touch updated_at and trigger query invalidations.
      if (form.current_km !== '' && form.current_km !== null) {
        const kmNum = Number(form.current_km);
        const unchanged = fields.apiKmValue != null && kmNum === fields.apiKmValue;
        if (Number.isFinite(kmNum) && kmNum >= 0 && !unchanged) patch.current_km = kmNum;
      }
      if (form.insurance_due_date) patch.insurance_due_date = form.insurance_due_date;
      if (form.insurance_company) {
        patch.insurance_company = form.insurance_company === 'אחר'
          ? form.insurance_company_other.trim() || null
          : form.insurance_company;
      }
      if (form.last_tire_change_date) patch.last_tire_change_date = form.last_tire_change_date;
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
      <DrawerContent dir="rtl" className="max-h-[92vh] p-0 overflow-hidden mx-auto w-full max-w-md">
        {/* Hero — typography-only welcome. No checkmark glyph, no emoji.
            The license plate chip + vehicle name carry the recognition. */}
        <div
          className="px-6 pt-5 pb-5 relative"
          style={{ background: C.successSubtle }}
        >
          <button
            onClick={handleSkip}
            disabled={saving}
            aria-label="סגירה"
            className="absolute top-3 left-3 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
            style={{ background: 'rgba(255,255,255,0.7)', color: C.gray500 }}
          >
            <XIcon className="w-4 h-4" strokeWidth={2} />
          </button>

          <h2
            className="text-[22px] font-extrabold leading-tight"
            style={{ color: C.successDark }}
          >
            הרכב שלך מוכן
          </h2>

          <div className="flex items-center gap-2.5 mt-2">
            {plateDisplay && (
              <span
                dir="ltr"
                className="px-2.5 py-1 rounded-md text-[12px] font-bold tracking-wide font-mono"
                style={{
                  background: '#FFFFFF',
                  color: C.gray800,
                  border: `1px solid ${C.successLight}`,
                }}
              >
                {plateDisplay}
              </span>
            )}
            <span className="text-[14px] font-bold" style={{ color: C.gray700 }}>
              {vehicleLabel}
            </span>
          </div>

          <div className="mt-3 h-px" style={{ background: C.successLight }} />

          <p className="text-[13px] mt-3 font-medium" style={{ color: C.gray500 }}>
            כמה פרטים שיעזרו לנו לעזור לך לזכור תזכורות, טיפולים וביטוח.
          </p>
        </div>

        {/* Body — generous spacing, photo as the hero of the form */}
        <div className="px-6 pt-6 pb-2 overflow-y-auto space-y-7">

          {/* Photo card — centered, dominant, no dashed border */}
          {fields.photo && (
            <div className="flex justify-center">
              <label
                className="relative cursor-pointer block"
                style={{ width: 140, height: 140 }}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoPick}
                  disabled={photoUploading || saving}
                />
                <div
                  className="w-full h-full rounded-[20px] flex items-center justify-center overflow-hidden transition-all"
                  style={{
                    background: form.vehicle_photo ? 'transparent' : C.gray50,
                    boxShadow: form.vehicle_photo
                      ? 'none'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.04), inset 0 2px 8px rgba(0,0,0,0.05)',
                  }}
                >
                  {photoUploading ? (
                    <Loader2 className="w-8 h-8 animate-spin" style={{ color: C.primary }} />
                  ) : form.vehicle_photo ? (
                    <img
                      src={form.vehicle_photo}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon
                      className="w-7 h-7"
                      strokeWidth={1.5}
                      style={{ color: C.gray400 }}
                    />
                  )}
                </div>
              </label>
            </div>
          )}

          {/* Nickname */}
          {fields.nickname && (
            <div>
              <Label className="text-[13px] font-bold mb-2 block" style={{ color: C.gray700 }}>
                כינוי
              </Label>
              <Input
                value={form.nickname}
                onChange={(e) => handleChange('nickname', e.target.value)}
                placeholder="הקורולה שלי"
                maxLength={50}
                disabled={saving}
                className="h-11"
              />
            </div>
          )}

          {/* Insurance grid — date + company */}
          {fields.insurance && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[13px] font-bold mb-2 block" style={{ color: C.gray700 }}>
                    חידוש ביטוח
                  </Label>
                  <DateInput
                    value={form.insurance_due_date}
                    onChange={(e) => handleChange('insurance_due_date', e?.target?.value || '')}
                    placeholder="בחר תאריך"
                    native
                  />
                </div>
                <div>
                  <Label className="text-[13px] font-bold mb-2 block" style={{ color: C.gray700 }}>
                    חברת ביטוח
                  </Label>
                  <Select
                    value={form.insurance_company}
                    onValueChange={(v) => handleChange('insurance_company', v)}
                    disabled={saving}
                  >
                    <SelectTrigger className="h-11">
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
                  className="h-11"
                />
              )}
            </div>
          )}

          {/* Current km — only shown when gov.il actually returned a
              value. Pre-filled with the API reading; the user confirms
              or refines. The helper line below the input names the
              source so the value isn't a mystery number. */}
          {fields.currentKm && (
            <div>
              <Label className="text-[13px] font-bold mb-2 block" style={{ color: C.gray700 }}>
                ק&quot;מ נוכחי
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                value={form.current_km}
                onChange={(e) => handleChange('current_km', e.target.value)}
                placeholder="0"
                disabled={saving}
                className="h-11"
              />
              <p className="text-[12px] mt-1.5 leading-snug" style={{ color: C.gray500 }}>
                מהטסט האחרון במשרד התחבורה. אפשר לעדכן אם נסעת מאז.
              </p>
            </div>
          )}

          {/* Tire change date */}
          {fields.tires && (
            <div>
              <Label className="text-[13px] font-bold mb-2 block" style={{ color: C.gray700 }}>
                החלפת צמיגים אחרונה
              </Label>
              <DateInput
                value={form.last_tire_change_date}
                onChange={(e) => handleChange('last_tire_change_date', e?.target?.value || '')}
                placeholder="בחר תאריך"
                native
              />
            </div>
          )}
        </div>

        {/* Footer — balanced 1:1 buttons, equal visual weight */}
        <div
          className="px-6 pt-4 pb-6 mt-4"
          style={{ borderTop: `1px solid ${C.gray100}` }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              onClick={handleSkip}
              disabled={saving}
              variant="outline"
              className="h-12 text-[14px] font-bold"
              style={{ borderColor: C.gray200, color: C.gray700, background: '#FFFFFF' }}
            >
              דלג, אסיים אחר-כך
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || photoUploading}
              className="h-12 text-[14px] font-bold"
              style={{ background: C.primary, color: '#FFFFFF' }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'שמור והמשך'}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
