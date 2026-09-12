/**
 * VehicleCapReachedModal — the shared "you have reached a vehicle cap" wall.
 *
 * Shown by every vehicle-create path (AddVehicle, Dashboard quick-add, scan
 * wizard, bulk import). One component so the wall looks and reads the same
 * everywhere, which is why the plan cap was added HERE rather than as a
 * second modal that would slowly drift from this one.
 *
 * ⚠️ IT SERVES TWO CAPS WITH DIFFERENT ANSWERS, selected by `kind`:
 *
 *   'personal'  enforce_personal_vehicle_cap. Ceiling is
 *               accounts.vehicle_cap; remedy is a business account, which is
 *               an in-app admin-approval request and not a purchase, so no
 *               store rule constrains it.
 *
 *   'plan'      enforce_vehicle_plan_cap_stmt (phase 4). Ceiling is
 *               plan_limits.max_vehicles; remedy is a paid PLAN. A business
 *               account is NOT the answer, because from ₪9 the business
 *               interface is already included (spec ח-2), so offering it
 *               would misdescribe what the money buys.
 *
 * ⚠️ AND THE PLAN VARIANT IS PLATFORM-CONSTRAINED. capWallAction() decides
 * what may be shown: on iOS a plan wall carries no button, no perks list and
 * no mention of plans or prices at all, because 3.1.1(a) covers prose as
 * well as controls. On Android it may mention without linking. The full
 * reasoning, including why /MyPlan's button is not labelled "upgrade", is in
 * lib/billingGate.js.
 *
 * Copy rule (spec §5.7 / E-7): describe what is UNLOCKED, never promise
 * "free" or "unlimited forever".
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Truck, Users, X, ArrowLeft, Sparkles } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';
import { capWallAction } from '@/lib/billingGate';

const PERKS = [
  { Icon: Truck, t: 'בלי תקרת רכבים', d: 'נהלו צי שלם במקום אחד' },
  { Icon: Users, t: 'צוות ונהגים',    d: 'שיתוף מעבר ל-3 אנשים לרכב' },
];

// The paid-plan variant. Deliberately NOT the business-account perks: from
// ₪9 the business interface is included, so listing it as the reward for
// upgrading would misdescribe what the money buys (spec ח-2).
const PLAN_PERKS = [
  { Icon: Truck,   t: 'תקרה גבוהה יותר', d: 'עד 10, 30, או בלי הגבלה' },
  { Icon: Sparkles, t: 'כל היכולות פתוחות', d: 'היועץ, הבדיקות, השיתופים והממשק העסקי' },
];

/**
 * @param {'plan'|'personal'} [kind]  which cap refused. Defaults to
 *   'personal' so the three call sites that do not pass it keep their
 *   existing behaviour unchanged.
 * @param {number|null} [planCap]  plan_limits.max_vehicles, for the plan
 *   variant. Never falls back to capacity.cap: that is accounts.vehicle_cap
 *   and printing it after a plan-cap refusal is the "5 of 10" bug.
 */
export default function VehicleCapReachedModal({ open, onClose, capacity, kind = 'personal', planCap = null }) {
  const navigate = useNavigate();
  if (!open) return null;

  const isPlan = kind === 'plan';
  // ⚠️ TWO DIFFERENT CEILINGS FROM TWO DIFFERENT SYSTEMS. The personal cap
  // is accounts.vehicle_cap (default 10); the plan cap is
  // plan_limits.max_vehicles. Reading the wrong one prints a number the
  // server did not refuse on.
  const cap = isPlan ? planCap : (capacity?.cap ?? 10);
  const action = capWallAction(kind);
  const perks = isPlan ? PLAN_PERKS : PERKS;

  const goBusiness = () => {
    onClose?.();
    navigate(createPageUrl('CreateBusinessWorkspace'));
  };

  const goPlan = () => {
    onClose?.();
    navigate(createPageUrl('MyPlan'));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,20,12,0.55)' }}
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label={isPlan ? "הגעת לתקרת המסלול" : "הגעת לתקרת הרכבים"}
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
          <h2 className="text-xl font-extrabold">
            {isPlan ? 'הגעת לתקרת המסלול' : 'הגעת לתקרת הרכבים'}
          </h2>
          <p className="text-[12.5px] mt-1.5" style={{ color: 'rgba(255,255,255,0.88)' }}>
            {isPlan
              ? (
                // ⚠️ THE SENTENCE ADAPTS TO WHAT THE PLATFORM MAY SAY. On
                // iOS mayMentionPlans is false, so the copy states the limit
                // and the one action available in the app, and says nothing
                // about plans, prices or a website. Naming an upgrade the
                // user cannot make here would breach 3.1.1(a) AND offer an
                // action that cannot be fulfilled.
                action.mayMentionPlans
                  ? <>המסלול הנוכחי כולל עד {cap ?? '—'} כלי תחבורה. במסלול גדול יותר התקרה עולה.</>
                  : <>המסלול הנוכחי כולל עד {cap ?? '—'} כלי תחבורה. כדי להוסיף כלי חדש, אפשר להסיר אחד קיים.</>
              )
              : <>החשבון האישי מיועד לניהול עד {cap} רכבים. כדי להוסיף עוד, כאן נכנס החשבון העסקי.</>}
          </p>
        </div>

        {/* Perks. Hidden entirely when the platform may say nothing about
            plans: a list of what a paid plan unlocks IS a mention, so on
            iOS the wall carries only the limit and the in-app remedy. */}
        <div className="px-5 pt-4 pb-2">
          {(isPlan && !action.mayMentionPlans ? [] : perks).map(({ Icon, t, d }) => (
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
          {/* ⚠️ NO PRIMARY BUTTON WHEN action.cta IS NULL, which is iOS and
              Android for a plan cap. Two rules force that, not one:
              anti-steering forbids the control on iOS, and lib/aiScanGate's
              documented lesson forbids offering an action that cannot be
              fulfilled anywhere. On Android there is genuinely nothing to
              press until Play Billing exists; a button would be theatre. */}
          {action.cta === 'business' && (
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
          )}
          {action.cta === 'plan' && (
            /* ⚠️ THE LABEL IS DELIBERATELY NOT "שדרג". /MyPlan is
               display-only until phase 6, so a button promising an upgrade
               would lead to a screen that cannot perform one. It says what
               actually happens: you see your plan and its limits. */
            <button
              type="button"
              onClick={goPlan}
              className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              style={{
                background: `linear-gradient(135deg, ${C.successDark} 0%, ${C.successBright} 80%, ${C.successMid} 100%)`,
                color: '#FFFFFF',
                boxShadow: '0 8px 20px rgba(16,185,129,0.30)',
              }}
            >
              המסלול והמגבלות שלי <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl font-bold text-sm transition-colors"
            style={{ background: C.bgSubtle, color: C.textAlt }}
          >
            {/* "סגור" rather than "לא עכשיו" when it is the only button:
                "not now" implies a deferred offer, and on iOS there is no
                offer to defer. */}
            {action.cta ? 'לא עכשיו' : 'סגור'}
          </button>
        </div>
      </div>
    </div>
  );
}
