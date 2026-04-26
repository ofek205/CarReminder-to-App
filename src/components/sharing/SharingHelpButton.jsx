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
import { Info, X, Users, Car, Clock } from 'lucide-react';
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
              שיתוף רכב
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-right" dir="rtl">
            {/* Plain, single-sentence hook. Copywriter pass cut the
                two-sentence intro: users learn what the role does
                from the role-picker itself, not from the help dialog. */}
            <p className="text-sm leading-relaxed text-gray-700">
              כשמשתפים, הצד השני רואה את הרכב והנתונים שלך. עם הרשאת <strong>עריכה</strong> גם מוסיף ומעדכן.
            </p>

            {/* Path 1: account-wide */}
            <div className="rounded-2xl p-3 flex items-start gap-3" style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: '#4338CA' }}>
                <Users className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm" style={{ color: '#312E81' }}>חשבון שלם</p>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#312E81' }}>
                  למשפחה או בן/בת זוג. כל הרכבים גלויים.
                </p>
                <p className="text-[11px] font-bold mt-1.5" style={{ color: '#4338CA' }}>
                  מהמסך הזה. הזמן משתמש
                </p>
              </div>
            </div>

            {/* Path 2: per-vehicle */}
            <div className="rounded-2xl p-3 flex items-start gap-3" style={{ background: '#E0F2FE', border: '1.5px solid #BAE6FD' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: '#0369A1' }}>
                <Car className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm" style={{ color: '#075985' }}>רכב אחד</p>
                <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#075985' }}>
                  למוסך, חבר או נהג זמני. רק רכב אחד.
                </p>
                <p className="text-[11px] font-bold mt-1.5" style={{ color: '#0369A1' }}>
                  בעמוד הרכב. כפתור שיתוף
                </p>
              </div>
            </div>

            {/* Constraints — three lines max. Removed the editor-permission
                line because the role picker itself spells that out at
                share time. */}
            <div className="rounded-2xl p-3 space-y-1.5" style={{ background: '#FAFAFA', border: '1px solid #E5E7EB' }}>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Users className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span>עד 3 משתמשים לכל רכב</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Clock className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span>הזמנה פגה אחרי 7 ימים</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <X className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span>אפשר לבטל שיתוף בכל רגע</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full h-11 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background: '#2D5233', color: '#fff', boxShadow: '0 4px 14px rgba(45,82,51,0.3)' }}>
              הבנתי
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
