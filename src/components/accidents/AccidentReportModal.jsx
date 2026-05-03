import React, { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { C } from '@/lib/designTokens';
import AccidentPrintReport from './AccidentPrintReport';

/**
 * AccidentReportModal — shared dialog used by both:
 *   • AddAccident (edit mode footer button → ייצוא דוח רשמי)
 *   • Accidents list (per-row "דוח" quick-action button)
 *
 * Two states driven by the `mode` prop:
 *   mode='options' → small picker that lets the user choose between
 *                    "preview" (in-app readable view) and direct
 *                    download (which fires the browser print dialog →
 *                    save as PDF).
 *   mode='preview' → full-screen modal with the report rendered as a
 *                    sheet of paper. From here the same Download
 *                    button fires window.print() so saving as PDF is
 *                    one click.
 */
export default function AccidentReportModal({
  mode,
  accident,
  vehicle,
  reporter,
  onClose,
  onPreview,
  onDownload,
}) {
  const isPreview = mode === 'preview';

  // ESC key closes the modal — standard expectation, missing previously.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Click on the dim backdrop (but not on the dialog itself) closes too.
  // We compare event.target to event.currentTarget to detect that the
  // tap landed on the backdrop, not on a child element.
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 p-3 sm:p-6 flex items-start sm:items-center justify-center"
      dir="rtl"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      {/* Modal capped at 90vh + flex column → header stays visible
          regardless of report length. The report area scrolls inside,
          not the whole window. */}
      <div className={`bg-white rounded-3xl shadow-2xl mx-auto w-full ${isPreview ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] flex flex-col overflow-hidden`}>
        {/* Header — always visible. X icon button on the trailing edge
            is the universal close affordance; the "סגור" text was easy
            to miss and got pushed off-screen on long reports. */}
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 shrink-0">
          <div className="min-w-0">
            <p className="text-base font-bold text-gray-900 truncate">
              {isPreview ? 'צפייה בדוח התאונה' : 'ייצוא דוח תאונה'}
            </p>
            <p className="text-xs text-gray-500 truncate">
              דוח רשמי המתאים לשליחה לחברת הביטוח או לצירוף לתיק במשטרה.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center shrink-0 transition-colors hover:bg-gray-50 active:scale-95"
            aria-label="סגור"
            title="סגור (Esc)"
          >
            <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        {isPreview ? (
          <>
            <div className="flex flex-col sm:flex-row gap-2 p-3 border-b border-gray-100 bg-gray-50 shrink-0">
              <button
                type="button"
                onClick={onDownload}
                className="rounded-2xl font-bold inline-flex items-center justify-center gap-2 h-10 px-4 text-white text-sm"
                style={{ background: C.primary }}
              >
                <Download className="h-4 w-4" />
                הורדת PDF
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl font-bold inline-flex items-center justify-center h-10 px-4 text-sm border"
                style={{ borderColor: C.border, color: C.text }}
              >
                חזרה
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 p-3 sm:p-5">
              <AccidentPrintReport
                accident={accident}
                vehicle={vehicle}
                reporter={reporter}
                variant="preview"
              />
            </div>
          </>
        ) : (
          <div className="p-4 sm:p-5 space-y-3">
            <button
              type="button"
              onClick={onPreview}
              className="w-full text-right rounded-3xl border bg-[#F5FAF6] p-4 transition-colors hover:border-[#2D5233]"
              style={{ borderColor: '#D8E5D9' }}
            >
              <p className="text-sm font-bold text-[#1C2E20] mb-1">צפייה בדוח</p>
              <p className="text-xs leading-relaxed text-gray-600">
                פותח תצוגה מקדימה של הדוח בתוך האפליקציה. מתוך התצוגה אפשר גם להוריד.
              </p>
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="w-full text-right rounded-3xl border bg-white p-4 transition-colors hover:border-[#2D5233]"
              style={{ borderColor: C.border }}
            >
              <p className="text-sm font-bold text-[#1C2E20] mb-1">הורדה ישירה כ-PDF</p>
              <p className="text-xs leading-relaxed text-gray-600">
                פותח את חלון ההדפסה של הדפדפן. בחר "שמור כ-PDF" כדי לקבל את הדוח כקובץ.
              </p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
