import React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Sparkles } from 'lucide-react';
import { C } from '@/lib/designTokens';

/**
 * ReleaseNotesPopup — renders the admin-published "what's new" announcement.
 *
 * Content is fully admin-controlled (title + free-text body, entered in the
 * admin Versions tab and stored in app_config). The body preserves line
 * breaks (whitespace-pre-line) so the admin can write a short bullet list.
 *
 * Triggering + once-per-user dedup live in useReleaseAnnouncement; this is a
 * pure presentational dialog. onClose marks the announcement seen.
 */
export default function ReleaseNotesPopup({ open, title, body, onClose }) {
  const heading = (title && title.trim()) ? title.trim() : 'מה חדש בגרסה';

  if (!body) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-md w-[calc(100vw-32px)] max-h-[90vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0 shadow-2xl"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{heading}</DialogTitle>
        </VisuallyHidden.Root>

        {/* Hero */}
        <div
          className="relative overflow-hidden"
          style={{ background: `linear-gradient(165deg, #1C3620 0%, ${C.primary} 45%, #4A8C5C 100%)`, padding: '28px 24px 22px' }}
        >
          <div className="absolute pointer-events-none rounded-full"
            style={{ top: -40, right: -40, width: 140, height: 140, background: 'rgba(255,255,255,0.08)' }} />
          <div className="absolute pointer-events-none rounded-full"
            style={{ bottom: -30, left: -30, width: 100, height: 100, background: 'rgba(255,191,0,0.06)' }} />

          <div className="flex justify-center relative z-10">
            <div className="flex items-center justify-center"
              style={{
                width: 56, height: 56, borderRadius: 18,
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                border: '1.5px solid rgba(255,255,255,0.2)',
              }}>
              <Sparkles className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.2em', color: 'rgba(255,255,255,0.85)' }}>
            מה חדש
          </p>
          <h2 className="text-center mt-1.5 text-2xl font-bold text-white leading-tight relative z-10">
            {heading}
          </h2>
        </div>

        {/* Body — admin free text, line breaks preserved */}
        <div className="px-6 pt-5 pb-5">
          <p className="text-[14px] leading-relaxed whitespace-pre-line" style={{ color: '#374151' }}>
            {body}
          </p>

          <button
            onClick={() => onClose?.()}
            className="w-full text-white font-bold transition-all active:translate-y-px"
            style={{
              height: 52, borderRadius: 16,
              background: `linear-gradient(135deg, ${C.primary} 0%, #4A8C5C 100%)`,
              boxShadow: '0 12px 24px -6px rgba(45,82,51,0.4), 0 4px 8px rgba(45,82,51,0.15)',
              fontSize: 16, marginTop: 20,
            }}
          >
            הבנתי 🚗
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
