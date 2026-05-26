import React from 'react';
import { AlertTriangle, RefreshCw, MessageCircle, X } from 'lucide-react';
import { C } from '@/lib/designTokens';

/**
 * System error banner for API/save/upload failures.
 * Shows a clear message with "רענן", "תמיכה" and a dismiss (X) action.
 * The onDismiss prop was being accepted but ignored. now it drives a
 * close button so the banner can actually be dismissed.
 */
export default function SystemErrorBanner({ message, onRetry, onDismiss }) {
  return (
    <div className="rounded-2xl p-4 flex items-start gap-3 mb-4 relative"
      style={{ background: C.errorBg, border: `1.5px solid ${C.errorBorder}`, boxShadow: '0 2px 8px rgba(220,38,38,0.06)' }}
      dir="rtl"
      role="alert">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: C.errorLight }}>
        <AlertTriangle className="w-4.5 h-4.5" style={{ color: C.error }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: C.errorDark }}>
          {message || 'אירעה שגיאה, נסה שוב'}
        </p>
      </div>
      <div className="flex gap-2 shrink-0 items-start">
        {onRetry && (
          <button onClick={onRetry}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 transition-all active:scale-95"
            style={{ background: C.error, color: '#fff' }}>
            <RefreshCw className="w-3 h-3" />
            רענן
          </button>
        )}
        <a href="mailto:support@car-reminder.app"
          className="text-[11px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 transition-all active:scale-95"
          style={{ background: C.errorLight, color: C.errorDark }}>
          <MessageCircle className="w-3 h-3" />
          תמיכה
        </a>
        {onDismiss && (
          <button onClick={onDismiss}
            aria-label="סגור הודעה"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90 hover:bg-red-100"
            style={{ color: C.errorDark }}>
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
