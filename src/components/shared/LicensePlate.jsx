import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';

/**
 * Israeli license plate display. yellow plate, IL flag, copy button.
 * Usage: <LicensePlate value={vehicle.license_plate} size="sm|md|lg" />
 */
export default function LicensePlate({ value, size = 'md', showCopy = true, className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      toast.success('המספר הועתק');
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error('לא ניתן להעתיק במכשיר הזה');
    }
  };

  // Size presets. The plate number is the only info that matters. the IL
  // badge is a brand signal, so we keep it compact (flag only, no stacked
  // "IL" text that was 4-8px and illegible anyway) and give the number
  // the room it needs to actually be readable.
  const P = size === 'sm'
    ? { height: 18, padding: '1px 3px 1px 2px', textSize: 10, flagWidth: 9,  flagHeight: 6,  borderWidth: 1.5, flagPad: '1px 2px' }
    : size === 'lg'
    ? { height: 32, padding: '3px 8px 3px 5px', textSize: 16, flagWidth: 16, flagHeight: 11, borderWidth: 2,   flagPad: '3px 4px' }
    : { height: 24, padding: '2px 5px 2px 3px', textSize: 12, flagWidth: 11, flagHeight: 7,  borderWidth: 1.5, flagPad: '2px 3px' };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} dir="ltr">
      <span
        className="inline-flex items-center gap-1.5 rounded shrink-0"
        style={{
          padding: P.padding,
          background: '#FFBF00',
          border: `${P.borderWidth}px solid #1A3A5C`,
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          height: P.height,
        }}>
        {/* IL flag badge. flag only; no stacked "IL" text (was illegible at small sizes) */}
        <span className="flex items-center justify-center rounded-sm"
          style={{ background: '#1A3A5C', padding: P.flagPad }}>
          <svg viewBox="0 0 60 40" style={{ width: P.flagWidth, height: P.flagHeight, display: 'block' }} aria-label="דגל ישראל">
            <rect width="60" height="40" fill="white" />
            <rect y="4" width="60" height="5" fill="#003DA5" />
            <rect y="31" width="60" height="5" fill="#003DA5" />
            <polygon points="30,10 34.5,21 25.5,21" fill="none" stroke="#003DA5" strokeWidth="2" />
            <polygon points="30,26 25.5,15 34.5,15" fill="none" stroke="#003DA5" strokeWidth="2" />
          </svg>
        </span>
        <span className="font-black leading-none" style={{ color: '#1a1a1a', fontSize: P.textSize, letterSpacing: '0.02em' }}>
          {value}
        </span>
      </span>
      {showCopy && (
        <button onClick={handleCopy} type="button"
          className="w-6 h-6 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-all active:scale-90 shrink-0"
          aria-label="העתק מספר רכב">
          {copied
            ? <Check className="w-3 h-3 text-green-600" />
            : <Copy className="w-3 h-3 text-gray-500" />
          }
        </button>
      )}
    </span>
  );
}
