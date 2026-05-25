/**
 * ReportBugDialog — user-initiated bug report dialog.
 *
 * The user-visible counterpart to the silent observability pipeline.
 * crashReporter + toastError capture errors WE detect; this captures
 * the ones only the USER notices — UI freezes, wrong data, confusing
 * behavior, anything we couldn't measure automatically.
 *
 * The dialog is rendered once at the App level and opened from anywhere
 * via a global custom event:
 *
 *   window.dispatchEvent(new CustomEvent('cr:open-report-bug', {
 *     detail: { prefilledMessage, contextNote }
 *   }));
 *
 * Why an event instead of a context: callers may live inside a broken
 * subtree (a crashed route under PageErrorBoundary). The boundary
 * fallback can't reach into a React context that lives ABOVE it without
 * forwarding props, but it CAN fire a window event. The dialog itself
 * is mounted OUTSIDE every route boundary so it stays renderable even
 * when the active page tree is in error state.
 *
 * What it sends to app_errors:
 *   type        = 'user_report'
 *   severity    = 'info'        (not a crash — a complaint)
 *   visible     = true          (the user typed it; they obviously saw a problem)
 *   message     = the user's text (capped 500 chars)
 *   route       = current route at the moment of submission
 *   action      = 'user_bug_report'
 *   breadcrumbs = last 30 user actions (from src/lib/breadcrumbs.js)
 *   extra       = { contextNote? — e.g. "from crash boundary on /Foo" }
 *
 * Privacy:
 *   We deliberately do NOT capture form contents, page DOM, or
 *   screenshots. The user's free-text description + their recent
 *   navigation breadcrumbs are enough triage signal without exposing
 *   anything sensitive they didn't choose to share.
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Send, MessageSquareWarning, CheckCircle2 } from 'lucide-react';
import { reportError } from '@/lib/crashReporter';
import { crumb } from '@/lib/breadcrumbs';
import { C } from '@/lib/designTokens';
import { toast } from 'sonner';

const MIN_CHARS = 5;
const MAX_CHARS = 500;

export default function ReportBugDialog() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [contextNote, setContextNote] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    function handleOpen(e) {
      const detail = e?.detail || {};
      setText(detail.prefilledMessage ? String(detail.prefilledMessage).slice(0, MAX_CHARS) : '');
      setContextNote(detail.contextNote || null);
      setSubmitted(false);
      setOpen(true);
      // Drop a breadcrumb so a subsequent crash report shows the user
      // had opened the report dialog right before.
      try { crumb.click('open_report_bug_dialog', detail.contextNote ? { contextNote: detail.contextNote } : undefined); } catch {}
    }
    window.addEventListener('cr:open-report-bug', handleOpen);
    return () => window.removeEventListener('cr:open-report-bug', handleOpen);
  }, []);

  const handleClose = (v) => {
    if (submitting) return; // don't dismiss mid-submit
    setOpen(v);
    if (!v) {
      // Reset after the fade-out animation so the user doesn't see the
      // form flash empty before the dialog closes.
      setTimeout(() => {
        setText('');
        setContextNote(null);
        setSubmitted(false);
      }, 200);
    }
  };

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS) {
      toast.error(`כתוב לפחות ${MIN_CHARS} תווים כדי שנוכל להבין`);
      return;
    }
    setSubmitting(true);
    try {
      // The reporter handles the actual insert + queue + retry semantics.
      // We pass a stub Error so the stack column stays null (this is
      // user text, not a thrown error — a fake stack would be misleading).
      reportError('user_report', { message: trimmed.slice(0, MAX_CHARS), stack: '' }, {
        action: 'user_bug_report',
        severity: 'info',
        visible: true,
        context_note: contextNote || null,
        text_length: trimmed.length,
      });
      // Give the queued insert a moment to flush so the success toast
      // doesn't fire before the row reaches the table. The reporter
      // batches with a 2s debounce; we wait briefly but never block the
      // UI on the network result (it queues offline-safe).
      await new Promise((r) => setTimeout(r, 250));
      setSubmitted(true);
    } catch {
      // crashReporter is fire-and-forget; we still show the success
      // state because the local-queue copy is already saved.
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const charCount = text.length;
  const tooShort = text.trim().length > 0 && text.trim().length < MIN_CHARS;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquareWarning className="w-4 h-4" style={{ color: C.primary }} />
            דווח על תקלה
          </DialogTitle>
        </DialogHeader>

        {submitted ? (
          <div className="text-center py-6 px-2">
            <div
              className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center"
              style={{ background: '#DCFCE7' }}
            >
              <CheckCircle2 className="w-7 h-7" style={{ color: '#16A34A' }} />
            </div>
            <h3 className="text-base font-bold mb-1.5 text-gray-900">תודה</h3>
            <p className="text-sm text-gray-600 leading-relaxed mb-5">
              קיבלנו את הדיווח. אם הוא דחוף, אפשר גם לפנות למייל התמיכה.
            </p>
            <Button onClick={() => handleClose(false)} className="w-full">סגור</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 leading-relaxed">
              ספר לנו מה לא עבד או מה היה מבלבל. אנחנו מצרפים אוטומטית את הדף הנוכחי
              ואת הפעולות האחרונות שלך כדי לעזור לנו לאתר את הבעיה.
            </p>
            {contextNote && (
              <div
                className="text-xs px-3 py-2 rounded-lg"
                style={{ background: '#FEF3C7', color: '#92400E' }}
              >
                {contextNote}
              </div>
            )}
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
              placeholder="לדוגמה: לחצתי על שמירה ולא קרה כלום, הסכום נראה לא נכון, המסך לא נטען..."
              rows={5}
              className="resize-none text-sm"
              dir="rtl"
            />
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: tooShort ? '#DC2626' : C.muted }}>
                {tooShort ? `קצר מדי — לפחות ${MIN_CHARS} תווים` : ''}
              </span>
              <span style={{ color: C.muted }} dir="ltr">{charCount} / {MAX_CHARS}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => handleClose(false)}
                disabled={submitting}
                className="flex-1"
              >
                ביטול
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || text.trim().length < MIN_CHARS}
                className="flex-1 gap-1.5"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {submitting ? 'שולח...' : 'שלח'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Convenience helper — open the dialog from anywhere.
 *
 *   import { openReportBugDialog } from '@/components/shared/ReportBugDialog';
 *   openReportBugDialog();
 *   openReportBugDialog({ contextNote: 'מהמסך של המסמכים' });
 *   openReportBugDialog({ prefilledMessage: error.message });
 */
export function openReportBugDialog(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('cr:open-report-bug', { detail }));
  } catch {
    // SSR or no window — no-op.
  }
}
