import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Car, Wrench, Star, AlertTriangle, Sparkles, ScanLine, MapPin, Bell, Database } from "lucide-react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

/**
 * WelcomePopup. post-login greeting modal.
 *
 * Returning-user variant is a "magazine cover" layout: a branded dark-green
 * hero up top, then two feature rows with accent stripes, a subtle feedback
 * line, and a premium gradient CTA. First-time variant keeps the fuller
 * onboarding list on a lighter background.
 */
export default function WelcomePopup({ open, onClose, isReturningUser = false, userName = '' }) {
  const firstName = userName ? userName.split(' ')[0] : '';
  const title = isReturningUser
    ? `טוב שחזרת${firstName ? `, ${firstName}` : ''} 👋`
    : 'ברוך הבא 👋';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        dir="rtl"
        className="max-w-md w-[calc(100vw-32px)] max-h-[90vh] p-0 overflow-y-auto overflow-x-hidden rounded-3xl border-0 shadow-2xl"
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>

        {/* Screen-reader title (visual title lives in the hero below) */}
        <VisuallyHidden.Root>
          <DialogTitle>{title}</DialogTitle>
        </VisuallyHidden.Root>

        {/*  Hero  */}
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

          {/* Brand label. keep brand's camelCase "CarReminder" intact (no uppercase) */}
          <p className="text-center mt-3 text-[11px] font-bold relative z-10"
            style={{ letterSpacing: '0.25em', color: 'rgba(255,255,255,0.85)' }}>
            CarReminder
          </p>

          {/* Title */}
          <h2 className="text-center mt-1.5 text-2xl font-black text-white leading-tight relative z-10">
            {title}
          </h2>
        </div>

        {/*  Content zone  */}
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
              body="ברוך ויוסי מכירים את הפרטים של הרכב או הסירה שלך, ועונים מדויק על תקלות, עלויות וטיפולים."
              bg="#FAFCF9"
              accent="#2D5233"
              tileShadow="0 8px 16px -4px rgba(45,82,51,0.35)"
            />
            <div className="h-2.5" />
            {/* Feature: Accidents */}
            <FeatureRow
              icon={AlertTriangle}
              title="ניהול תאונות"
              body="נזקים, פרטי נהג שני, צילומים וחברת ביטוח. הכול במקום אחד."
              bg="#FFFCF5"
              accent="#D97706"
              tileShadow="0 8px 16px -4px rgba(217,119,6,0.35)"
            />

            {/* Feedback inline note */}
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Star className="h-3.5 w-3.5" style={{ color: '#FFBF00', fill: '#FFBF00' }} />
              <p className="text-[11px] font-medium text-gray-500">
                האפליקציה מתפתחת. נשמח לשמוע רעיונות.
              </p>
            </div>

            {/* CTA */}
            <PremiumCta onClick={onClose} label="נמשיך 🚗" />

            {/* Credit */}
            <p className="text-center text-[11px] text-gray-400 mt-4">פותח על ידי אופק אדלשטיין</p>
          </div>
        ) : (
          //  First-time user content. mirrors GuestWelcomePopup DNA 
          <div className="px-6 pt-5 pb-5">
            <p className="text-gray-600 text-center text-sm leading-relaxed mb-4">
              מכאן תנהל את כל הרכבים והסירות שלך במקום אחד.
            </p>
            <div className="rounded-2xl p-4 space-y-3 relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #F0FDF4 0%, #E8F2EA 100%)', border: '1.5px solid #BBF7D0' }}>
              <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full pointer-events-none"
                style={{ background: 'rgba(45,82,51,0.04)' }} />
              <MiniRow icon={Sparkles}  title="מומחה AI אישי"
                body="ברוך ויוסי זמינים 24/7 עם כל הפרטים של הרכב או הסירה שלך." />
              <MiniRow icon={ScanLine}  title="סריקה אוטומטית"
                body="צלם רישיון, ביטוח או טסט. הפרטים ימולאו לבד." />
              <MiniRow icon={MapPin}    title="מוסכים בסביבה"
                body="מפה חיה עם סינון לפי סוג שירות ומרחק." />
              <MiniRow icon={Bell}      title="תזכורות בזמן"
                body="טסט, ביטוח, צמיגים וטיפולים. נזכיר לפני שיפוג." />
              <MiniRow icon={Database}  title="פרטי הרכב ממשרד התחבורה"
                body="מספר רישוי אחד, והמפרט המלא נטען מעצמו." />
            </div>

            <PremiumCta onClick={onClose} label="נתחיל 🚗" />

            <p className="text-center text-[11px] text-gray-400 mt-4">פותח על ידי אופק אדלשטיין</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

//  Feature row (returning-user) 
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

//  Mini row (first-time user). matches GuestWelcomePopup layout 
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

//  Premium CTA button 
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
