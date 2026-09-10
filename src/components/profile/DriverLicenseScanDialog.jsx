import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadScanFile, deleteFile } from '@/lib/supabaseStorage';
import { extractDataFromUploadedFile } from '@/lib/aiExtract';
import { isAiScanEnabled } from '@/lib/aiScanGate';
import { validateUploadFile } from '@/lib/securityUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Check, ScanLine, Camera, Info } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

function parseDate(str) {
  if (!str) return '';
  // format: DD.MM.YYYY or DD/MM/YYYY
  const parts = str.replace(/\//g, '.').split('.');
  if (parts.length !== 3) return '';
  let [d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  d = d.padStart(2, '0');
  m = m.padStart(2, '0');
  const result = `${y}-${m}-${d}`;
  return isNaN(new Date(result).getTime()) ? '' : result;
}

// step: upload | confirm
export default function DriverLicenseScanDialog({ open, onClose, onSave }) {
  const [step, setStep] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fileUrl, setFileUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  // Mirror of app_config.scan_extraction_enabled. Starts false so the AI
  // label never flashes in and then swaps on a slow network, matching the
  // pattern in VehicleInfoSection.jsx. Admins always resolve true, so QA
  // can still exercise the scan while it is off for users.
  const [aiScanAllowed, setAiScanAllowed] = useState(false);
  const [fields, setFields] = useState({
    full_name: '',
    birth_date: '',
    driver_license_number: '',
    license_expiration_date: '',
  });
  // Orphan-cleanup bookkeeping — same pattern as VesselScanWizard. We
  // track the storage_path of the uploaded scan and whether the user
  // committed it via onSave. On dialog close without commit, delete the
  // blob so we don't pay for abandoned uploads forever.
  const storagePathRef = useRef(null);
  const savedRef = useRef(false);

  // Re-read the gate every time the dialog opens rather than once on
  // mount: the flag is cached for 60s and an admin can flip it while the
  // app is open, so a mount-only read would go stale for the session.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    isAiScanEnabled().then(v => { if (!cancelled) setAiScanAllowed(!!v); });
    return () => { cancelled = true; };
  }, [open]);

  // Straight to the editable form with empty fields, no AI call. This is
  // the same transition handleExtract already makes when extraction
  // fails, reused here so the scan being switched off cannot dead-end
  // the user: before this, EVERY route to step 'confirm' ran through
  // handleExtract, so a disabled scan button would have left the dialog
  // with no way forward at all.
  const skipToManual = () => {
    setError('');
    setStep('confirm');
  };

  const reset = () => {
    setStep('upload'); setUploading(false); setExtracting(false);
    setFileUrl(''); setFileName(''); setError('');
    setFields({ full_name: '', birth_date: '', driver_license_number: '', license_expiration_date: '' });
    storagePathRef.current = null;
    savedRef.current = false;
  };

  const handleClose = () => {
    if (storagePathRef.current && !savedRef.current) {
      deleteFile(storagePathRef.current).catch(() => {});
    }
    reset();
    onClose();
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'doc', 10);
    if (!validation.ok) { setError(validation.error); e.target.value = ''; return; }
    setError('');
    setUploading(true);
    setFileName(file.name);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('no user');
      const { file_url, storage_path } = await uploadScanFile({ file, userId: user.id });
      setFileUrl(file_url);
      storagePathRef.current = storage_path;
    } catch {
      setError('שגיאה בהעלאת הקובץ. נסה שנית.');
    } finally {
      setUploading(false);
    }
  };

  const handleExtract = async () => {
    if (!fileUrl) { setError('יש להעלות קובץ תחילה'); return; }
    setExtracting(true);
    setError('');

    const schema = {
      type: 'object',
      properties: {
        last_name: { type: 'string', description: 'שם משפחה (שדה 1 ברישיון)' },
        first_name: { type: 'string', description: 'שם פרטי (שדה 2 ברישיון)' },
        birth_date: { type: 'string', description: 'תאריך לידה (שדה 3 ברישיון) בפורמט DD.MM.YYYY' },
        license_expiration_date: { type: 'string', description: 'תוקף רישיון (שדה 4b ברישיון) בפורמט DD.MM.YYYY' },
        driver_license_number: { type: 'string', description: 'מספר רישיון נהיגה (שדה 5 ברישיון)' },
      }
    };

    const result = await extractDataFromUploadedFile({ file_url: fileUrl, json_schema: schema, surface: 'driver_license_scan' });

    if (result.status !== 'success' || !result.output) {
      setError('לא הצלחתי לקרוא את הרישיון. ניתן להמשיך עם הזנה ידנית.');
      setStep('confirm');
      setExtracting(false);
      return;
    }

    const raw = result.output;
    const firstName = (raw.first_name || '').trim();
    const lastName = (raw.last_name || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');

    setFields({
      full_name: fullName,
      birth_date: parseDate(raw.birth_date || ''),
      driver_license_number: raw.driver_license_number || '',
      license_expiration_date: parseDate(raw.license_expiration_date || ''),
    });

    setExtracting(false);
    setStep('confirm');
  };

  const handleConfirm = () => {
    // Mark saved BEFORE handleClose so the orphan-cleanup branch
    // doesn't delete the image the parent is about to persist.
    savedRef.current = true;
    onSave({ ...fields, license_image_url: fileUrl });
    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-[#2D5233]" />
            סריקת רישיון נהיגה (AI)
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer hover:border-[#2D5233] bg-gray-50 transition-colors">
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-[#2D5233]" />
              ) : fileUrl ? (
                <>
                  <Check className="h-6 w-6 text-green-600" />
                  <span className="text-sm text-green-700 font-medium">הקובץ הועלה ✓</span>
                  <span className="text-xs text-gray-400">{fileName}</span>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-gray-400" />
                  <span className="text-sm text-gray-500">לחץ להעלאת תמונת רישיון</span>
                  <span className="text-xs text-gray-400">JPG, PNG, PDF</span>
                </>
              )}
              {/* PDF first: Android routes a media-typed chooser intent to
                  the photo picker, which would hide PDFs entirely. Matches
                  VehicleScanWizard and VesselScanWizard. */}
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFile} />
            </label>
            {/* Camera capture */}
            {!uploading && (
              <label className={`${buttonVariants({ variant: "outline" })} w-full cursor-pointer gap-2 justify-center border-[#2D5233] text-[#2D5233] hover:bg-[#FDF6F0]`}>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
                <Camera className="h-4 w-4" />
                צלם רישיון
              </label>
            )}

            {error && <p className="text-sm text-red-500 bg-red-50 p-2 rounded-lg">{error}</p>}

            {/* Quiet notice, not an alarm — appears only when an admin has
                switched scan extraction off. Without it the button below
                silently changes meaning and the user has no idea why. */}
            {!aiScanAllowed && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-lg flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <span>סריקה אוטומטית כרגע לא זמינה. הקובץ יישמר, ואת הפרטים אפשר למלא ידנית.</span>
              </p>
            )}

            <div className="flex gap-2">
              {/* One button, two meanings. With the gate off it goes straight
                  to the editable form instead of being disabled: every route
                  to step 'confirm' used to run through handleExtract, so a
                  disabled button here would dead-end the dialog entirely. */}
              <Button
                onClick={aiScanAllowed ? handleExtract : skipToManual}
                disabled={!fileUrl || extracting || uploading}
                className="flex-1 bg-[#2D5233] hover:bg-[#1E3D24] text-white"
              >
                {extracting
                  ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />מחלץ פרטים...</>
                  : aiScanAllowed ? 'חלץ פרטים בAI' : 'המשך להזנה ידנית'}
              </Button>
              <Button variant="outline" onClick={handleClose}>ביטול</Button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
              אמת את הפרטים שחולצו ועדכן במידת הצורך:
            </p>
            <div className="space-y-3">
              <div>
                <Label>שם מלא</Label>
                <Input value={fields.full_name} onChange={e => setFields(p => ({ ...p, full_name: e.target.value }))} placeholder="שם פרטי ומשפחה" />
              </div>
              <div>
                <Label>תאריך לידה</Label>
                <DateInput value={fields.birth_date} onChange={e => setFields(p => ({ ...p, birth_date: e.target.value }))} />
              </div>
              <div>
                <Label>מספר רישיון נהיגה</Label>
                <Input value={fields.driver_license_number} onChange={e => setFields(p => ({ ...p, driver_license_number: e.target.value }))} placeholder="מספר רישיון" dir="ltr" />
              </div>
              <div>
                <Label>תוקף רישיון</Label>
                <DateInput value={fields.license_expiration_date} onChange={e => setFields(p => ({ ...p, license_expiration_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={handleConfirm} className="flex-1 bg-[#2D5233] hover:bg-[#1E3D24] text-white">
                <Check className="h-4 w-4 ml-2" />
                אשר ושמור
              </Button>
              <Button variant="outline" onClick={() => setStep('upload')}>חזור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}