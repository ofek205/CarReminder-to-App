/**
 * VehicleCapReachedModal — the shared "you've reached the personal cap" block.
 *
 * Shown by every vehicle-create path (AddVehicle, Dashboard quick-add, scan
 * wizard, bulk import) when the server raises personal_vehicle_cap_reached
 * (detected via isVehicleCapError). One component so the wall looks and reads
 * the same everywhere.
 *
 * The primary action routes to CreateBusinessWorkspace — the existing page
 * that already carries the full benefits showcase and the request flow. We do
 * NOT rebuild the benefits here; this modal is the concise stop + hand-off.
 * (Wave 3 makes that page's request auto-approve when it arrives from the cap.)
 *
 * Copy rule (spec §5.7 / E-7): describe what a business account UNLOCKS, never
 * promise "free" or "unlimited forever" — the business tier is planned to be
 * paid. "בלי תקרת רכבים" is a true feature statement, not a price promise.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Truck, Users, X, ArrowLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';

const PERKS = [
  { Icon: Truck, t: 'בלי תקרת רכבים', d: 'נהלו צי שלם במקום אחד' },
  { Icon: Users, t: 'צוות ונהגים',    d: 'שיתוף מעבר ל-3 אנשים לרכב' },
];

export default function VehicleCapReachedModal({ open, onClose, capacity }) {
  const navigate = useNavigate();
  if (!open) return null;

  const cap = capacity?.cap ?? 10;

  const goBusiness = () => {
    onClose?.();
    navigate(createPageUrl('CreateBusinessWorkspace'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,12,0.55)' }}
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="הגעת לתקרת הרכבים"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl overflow-hidden bg-white shadow-2xl"
        style={{ maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div
          className="relative px-6 py-7 text-center text-white"
          style={{ background: 'linear-gradient(125deg,#1E3D28 0%,#2D5233 70%,#3C7A4D 100%)' }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="סגור"
            className="absolute top-3 left-3 p-1.5 rounded-full transition-colors"
            style={{ background: 'rgba(255,255,255,0.14)' }}
          >
            <X className="h-4 w-4" />
          </button>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
            style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}
          >
            <Briefcase className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-extrabold">הגעת לתקרת הרכבים</h2>
          <p className="text-[12.5px] mt-1.5" style={{ color: 'rgba(255,255,255,0.88)' }}>
            החשבון האישי מיועד לניהול עד {cap} רכבים. כדי להוסיף עוד — כאן נכנס החשבון העסקי.
          </p>
        </div>

        {/* Perks */}
        <div className="px-5 pt-4 pb-2">
          {PERKS.map(({ Icon, t, d }) => (
            <div key={t} className="flex items-center gap-3 py-2.5">
              <div
                className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
                style={{ background: `linear-gradient(135deg, ${C.successDark}, ${C.successBright})` }}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold leading-tight" style={{ color: C.primaryDark }}>{t}</p>
                <p className="text-[11.5px] mt-0.5" style={{ color: C.textAlt }}>{d}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 pt-2 space-y-2">
          <button
            type="button"
            onClick={goBusiness}
            className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={{
              background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
              color: '#FFFFFF',
              boxShadow: '0 8px 20px rgba(16,185,129,0.30)',
            }}
          >
            פתיחת חשבון עסקי <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl font-bold text-sm transition-colors"
            style={{ background: C.bgSubtle, color: C.textAlt }}
          >
            לא עכשיו
          </button>
        </div>
      </div>
    </div>
  );
}
