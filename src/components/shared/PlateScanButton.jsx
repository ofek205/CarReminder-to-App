/**
 * PlateScanButton — optional "photograph the plate" shortcut shared by
 * every surface that has a license-plate lookup input (the Dashboard
 * quick-check hero and the full /VehicleCheck page).
 *
 * Flow:
 *   tap → native file/camera picker → compress in-browser → send the
 *   bytes to ai-proxy as base64 → parse the extracted plate → hand it
 *   back to the parent via onPlateDetected(cleanedString). The parent
 *   pre-fills its plate input. We deliberately do NOT trigger the
 *   search — the user proofreads the number and presses the existing
 *   "בדוק רכב" button so a mis-scan can't burn gov.il quota.
 *
 * Privacy / retention:
 *   The image only exists in browser memory. It's posted to ai-proxy
 *   in the HTTP body and discarded the instant that promise resolves —
 *   no Storage upload, no DB write, no persistence. The project's
 *   `no-readAsDataURL` lint rule guards against base64 reaching
 *   Postgres columns (Sprint A); this in-memory AI-vision read is not
 *   that, so fileToBase64 carries a scoped eslint-disable.
 *
 * Why a shared component:
 *   The AI call + compression + prompt + error handling is non-trivial.
 *   Both the Dashboard hero and /VehicleCheck need the identical
 *   behaviour, so it lives here once. Parents only wire a callback and
 *   (optionally) a size variant.
 */

import React, { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { aiRequest } from '@/lib/aiProxy';
import { compressImage } from '@/lib/imageCompress';
import { validateUploadFile } from '@/lib/securityUtils';
import { C } from '@/lib/designTokens';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';

// Read a File as a base64 data URL — in-memory only, forwarded to
// ai-proxy and discarded. Never persisted. See the rule note above.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('שגיאה בקריאת התמונה'));
    // eslint-disable-next-line no-restricted-syntax -- in-memory AI scan; not persisted
    r.readAsDataURL(file);
  });
}

/**
 * @param {(plate: string) => void} onPlateDetected — called with the
 *   cleaned alphanumeric plate when the AI returns a usable result.
 * @param {boolean} [disabled] — parent-controlled (e.g. while a search
 *   is already in flight).
 * @param {'default'|'compact'} [size] — compact is the shorter variant
 *   for the Dashboard hero; default is the taller /VehicleCheck one.
 */
export default function PlateScanButton({ onPlateDetected, disabled = false, size = 'default' }) {
  const inputRef = useRef(null);
  const [scanning, setScanning] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (scanning) return;
    const v = validateUploadFile(file, 'photo', 10);
    if (!v.ok) {
      toastError(v.error, { action: 'plate_scan_validate' });
      e.target.value = '';
      return;
    }
    setScanning(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1024, maxHeight: 1024, quality: 0.7 });
      const base64 = await fileToBase64(compressed);
      const mediaType = base64.match(/^data:([^;]+);/)?.[1] || 'image/jpeg';
      const data = base64.split(',')[1];
      const json = await aiRequest({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 80,
        feature: 'plate_scan',
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text:
            'בתמונה: מספר רישוי של רכב ישראלי או מספר רישוי אווירי.\n' +
            'חלץ אותו בלבד. עבור רכב יבשתי: רק ספרות (5-8). עבור כלי טיס: אלפא-נומרי.\n' +
            'אם התמונה לא ברורה או לא של מספר רכב — החזר ריק.\n' +
            'החזר JSON בלבד, ללא טקסט נוסף: {"plate":""}'
          },
        ]}],
      });
      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*?\}/);
      const parsed = match ? JSON.parse(match[0]) : null;
      const cleaned = String(parsed?.plate || '').trim().replace(/[^0-9A-Za-z]/g, '');
      if (!cleaned || cleaned.length < 4) {
        toastError('לא הצלחנו לזהות מספר רישוי. נסה תמונה ברורה יותר או הקלד ידנית.', { action: 'plate_scan_no_match' });
        return;
      }
      onPlateDetected?.(cleaned);
      toast.success('מספר זוהה — בדוק שזה נכון ולחץ "בדוק רכב"');
    } catch (err) {
      toastError(err?.message || 'הסריקה נכשלה. נסה שוב או הקלד ידנית.', { action: 'plate_scan', err });
    } finally {
      setScanning(false);
      e.target.value = '';
    }
  };

  const heightClass = size === 'compact' ? 'h-10' : 'h-12';
  const textClass = size === 'compact' ? 'text-[13px]' : 'text-sm';

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || scanning}
        className={`w-full ${heightClass} rounded-xl border flex items-center justify-center gap-2 ${textClass} font-bold transition-colors disabled:opacity-60`}
        style={{ background: '#FFFFFF', borderColor: C.gray200, color: C.gray700 }}
      >
        {scanning ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            סורק...
          </>
        ) : (
          <>
            <Camera className="w-4 h-4" strokeWidth={2} />
            סרוק תמונה של מספר רכב
          </>
        )}
      </button>
    </>
  );
}
