import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import logo from "@/assets/logo.png";

/**
 * GuestWelcomePopup - shown every time a user enters in guest mode.
 * Never persisted. Always appears on each session/refresh when guest.
 */
export default function GuestWelcomePopup({ open, onClose }) {
  const handleSignup = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md text-right" dir="rtl">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <img src={logo} alt="CarReminder" className="h-16 rounded-2xl object-contain shadow-md" />
          </div>
          <DialogTitle className="text-2xl font-bold text-center text-gray-900">
            שלום לך, נכנסת כאורח 👋
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-gray-600 text-center text-sm leading-relaxed">
            אפשר להתרשם מהמערכת, לראות איך הכל עובד, ולבדוק את האפשרויות לפני הרשמה
          </p>

          <div className="bg-[#E8F2EA] rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-base shrink-0">🔍</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">חיפוש לפי מספר רכב</p>
                <p className="text-xs text-gray-500">הזן מספר לוחית - המערכת תביא יצרן, דגם, שנה, סוג דלק ועוד.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base shrink-0">🔔</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">תזכורות לפני שמאחרים</p>
                <p className="text-xs text-gray-500">התראות לטיפולים, טסט וביטוח לפני שפג תוקפם.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base shrink-0">🤖</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">סריקת מסמכים עם AI</p>
                <p className="text-xs text-gray-500">העלה תמונה של מסמך - המערכת תמלא את הפרטים אוטומטית.</p>
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
              <span className="text-base shrink-0">📋</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">היסטוריית טיפולים ומסמכים</p>
                <p className="text-xs text-gray-500">מעקב אחרי כל מה שנעשה ברכב לאורך זמן.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <Button
            onClick={handleSignup}
            className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white"
          >
            להרשמה 🚗
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            להמשיך כאורח
          </Button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-2">פותח על ידי אופק אדלשטיין</p>
      </DialogContent>
    </Dialog>
  );
}
