import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Share2, Loader2, X } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { shareContent } from '@/lib/capacitor';

/**
 * FormPreviewModal — shared full-screen preview + export shell for the
 * Forms feature. Renders the supplied document (children) inside a ref'd
 * container that html2canvas captures, then exposes PDF / Word / Share.
 *
 * Mirrors AccidentReportModal's proven pattern: a visible rendered element
 * (offscreen display:none doesn't paint to canvas) + safe-area-padded
 * sticky action bar for thumb reach.
 *
 * Props:
 *   fileBase    suggested filename (sanitised here; no extension)
 *   disclaimer  one-line note shown above the export buttons
 *   shareTitle  native share-sheet title
 *   shareText   native share-sheet body
 *   onClose     close handler
 *   children    the rendered document element
 */
export default function FormPreviewModal({ fileBase, disclaimer, shareTitle, shareText, onClose, children, title = 'תצוגה מקדימה', subtitle = 'בדוק את הפרטים לפני ההפקה' }) {
  const previewRef = useRef(null);
  const [busy, setBusy] = useState(false);
  // Keep Hebrew letters/digits/dashes, drop anything a filesystem dislikes.
  const safeName = String(fileBase || 'document').replace(/[^\w֐-׿-]/g, '').slice(0, 60) || 'document';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportAs = async (kind) => {
    if (busy || !previewRef.current) return;
    setBusy(true);
    try {
      const mod = await import('@/lib/pdfExport');
      const fn = kind === 'word' ? mod.exportElementToWord : mod.exportElementToPdf;
      const ok = await fn(previewRef.current, safeName);
      if (ok) toast.success(kind === 'word' ? 'מסמך Word נוצר' : 'מסמך PDF נוצר');
      else toastError(`שגיאה ביצירת קובץ ה-${kind === 'word' ? 'Word' : 'PDF'}`, { action: `form_${kind}_export` });
    } catch (e) {
      toastError('שגיאה ביצירת המסמך', { action: `form_${kind}_export`, err: e });
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    const ok = await shareContent({ title: shareTitle || 'מסמך', text: shareText || '' });
    if (!ok) toastError('השיתוף בוטל', { action: 'form_share_cancel' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        paddingTop: 'max(12px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        paddingInline: '12px',
      }}
    >
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl my-auto max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 shrink-0" style={{ borderColor: C.border }}>
          <div className="min-w-0">
            <p className="text-base font-bold" style={{ color: C.text }}>{title}</p>
            <p className="text-xs" style={{ color: C.muted }}>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="סגור"
            className="w-9 h-9 rounded-full border flex items-center justify-center shrink-0" style={{ borderColor: C.border }}>
            <X className="h-4 w-4" style={{ color: C.muted }} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 sm:p-5" style={{ background: C.gray100 }}>
          <div ref={previewRef}>{children}</div>
        </div>

        <div className="border-t p-3 shrink-0" style={{ borderColor: C.border, background: C.card }}>
          {disclaimer && (
            <p className="text-[11px] text-center mb-2" style={{ color: C.muted }}>{disclaimer}</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={() => exportAs('pdf')} disabled={busy}
              className="h-11 sm:flex-1 rounded-2xl font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: C.primary }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
            </button>
            <button type="button" onClick={() => exportAs('word')} disabled={busy}
              className="h-11 sm:flex-1 rounded-2xl font-bold inline-flex items-center justify-center gap-2 border disabled:opacity-60"
              style={{ borderColor: C.primary, color: C.primary, background: C.card }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Word
            </button>
            <button type="button" onClick={handleShare}
              className="h-11 rounded-2xl font-bold inline-flex items-center justify-center gap-2 border px-4"
              style={{ borderColor: C.border, color: C.text, background: C.card }}>
              <Share2 className="h-4 w-4" /> שתף
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
