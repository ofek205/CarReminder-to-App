import React, { useState } from 'react';
import { aiRequest } from '@/lib/aiProxy';
import { compressImage } from '@/lib/imageCompress';
import { db } from '@/lib/supabaseEntities';
import { validateUploadFile } from '@/lib/securityUtils';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, Pencil, ScanLine, AlertTriangle, Check, Camera } from "lucide-react";
import { normalizePlate } from "../shared/DateStatusUtils";
import { isNative, takePhoto } from '@/lib/capacitor';

function parseIsraeliDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return '';
  let [d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  if (d.length < 2) d = '0' + d;
  if (m.length < 2) m = '0' + m;
  const result = `${y}-${m}-${d}`;
  // sanity check
  if (isNaN(new Date(result).getTime())) return '';
  return result;
}

const FIELD_LABELS = {
  license_plate: 'מספר רכב',
  test_due_date: 'תוקף טסט',
  owner_name: 'בעלים',
  first_registration_date: 'תאריך רישום',
  manufacturer: 'יצרן',
  model: 'דגם',
  vehicle_type: 'סוג רכב',
  engine_cc: 'נפח מנוע',
  year: 'שנת ייצור',
};

// steps: upload | preview | complete | compare | saving
export default function VehicleScanWizard({ open, onClose, vehicles = [], accountId, userId, onUpdateVehicle, onExtracted }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('upload');
  const [mode, setMode] = useState('new'); // new | update
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [editableFields, setEditableFields] = useState({});
  const [editingField, setEditingField] = useState(null);
  const [compareChecks, setCompareChecks] = useState({});
  const [plateMismatchWarning, setPlateMismatchWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [duplicateVehicle, setDuplicateVehicle] = useState(null); // existing vehicle with same plate
  // completion fields (not from license)
  const [completion, setCompletion] = useState({
    nickname: '',
    current_km: '',
    current_engine_hours: '',
    insurance_due_date: '',
    insurance_company: '',
  });
  const [usageMetric, setUsageMetric] = useState('קילומטרים');

  const reset = () => {
    setStep('upload'); setMode('new'); setSelectedVehicleId('');
    setUploadedFile(null); setFileUrl(''); setUploading(false); setExtracting(false);
    setEditableFields({}); setEditingField(null); setCompareChecks({});
    setPlateMismatchWarning(false); setSaving(false); setError(''); setDuplicateVehicle(null);
    setCompletion({ nickname: '', current_km: '', current_engine_hours: '', insurance_due_date: '', insurance_company: '' });
    setUsageMetric('קילומטרים');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'doc', 15);
    if (!validation.ok) { setError(validation.error); e.target.value = ''; return; }
    setError('');
    setUploading(true);
    try {
      // Compress the image before converting to base64. Phone camera
      // shots are routinely 4-8MB — once base64-encoded that pushes
      // the ai-proxy payload past Supabase's 8MB edge-function limit
      // and the request silently fails. compressImage is a no-op for
      // PDFs (it preserves non-image files), so documents pass
      // through untouched.
      const ready = await compressImage(file);
      setUploadedFile(ready);

      const reader = new FileReader();
      reader.onload = (ev) => {
        setFileUrl(ev.target.result);
        setUploading(false);
      };
      reader.onerror = () => {
        setError('שגיאה בקריאת הקובץ');
        setUploading(false);
      };
      reader.readAsDataURL(ready);
    } catch (err) {
      setError('שגיאה בהעלאה');
      setUploading(false);
    }
  };

  const handleExtract = async () => {
    if (!fileUrl) { setError('יש להעלות קובץ תחילה'); return; }
    if (mode === 'update' && !selectedVehicleId) { setError('יש לבחור רכב לעדכון'); return; }
    setExtracting(true);
    setError('');

    // Use AI proxy (vision-capable provider) to extract fields from the uploaded
    // image or PDF. Detect MIME type from the data URL prefix so PDFs aren't
    // mis-tagged as JPEGs (which used to cause the model to "see" garbage and
    // hallucinate plausible-but-wrong fields).
    let raw = null;
    let aiErrorCode = null;
    try {
      const mimeMatch = fileUrl.match(/^data:([^;]+);base64,/);
      const mediaType = mimeMatch?.[1] || 'image/jpeg';
      const fileData = fileUrl.split(',')[1] || '';
      const isPdf = mediaType === 'application/pdf';
      const sourcePart = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileData } }
        : { type: 'image',    source: { type: 'base64', media_type: mediaType, data: fileData } };

      const json = await aiRequest({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            sourcePart,
            { type: 'text', text: `אתה רואה תמונה או PDF של רישיון רכב ישראלי. חלץ את השדות המופיעים במסמך והחזר JSON בלבד.

חוקים קריטיים נגד המצאה:
- אם השדה לא מופיע במסמך. החזר "" (מחרוזת ריקה). אל תנחש.
- אם המסמך אינו רישיון רכב, או שאינך יכול לקרוא אותו (טשטוש, חיתוך, איכות נמוכה). החזר {"_unreadable": true}.
- מספר רכב הוא 7-8 ספרות עם מקפים. אל תחזיר אותיות.
- תאריכים בפורמט DD/MM/YYYY כפי שהם מודפסים במסמך הישראלי.

פורמט החזרה (החזר את האובייקט בלבד, ללא טקסט נוסף):
{"license_plate":"", "test_due_date":"", "owner_name":"", "first_registration_date":"", "manufacturer":"", "model":"", "vehicle_type":"", "engine_cc":0}` },
          ],
        }],
      });
      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed._unreadable) raw = null;
        else raw = parsed;
      }
    } catch (err) {
      // Remember which category of failure happened so we can show the
      // user a message they can actually act on. Before this we always
      // said "I couldn't read the document", which was misleading when
      // the real cause was network / auth / quota.
      aiErrorCode = err?.code || 'UNKNOWN';
      console.warn('Scan error:', aiErrorCode, err?.message);
    }

    if (!raw) {
      // Map aiProxy error codes to Hebrew user-facing copy.
      let msg;
      switch (aiErrorCode) {
        case 'TIMEOUT':
          msg = 'התשובה מהשרת מאחרת. נסה שוב על רשת יציבה יותר.'; break;
        case 'NETWORK':
          msg = 'אין חיבור לאינטרנט. בדוק את הרשת ונסה שוב.'; break;
        case 'RATE_LIMIT':
          msg = 'יותר מדי ניסיונות. נסה שוב בעוד דקה.'; break;
        case 'UNAUTHORIZED':
        case 'NO_SESSION':
          msg = 'ההתחברות פגה. יש להתחבר מחדש ולנסות שוב.'; break;
        case 'PROVIDER_UNAVAILABLE':
        case 'AI_UNAVAILABLE':
          msg = 'שירות AI לא זמין כרגע. נסה שוב בעוד רגע.'; break;
        default:
          // No error code → AI replied but couldn't extract. The
          // document itself was the problem, not the plumbing.
          msg = 'לא הצלחתי לקרוא את המסמך. ודא שהתמונה חדה וכל הרישיון נראה, או המשך להזנה ידנית.';
      }
      setError(msg);
      setExtracting(false);
      setEditableFields({});
      setStep('preview');
      return;
    }
    const parsed = {
      license_plate: normalizePlate(raw.license_plate || ''),
      test_due_date: parseIsraeliDate(raw.test_due_date || ''),
      owner_name: raw.owner_name || '',
      first_registration_date: parseIsraeliDate(raw.first_registration_date || ''),
      manufacturer: raw.manufacturer || '',
      model: raw.model || '',
      vehicle_type: raw.vehicle_type || '',
      engine_cc: raw.engine_cc ? String(raw.engine_cc) : '',
      year: raw.first_registration_date ? (() => {
        const y = new Date(parseIsraeliDate(raw.first_registration_date)).getFullYear();
        return isNaN(y) ? '' : String(y);
      })() : '',
    };
    const cleaned = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v && v !== '0' && v !== 'NaN'));

    setEditableFields(cleaned);

    // Determine usage metric from vehicle type
    const vtype = (cleaned.vehicle_type || '').toLowerCase();
    if (vtype.includes('מנוע') || vtype.includes('טרקטור') || vtype.includes('שטח')) {
      setUsageMetric('שעות מנוע');
    }

    if (mode === 'update' && selectedVehicleId) {
      const existingVehicle = vehicles.find(v => v.id === selectedVehicleId);
      if (existingVehicle && cleaned.license_plate &&
          normalizePlate(existingVehicle.license_plate) !== normalizePlate(cleaned.license_plate)) {
        setPlateMismatchWarning(true);
      }
      const checks = {};
      Object.keys(cleaned).forEach(k => { checks[k] = k === 'test_due_date'; });
      setCompareChecks(checks);
    }

    setExtracting(false);
    setStep('preview');
  };

  const handleFieldEdit = (field, value) => setEditableFields(prev => ({ ...prev, [field]: value }));

  // After preview confirmation for new vehicle -> go to completion step
  // Check for duplicates first
  const handleConfirmPreview = async () => {
    if (mode === 'update') {
      setStep('compare');
      return;
    }
    // Check for duplicate plate
    if (editableFields.license_plate) {
      const normalized = normalizePlate(editableFields.license_plate);
      const dup = vehicles.find(v => normalizePlate(v.license_plate) === normalized);
      if (dup) {
        setDuplicateVehicle(dup);
        return; // stay on preview, show duplicate warning
      }
    }
    // If caller wants the extracted data instead of the full wizard, hand it off.
    // handleClose BEFORE onExtracted so React batches: onClose's setSelectedMethod(null)
    // is overwritten by handleScanExtracted's setSelectedMethod('scan'). Last wins ✓
    if (onExtracted) {
      const data = { ...editableFields };
      handleClose();
      onExtracted(data);
      return;
    }
    setStep('complete');
  };

  const handleDuplicateUpdate = () => {
    // Switch to update mode for the duplicate
    setSelectedVehicleId(duplicateVehicle.id);
    setMode('update');
    setDuplicateVehicle(null);
    const checks = {};
    Object.keys(editableFields).forEach(k => { checks[k] = k === 'test_due_date'; });
    setCompareChecks(checks);
    setStep('compare');
  };

  const handleDuplicateForce = () => {
    setDuplicateVehicle(null);
    setStep('complete');
  };

  // Final save: create new vehicle
  const handleSaveNew = async () => {
    setSaving(true);
    const data = {
      account_id: accountId,
      license_plate: editableFields.license_plate || '',
      license_plate_normalized: normalizePlate(editableFields.license_plate || ''),
      manufacturer: editableFields.manufacturer || '',
      model: editableFields.model || '',
      vehicle_type: editableFields.vehicle_type || '',
      year: editableFields.year ? Number(editableFields.year) : undefined,
      test_due_date: editableFields.test_due_date || undefined,
      nickname: completion.nickname || undefined,
      current_km: completion.current_km ? Number(completion.current_km) : undefined,
      current_engine_hours: completion.current_engine_hours ? Number(completion.current_engine_hours) : undefined,
      insurance_due_date: completion.insurance_due_date || undefined,
      insurance_company: completion.insurance_company || undefined,
    };
    // Clean empty
    Object.keys(data).forEach(k => { if (data[k] === '' || data[k] === undefined) delete data[k]; });

    try {
      const vehicle = await db.vehicles.create(data);

      // Save document
      if (fileUrl && vehicle?.id) {
        try {
          await db.documents.create({
            account_id: accountId,
            vehicle_id: vehicle.id,
            document_type: 'רישיון רכב',
            title: 'רישיון רכב (סרוק)',
            file_url: fileUrl,
          });
        } catch (docErr) { console.warn('Document save skipped:', docErr?.message); }
      }

      setSaving(false);
      handleClose();
      navigate(createPageUrl(`VehicleDetail?id=${vehicle.id}`));
    } catch (err) {
      setSaving(false);
      setError('שגיאה בשמירה: ' + (err?.message || ''));
    }
  };

  // Save update for existing vehicle
  const handleSaveUpdate = async () => {
    setSaving(true);
    const vehicleUpdate = {};
    Object.entries(compareChecks).forEach(([k, checked]) => {
      if (!checked || !editableFields[k]) return;
      if (k === 'license_plate') {
        vehicleUpdate.license_plate = editableFields[k];
        vehicleUpdate.license_plate_normalized = normalizePlate(editableFields[k]);
      } else if (k === 'year') {
        vehicleUpdate.year = Number(editableFields[k]);
      } else {
        vehicleUpdate[k] = editableFields[k];
      }
    });

    try {
      if (Object.keys(vehicleUpdate).length > 0) {
        await db.vehicles.update(selectedVehicleId, vehicleUpdate);
      }
      if (fileUrl) {
        try {
          await db.documents.create({
            account_id: accountId,
            vehicle_id: selectedVehicleId,
            document_type: 'רישיון רכב',
            title: 'רישיון רכב (סרוק)',
            file_url: fileUrl,
          });
        } catch (docErr) { console.warn('Document save skipped:', docErr?.message); }
      }
      setSaving(false);
      if (onUpdateVehicle) onUpdateVehicle(selectedVehicleId);
      handleClose();
      navigate(createPageUrl(`VehicleDetail?id=${selectedVehicleId}`));
    } catch (err) {
      setSaving(false);
      setError('שגיאה בעדכון: ' + (err?.message || ''));
    }
  };

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);
  const nonEmptyFields = Object.entries(editableFields).filter(([, v]) => v && v !== '');

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <ScanLine className="h-5 w-5 text-[#2D5233]" />
            סריקת רישיון חכמה
          </DialogTitle>
        </DialogHeader>

        {/* STEP: UPLOAD */}
        {step === 'upload' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="font-medium">מה תרצה לעשות?</Label>
              <div className="flex flex-col gap-2">
                {[
                  { value: 'new', label: 'צור רכב חדש מהנתונים' },
                  { value: 'update', label: 'עדכן רכב קיים' },
                ].map(opt => (
                  <label key={opt.value} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${mode === opt.value ? 'bg-[#E8F2EA] border-[#2D5233]' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input type="radio" name="mode" value={opt.value} checked={mode === opt.value} onChange={() => setMode(opt.value)} className="accent-[#2D5233]" />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {mode === 'update' && (
              <div>
                <Label>בחר רכב לעדכון</Label>
                <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                  <SelectTrigger><SelectValue placeholder="בחר רכב..." /></SelectTrigger>
                  <SelectContent>
                    {vehicles.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.nickname || `${v.manufacturer || ''} ${v.model || ''} (${v.license_plate})`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>העלה רישיון רכב</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {/* File upload */}
                <label className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-[#D8E5D9] rounded-2xl cursor-pointer hover:border-[#4B7A53] transition-colors bg-white text-center">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[#2D5233]" />
                  ) : fileUrl ? (
                    <Check className="h-5 w-5 text-green-600" />
                  ) : (
                    <Upload className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="text-xs text-gray-600 font-medium">העלה קובץ</span>
                  <span className="text-[10px] text-gray-400">PDF / JPG / PNG</span>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleFileSelect} />
                </label>
                {/* Camera capture. uses the Capacitor Camera plugin on native
                    (Android WebView silently ignores capture="environment" and
                    only opens the gallery, so we route natives to takePhoto()). */}
                <button
                  type="button"
                  onClick={async () => {
                    if (!isNative) {
                      document.getElementById('vsw-camera-input')?.click();
                      return;
                    }
                    try {
                      const result = await takePhoto('CAMERA');
                      if (!result?.dataUrl) return;
                      // Fake a change event so handleFileSelect doesn't need to change
                      const blob = await (await fetch(result.dataUrl)).blob();
                      const file = new File([blob], `scan-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' });
                      handleFileSelect({ target: { files: [file], value: '' } });
                    } catch (err) {
                      console.error('Native camera error:', err);
                    }
                  }}
                  className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-[#D8E5D9] rounded-2xl cursor-pointer hover:border-[#4B7A53] transition-colors bg-white text-center">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-[#2D5233]" />
                  ) : (
                    <Camera className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="text-xs text-gray-600 font-medium">צלם עכשיו</span>
                  <span className="text-[10px] text-gray-400">פתח מצלמה</span>
                  <input id="vsw-camera-input" type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
                </button>
              </div>
              {fileUrl && (
                <p className="mt-2 text-sm text-green-700 flex items-center gap-1.5">
                  <Check className="h-4 w-4 shrink-0" />
                  {uploadedFile?.name || 'הקובץ הועלה בהצלחה'}
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-500 bg-red-50 p-2 rounded-lg">{error}</p>}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleExtract} disabled={!fileUrl || extracting || uploading}
                className="flex-1 font-bold" style={{ background: '#FFBF00', color: '#2D5233' }}>
                {extracting ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />מחלץ פרטים...</> : 'חלץ פרטים'}
              </Button>
              <Button variant="outline" onClick={handleClose} className="border-[#D8E5D9] text-[#7A8A7C]">ביטול</Button>
            </div>
          </div>
        )}

        {/* STEP: PREVIEW */}
        {step === 'preview' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
              {nonEmptyFields.length > 0 ? 'מצאתי את הפרטים הבאים, ניתן לערוך לפני האישור:' : 'לא חולצו פרטים. המשך להשלמה ידנית.'}
            </p>

            {/* Retry button — when the scan came back empty/failed, give
                the user an inline way to try again with the same file
                instead of forcing them to back out of the wizard. */}
            {nonEmptyFields.length === 0 && fileUrl && (
              <Button variant="outline" className="w-full"
                onClick={() => { setError(''); handleExtract(); }}
                disabled={extracting}>
                {extracting ? <><Loader2 className="h-4 w-4 animate-spin ml-2" /> סורק...</> : 'נסה סריקה שוב'}
              </Button>
            )}

            {plateMismatchWarning && (
              <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>לוחית הרישוי ברישיון ({editableFields.license_plate}) שונה מהרכב שנבחר ({selectedVehicle?.license_plate}).</span>
              </div>
            )}

            {/* Duplicate warning */}
            {duplicateVehicle && (
              <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 space-y-2">
                <div className="flex items-start gap-2 text-yellow-800 text-sm">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>רכב עם מספר {editableFields.license_plate} כבר קיים ({duplicateVehicle.manufacturer} {duplicateVehicle.model}). רוצה לעדכן אותו במקום?</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleDuplicateUpdate} className="bg-[#2D5233] hover:bg-[#1E3D24] text-white">עדכן רכב קיים</Button>
                  <Button size="sm" variant="outline" onClick={handleDuplicateForce}>צור בכל זאת</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDuplicateVehicle(null)}>ביטול</Button>
                </div>
              </div>
            )}

            {nonEmptyFields.length > 0 && (
              <div className="space-y-1 border rounded-xl p-2">
                {nonEmptyFields.map(([field, value]) => (
                  <div key={field} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-50">
                    <button onClick={() => setEditingField(editingField === field ? null : field)} className="text-gray-400 hover:text-[#2D5233] shrink-0">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-gray-500">{FIELD_LABELS[field] || field}: </span>
                      {editingField === field ? (
                        <Input type={field.includes('date') ? 'date' : 'text'} value={value} onChange={e => handleFieldEdit(field, e.target.value)} autoFocus className="h-7 text-sm inline-block w-auto" onBlur={() => setEditingField(null)} />
                      ) : (
                        <span className="text-sm font-medium text-gray-800">{value}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!duplicateVehicle && (
              <div className="flex flex-col gap-2 pt-2 border-t">
                <Button onClick={handleConfirmPreview} className="w-full font-bold" style={{ background: '#FFBF00', color: '#2D5233' }}>
                  <Check className="h-4 w-4 ml-2" />
                  {mode === 'new' ? 'אשר והמשך להשלמה' : 'אשר והמשך להשוואה'}
                </Button>
                <Button variant="ghost" onClick={() => setStep('upload')} className="w-full text-gray-500">חזור</Button>
              </div>
            )}
          </div>
        )}

        {/* STEP: COMPLETE (new vehicle, fill missing fields) */}
        {step === 'complete' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 bg-green-50 p-3 rounded-lg">
              כמעט סיימנו! השלם את הפרטים הנוספים:
            </p>

            <div className="space-y-3">
              <div>
                <Label>כינוי לרכב (אופציונלי)</Label>
                <Input value={completion.nickname} onChange={e => setCompletion(p => ({ ...p, nickname: e.target.value }))} placeholder='למשל: "הקורולה של אבא"' />
              </div>

              {usageMetric === 'קילומטרים' && (
                <div>
                  <Label>כמה ק"מ נמצא הרכב כרגע?</Label>
                  <Input type="number" value={completion.current_km} onChange={e => setCompletion(p => ({ ...p, current_km: e.target.value }))} placeholder="קילומטראז׳" />
                </div>
              )}
              {usageMetric === 'שעות מנוע' && (
                <div>
                  <Label>כמה שעות מנוע?</Label>
                  <Input type="number" value={completion.current_engine_hours} onChange={e => setCompletion(p => ({ ...p, current_engine_hours: e.target.value }))} placeholder="שעות מנוע" />
                </div>
              )}

              <div>
                <Label>תאריך ביטוח (אופציונלי)</Label>
                <DateInput value={completion.insurance_due_date} onChange={e => setCompletion(p => ({ ...p, insurance_due_date: e.target.value }))} />
              </div>

              <div>
                <Label>חברת ביטוח (אופציונלי)</Label>
                <Select value={completion.insurance_company} onValueChange={v => setCompletion(p => ({ ...p, insurance_company: v }))}>
                  <SelectTrigger><SelectValue placeholder="בחר חברת ביטוח" /></SelectTrigger>
                  <SelectContent>
                    {['ליברה','הפניקס','כלל','ישיר','מגדל','הראל','איילון','AIG','שומרה','אחר'].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Summary of what will be saved */}
            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 space-y-0.5">
              <p className="font-medium text-gray-700 mb-1">יישמרו הנתונים הבאים:</p>
              {nonEmptyFields.map(([k, v]) => <p key={k}><span className="font-medium">{FIELD_LABELS[k] || k}:</span> {v}</p>)}
            </div>

            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={handleSaveNew} disabled={saving} className="flex-1 bg-[#2D5233] hover:bg-[#1E3D24] text-white">
                {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Check className="h-4 w-4 ml-2" />}
                שמור רכב
              </Button>
              <Button variant="outline" onClick={() => setStep('preview')}>חזור</Button>
            </div>
          </div>
        )}

        {/* STEP: COMPARE (update mode) */}
        {step === 'compare' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
              בחר אילו שדות לעדכן. ברירת מחדל: רק תוקף הטסט.
            </p>
            <div className="space-y-1">
              <div className="grid grid-cols-4 gap-1 text-xs font-medium text-gray-500 px-2 pb-1 border-b">
                <span>שדה</span><span>נוכחי</span><span>מהרישיון</span><span className="text-center">עדכן</span>
              </div>
              {nonEmptyFields.filter(([k]) => k !== 'license_plate' || !plateMismatchWarning).map(([field, newValue]) => {
                const isMismatch = field === 'license_plate' && plateMismatchWarning;
                if (isMismatch) return null;
                const currentValue = selectedVehicle?.[field] || '-';
                return (
                  <div key={field} className="grid grid-cols-4 gap-1 items-center p-2 rounded-lg hover:bg-gray-50 text-sm">
                    <span className="text-gray-600 text-xs">{FIELD_LABELS[field] || field}</span>
                    <span className="text-gray-400 truncate text-xs">{currentValue}</span>
                    <span className="font-medium truncate text-xs">{newValue}</span>
                    <div className="flex justify-center">
                      <input type="checkbox" checked={!!compareChecks[field]} onChange={e => setCompareChecks(prev => ({ ...prev, [field]: e.target.checked }))} className="accent-[#2D5233] h-4 w-4" />
                    </div>
                  </div>
                );
              })}
              {plateMismatchWarning && (
                <div className="p-2 bg-yellow-50 rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!compareChecks['license_plate']} onChange={e => setCompareChecks(prev => ({ ...prev, license_plate: e.target.checked }))} className="accent-yellow-600 h-4 w-4" />
                    <span className="text-xs text-yellow-800">
                      <AlertTriangle className="h-3 w-3 inline ml-1" />
                      עדכון לוחית רישוי: {selectedVehicle?.license_plate} → {editableFields.license_plate}
                    </span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button onClick={handleSaveUpdate} disabled={saving} className="flex-1 bg-[#2D5233] hover:bg-[#1E3D24] text-white">
                {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Check className="h-4 w-4 ml-2" />}
                שמור עדכונים
              </Button>
              <Button variant="outline" onClick={() => setStep('preview')}>חזור</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}