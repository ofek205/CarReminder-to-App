import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Shield, UserPlus, CloudUpload, Lock, Sparkles } from "lucide-react";
import { SYSTEM_POPUP_IDS, logSystemPopupEvent } from "@/lib/popups/systemPopups";

/**
 * SignUpPromptDialog. softer CTA popup that gently encourages registration
 * when the user tries to do something that requires a persistent account.
 * Uses the same hero DNA as WelcomePopup but with a cloud-upload tile.
 */
export default function SignUpPromptDialog({ open, onClose, reason }) {
  useEffect(() => {
    if (open) logSystemPopupEvent(SYSTEM_POPUP_IDS.signUpPrompt, 'shown');
  }, [open]);

  const handleLogin = () => {
    logSystemPopupEvent(SYSTEM_POPUP_IDS.signUpPrompt, 'clicked');
    window.location.href = '/Auth';
  };
  const handleDismiss = () => {
    logSystemPopupEvent(SYSTEM_POPUP_IDS.signUpPrompt, 'dismissed');
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-sm w-[calc(100vw-32px)] max-h-[90vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <VisuallyHidden.Root>
          <DialogTitle>שמור את הנתונים שלך</DialogTitle>
        </VisuallyHidden.Root>

        {/*  Hero  */}
        <div className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(165deg, #1C3620 0%, #2D5233 45%, #4A8C5C 100%)',
            padding: '28px 24px 24px',
          }}>
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
              <CloudUpload className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
            CarReminder
          </p>
          <h2 className="text-center mt-1.5 text-2xl font-black text-white leading-tight relative z-10">
            שמור הכול בחשבון חינמי
          </h2>
        </div>

        {/*  Content  */}
        <div className="px-6 pt-5 pb-5">
          <p className="text-gray-700 text-center text-sm font-medium leading-relaxed">
            {reason || 'כדי לשמור את הנתונים לצמיתות'}
          </p>
          <p className="text-gray-500 text-center text-xs mt-2 leading-relaxed">
            הרשמה בחינם בפחות מדקה. כל מה שהזנת עד כה יעבור אוטומטית לחשבון החדש.
          </p>

          {/* Trust row. 2 tiny value props */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="rounded-xl px-3 py-2.5 flex items-center gap-2"
              style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
              <Lock className="w-3.5 h-3.5" style={{ color: '#2D5233' }} />
              <span className="text-[11px] font-bold" style={{ color: '#1C3620' }}>מאובטח</span>
            </div>
            <div className="rounded-xl px-3 py-2.5 flex items-center gap-2"
              style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: '#D97706' }} />
              <span className="text-[11px] font-bold" style={{ color: '#92400E' }}>חינם לגמרי</span>
            </div>
          </div>

          {/* Primary CTA */}
          <button onClick={handleLogin}
            className="w-full text-white font-extrabold transition-all active:translate-y-px mt-5 flex items-center justify-center gap-2"
            style={{
              height: 52, borderRadius: 16,
              background: 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
              boxShadow: '0 12px 24px -6px rgba(45,82,51,0.4), 0 4px 8px rgba(45,82,51,0.15)',
              fontSize: 16,
            }}>
            <UserPlus className="h-5 w-5" strokeWidth={2.3} />
            הרשמה בחינם
          </button>
          <button onClick={handleDismiss}
            className="w-full font-bold transition-all hover:bg-gray-50 mt-2"
            style={{ height: 44, borderRadius: 12, color: '#9CA3AF', fontSize: 13 }}>
            המשך כאורח
          </button>

          <div className="flex items-center gap-1.5 justify-center text-[10px] text-gray-400 mt-4">
            <Shield className="h-3 w-3" />
            <span>כל הנתונים מוצפנים</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
