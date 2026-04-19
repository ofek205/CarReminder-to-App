import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Car, Wrench, Star, AlertTriangle } from "lucide-react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

/**
 * WelcomePopup — post-login greeting modal.
 *
 * Returning-user variant is a "magazine cover" layout: a branded dark-green
 * hero up top, then two feature rows with accent stripes, a subtle feedback
 * line, and a premium gradient CTA. First-time variant keeps the fuller
 * onboarding list on a lighter background.
 */
export default function WelcomePopup({ open, onClose, isReturningUser = false, userName = '' }) {
  const firstName = userName ? userName.split(' ')[0] : '';
  const title = isReturningUser
    ? `כיף שחזרת${firstName ? `, ${firstName}` : ''}! 👋`
    : 'ברוך הבא! 👋';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        dir="rtl"
        className="max-w-md p-0 overflow-hidden rounded-3xl border-0 shadow-2xl"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>

        {/* Screen-reader title (visual title lives in the hero below) */}
        <VisuallyHidden.Root>
          <DialogTitle>{title}</DialogTitle>
        </VisuallyHidden.Root>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden"
          style={{
            background: 'linear-gradient(165deg, #1C3620 0%, #2D5233 45%, #4A8C5C 100%)',
            padding: '28px 24px 24px',
          }}>
          {/* Decorative blooms */}
          <div className="absolute pointer-events-none rounded-full"
            style={{ top: -40, right: -40, width: 140, height: 140, background: 'rgba(255,255,255,0.08)' }} />
          <div className="absolute pointer-events-none rounded-full"
            style={{ bottom: -30, left: -30, width: 100, height: 100, background: 'rgba(255,191,0,0.06)' }} />

          {/* Logo tile (glass effect) */}
          <div className="flex justify-center relative z-10">
            <div className="flex items-center justify-center"
              style={{
                width: 56, height: 56, borderRadius: 18,
                background: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: '1.5px solid rgba(255,255,255,0.2)',
              }}>
              <Car className="w-7 h-7 text-white" strokeWidth={2} />
            </div>
          </div>

          {/* Brand label */}
          <p className="text-center mt-3 text-[10px] font-bold uppercase relative z-10"
            style={{ letterSpacing: '0.35em', color: 'rgba(255,255,255,0.8)' }}>
            CarReminder
          </p>

          {/* Title */}
          <h2 className="text-center mt-1.5 text-2xl font-black text-white leading-tight relative z-10">
            {title}
          </h2>
        </div>

        {/* ── Content zone ─────────────────────────────────────────────── */}
        {isReturningUser ? (
          <div className="px-6 pt-5 pb-5">
            {/* "מה חדש" divider */}
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px flex-1 bg-gray-200" />
              <span className="text-[10px] font-bold uppercase text-gray-400"
                style={{ letterSpacing: '0.2em' }}>
                מה חדש
              </span>
              <span className="h-px flex-1 bg-gray-200" />
            </div>

            {/* Feature: AI expert */}
            <FeatureRow
              icon={Wrench}
              title="מומחה AI אישי"
              body="ברוך המוסכניק ויוסי מומחה כלי שייט כבר מכירים את פרטי הרכב שלך, ויענו לשאלות בצורה מדויקת על תקלות, עלויות וטיפולים."
              bg="#FAFCF9"
              accent="#2D5233"
              tileShadow="0 8px 16px -4px rgba(45,82,51,0.35)"
            />
            <div className="h-2.5" />
            {/* Feature: Accidents */}
            <FeatureRow
              icon={AlertTriangle}
              title="ניהול תאונות"
              body="תיעוד מסודר של תאונות: נזקים, פרטי נהג שני, צילומים וחברת ביטוח, הכל במקום אחד."
              bg="#FFFCF5"
              accent="#D97706"
              tileShadow="0 8px 16px -4px rgba(217,119,6,0.35)"
            />

            {/* Feedback inline note */}
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Star className="h-3.5 w-3.5" style={{ color: '#FFBF00', fill: '#FFBF00' }} />
              <p className="text-[11px] font-medium text-gray-500">
                האפליקציה מתפתחת, נשמח לפידבק ורעיונות.
              </p>
            </div>

            {/* CTA */}
            <PremiumCta onClick={onClose} label="בואו נמשיך 🚗" />

            {/* Credit */}
            <p className="text-center text-[11px] text-gray-400 mt-4">פותח על ידי אופק אדלשטיין</p>
          </div>
        ) : (
          // ── First-time user content (kept fuller but polished) ────────
          <div className="px-6 pt-5 pb-5">
            <p className="text-gray-600 text-center text-sm leading-relaxed mb-4">
              כאן תוכל לנהל ולעקוב אחרי הרכבים שלך בקלות ובנוחות.
            </p>
            <div className="rounded-2xl p-4 space-y-3"
              style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, #E8F2EA 100%)', border: '1.5px solid #BBF7D0' }}>
              <MiniRow emoji="🔍" title="חיפוש לפי מספר רכב" body="הזן מספר לוחית וקבל מיד יצרן, דגם, שנה וסוג דלק." />
              <MiniRow emoji="🔔" title="תזכורות חכמות" body="התראות לפני שטסט, ביטוח או מסמכים פגים." />
              <MiniRow emoji="🤖" title="סריקת מסמכים עם AI" body="העלה תמונה, המערכת תמלא את הפרטים אוטומטית." />
              <MiniRow emoji="💬" title="צ'אט AI לייעוץ" body="שאל כל שאלה על הרכב וקבל תשובה מיידית." />
            </div>

            <PremiumCta onClick={onClose} label="בואו נתחיל! 🚗" />

            <p className="text-center text-[11px] text-gray-400 mt-4">פותח על ידי אופק אדלשטיין</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Feature row (returning-user) ───────────────────────────────────────
function FeatureRow({ icon: Icon, title, body, bg, accent, tileShadow }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-2xl"
      style={{ background: bg, borderInlineStart: `3px solid ${accent}` }}>
      <div className="flex items-center justify-center shrink-0"
        style={{
          width: 40, height: 40, borderRadius: 12,
          background: accent,
          boxShadow: tileShadow,
        }}>
        <Icon className="w-5 h-5 text-white" strokeWidth={2.3} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-extrabold" style={{ color: '#1C3620' }}>{title}</p>
        <p className="text-xs text-gray-600 mt-1 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

// ── Mini row (first-time user) ─────────────────────────────────────────
function MiniRow({ emoji, title, body }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-base shrink-0">{emoji}</span>
      <div>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <p className="text-xs text-gray-500">{body}</p>
      </div>
    </div>
  );
}

// ── Premium CTA button ─────────────────────────────────────────────────
function PremiumCta({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-white font-extrabold transition-all active:translate-y-px"
      style={{
        height: 52,
        borderRadius: 16,
        background: 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
        boxShadow: '0 12px 24px -6px rgba(45,82,51,0.4), 0 4px 8px rgba(45,82,51,0.15)',
        fontSize: 16,
        marginTop: 20,
      }}>
      {label}
    </button>
  );
}
