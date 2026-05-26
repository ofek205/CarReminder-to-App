/**
 * ScanConfirmDialog — gentle "do you want me to scan this?" pause
 * between the file picker and the AI request.
 *
 * Used by every surface that previously auto-scanned the moment a
 * file was selected. Two reasons we added this step:
 *   1. Saves token quota — half the users just want to attach a file
 *      for documentation, not to extract fields from it.
 *   2. Lets the user reject the scan up-front instead of finding out
 *      after the fact that the AI misread something.
 *
 * Behaviour:
 *   • Bottom sheet on mobile (small viewport), centered modal on desktop
 *   • Shows a thumbnail (for images) or doc icon (for PDFs) at the top
 *   • Two CTAs of unequal weight — green gradient for "scan", muted
 *     for "manual entry"
 *   • Either choice closes the dialog and calls the matching handler
 *
 * Props:
 *   open       — controls visibility
 *   file       — the File the user just picked (for thumbnail + name)
 *   onConfirm  — fired when the user taps "Yes, scan with AI"
 *   onSkip     — fired when the user taps "No, enter manually"
 *   onCancel   — fired when the user dismisses without choosing (backdrop / X)
 *   title      — optional override for the question (default: generic
 *                  "לסרוק את המסמך עם AI?")
 *   description — optional secondary line
 */

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Sparkles, FileText } from 'lucide-react';
import { C } from '@/lib/designTokens';

export default function ScanConfirmDialog({
  open,
  file,
  onConfirm,
  onSkip,
  onCancel,
  title       = 'לסרוק את המסמך עם AI?',
  description = 'ה-AI יחלץ את הפרטים אוטומטית ויחסוך לך זמן הקלדה',
}) {
  const isImage = !!file && file.type?.startsWith('image/');
  const [thumb, setThumb] = useState(null);

  // Generate a thumbnail (data URL) only for images. PDFs use an icon
  // — no point in reading 4 MB into memory just to show a generic
  // first-page render that requires extra deps.
  useEffect(() => {
    if (!file || !isImage) { setThumb(null); return; }
    const reader = new FileReader();
    reader.onload = () => setThumb(reader.result);
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file, isImage]);

  const handleConfirm = () => onConfirm?.();
  const handleSkip    = () => onSkip?.();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel?.(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-sm rounded-3xl p-0 overflow-hidden"
        style={{ background: '#fff' }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </VisuallyHidden.Root>

        <div className="px-6 pt-6 pb-5 text-center">
          {/* File preview — thumbnail for images, icon for PDFs */}
          <div className="mx-auto mb-4 w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center"
            style={{ background: C.light, border: `1.5px solid ${C.border}` }}>
            {thumb
              ? <img src={thumb} alt="" className="w-full h-full object-cover" />
              : <FileText className="w-9 h-9" style={{ color: C.primary }} />}
          </div>

          {/* Sparkles badge — the "AI" cue */}
          <div className="mx-auto mb-3 w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: C.light, border: `1.5px solid ${C.border}` }}>
            <Sparkles className="w-6 h-6" style={{ color: C.primary }} />
          </div>

          <h2 className="text-lg font-bold mb-1" style={{ color: C.gray800 }}>
            {title}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: C.gray500 }}>
            {description}
          </p>

          {/* File name + size */}
          {file && (
            <p className="text-[11px] font-medium mt-3 truncate" style={{ color: C.gray400 }} dir="ltr">
              {file.name}
            </p>
          )}
        </div>

        {/* CTAs */}
        <div className="px-6 pb-6 space-y-2.5">
          <button
            onClick={handleConfirm}
            className="w-full h-12 rounded-full flex items-center justify-center gap-2 font-bold text-[14px] transition-all active:scale-[0.98]"
            style={{ background: C.grad, color: '#fff', boxShadow: `0 4px 16px ${C.primary}40` }}
          >
            <Sparkles className="w-4 h-4" />
            כן, סרוק עם AI
          </button>
          <button
            onClick={handleSkip}
            className="w-full h-12 rounded-full font-bold text-[14px] transition-all active:scale-[0.98]"
            style={{ background: C.gray50, color: C.gray700, border: `1.5px solid ${C.gray200}` }}
          >
            לא, אזין ידנית
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
