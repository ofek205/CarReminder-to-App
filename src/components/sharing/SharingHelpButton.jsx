/**
 * SharingHelpButton — gold "i" icon that opens an explanation dialog
 * for the sharing feature.
 *
 * Lives in two places: next to the "חשבון משותף" header on
 * AccountSettings, and inline on Vehicle pages where the share
 * button sits. Same component, same copy — keeps the explanation
 * consistent across surfaces.
 *
 * Designed by product + copywriter:
 *   * Lead with what sharing actually does (not jargon).
 *   * Make the two paths (account-wide vs per-vehicle) concrete with
 *     real-world scenarios users recognize: spouse / mechanic /
 *     temporary borrow.
 *   * Surface the constraints inline so users don't get a "max 3"
 *     error after they already typed an email.
 */

import React, { useState } from 'react';
import { Info, X, Users, Car, Clock, Shield } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function SharingHelpButton({ size = 'md', className = '' }) {
  const [open, setOpen] = useState(false);

  const iconSize = size === 'sm' ? 14 : 16;
  const btnSize  = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={`${btnSize} rounded-full inline-flex items-center justify-center shrink-0 transition-all active:scale-95 ${className}`}
        style={{ background: '#FEF3C7', color: '#B45309', border: '1.5px solid #FDE68A' }}
        aria-label="הסבר על שיתוף"
        title="איך זה עובד?">
        <Info style={{ width: iconSize, height: iconSize }} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md mx-4 max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Info className="w-5 h-5" style={{ color: '#B45309' }} />
              שיתוף — איך זה עובד?
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2 text-right" dir="rtl">
            {/* Plain-language hook */}
            <p className="text-sm leading-relaxed text-gray-700">
              שיתוף נותן לאדם נוסף לראות את הנתונים שלך — תיקונים, מסמכים, תזכורות, ביטוחים.
              אם תיתן/י הרשאת <strong>עריכה</strong>, הוא יוכל גם להוסיף ולעדכן בעצמו (חוץ
              ממחיקת הרכב).
            </p>

            <div className="rounded-2xl p-1" style={{ background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
              <p className="text-[11px] font-bold text-center px-2 py-1.5 text-gray-500">
                יש שתי דרכים לשתף — בחר את זו שמתאימה
              </p>
            </div>

            {/* Path 1: account-wide */}
            <div className="rounded-2xl p-4 space-y-2" style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: '#4338CA', boxShadow: '0 3px 10px rgba(67,56,202,0.3)' }}>
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm" style={{ color: '#312E81' }}>חשבון שלם</p>
                  <p className="text-xs mt-0.5" style={{ color: '#4F46E5' }}>בן/בת זוג, בני משפחה</p>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#312E81' }}>
                כשמישהו אחד מטפל בכל הרכבים יחד איתך. הוא רואה את כולם, או רק רכבים שתבחר/י לתת לו
                מתוך החשבון.
              </p>
              <div className="rounded-xl px-3 py-2 text-[11px] font-bold inline-block" style={{ background: 'rgba(67,56,202,0.1)', color: '#4338CA' }}>
                מהמסך הזה: <span className="underline">הזמן משתמש</span>
              </div>
            </div>

            {/* Path 2: per-vehicle */}
            <div className="rounded-2xl p-4 space-y-2" style={{ background: '#E0F2FE', border: '1.5px solid #BAE6FD' }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: '#0369A1', boxShadow: '0 3px 10px rgba(3,105,161,0.3)' }}>
                  <Car className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm" style={{ color: '#075985' }}>רכב אחד</p>
                  <p className="text-xs mt-0.5" style={{ color: '#0369A1' }}>מוסך, חבר שמשאיל את הרכב</p>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#075985' }}>
                כשהשיתוף הוא לרכב ספציפי — בן/בת זוג שנוהג/ת ברכב, מוסך שעוקב אחרי טיפולים, או
                חבר שלוקח את הרכב לכמה ימים.
              </p>
              <div className="rounded-xl px-3 py-2 text-[11px] font-bold inline-block" style={{ background: 'rgba(3,105,161,0.1)', color: '#0369A1' }}>
                מתוך עמוד הרכב: כפתור <span className="underline">שיתוף</span> (שמאל למעלה)
              </div>
            </div>

            {/* Constraints — surfaced before the user gets surprised */}
            <div className="rounded-2xl p-3 space-y-2" style={{ background: '#FAFAFA', border: '1px solid #E5E7EB' }}>
              <p className="text-xs font-bold text-gray-700">לידיעה</p>
              <ul className="text-xs text-gray-600 space-y-1.5">
                <li className="flex items-start gap-2">
                  <Users className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span><strong>עד 3 משתמשים</strong> נוספים לכל רכב, מעבר לבעלים</span>
                </li>
                <li className="flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span>הזמנות שלא אושרו פגות אחרי <strong>7 ימים</strong>. תמיד אפשר לשלוח חדשה</span>
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span><strong>שותף עורך</strong> יכול להוסיף ולעדכן הכל, חוץ ממחיקת הרכב או שיתוף עם אחרים</span>
                </li>
                <li className="flex items-start gap-2">
                  <X className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                  <span>אפשר לבטל שיתוף בכל עת — הרכב יוסר מהרשימה של המשתמש האחר</span>
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full h-12 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: '#2D5233', color: '#fff', boxShadow: '0 4px 14px rgba(45,82,51,0.3)' }}>
              הבנתי
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
