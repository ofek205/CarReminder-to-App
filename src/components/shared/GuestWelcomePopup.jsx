import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Car, Search, Bell, Sparkles, MessageSquare, FileText } from "lucide-react";

/**
 * GuestWelcomePopup — shown every time a user enters in guest mode.
 * Shares DNA with WelcomePopup (magazine-cover hero + premium CTA).
 * Primary CTA pushes to /Auth; secondary lets the user continue as guest.
 */
export default function GuestWelcomePopup({ open, onClose }) {
  const handleSignup = () => { window.location.href = '/Auth'; };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        dir="rtl"
        className="max-w-md p-0 overflow-hidden rounded-3xl border-0"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        <VisuallyHidden.Root>
          <DialogTitle>שלום לך, נכנסת כאורח</DialogTitle>
        </VisuallyHidden.Root>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
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
              <Car className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
            CarReminder
          </p>
          <h2 className="text-center mt-1.5 text-2xl font-black text-white leading-tight relative z-10">
            שלום לך, נכנסת כאורח 👋
          </h2>
        </div>

        {/* ── Content ──────────────────────────────────────────────────── */}
        <div className="px-6 pt-5 pb-5">
          <p className="text-gray-600 text-center text-sm leading-relaxed mb-4">
            התרשם מהמערכת לפני שנרשמים. אלה הכלים שתקבל:
          </p>

          {/* Unified features card */}
          <div className="rounded-2xl p-4 space-y-3 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #F0FDF4 0%, #E8F2EA 100%)',
              border: '1.5px solid #BBF7D0',
            }}>
            <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full pointer-events-none"
              style={{ background: 'rgba(45,82,51,0.04)' }} />

            <MiniRow icon={Search} title="חיפוש לפי מספר רכב"
              body="מספר לוחית והמערכת מביאה יצרן, דגם, שנה ודלק." />
            <MiniRow icon={Bell} title="תזכורות לפני שמאחרים"
              body="טסט, ביטוח וטיפולים לפני פג התוקף." />
            <MiniRow icon={Sparkles} title="סריקת מסמכים עם AI"
              body="העלה תמונה, הפרטים ממולאים אוטומטית." />
            <MiniRow icon={MessageSquare} title="צ'אט AI לייעוץ"
              body="שאלה על הרכב וקבל תשובה מיידית." />
            <MiniRow icon={FileText} title="היסטוריית טיפולים"
              body="מעקב אחרי כל מה שנעשה ברכב לאורך זמן." />
          </div>

          {/* CTAs — register primary, continue as guest secondary */}
          <button onClick={handleSignup}
            className="w-full text-white font-extrabold transition-all active:translate-y-px mt-5"
            style={{
              height: 52, borderRadius: 16,
              background: 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
              boxShadow: '0 12px 24px -6px rgba(45,82,51,0.4), 0 4px 8px rgba(45,82,51,0.15)',
              fontSize: 16,
            }}>
            להרשמה 🚗
          </button>
          <button onClick={onClose}
            className="w-full font-bold transition-all hover:bg-gray-50 mt-2"
            style={{ height: 44, borderRadius: 12, color: '#6B7280', fontSize: 14 }}>
            להמשיך כאורח
          </button>

          <p className="text-center text-[11px] text-gray-400 mt-4">פותח על ידי אופק אדלשטיין</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MiniRow({ icon: Icon, title, body }) {
  return (
    <div className="flex items-start gap-3 relative z-10">
      <div className="flex items-center justify-center shrink-0"
        style={{ width: 32, height: 32, borderRadius: 10, background: '#2D5233' }}>
        <Icon className="w-4 h-4 text-white" strokeWidth={2.3} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: '#1C3620' }}>{title}</p>
        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
