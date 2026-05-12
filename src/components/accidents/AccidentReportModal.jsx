import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Share2, X } from 'lucide-react';
import { C } from '@/lib/designTokens';
import AccidentPrintReport from './AccidentPrintReport';
import { shareContent } from '@/lib/capacitor';
import { exportElementToPdf } from '@/lib/pdfExport';
import { toast } from 'sonner';

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
  // Ref to the on-screen preview element. PDF generation captures
  // this DOM node directly via html2canvas → multi-page A4 PDF.
  // Replaces the previous window.print() which Capacitor WKWebView
  // ignored (user reported "Download does nothing").
  const previewRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadPdf = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      // If we're not in preview mode the preview element isn't
      // mounted yet — switch to preview first, then let the user tap
      // again (the preview-mode button does the actual export).
      if (!previewRef.current) {
        if (typeof onPreview === 'function') onPreview();
        return;
      }
      const dateLabel = accident?.date
        ? new Date(accident.date).toISOString().slice(0, 10)
        : 'no-date';
      const ok = await exportElementToPdf(previewRef.current, `accident-${dateLabel}`);
      if (!ok) toast.error('שגיאה ביצירת קובץ ה-PDF');
    } catch (e) {
      console.error(e);
      toast.error('שגיאה ביצירת קובץ ה-PDF');
    } finally {
      setDownloading(false);
    }
  };

  // ESC key closes the modal — standard expectation, missing previously.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Native share — invokes the OS share sheet (iOS Sharesheet,
  // Android chooser, Web Share API on supporting browsers). The PDF
  // itself isn't attached as a file yet (that needs filesystem
  // plumbing); we share a short Hebrew text summary the user can
  // forward in WhatsApp/Mail/etc. The Download button next to it
  // remains the path for getting the actual PDF.
  const handleShare = async () => {
    const dateLabel = accident?.date
      ? new Date(accident.date).toLocaleDateString('he-IL')
      : 'תאריך לא הוזן';
    const plate = vehicle?.license_plate ? ` (${vehicle.license_plate})` : '';
    const loc = accident?.location ? ` במיקום ${accident.location}` : '';
    const otherDriver = accident?.other_driver_name
      ? `\nנהג שני: ${accident.other_driver_name}`
      : '';
    const text = `דיווח תאונה
תאריך: ${dateLabel}${loc}
רכב: ${vehicle?.nickname || vehicle?.manufacturer || 'לא צויין'}${plate}${otherDriver}

הופק מאפליקציית CarReminder.`;
    const ok = await shareContent({
      title: 'דיווח תאונה',
      text,
    });
    if (!ok) toast.error('השיתוף בוטל');
  };

  // Click on the dim backdrop (but not on the dialog itself) closes too.
  // We compare event.target to event.currentTarget to detect that the
  // tap landed on the backdrop, not on a child element.
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-start sm:items-center justify-center overflow-y-auto"
      dir="rtl"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      style={{
        // safe-area padding so the modal doesn't get clipped behind
        // the iOS status bar / home indicator. Without these, users
        // reported "the screen is cropped, can't scroll to the top".
        paddingTop:    'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        paddingLeft:   '12px',
        paddingRight:  '12px',
      }}
    >
      {/* Modal: max-h is in dvh (dynamic viewport height) so iOS
          properly accounts for the URL bar / dynamic island. flex
          column → header stays visible regardless of report length;
          the report area scrolls inside, not the whole window. */}
      <div className={`bg-white rounded-3xl shadow-2xl mx-auto w-full my-auto ${isPreview ? 'max-w-4xl' : 'max-w-lg'} max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden`}>
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
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="rounded-2xl font-bold inline-flex items-center justify-center gap-2 h-10 px-4 text-white text-sm disabled:opacity-60"
                style={{ background: C.primary }}
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {downloading ? 'יוצר PDF...' : 'הורדת PDF'}
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
              {/* Wrapper ref captures the rendered preview for PDF
                  export. The AccidentPrintReport itself doesn't
                  forward refs, so we wrap it. */}
              <div ref={previewRef}>
                <AccidentPrintReport
                  accident={accident}
                  vehicle={vehicle}
                  reporter={reporter}
                  variant="preview"
                />
              </div>
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
              onClick={() => {
                // Route into preview mode — the PDF export needs the
                // preview DOM mounted (window.print no longer used,
                // it didn't work in Capacitor WKWebView). One tap on
                // "הורדה" inside the preview ships the file.
                if (typeof onPreview === 'function') onPreview();
              }}
              className="w-full text-right rounded-3xl border bg-white p-4 transition-colors hover:border-[#2D5233]"
              style={{ borderColor: C.border }}
            >
              <p className="text-sm font-bold text-[#1C2E20] mb-1">הורדה ישירה כ-PDF</p>
              <p className="text-xs leading-relaxed text-gray-600">
                פותח תצוגה מקדימה. כפתור ההורדה בתוכה ייצור קובץ PDF להורדה או שיתוף.
              </p>
            </button>
            {/* Share — opens the native OS share sheet (or Web Share
                API in the browser) with a short Hebrew summary of the
                accident. Useful when forwarding to an insurance
                broker or family member without first downloading a
                file. The PDF can still be attached manually after
                Download. */}
            <button
              type="button"
              onClick={handleShare}
              className="w-full text-right rounded-3xl border bg-white p-4 transition-colors hover:border-[#2D5233]"
              style={{ borderColor: C.border }}
            >
              <p className="text-sm font-bold text-[#1C2E20] mb-1 flex items-center gap-2">
                <Share2 className="w-4 h-4" />
                שיתוף סיכום
              </p>
              <p className="text-xs leading-relaxed text-gray-600">
                שולח סיכום קצר של התאונה דרך וואטסאפ, מייל או כל אפליקציה אחרת במכשיר.
              </p>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
