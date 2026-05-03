/**
 * ExternalDriverFormDialog — add or edit a non-account ("external")
 * driver. Companion to the registered-driver invite flow already in
 * /Drivers; this one captures roster data for someone who isn't a
 * user in the app (no auth.users row).
 *
 * Props:
 *   open        boolean
 *   onClose     ()
 *   onSaved     (driverId) — fires on successful create/update
 *   accountId   workspace
 *   initial     external_drivers row | null   (null = create mode)
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateInput } from '@/components/ui/date-input';
import { toast } from 'sonner';
import { Loader2, Upload, Camera, Trash2, Check, IdCard, ExternalLink, Plus } from 'lucide-react';
import { C } from '@/lib/designTokens';
import {
  LICENSE_CATEGORIES,
  createExternalDriver,
  updateExternalDriver,
} from '@/services/drivers';
import useFileUpload from '@/hooks/useFileUpload';
import { validateUploadFile } from '@/lib/securityUtils';
import { deleteFile, refreshSignedUrl } from '@/lib/supabaseStorage';

// Loose check — rejects obvious junk, accepts Israeli mobile (05X-) and
// landline formats with or without separators. We don't lock to a
// specific format because business owners often paste numbers with
// hyphens, spaces or +972 prefixes; rejecting strict-fmt entries
// frustrates them more than it improves data quality.
function isPlausiblePhone(s) {
  const digits = String(s || '').replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}

export default function ExternalDriverFormDialog({
  open,
  onClose,
  onSaved,
  accountId,
  initial = null,
}) {
  const isEdit = !!initial?.id;

  // Form state
  const [fullName,    setFullName]    = useState('');
  const [phone,       setPhone]       = useState('');
  const [email,       setEmail]       = useState('');
  const [birthDate,   setBirthDate]   = useState('');
  const [licenseNum,  setLicenseNum]  = useState('');
  const [licenseExp,  setLicenseExp]  = useState('');
  const [categories,  setCategories]  = useState([]);
  const [customCat,   setCustomCat]   = useState('');
  const [notes,       setNotes]       = useState('');
  const [photoUrl,    setPhotoUrl]    = useState('');
  const [photoPath,   setPhotoPath]   = useState('');
  const [didChangePhoto, setDidChangePhoto] = useState(false);

  // Per-field error (clears on touch)
  const [fieldError, setFieldError] = useState({ field: null, message: '' });
  const setFE   = (field, message) => setFieldError({ field, message });
  const clearFE = (field) => setFieldError(prev => prev.field === field ? { field: null, message: '' } : prev);

  const [submitting, setSubmitting] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const fileInputRef = useRef(null);

  // Storage upload — `subPath: 'drivers'` keeps every driver-related
  // upload under `{accountId}/drivers/...`, matching the bucket RLS
  // policy (only the FIRST folder is checked).
  const { upload: uploadPhoto } = useFileUpload({
    accountId,
    subPath: 'drivers',
    mode: 'photo',
    maxMB: 10,
  });

  // Track an upload that was made but never saved — clean it up on
  // close so we don't leak orphaned blobs.
  const newOrphanPathRef = useRef(null);
  const savedRef         = useRef(false);

  // Hydrate on open
  useEffect(() => {
    if (!open) return;
    savedRef.current = false;
    if (initial) {
      setFullName(initial.full_name || '');
      setPhone(initial.phone || '');
      setEmail(initial.email || '');
      setBirthDate(initial.birth_date || '');
      setLicenseNum(initial.license_number || '');
      setLicenseExp(initial.license_expiry_date || '');
      setCategories(Array.isArray(initial.license_categories) ? initial.license_categories : []);
      setCustomCat('');
      setNotes(initial.notes || '');
      setPhotoUrl(initial.license_photo_url || '');
      setPhotoPath(initial.license_photo_storage_path || '');
      setDidChangePhoto(false);
    } else {
      setFullName('');
      setPhone('');
      setEmail('');
      setBirthDate('');
      setLicenseNum('');
      setLicenseExp('');
      setCategories([]);
      setCustomCat('');
      setNotes('');
      setPhotoUrl('');
      setPhotoPath('');
      setDidChangePhoto(false);
    }
    setFieldError({ field: null, message: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  // Cleanup orphan file when dialog closes without save
  useEffect(() => {
    if (open) return;
    if (!savedRef.current && newOrphanPathRef.current) {
      deleteFile(newOrphanPathRef.current).catch(() => {});
      newOrphanPathRef.current = null;
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  // ── Photo upload ────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const v = validateUploadFile(file, 'photo', 10);
    if (!v.ok) { toast.error(v.error); return; }
    if (!accountId) { toast.error('עדיין נטען. נסה שוב בעוד רגע'); return; }

    setUploading(true);
    try {
      const { fileUrl, storagePath } = await uploadPhoto(file);
      // Drop the previous orphan from this open session if any.
      if (newOrphanPathRef.current && newOrphanPathRef.current !== storagePath) {
        deleteFile(newOrphanPathRef.current).catch(() => {});
      }
      newOrphanPathRef.current = storagePath;
      setPhotoUrl(fileUrl);
      setPhotoPath(storagePath);
      setDidChangePhoto(true);
      toast.success('תמונת הרישיון נטענה');
    } catch (err) {
      console.error('license photo upload error:', err);
      toast.error(err?.message || 'שגיאה בהעלאת התמונה');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = () => {
    if (newOrphanPathRef.current) {
      deleteFile(newOrphanPathRef.current).catch(() => {});
      newOrphanPathRef.current = null;
    }
    setPhotoUrl('');
    setPhotoPath('');
    setDidChangePhoto(true);
  };

  const openPhoto = async () => {
    if (!photoUrl && !photoPath) return;
    let url = photoUrl;
    if (photoPath) {
      try {
        const fresh = await refreshSignedUrl(photoPath);
        if (fresh) url = fresh;
      } catch { /* fall through */ }
    }
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── Categories ──────────────────────────────────────────────────────
  const toggleCategory = (code) => {
    setCategories(prev => prev.includes(code)
      ? prev.filter(c => c !== code)
      : [...prev, code]);
  };
  const addCustom = () => {
    const v = customCat.trim();
    if (!v) return;
    if (categories.includes(v)) { setCustomCat(''); return; }
    setCategories(prev => [...prev, v]);
    setCustomCat('');
  };

  // ── Submit ──────────────────────────────────────────────────────────
  const submit = async (e) => {
    e?.preventDefault?.();

    const cleanName = fullName.trim();
    if (!cleanName) { toast.error('יש להזין שם מלא'); setFE('full_name', 'יש להזין שם מלא'); return; }
    const cleanPhone = phone.trim();
    if (!cleanPhone) { toast.error('יש להזין טלפון'); setFE('phone', 'יש להזין טלפון'); return; }
    if (!isPlausiblePhone(cleanPhone)) {
      toast.error('מספר הטלפון לא נראה תקין');
      setFE('phone', 'מספר הטלפון לא נראה תקין');
      return;
    }
    const cleanEmail = email.trim();
    if (cleanEmail && !/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      toast.error('האימייל לא נראה תקין');
      setFE('email', 'אימייל לא תקין');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        await updateExternalDriver(initial.id, {
          fullName: cleanName,
          phone:    cleanPhone,
          email:    cleanEmail || null,
          clearEmail: !cleanEmail,
          birthDate: birthDate || null,
          clearBirthDate: !birthDate,
          licenseNumber: licenseNum.trim() || null,
          clearLicenseNumber: !licenseNum.trim(),
          licenseExpiryDate: licenseExp || null,
          clearLicenseExpiry: !licenseExp,
          licenseCategories: categories,
          licensePhotoUrl: didChangePhoto ? (photoUrl || null) : undefined,
          licensePhotoStoragePath: didChangePhoto ? (photoPath || null) : undefined,
          clearLicensePhoto: didChangePhoto && !photoPath,
          notes: notes.trim() || null,
          clearNotes: !notes.trim(),
        });
        toast.success('הנהג עודכן');
        savedRef.current = true;
        onSaved?.(initial.id);
      } else {
        const newId = await createExternalDriver({
          accountId,
          fullName: cleanName,
          phone:    cleanPhone,
          email:    cleanEmail || null,
          birthDate: birthDate || null,
          licenseNumber: licenseNum.trim() || null,
          licenseExpiryDate: licenseExp || null,
          licenseCategories: categories,
          licensePhotoUrl: photoUrl || null,
          licensePhotoStoragePath: photoPath || null,
          notes: notes.trim() || null,
        });
        toast.success('הנהג נוסף');
        savedRef.current = true;
        newOrphanPathRef.current = null;
        onSaved?.(newId);
      }
      onClose?.();
    } catch (err) {
      console.error('external driver save error:', err);
      const msg = err?.message || '';
      if      (msg.includes('forbidden_not_manager')) toast.error('אין לך הרשאת מנהל');
      else if (msg.includes('full_name_required'))    toast.error('יש להזין שם מלא');
      else if (msg.includes('phone_required'))        toast.error('יש להזין טלפון');
      else                                             toast.error('שגיאה בשמירה. נסה שוב.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent dir="rtl" className="max-w-md p-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-5 pt-4 pb-2 border-b border-gray-100 shrink-0">
          <DialogTitle className="text-base font-bold text-right">
            {isEdit ? 'עריכת נהג' : 'הוספת נהג ללא חשבון'}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-gray-500 text-right">
            {isEdit
              ? 'עדכון פרטי הנהג ברשומה'
              : 'נהג שעובד ברישום ידני, ללא יוזר באפליקציה'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="p-4 space-y-3 overflow-y-auto">
          {/* פרטי קשר */}
          <Section title="פרטי קשר">
            <Field label="שם מלא" required error={fieldError.field === 'full_name' && fieldError.message}>
              <Input
                value={fullName}
                onChange={e => { setFullName(e.target.value.slice(0, 80)); clearFE('full_name'); }}
                placeholder="ישראל ישראלי"
                className={`rounded-xl ${fieldError.field === 'full_name' ? 'border-red-400' : ''}`}
                maxLength={80}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="טלפון" required error={fieldError.field === 'phone' && fieldError.message}>
                <Input
                  value={phone}
                  onChange={e => { setPhone(e.target.value.slice(0, 20)); clearFE('phone'); }}
                  placeholder="050-1234567"
                  type="tel"
                  className={`rounded-xl ${fieldError.field === 'phone' ? 'border-red-400' : ''}`}
                  dir="ltr"
                />
              </Field>
              <Field
                label="תאריך לידה"
                hint="אופציונלי"
              >
                <DateInput
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
                  className="rounded-xl"
                />
              </Field>
            </div>
            <Field
              label="אימייל"
              hint="להתראות באימייל צריך אימייל. לא חובה."
              error={fieldError.field === 'email' && fieldError.message}
            >
              <Input
                value={email}
                onChange={e => { setEmail(e.target.value.slice(0, 120)); clearFE('email'); }}
                placeholder="driver@company.co.il"
                type="email"
                className={`rounded-xl ${fieldError.field === 'email' ? 'border-red-400' : ''}`}
                dir="ltr"
              />
            </Field>
          </Section>

          {/* רישיון נהיגה */}
          <Section title="רישיון נהיגה">
            <div className="grid grid-cols-2 gap-3">
              <Field label="מספר רישיון" hint="אופציונלי">
                <Input
                  value={licenseNum}
                  onChange={e => setLicenseNum(e.target.value.slice(0, 30))}
                  placeholder="123456789"
                  className="rounded-xl"
                  dir="ltr"
                />
              </Field>
              <Field label="תוקף עד" hint="אופציונלי">
                <DateInput
                  value={licenseExp}
                  onChange={e => setLicenseExp(e.target.value)}
                  className="rounded-xl"
                />
              </Field>
            </div>

            <Field label="קטגוריות רישיון" hint="ניתן לבחור כמה. הוסף קטגוריה מותאמת בשדה למטה.">
              <div className="flex flex-wrap gap-1.5">
                {LICENSE_CATEGORIES.map(cat => {
                  const sel = categories.includes(cat.code);
                  return (
                    <button
                      key={cat.code}
                      type="button"
                      onClick={() => toggleCategory(cat.code)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1 ${
                        sel
                          ? 'bg-[#E8F2EA] border-[#2D5233] text-[#2D5233]'
                          : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <span>{cat.emoji}</span>
                      <span>{cat.label.split(' - ')[0]}</span>
                      {sel && <Check className="w-3 h-3 mr-0.5" />}
                    </button>
                  );
                })}
                {/* Free-text categories from previous edits — render as
                    selected chips so the user can remove them. */}
                {categories
                  .filter(c => !LICENSE_CATEGORIES.some(lc => lc.code === c))
                  .map(custom => (
                    <button
                      key={custom}
                      type="button"
                      onClick={() => toggleCategory(custom)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold border bg-[#E8F2EA] border-[#2D5233] text-[#2D5233] flex items-center gap-1"
                    >
                      <span>✏️</span>
                      <span>{custom}</span>
                      <Check className="w-3 h-3 mr-0.5" />
                    </button>
                  ))}
              </div>
              {/* Custom-category input */}
              <div className="flex gap-1.5 mt-2">
                <Input
                  value={customCat}
                  onChange={e => setCustomCat(e.target.value.slice(0, 30))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                  placeholder="הוסף קטגוריה (למשל: מנוף עליון)"
                  className="rounded-xl text-sm flex-1 h-9"
                  maxLength={30}
                />
                <button
                  type="button"
                  onClick={addCustom}
                  disabled={!customCat.trim()}
                  className="h-9 px-3 rounded-xl text-xs font-bold bg-white border border-gray-200 text-[#2D5233] disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5 inline" /> הוסף
                </button>
              </div>
            </Field>

            <Field label="תמונת רישיון" hint="חזית הרישיון">
              <div className="rounded-xl p-3" style={{ background: '#F5F1EB', border: `1px solid ${C.border}` }}>
                {photoUrl ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={openPhoto}
                      className="flex-1 h-10 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 bg-white border"
                      style={{ borderColor: C.border, color: C.primary }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      צפה בתמונה
                    </button>
                    <button
                      type="button"
                      onClick={removePhoto}
                      className="w-10 h-10 rounded-lg flex items-center justify-center bg-white border"
                      style={{ borderColor: C.border }}
                      aria-label="הסר תמונה"
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex-1 h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 bg-white border disabled:opacity-60"
                      style={{ borderColor: C.border, color: C.primary }}
                    >
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      בחר קובץ
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="h-10 px-3 rounded-lg flex items-center justify-center bg-white border disabled:opacity-60"
                      style={{ borderColor: C.border, color: C.primary }}
                      aria-label="צלם רישיון"
                    >
                      <Camera className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFile}
                  className="hidden"
                />
              </div>
            </Field>
          </Section>

          {/* הערות */}
          <Section title="הערות">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 500))}
              placeholder="פרטים נוספים, מגבלות, הערות..."
              className="rounded-xl min-h-[60px] resize-y"
              maxLength={500}
            />
          </Section>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="flex-1 h-11 rounded-xl text-sm font-bold border bg-white"
              style={{ borderColor: C.border, color: C.text }}
            >
              ביטול
            </button>
            <button
              type="submit"
              disabled={submitting || uploading}
              className="flex-1 h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: C.primary }}
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'עדכן' : 'הוסף נהג'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <IdCard className="w-3.5 h-3.5" style={{ color: C.muted }} />
        <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: C.muted }}>
          {title}
        </p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, required, hint, error, children }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1" style={{ color: C.muted }}>
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-[10px] mt-1" style={{ color: C.muted }}>{hint}</p>
      )}
      {error && (
        <p className="text-[11px] text-red-600 mt-1">{error}</p>
      )}
    </div>
  );
}
