import React, { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { aiRequest } from '@/lib/aiProxy';
import { toast } from 'sonner';
import { isNative, takePhoto } from '@/lib/capacitor';

/**
 * Small camera button that scans a photo/certificate and extracts an expiry date using AI.
 * Usage: <AiDateScan onDateExtracted={(date) => handleChange('field', date)} />
 */
export default function AiDateScan({ onDateExtracted, label = 'סרוק תוקף' }) {
  const fileRef = useRef(null);
  const [scanning, setScanning] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result;
      await scanDate(base64);
    };
    reader.readAsDataURL(file);
  };

  const scanDate = async (base64) => {
    setScanning(true);
    try {
      const mediaType = base64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
      const imageData = base64.split(',')[1];

      const json = await aiRequest({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
            { type: 'text', text: 'סרוק את התמונה הזו וחלץ את תאריך התוקף / תאריך הפקיעה של הציוד. חפש תאריך על המדבקה, התעודה או האריזה. החזר JSON בלבד: {"date":"YYYY-MM-DD"}. אם לא ניתן לזהות תאריך - החזר {"date":""}.' },
          ],
        }],
      });

      const text = json?.content?.[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        // Validate date format strictly
        if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
          const d = new Date(parsed.date);
          if (!isNaN(d.getTime()) && d.getFullYear() >= 2020 && d.getFullYear() <= 2040) {
            onDateExtracted(parsed.date);
          } else {
            toast.error('התאריך שזוהה לא תקין, נסה תמונה ברורה יותר');
          }
        } else {
          toast.error('לא הצלחתי לזהות תאריך בתמונה, נסה תמונה ברורה יותר');
        }
      } else {
        toast.error('לא הצלחתי לעבד את התמונה, נסה שוב');
      }
    } catch (err) {
      console.error('AI date scan error:', err);
      toast.error('שגיאה בסריקה, נסה שוב');
    } finally {
      setScanning(false);
    }
  };

  // Native (Capacitor): Camera plugin — the plain <input> picker only opens
  // the gallery on native, so users couldn't actually take a fresh photo of
  // an extinguisher / pyro label / certificate. Here we invoke the native
  // camera directly.
  const handleNativeCamera = async () => {
    try {
      const result = await takePhoto('CAMERA');
      if (!result?.dataUrl) return;
      await scanDate(result.dataUrl);
    } catch (err) {
      console.error('Native camera error:', err);
      toast.error('שגיאה בפתיחת המצלמה');
    }
  };

  const onButtonClick = () => {
    if (isNative) handleNativeCamera();
    else fileRef.current?.click();
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={onButtonClick}
        disabled={scanning}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-[0.95] disabled:opacity-60 mt-1"
        style={{ background: '#ECFDF5', color: '#065F46', border: '1px solid #A7F3D0' }}
      >
        {scanning ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> סורק...</>
        ) : (
          <><Camera className="w-3 h-3" /> {label}</>
        )}
      </button>
    </>
  );
}
