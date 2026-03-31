import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { validateUploadFile } from '@/lib/securityUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, Check, ScanLine, Camera } from "lucide-react";
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
  const [fields, setFields] = useState({
    full_name: '',
    birth_date: '',
    driver_license_number: '',
    license_expiration_date: '',
  });

  const reset = () => {
    setStep('upload'); setUploading(false); setExtracting(false);
    setFileUrl(''); setFileName(''); setError('');
    setFields({ full_name: '', birth_date: '', driver_license_number: '', license_expiration_date: '' });
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'doc', 10);
    if (!validation.ok) { setError(validation.error); e.target.value = ''; return; }
    setError('');
    setUploading(true);
    setFileName(file.name);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFileUrl(file_url);
    setUploading(false);
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

    const result = await base44.integrations.Core.ExtractDataFromUploadedFile({ file_url: fileUrl, json_schema: schema });

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
              <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={handleFile} />
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

            <div className="flex gap-2">
              <Button onClick={handleExtract} disabled={!fileUrl || extracting || uploading} className="flex-1 bg-[#2D5233] hover:bg-[#1E3D24] text-white">
                {extracting ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />מחלץ פרטים...</> : 'חלץ פרטים בAI'}
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