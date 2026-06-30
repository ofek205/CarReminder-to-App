import React from 'react';
import { Mail, X } from 'lucide-react';
import { C } from '@/lib/designTokens';

export default function AdminMessageDialog({ title, body, timestamp, formatTime, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="w-full max-w-sm rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          style={{ background: '#FFFFFF', boxShadow: '0 24px 60px rgba(0,0,0,0.25)' }}
          dir="rtl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: C.infoBg, borderBottom: '1px solid #BFDBFE' }}>
            <Mail className="w-4 h-4" style={{ color: '#1D4ED8' }} />
            <span className="text-[13px] font-bold flex-1" style={{ color: C.infoDark }}>הודעה מ-CarReminder</span>
            <button onClick={onClose} className="w-11 h-11 rounded-lg flex items-center justify-center hover:bg-blue-200/50 transition">
              <X className="w-4 h-4" style={{ color: '#1D4ED8' }} />
            </button>
          </div>
          <div className="px-4 py-3">
            <p className="text-[14px] font-semibold mb-1" style={{ color: C.text }}>{title}</p>
            {timestamp && formatTime && (() => {
              const formatted = formatTime(timestamp);
              return formatted ? <p className="text-[11px] mb-3" style={{ color: '#8B9C8E' }}>{formatted}</p> : null;
            })()}
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: C.gray700 }}>{body}</p>
          </div>
          <div className="px-4 pb-3">
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ background: C.infoBg, color: '#1D4ED8' }}
            >
              הבנתי
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
