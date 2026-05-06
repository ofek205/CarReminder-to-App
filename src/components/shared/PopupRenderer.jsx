import React from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { X } from 'lucide-react';
import { themeByValue, iconByValue } from '@/lib/popups/constants';

/**
 * PopupRenderer — pure presentational component that takes a popup config
 * (the jsonb row from admin_popups) and renders it. Zero timing/gating
 * logic here; the engine decides when to mount this.
 *
 * Used by both the runtime engine (real user sessions) and the admin
 * editor's preview pane, so WYSIWYG is literal.
 *
 * Contract:
 *   - `popup`: full row from admin_popups (or editor's in-flight state).
 *   - `open`: whether visible. Admin preview passes true; engine passes
 *     true once a popup wins the selection.
 *   - `onClose(result)`: called when user dismisses. result is either
 *     'dismissed' or 'clicked' — engine uses this to log the event and
 *     advance frequency state.
 *   - `renderInline`: admin preview uses this to avoid portal-ing into
 *     document.body (we want the popup inside the preview pane frame).
 */
export default function PopupRenderer({ popup, open, onClose, renderInline = false }) {
  if (!popup) return null;
  const theme   = themeByValue(popup.design?.theme);
  const size    = popup.design?.size || 'center';
  const content = popup.content || {};
  const Icon    = iconByValue(content.icon);

  const title        = content.title || '';
  const body         = content.body || '';
  const primary      = content.primary_cta || null;
  const secondary    = content.secondary_cta || null;

  const handleClick = (cta) => {
    // Report 'clicked' and let the engine handle navigation side effects.
    if (cta?.action === 'navigate' && cta.target) {
      onClose?.('clicked', { action: 'navigate', target: cta.target });
    } else if (cta?.action === 'external' && cta.target) {
      onClose?.('clicked', { action: 'external', target: cta.target });
    } else {
      onClose?.('clicked');
    }
  };

  //
  // Body content — reused across all sizes
  //
  const body_node = (
    <>
      {/* Hero — consistent across all sizes. Colored gradient + icon. */}
      <div className="relative overflow-hidden"
        style={{ background: theme.bg, padding: '24px 20px 18px' }}>
        <div className="absolute pointer-events-none rounded-full"
          style={{ top: -36, right: -36, width: 120, height: 120, background: 'rgba(255,255,255,0.08)' }} />
        <div className="absolute pointer-events-none rounded-full"
          style={{ bottom: -26, left: -26, width: 90, height: 90, background: `${theme.accent}20` }} />

        <div className="flex justify-center relative z-10">
          <div className="flex items-center justify-center"
            style={{
              width: 52, height: 52, borderRadius: 16,
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(12px)',
              border: '1.5px solid rgba(255,255,255,0.2)',
            }}>
            <Icon className="w-6 h-6" style={{ color: '#fff' }} strokeWidth={2} />
          </div>
        </div>

        {title && (
          <h2 className="text-center mt-3 text-xl font-bold leading-tight relative z-10"
            style={{ color: theme.textOnBg }}>{title}</h2>
        )}
      </div>

      {/* Body text + CTAs */}
      <div className="px-6 pt-4 pb-5">
        {body && (
          <p className="text-[13px] leading-relaxed text-center text-gray-700 whitespace-pre-line">
            {body}
          </p>
        )}

        {(primary?.label || secondary?.label) && (
          <div className="flex gap-2 mt-5">
            {secondary?.label && (
              <button type="button" onClick={() => onClose?.('dismissed')}
                className="flex-1 rounded-xl h-11 text-[13px] font-semibold bg-white border border-gray-200 text-gray-700 transition-all active:scale-[0.98]">
                {secondary.label}
              </button>
            )}
            {primary?.label && (
              <button type="button" onClick={() => handleClick(primary)}
                className="flex-1 rounded-xl h-11 text-[14px] font-bold text-white transition-all active:translate-y-px"
                style={{
                  background: theme.primary,
                  boxShadow: `0 8px 20px -6px ${theme.primary}66`,
                }}>
                {primary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );

  //
  // Size-specific frames
  //

  if (renderInline) {
    // Admin preview: render in place, no Dialog/Sheet portal.
    if (!open) return null;
    return (
      <div className="relative w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl border border-gray-100"
        style={{ background: '#fff' }} dir="rtl">
        <PreviewCloseFakery />
        {body_node}
      </div>
    );
  }

  if (size === 'bottom-sheet') {
    return (
      <Sheet open={open} onOpenChange={(o) => { if (!o) onClose?.('dismissed'); }}>
        <SheetContent side="bottom" dir="rtl"
          className="p-0 rounded-t-3xl border-0 max-h-[85vh] overflow-y-auto">
          <VisuallyHidden.Root><DialogTitle>{title || 'הודעה'}</DialogTitle></VisuallyHidden.Root>
          {body_node}
        </SheetContent>
      </Sheet>
    );
  }

  if (size === 'top-banner') {
    return open ? (
      <div className="fixed inset-x-0 top-0 z-[9999] px-3 pt-3" dir="rtl">
        <div className="max-w-xl mx-auto rounded-2xl overflow-hidden shadow-2xl border border-white/20"
          style={{ background: '#fff' }}>
          {body_node}
          <button onClick={() => onClose?.('dismissed')}
            className="absolute top-3 left-3 w-7 h-7 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center">
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    ) : null;
  }

  if (size === 'corner-toast') {
    return open ? (
      <div className="fixed bottom-4 right-4 z-[9999] w-80 max-w-[calc(100vw-32px)]" dir="rtl">
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-gray-100 bg-white">
          {body_node}
        </div>
      </div>
    ) : null;
  }

  //  Default: 'center' modal
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.('dismissed'); }}>
      <DialogContent dir="rtl"
        className="max-w-md max-h-[92vh] overflow-y-auto p-0 border-0 rounded-3xl">
        <VisuallyHidden.Root><DialogTitle>{title || 'הודעה'}</DialogTitle></VisuallyHidden.Root>
        {body_node}
      </DialogContent>
    </Dialog>
  );
}

// Decorative X in admin preview (does nothing — preview is static).
function PreviewCloseFakery() {
  return (
    <div className="absolute top-3 left-3 z-10 w-7 h-7 rounded-full bg-white/20 flex items-center justify-center pointer-events-none">
      <X className="w-4 h-4 text-white/80" />
    </div>
  );
}
