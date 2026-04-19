import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Car, Wrench, Bell, Star, Search, MessageSquare, Sparkles } from "lucide-react";

export default function WelcomePopup({ open, onClose, isReturningUser = false, userName = '' }) {
  const handleClose = () => {
    onClose();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md text-right" dir="rtl">
        <DialogHeader>
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-2xl bg-[#2D5233] flex items-center justify-center shadow-md">
              <Car className="h-8 w-8 text-white" />
            </div>
          </div>
          <p className="text-[#2D5233] text-sm font-bold text-center tracking-wide">CarReminder</p>
          <DialogTitle className="text-2xl font-bold text-center text-gray-900">
            {isReturningUser ? `כיף שחזרת${userName ? `, ${userName.split(' ')[0]}` : ''}! 👋` : 'ברוך הבא! 👋'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isReturningUser ?
            <>
              <p className="text-gray-500 text-center text-xs">חדש באפליקציה</p>
              <div className="bg-[#E8F2EA] rounded-xl p-3 space-y-2.5">
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">🔧</span>
                  <p className="text-sm text-gray-800">
                    <span className="font-semibold">מומחה AI אישי:</span>
                    <span className="text-gray-500"> ברוך ויוסי מכירים את הרכב שלך.</span>
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-base shrink-0">⚠️</span>
                  <p className="text-sm text-gray-800">
                    <span className="font-semibold">ניהול תאונות:</span>
                    <span className="text-gray-500"> נזקים, נהג שני, צילומים וביטוח במקום אחד.</span>
                  </p>
                </div>
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