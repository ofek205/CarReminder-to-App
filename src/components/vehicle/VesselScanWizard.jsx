/**
 * VesselScanWizard.jsx
 * AI-powered scan wizard for Israeli vessel / yacht license documents.
 * Uses the ai-proxy Edge Function for Gemini extraction and Supabase
 * Storage for the uploaded image.
 */

import React, { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadScanFile, deleteFile } from '@/lib/supabaseStorage';
import { extractDataFromUploadedFile } from '@/lib/aiExtract';
import { validateUploadFile } from '@/lib/securityUtils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Upload, Pencil, Anchor, AlertTriangle, Check, Camera, Info } from "lucide-react";

//  Helpers 

/** Parse DD/MM/YYYY (or DD/MM/YY) → YYYY-MM-DD. Returns '' on failure. */
function parseDate(dateStr) {
  if (!dateStr) return '';
  const clean = dateStr.trim().replace(/[.\-]/g, '/');
  const parts = clean.split('/');
  if (parts.length !== 3) return '';
  let [d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  d = d.padStart(2, '0');
  m = m.padStart(2, '0');
  const iso = `${y}-${m}-${d}`;
  return isNaN(new Date(iso).getTime()) ? '' : iso;
}

/** Strip everything except digits from a string. */
function digitsOnly(str) {
  return (str || '').replace(/[^0-9]/g, '');
}

/** Human-readable labels shown in the preview step. */
const FIELD_LABELS = {
  registration_number: 'מספר רישום כלי שייט',
  valid_until:         'תוקף כושר שייט',
  vessel_name:         'שם כלי השייט',
  vessel_type:         'סוג כלי שייט',
  length:              'אורך',
  owner_name:          'שם הבעלים',
  engine_details:      'פרטי מנוע',
  hull_material:       'חומר גוף',
};

//  JSON schema sent to the AI extraction API 

const VESSEL_SCHEMA = {
  type: 'object',
  properties: {
    registration_number: {
      type: 'string',
      description:
        'Vessel registration / identity number. May appear as "IDENTITY NUMBER", "מספר זיהוי", "מספר רישום" or similar. Digits and letters only.',
    },
    valid_until: {
      type: 'string',
      description:
        'License / seaworthiness validity date. May appear as "VALID UNTIL", "תוקף עד", "כושר שייט עד". Format: DD/MM/YYYY.',
    },
    vessel_name: {
      type: 'string',
      description:
        'Name of the vessel / yacht. May appear as "VESSEL NAME", "שם כלי השייט", "שם הסירה".',
    },
    vessel_type: {
      type: 'string',
      description:
        'Type or category of the vessel. May appear as "VESSEL TYPE", "סוג כלי השייט", "קטגוריה". Examples: מנועית, מפרשית, אופנוע ים, סירת גומי.',
    },
    length: {
      type: 'string',
      description:
        'Overall length of the vessel. May appear as "LENGTH", "אורך". Include unit if present (e.g., "6.5m" or "21 ft").',
    },
    owner_name: {
      type: 'string',
      description:
        'Full name of the vessel owner. May appear as "VESSEL IN THE POSSESSION OF", "בעלים", "שם הבעלים".',
    },
    engine_details: {
      type: 'string',
      description:
        'Engine manufacturer and/or model. May appear as "ENGINE", "מנוע", "יצרן מנוע".',
    },
    hull_material: {
      type: 'string',
      description:
        'Hull material. May appear as "HULL MATERIAL", "חומר הגוף". Examples: FRP, אלומיניום, עץ.',
    },
  },
};

//  Component 

/**
 * Props:
 *   open         boolean
 *   onClose      () => void
 *   onExtracted  (vesselFields: object) => void   - called with parsed data
 *   accountId    string
 *   userId       string
 */
export default function VesselScanWizard({ open, onClose, onExtracted, accountId, userId }) {
  const [step, setStep] = useState('upload'); // upload | preview
  const [uploadedFile, setUploadedFile] = useState(null);
  const [fileUrl, setFileUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fields, setFields] = useState({});        // parsed + editable extracted fields
  const [editingField, setEditingField] = useState(null);
  const [partialWarning, setPartialWarning] = useState(false);
  const [error, setError] = useState('');
  // Keep the storage path separately so we can delete the file from the
  // bucket if the user abandons the wizard before confirming extraction.
  // Without this cleanup, every cancelled scan left an orphan blob in
  // scans/{uid}/ forever.
  const storagePathRef = useRef(null);
  // Set to true when extraction has been accepted — tells the close
  // handler NOT to delete the file (it's now owned by a real document).
  const extractedRef = useRef(false);

  //  Reset
  const reset = () => {
    setStep('upload');
    setUploadedFile(null);
    setFileUrl('');
    setUploading(false);
    setExtracting(false);
    setFields({});
    setEditingField(null);
    setPartialWarning(false);
    setError('');
    storagePathRef.current = null;
    extractedRef.current = false;
  };

  const handleClose = () => {
    // Orphan cleanup: if an upload happened but the user didn't commit
    // the extraction, delete the file from the bucket.
    if (storagePathRef.current && !extractedRef.current) {
      deleteFile(storagePathRef.current).catch(() => {});
    }
    reset();
    onClose();
  };

  //  Upload 
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const validation = validateUploadFile(file, 'doc', 15);
    if (!validation.ok) { setError(validation.error); e.target.value = ''; return; }
    setError('');
    setUploadedFile(file);
    setUploading(true);
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

  //  AI Extraction 
  const handleExtract = async () => {
    if (!fileUrl) { setError('יש להעלות קובץ תחילה'); return; }
    setExtracting(true);
    setError('');
    setPartialWarning(false);

    try {
      const result = await extractDataFromUploadedFile({
        file_url: fileUrl,
        json_schema: VESSEL_SCHEMA,
      });

      if (result.status !== 'success' || !result.output) {
        setError('לא הצלחנו לקרוא את המסמך. ניתן להמשיך עם הזנה ידנית.');
        setFields({});
        setStep('preview');
        return;
      }

      const raw = result.output;

      // Map AI output → internal field names, parse dates
      const parsed = {
        registration_number: (raw.registration_number || '').trim(),
        valid_until:         parseDate(raw.valid_until || ''),
        vessel_name:         (raw.vessel_name || '').trim(),
        vessel_type:         (raw.vessel_type || '').trim(),
        length:              (raw.length || '').trim(),
        owner_name:          (raw.owner_name || '').trim(),
        engine_details:      (raw.engine_details || '').trim(),
        hull_material:       (raw.hull_material || '').trim(),
      };

      // Keep only non-empty values
      const cleaned = Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => v !== '')
      );

      setFields(cleaned);

      // Warn if fewer than 2 meaningful fields extracted
      const keyFields = ['registration_number', 'valid_until', 'vessel_name'];
      const foundKey = keyFields.filter(k => cleaned[k]);
      if (foundKey.length < 2) setPartialWarning(true);

      setStep('preview');
    } catch {
      setError('אירעה שגיאה בעת ניתוח המסמך. ניתן להמשיך עם הזנה ידנית.');
      setStep('preview');
    } finally {
      setExtracting(false);
    }
  };

  //  Field editing 
  const handleFieldEdit = (key, value) =>
    setFields(prev => ({ ...prev, [key]: value }));

  //  Confirm & return data 
  // IMPORTANT: handleClose() must run BEFORE onExtracted() so that the
  // onClose callback's setSelectedMethod(null) is batched BEFORE
  // handleVesselScanExtracted's setSelectedMethod('scan').
  // React 18 batches both; the LAST setter wins → 'scan' ✓
  const handleConfirm = () => {
    const data = { ...fields, _fileUrl: fileUrl };
    // Mark extracted so handleClose (about to run) does NOT delete the
    // uploaded file — the parent now owns it and will either persist the
    // URL in the document record or re-upload if the user cancels later.
    extractedRef.current = true;
    handleClose();       // runs onClose → may call setSelectedMethod(null)
    onExtracted(data);   // runs AFTER → setSelectedMethod('scan') wins
  };

  //  Derived 
  const nonEmpty = Object.entries(fields).filter(([, v]) => v !== '');

  //  Render 
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <Anchor className="h-5 w-5 text-cyan-600" />
            סריקת רישיון כלי שייט חכמה
          </DialogTitle>
        </DialogHeader>

        {/*  STEP: UPLOAD  */}
        {step === 'upload' && (
          <div className="space-y-5">

            {/* Info banner */}
            <div className="flex items-start gap-2 bg-cyan-50 border border-cyan-200 rounded-xl p-3 text-sm text-cyan-800">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                צלם או העלה את רישיון כלי השייט הישראלי. המערכת תחלץ אוטומטית
                את מספר הרישום, תוקף כושר השייט, שם הכלי ועוד.
              </span>
            </div>

            {/* Upload area */}
            <div>
              <Label className="font-medium">העלה רישיון כלי שייט</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">

                {/* File upload */}
                <label className="flex flex-col items-center gap-2 p-4 border-2 border-dashed rounded-xl cursor-pointer hover:border-cyan-500 transition-colors bg-gray-50 text-center">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
                  ) : fileUrl ? (
                    <Check className="h-5 w-5 text-green-600" />
                  ) : (
                    <Upload className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="text-xs text-gray-600 font-medium">העלה קובץ</span>
                  <span className="text-[10px] text-gray-400">PDF / JPG / PNG</span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </label>

                {/* Camera capture */}
                <label className="flex flex-col items-center gap-2 p-4 border-2 border-dashed rounded-xl cursor-pointer hover:border-cyan-500 transition-colors bg-gray-50 text-center">
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
                  ) : (
                    <Camera className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="text-xs text-gray-600 font-medium">צלם עכשיו</span>
                  <span className="text-[10px] text-gray-400">פתח מצלמה</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </label>
              </div>

              {fileUrl && (
                <p className="mt-2 text-sm text-green-700 flex items-center gap-1.5">
                  <Check className="h-4 w-4 shrink-0" />
                  {uploadedFile?.name || 'הקובץ הועלה בהצלחה'}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 p-2 rounded-lg">{error}</p>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleExtract}
                disabled={!fileUrl || extracting || uploading}
                className="flex-1 bg-cyan-700 hover:bg-cyan-800 text-white"
              >
                {extracting
                  ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />מנתח מסמך...</>
                  : <><Anchor className="h-4 w-4 ml-2" />חלץ פרטי כלי השייט</>
                }
              </Button>
              <Button variant="outline" onClick={handleClose}>ביטול</Button>
            </div>
          </div>
        )}

        {/*  STEP: PREVIEW  */}
        {step === 'preview' && (
          <div className="space-y-4">

            {/* Status banner */}
            {nonEmpty.length > 0 ? (
              <p className="text-sm text-gray-700 bg-green-50 border border-green-200 p-3 rounded-xl flex items-start gap-2">
                <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                זיהינו {nonEmpty.length} שד{nonEmpty.length === 1 ? 'ה' : 'ות'}, ניתן לערוך לפני האישור.
              </p>
            ) : (
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 p-3 rounded-xl">
                לא זוהו פרטים מהמסמך. ניתן להמשיך עם הזנה ידנית בטופס.
              </p>
            )}

            {/* Partial extraction warning */}
            {partialWarning && nonEmpty.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  לא הצלחנו לזהות את כל הפרטים מהמסמך, אפשר להשלים ידנית בטופס.
                </span>
              </div>
            )}

            {/* Extracted fields - editable */}
            {nonEmpty.length > 0 && (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                {nonEmpty.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <button
                      type="button"
                      onClick={() => setEditingField(editingField === key ? null : key)}
                      className="text-gray-400 hover:text-cyan-600 shrink-0"
                      title="ערוך"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-gray-400 block">
                        {FIELD_LABELS[key] || key}
                      </span>
                      {editingField === key ? (
                        <Input
                          type={key === 'valid_until' ? 'date' : 'text'}
                          value={value}
                          onChange={e => handleFieldEdit(key, e.target.value)}
                          autoFocus
                          className="h-7 text-sm mt-0.5"
                          onBlur={() => setEditingField(null)}
                        />
                      ) : (
                        <span className="text-sm font-medium text-gray-800">
                          {key === 'valid_until' && value
                            ? new Date(value).toLocaleDateString('he-IL')
                            : value}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Helper text */}
            <p className="text-[11px] text-gray-400 text-center">
              הנתונים ימולאו בטופס - ניתן לערוך הכל לפני השמירה
            </p>

            <div className="flex flex-col gap-2 pt-1 border-t">
              <Button
                onClick={handleConfirm}
                className="w-full bg-cyan-700 hover:bg-cyan-800 text-white"
              >
                <Check className="h-4 w-4 ml-2" />
                {nonEmpty.length > 0 ? 'אשר ומלא את הטופס' : 'המשך לטופס ידני'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setStep('upload')}
                className="w-full text-gray-500"
              >
                חזור
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
