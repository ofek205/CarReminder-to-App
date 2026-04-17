import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/clipboard';

/**
 * Israeli license plate display — yellow plate, IL flag, copy button.
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

  // Size presets
  const P = size === 'sm'
    ? { height: 22, padding: '2px 4px', textSize: 10, flagWidth: 10, flagHeight: 7, ilSize: 5 }
    : size === 'lg'
    ? { height: 34, padding: '4px 6px', textSize: 14, flagWidth: 18, flagHeight: 12, ilSize: 8 }
    : { height: 28, padding: '3px 5px', textSize: 12, flagWidth: 14, flagHeight: 9, ilSize: 6 };

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} dir="ltr">
      <span
        className="inline-flex items-center gap-1 rounded shrink-0"
        style={{
          padding: P.padding,
          background: '#FFBF00',
          border: '2px solid #1A3A5C',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          height: P.height,
        }}>
        {/* IL flag badge */}
        <span className="flex flex-col items-center justify-center rounded-sm"
          style={{ background: '#1A3A5C', padding: '2px 3px' }}>
          <span className="text-white font-bold leading-none" style={{ fontSize: P.ilSize }}>IL</span>
          <svg viewBox="0 0 60 40" style={{ width: P.flagWidth, height: P.flagHeight, marginTop: 1 }}>
            <rect width="60" height="40" fill="white" />
            <rect y="4" width="60" height="5" fill="#003DA5" />
            <rect y="31" width="60" height="5" fill="#003DA5" />
            <polygon points="30,10 34.5,21 25.5,21" fill="none" stroke="#003DA5" strokeWidth="2" />
            <polygon points="30,26 25.5,15 34.5,15" fill="none" stroke="#003DA5" strokeWidth="2" />
          </svg>
        </span>
        <span className="font-black tracking-wider px-1" style={{ color: '#1a1a1a', fontSize: P.textSize }}>
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
