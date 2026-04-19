import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Car, Wrench, Bell, Star, Search, MessageSquare, Sparkles, AlertTriangle } from "lucide-react";

export default function WelcomePopup({ open, onClose, isReturningUser = false, userName = '' }) {
  const handleClose = () => {
    onClose();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md text-right" dir="rtl">
        <DialogHeader>
          <div className="flex justify-center mb-3">
            {/* Hero icon — green gradient ring + filled logo sits on top */}
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #2D5233 0%, #4A8C5C 100%)',
                boxShadow: '0 8px 24px rgba(45,82,51,0.25)',
              }}>
              <Car className="h-8 w-8 text-white" strokeWidth={2.2} />
            </div>
          </div>
          <p className="text-[#2D5233] text-xs font-bold text-center tracking-wider">CarReminder</p>
          <DialogTitle className="text-2xl font-black text-center text-gray-900 mt-1">
            {isReturningUser ? `כיף שחזרת${userName ? `, ${userName.split(' ')[0]}` : ''}! 👋` : 'ברוך הבא! 👋'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isReturningUser ?
            <>
              {/* Intro caption — simple, warm */}
              <p className="text-gray-600 text-center text-sm leading-relaxed">
                מה חדש באפליקציה:
              </p>

              {/* Unified features card — soft green→mint gradient with a subtle
                  inner bloom. One container keeps the eye moving in a single
                  line of sight instead of jumping between two isolated boxes. */}
              <div className="rounded-2xl p-4 space-y-3.5 relative overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #F0FDF4 0%, #E8F2EA 100%)',
                  border: '1.5px solid #BBF7D0',
                  boxShadow: '0 4px 16px rgba(45,82,51,0.08)',
                }}>
                {/* Subtle decorative bloom, bottom-left */}
                <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full pointer-events-none"
                  style={{ background: 'rgba(45,82,51,0.04)' }} />

                {/* Feature row — AI expert */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: '#2D5233', boxShadow: '0 4px 12px rgba(45,82,51,0.25)' }}>
                    <Wrench className="h-5 w-5 text-white" strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: '#1C3620' }}>מומחה AI אישי</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      ברוך המוסכניק ויוסי מומחה כלי שייט כבר מכירים את פרטי הרכב שלך, ויענו לשאלות בצורה מדויקת על תקלות, עלויות וטיפולים.
                    </p>
                  </div>
                </div>

                {/* Divider between features — slim, same tone */}
                <div className="h-px" style={{ background: 'rgba(45,82,51,0.1)' }} />

                {/* Feature row — Accident management */}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: '#D97706', boxShadow: '0 4px 12px rgba(217,119,6,0.25)' }}>
                    <AlertTriangle className="h-5 w-5 text-white" strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: '#1C3620' }}>ניהול תאונות</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      תיעוד מסודר של תאונות: נזקים, פרטי נהג שני, צילומים וחברת ביטוח, הכל במקום אחד.
                    </p>
                  </div>
                </div>
              </div>

              {/* Soft feedback pill — subtle, not demanding attention */}
              <div className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl"
                style={{ background: '#F3F4F6', border: '1px solid #E5E7EB' }}>
                <Star className="h-3.5 w-3.5" style={{ color: '#D97706' }} />
                <p className="text-[11px] font-medium text-gray-600">
                  האפליקציה מתפתחת כל הזמן. נשמח לפידבק ורעיונות.
                </p>
              </div>
            </> :

            <>
              <p className="text-gray-600 text-center text-base leading-relaxed">
                כאן תוכל לנהל ולעקוב אחרי הרכבים שלך בקלות ובנוחות.
              </p>
              <div className="bg-[#E8F2EA] rounded-xl p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">🔍</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">חיפוש לפי מספר רכב</p>
                    <p className="text-xs text-gray-500">הזן מספר לוחית וקבל מיד יצרן, דגם, שנה, סוג דלק ועוד.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">🔔</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">תזכורות לטסטים, ביטוחים וטיפולים</p>
                    <p className="text-xs text-gray-500">התראות לפני שפג תוקפם - לא תפספס יותר.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">🤖</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">סריקת מסמכים עם AI</p>
                    <p className="text-xs text-gray-500">העלה תמונה של מסמך - המערכת תמלא הכל אוטומטית.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">💬</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">צ׳אט AI לייעוץ</p>
                    <p className="text-xs text-gray-500">שאל כל שאלה על הרכב וקבל תשובה מיידית וחכמה.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">🔧</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">תיעוד טיפולים ומסמכים</p>
                    <p className="text-xs text-gray-500">כל ההיסטוריה של הרכב במקום אחד, מסודר ונגיש.</p>
                  </div>
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <Star className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-blue-700 leading-relaxed">
                    <strong>האפליקציה עדיין בפיתוח</strong> ואנחנו נשמח לפידבקים ורעיונות לשיפור.
                  </p>
                </div>
              </div>
            </>
            }

        </div>

        <Button
            onClick={handleClose}
            className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white mt-2">

          {isReturningUser ? 'בואו נמשיך 🚗' : 'בואו נתחיל! 🚗'}
        </Button>

        <p className="text-center text-xs text-gray-400 mt-2">פותח על ידי אופק אדלשטיין</p>
      </DialogContent>
    </Dialog>
    </>);

}