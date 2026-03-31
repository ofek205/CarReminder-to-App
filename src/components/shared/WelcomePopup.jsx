import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Car, Wrench, Bell, Star, Smartphone, Search, MessageSquare, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import usePWAInstall from "./usePWAInstall";
import IOSInstallModal from "./IOSInstallModal";
import { isNative } from "@/lib/capacitor";

export default function WelcomePopup({ open, onClose, isReturningUser = false, userName = '' }) {
  // In native app, PWA install is irrelevant
  const { canInstall: _canInstall, install } = usePWAInstall();
  const canInstall = isNative ? false : _canInstall;
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [installSnoozed, setInstallSnoozed] = useState(false);

  useEffect(() => {
    async function checkSnooze() {
      try {
        const user = await base44.auth.me();
        if (!user) return;
        const snoozed = user.install_cta_snoozed_until;
        if (snoozed && new Date(snoozed) > new Date()) setInstallSnoozed(true);
      } catch (e) {}
    }
    if (open) checkSnooze();
  }, [open]);

  const handleInstall = async () => {
    const installed = await install();
    if (!installed) setShowIOSModal(true);
  };

  const handleSnoozeInstall = async () => {
    setInstallSnoozed(true);
    try {
      const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await base44.auth.updateMe({ install_cta_snoozed_until: until });
    } catch (e) {}
  };

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
          <p className="text-[#2D5233] text-sm font-bold text-center tracking-wide">carReminder</p>
          <DialogTitle className="text-2xl font-bold text-center text-gray-900">
            {isReturningUser ? `כיף שחזרת${userName ? `, ${userName.split(' ')[0]}` : ''}! 👋` : 'ברוך הבא! 👋'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isReturningUser ?
            <>
              <p className="text-gray-600 text-center text-sm leading-relaxed">
                הנה מה שיש באפליקציה:
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
                  <span className="text-base shrink-0">📅</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">הוספה אוטומטית ללוח שנה</p>
                    <p className="text-xs text-gray-500">בלחיצה אחת להוסיף טסט או ביטוח ליומן האישי שלך.</p>
                  </div>
                </div>
              </div>
              <p className="bg-slate-200 text-slate-800 text-xs font-medium text-center leading-relaxed">⭐ האפליקציה עדיין מתפתחת ונשמח לפידבקים ורעיונות לשיפור.</p>
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

          {!installSnoozed &&
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-start gap-2">
                <Smartphone className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-800">התקן כאפליקציה במסך הבית</p>
                  <p className="text-xs text-green-700 mt-0.5">פותח מהר יותר ונראה כמו אפליקציה אמיתית</p>
                  <div className="flex items-center gap-3 mt-2">
                    <Button size="sm" onClick={handleInstall} className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-3">
                      📲 התקן עכשיו
                    </Button>
                    <button onClick={handleSnoozeInstall} className="text-xs text-green-600 underline">
                      לא עכשיו
                    </button>
                  </div>
                </div>
              </div>
            </div>
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

    <IOSInstallModal open={showIOSModal} onClose={() => setShowIOSModal(false)} />
    </>);

}