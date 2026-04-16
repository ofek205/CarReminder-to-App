import React from 'react';
import { AlertTriangle, RefreshCw, MessageCircle } from 'lucide-react';

/**
 * System error banner for API/save/upload failures.
 * Shows a clear message with "רענן" and "פנה לתמיכה" actions.
 */
export default function SystemErrorBanner({ message, onRetry, onDismiss }) {
  return (
    <div className="rounded-2xl p-4 flex items-start gap-3 mb-4"
      style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', boxShadow: '0 2px 8px rgba(220,38,38,0.06)' }}
      dir="rtl">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: '#FEE2E2' }}>
        <AlertTriangle className="w-4.5 h-4.5" style={{ color: '#DC2626' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: '#991B1B' }}>
          {message || 'אירעה שגיאה, נסה שוב'}
        </p>
      </div>
      <div className="flex gap-2 shrink-0">
        {onRetry && (
          <button onClick={onRetry}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 transition-all active:scale-95"
            style={{ background: '#DC2626', color: '#fff' }}>
            <RefreshCw className="w-3 h-3" />
            רענן
          </button>
        )}
        <a href="mailto:support@carreminder.co.il"
          className="text-[11px] font-bold px-3 py-1.5 rounded-xl flex items-center gap-1 transition-all active:scale-95"
          style={{ background: '#FEE2E2', color: '#991B1B' }}>
          <MessageCircle className="w-3 h-3" />
          תמיכה
        </a>
      </div>
    </div>
  );
}
