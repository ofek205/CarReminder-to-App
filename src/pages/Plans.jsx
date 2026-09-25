/**
 * /Plans — where you stand, and every plan side by side.
 *
 * ⚠️ A DECISION SCREEN NOW, NOT AN INFORMATION SCREEN. It was built when no
 * platform could sell anything, and its layout said so: two full cards and
 * the tiers above folded into one line. Play can sell now, and Ofek wants the
 * screen to encourage moving between plans, so all four plans are always on
 * screen, in the same ascending order, for every account.
 *
 * ⚠️ AN ACCORDION, AND THE CLOSED ROWS ARE THE COMPARISON. Each closed row
 * carries the three numbers that actually differ between plans (vehicles,
 * documents, AI), in fixed-width columns under one legend, so the eye reads
 * 5 → 15 → 30 → ללא without scrolling. One row is open at a time, and only
 * the open row carries a price, a detail list and an action. Four full cards
 * were ~2,000px of scrolling with four competing buttons; a table could not
 * hold PurchaseAction's eleven states in a 70px column.
 *
 * ⚠️ EVERY NUMBER AND EVERY NAME COMES FROM plan_limits. Not one limit is
 * typed into this file. Marketing and enforcement cannot contradict each
 * other, and tuning a cap is an UPDATE with no deploy. A hardcoded number
 * becomes a lie the moment that happens.
 *
 * ⚠️ "מתאים לך" IS EARNED FROM USAGE, NEVER STATIC. It appears only when the
 * account holds 80% of a cap, and it lands on the cheapest plan that leaves
 * 20% of headroom, so it never sends somebody straight to the edge of the
 * next plan. There is no "הכי פופולרי": there are no subscribers yet, and a
 * claim nothing can prove is how trust at a payment moment is lost.
 *
 * @see docs/ux-plans-redesign.md
 * @see docs/spec-monetization-plans-v2.md §5.1, §5.4
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Car, FileText, Sparkles, CornerDownLeft } from 'lucide-react';
import PageShell from '@/components/business/system/PageShell';
import SystemErrorBanner from '@/components/shared/SystemErrorBanner';
import { createPageUrl } from '@/utils';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/designTokens';
import usePlanCatalog from '@/hooks/usePlanCatalog';
import useAccountPlan, { ACCOUNT_PLAN_QUERY_KEY } from '@/hooks/useAccountPlan';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import useVehicleCapacity, { VEHICLE_CAPACITY_QUERY_KEY } from '@/hooks/useVehicleCapacity';
import useDocumentUsage, { DOCUMENT_USAGE_QUERY_KEY } from '@/hooks/useDocumentUsage';
import { FEATURE_USAGE_QUERY_KEY } from '@/hooks/useFeatureUsage';
import { billingSurface, IAP, NONE, WEB } from '@/lib/billingGate';
import {
  getBillingBackend,
  openStoreSubscriptionManagement,
  canOpenStoreSubscriptionManagement,
} from '@/lib/billing';
import { PurchaseState, mayOfferPurchase } from '@/lib/billing/purchaseMachine';
import { usePurchaseFlow } from '@/hooks/usePurchaseFlow';
import { useFeatureFlag } from '@/lib/featureFlags';
import useAccountRole from '@/hooks/useAccountRole';
import PurchaseAction from '@/components/plans/PurchaseAction';
import VerifyingBanner from '@/components/plans/VerifyingBanner';

// ── pure helpers, exported for testing ──────────────────────────────────
//
// NULL means unlimited everywhere in plan_limits. Rendering it as 0 would
// invert the meaning, which is why every one of these tests for null first.

/** "עד 5" / "ללא הגבלה" */
export function capLabel(n) {
  return n === null || n === undefined ? 'ללא הגבלה' : `עד ${n}`;
}

/**
 * The advisor, in full, for the open row.
 *
 * ⚠️ "להתרשמות" IS LOAD-BEARING. The free allowance is one question for the
 * lifetime of the account, and "שאלה אחת" alone reads as a monthly quota.
 *
 * ⚠️ PAID PLANS SHOW THEIR DAILY CAP, AND THIS USED TO SAY "פתוח". That hid
 * the 50 / 200 / 500 difference, which is one of only three things that
 * separate the paid plans at all.
 */
export function advisorLabel(plan) {
  const teaser = plan?.aiLifetimeTeaser;
  if (teaser !== null && teaser !== undefined) {
    return teaser === 1 ? 'שאלה אחת להתרשמות' : `${teaser} שאלות להתרשמות`;
  }
  const cap = plan?.aiDailyCap;
  if (cap !== null && cap !== undefined) return `${cap} שאלות ביום`;
  return 'ללא הגבלה';
}

/**
 * The note that stops this screen lying to the grandfathered accounts.
 *
 * account_plan() applies the override, so the plan a frozen user is ON says
 * "עד 5" while their app allows the 17 they actually hold. The row shows the
 * PLAN and annotates the difference, and "נשמר מהמצב הקודם" is the half that
 * matters: without a reason, a reader concludes one of the numbers is a bug.
 *
 * @param effective  the account's real ceiling (from account_plan)
 * @param catalogue  what the plan advertises
 * @returns {string|null}
 */
export function personalNote(effective, catalogue) {
  const eff = effective === undefined ? null : effective;
  const cat = catalogue === undefined ? null : catalogue;
  if (eff === cat) return null;
  if (eff === null) return 'אצלך ללא הגבלה';
  if (cat === null) return `אצלך עד ${eff}`;
  return `אצלך עד ${eff}, נשמר מהמצב הקודם`;
}

/**
 * Why there is no purchase button, worded for the platform.
 *
 * ⚠️ THE iOS STRING MAY NOT HINT THAT A PURCHASE EXISTS ELSEWHERE.
 * Guideline 3.1.1(a) covers prose, so "המנוי מנוהל באתר" is steering there.
 * "בגרסה הזו של האפליקציה" says temporary without pointing anywhere, and
 * none of them says "בקרוב", a promise with a date nobody has.
 *
 * ⚠️ NO SURFACE NAMES A WEBSITE. Android ships Play Billing, and Play Billing
 * present AND an external purchase referred to is the hybrid Play forbids.
 */
export function unavailableCopy(surface) {
  if (surface === IAP)  return 'רכישה אינה זמינה בגרסה הזו של האפליקציה.';
  if (surface === NONE) return 'רכישה אינה זמינה באפליקציה.';
  return 'רכישה אינה זמינה כרגע.';
}

/**
 * Does this plan's own name already state its price?
 *
 * Until the names in supabase-plans-redesign-2026-09-25.sql are applied,
 * label_he for the paid plans IS the price ("₪9 לחודש"), and printing a price
 * line under it rendered the price twice. Checked against the label rather
 * than assumed, so the price line appears by itself once the names land.
 */
export function labelStatesPrice(plan) {
  if (!plan) return false;
  if (plan.priceIlsMonth === 0) return true;
  return String(plan.labelHe || '').includes(String(plan.priceIlsMonth));
}

/**
 * May this surface print a price taken from plan_limits?
 *
 * ⚠️ ONLY THE WEB. On Android the price must be Play's, because the store
 * knows the currency, the tax and the buyer's locale, and a price that
 * differs from the one charged is a removable offence under Play policy. On
 * iOS no price may appear at all. So a native row with no Play product shows
 * no price rather than our number.
 */
export function catalogPriceAllowed(surface) {
  return surface === WEB;
}

/** The three columns every closed row carries, in legend order. */
export const COLUMNS = ['vehicles', 'documents', 'ai'];

/**
 * One closed-row cell. "ללא" and not "ללא הגבלה": only three letters fit a
 * 52px column, and the legend and the open row carry the full wording.
 *
 * ⚠️ THE AI UNIT IS WRITTEN IN EVERY CELL, NOT IN THE LEGEND. Free has one
 * question for life and the paid plans have a daily cap, so a shared "ליום"
 * heading would print the free teaser as one question a day.
 */
export function cellValue(key, plan) {
  if (!plan) return '';
  if (key === 'vehicles')  return plan.maxVehicles === null ? 'ללא' : String(plan.maxVehicles);
  if (key === 'documents') return plan.maxDocuments === null ? 'ללא' : String(plan.maxDocuments);
  if (key === 'ai') {
    if (plan.aiLifetimeTeaser !== null && plan.aiLifetimeTeaser !== undefined) {
      return `${plan.aiLifetimeTeaser} בסה״כ`;
    }
    if (plan.aiDailyCap !== null && plan.aiDailyCap !== undefined) return `${plan.aiDailyCap} ביום`;
    return 'ללא';
  }
  return '';
}

/** One open-row value, in full. */
export function detailValue(key, plan) {
  if (!plan) return '';
  if (key === 'vehicles')  return capLabel(plan.maxVehicles);
  if (key === 'documents') return capLabel(plan.maxDocuments);
  if (key === 'ai')        return advisorLabel(plan);
  return '';
}

/** The short form a plan's value takes inside "(במקום …)". */
function referenceValue(key, plan) {
  if (key === 'ai') {
    const t = plan.aiLifetimeTeaser;
    if (t !== null && t !== undefined) return t === 1 ? 'שאלה אחת' : `${t} שאלות`;
    if (plan.aiDailyCap !== null && plan.aiDailyCap !== undefined) return `${plan.aiDailyCap} ביום`;
    return 'ללא הגבלה';
  }
  const n = key === 'vehicles' ? plan.maxVehicles : plan.maxDocuments;
  return n === null || n === undefined ? 'ללא הגבלה' : String(n);
}

/**
 * "(במקום 5)" beside a value that differs from the account's current plan,
 * or null when it does not.
 *
 * ⚠️ "(במקום 5)" AND NOT "+10". A positive number reads like an advert;
 * "15 (במקום 5)" reads as a fact: this is what you have, this is what you
 * would have. The encouragement comes from the comparison, not from words.
 */
export function deltaNote(key, plan, reference) {
  if (!plan || !reference || plan.code === reference.code) return null;
  const mine = referenceValue(key, plan);
  const theirs = referenceValue(key, reference);
  return mine === theirs ? null : `(במקום ${theirs})`;
}

/**
 * The single line under the three numbers: vehicle checks, sharing, and the
 * business interface.
 *
 * ⚠️ ONE LINE, NOT THREE ROWS, AND THAT IS THE WHOLE OF THE "LIGHTER" DESIGN
 * OFEK CHOSE. These three are the same on every paid plan, so three rows each
 * repeated them under every plan and again at the foot of the screen. Said
 * once here, the open row keeps its button within thumb reach.
 *
 * ⚠️ BUSINESS ACCOUNTS READ THE BUSINESS INTERFACE FIRST. For a business
 * account sitting on free, "בלי ממשק עסקי" is the most consequential phrase
 * on the screen, and last in the line is the last thing read.
 */
export function extrasLine(plan, isBusiness = false) {
  if (!plan) return '';
  const plateOpen = plan.plateChecksPerMonth === null || plan.plateChecksPerMonth === undefined;
  const sharesOpen = plan.maxShares === null || plan.maxShares === undefined;
  const counts = plateOpen && sharesOpen
    ? 'בדיקות רכב ושיתופים ללא הגבלה'
    : [
      plateOpen ? 'בדיקות רכב ללא הגבלה' : `${plan.plateChecksPerMonth} בדיקות רכב בחודש`,
      sharesOpen ? 'שיתופים ללא הגבלה' : `${plan.maxShares} שיתופי רכב`,
    ].join(', ');

  if (plan.businessUi) {
    return isBusiness ? `בנוסף: ממשק עסקי, ${counts}.` : `בנוסף: ${counts}, וממשק עסקי.`;
  }
  return isBusiness ? `בלי ממשק עסקי, ${counts}.` : `${counts}, בלי ממשק עסקי.`;
}

/** The share of a cap at which a meter turns amber and a plan is recommended. */
export const NEAR_FULL = 0.8;

/**
 * One usage meter, or null when the number is not known.
 *
 * A null limit is unlimited: no bar, because a bar needs a denominator and
 * "11 of infinity" drawn as an empty track reads as "nothing used".
 */
export function usageMeter(used, limit) {
  if (used === null || used === undefined) return null;
  if (limit === null || limit === undefined) return { used, limit: null, pct: 0, near: false };
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  return { used, limit, pct, near: limit <= 0 || used / limit >= NEAR_FULL };
}

/**
 * The plan "מתאים לך" sits on, or null.
 *
 * Appears only when the account holds NEAR_FULL of its current vehicle or
 * document cap. Lands on the cheapest plan above the current one where BOTH
 * what it holds stays under NEAR_FULL of the new cap.
 *
 * ⚠️ THE HEADROOM RULE APPLIES TO THE TARGET TOO, AND THAT WAS A BUG FIRST.
 * "The cheapest plan whose cap exceeds usage" sends somebody holding 12
 * vehicles to ₪9, where 12 of 15 is already 80%, and a week later the same
 * badge tells them to upgrade again. They get ₪19.
 *
 * ⚠️ AN UNKNOWN DOCUMENT COUNT IS NEITHER FULL NOR BLOCKING. Before
 * my_document_usage() exists the recommendation runs on vehicles alone,
 * rather than inventing a document number to decide on.
 *
 * @param plans    the catalogue, ascending
 * @param current  the account's plan, with overrides applied
 * @param usage    { vehicles, documents }, each a number or null
 */
export function recommendPlan(plans, current, usage) {
  if (!Array.isArray(plans) || !current) return null;
  const full = (used, cap) =>
    used !== null && used !== undefined && cap !== null && cap !== undefined
    && (cap <= 0 || used / cap >= NEAR_FULL);
  const roomy = (used, cap) =>
    used === null || used === undefined || cap === null || cap === undefined
    || used < NEAR_FULL * cap;

  const v = usage?.vehicles ?? null;
  const d = usage?.documents ?? null;
  if (!full(v, current.maxVehicles) && !full(d, current.maxDocuments)) return null;

  const rank = plans.findIndex((p) => p.code === current.code);
  if (rank < 0) return null;
  const fit = plans.slice(rank + 1).find((p) => roomy(v, p.maxVehicles) && roomy(d, p.maxDocuments));
  return fit ? fit.code : null;
}

/**
 * Which row is open when the screen arrives.
 *
 * A recommendation opens itself. Otherwise the next step up, which for a
 * guest or a free account is the entry paid plan; the top plan opens its own
 * row, because there is nothing above it to show.
 */
export function defaultOpenCode(plans, currentCode, recCode) {
  if (!Array.isArray(plans) || plans.length === 0) return null;
  if (recCode && plans.some((p) => p.code === recCode)) return recCode;
  const rank = plans.findIndex((p) => p.code === currentCode);
  if (rank < 0) return (plans.find((p) => p.priceIlsMonth > 0) || plans[0]).code;
  return (plans[rank + 1] || plans[rank]).code;
}

/**
 * What the open row offers, as one word.
 *
 * ⚠️ A SUBSCRIBER NEVER GETS 'purchase' ON ANOTHER PLAN. purchaseProduct()
 * has no replacement mode in our plugin, so Play treats a second tap as a NEW
 * subscription: two live subscriptions, two charges, one account. 'manage'
 * explains that switching is not possible yet and points at the one place a
 * cancellation happens.
 *
 * ⚠️ THE ACTIVE CARD WINS OVER 'current'. The moment a purchase is granted the
 * plan becomes current, and without this the success state would be replaced
 * mid-sentence by "זה המסלול שלך".
 */
export function actionKind({ plan, isCurrent, isGuest, offering, storeManaged, isActive }) {
  if (isGuest) return 'guest';
  if (isActive) return 'purchase';
  if (isCurrent) return 'current';
  if (storeManaged) return 'manage';
  if (offering && plan?.priceIlsMonth > 0) return 'purchase';
  return 'none';
}

/**
 * The sentence on a row a subscriber cannot switch to.
 *
 * ⚠️ IT MAY NOT PROMISE A SWITCH, AND TWO EARLIER STRINGS DID. Play's
 * subscription centre offers cancel, resume, pause and payment method, never
 * a move between products, and a move started in the app needs a replacement
 * mode our plugin does not have.
 */
export function manageNote(target) {
  if (target?.priceIlsMonth === 0) {
    return 'כדי לחזור לחינם מבטלים את המנוי ב-Google Play. המסלול הנוכחי נשאר פעיל עד סוף התקופה ששולמה.';
  }
  return 'עדיין אי אפשר לעבור מסלול מתוך האפליקציה. מבטלים ב-Google Play, ובסוף התקופה ששולמה בוחרים כאן את המסלול החדש.';
}

/**
 * Does Google hold a live subscription for this account right now?
 *
 * ⚠️ GATED ON THE SOURCE, NOT ON "is on a paid plan". An admin grant also
 * puts an account on p19, and sending that person to Play would open a
 * subscriptions list their plan is not in.
 *
 * ⚠️ AND ON THE PLAN BEING PAID, OR AN EXPIRED SUBSCRIBER COULD NEVER BUY
 * AGAIN. The subscription row keeps source 'iap_google' after the period
 * ends; account_plan() drops the account to free (the expiry fix, ledger 31)
 * but the source stays. Keyed on source alone, that person would be told
 * forever that switching is not possible, with nothing live to switch from.
 */
export function isStoreManaged(subscription, plan) {
  return subscription?.source === 'iap_google' && plan?.priceIlsMonth > 0;
}

/** The sentence on the account's own row. */
export function currentNote(plan, storeManaged) {
  return storeManaged && plan?.priceIlsMonth > 0
    ? 'זה המסלול שלך. ביטול ושינוי אמצעי תשלום נעשים ב-Google Play.'
    : 'זה המסלול שלך כרגע.';
}

// ── presentation ────────────────────────────────────────────────────────

const COLUMN_META = {
  vehicles:  { icon: Car,      label: 'כלי תחבורה', detail: 'כלי תחבורה',     chip: C.light },
  documents: { icon: FileText, label: 'מסמכים',     detail: 'מסמכים שמורים', chip: C.light },
  // Yellow because the AI expert already wears it: a green sparkle on a
  // yellow tile is its avatar across the app.
  ai:        { icon: Sparkles, label: 'מומחה AI',   detail: 'מומחה AI',      chip: C.yellow },
};

/**
 * Keeps the legend and every closed row on the same five tracks.
 *
 * ⚠️ THE NUMBER TRACKS ARE AS NARROW AS THEIR WIDEST VALUE, FOUND IN THE
 * PREVIEW. Inside PageShell a row is about 283px wide, and wider tracks left
 * the name 63px, so "₪19 לחודש" broke over two lines and "ללא הגבלה" would
 * too. "ללא" and "40" fit 44px; "200 ביום" fits 60px.
 */
const ROW_GRID = 'grid grid-cols-[22px_minmax(0,1fr)_44px_44px_60px] gap-1 items-center';

/** Numerals stay LTR inside Hebrew, or "₪9" renders reversed. */
function Num({ children }) {
  return <span dir="ltr" className="tabular-nums">{children}</span>;
}

function Chip({ column, size = 24 }) {
  const meta = COLUMN_META[column];
  const Icon = meta.icon;
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center rounded-full shrink-0"
      style={{ width: size, height: size, background: meta.chip }}
    >
      <Icon style={{ width: size * 0.58, height: size * 0.58, color: C.primary }} />
    </span>
  );
}

/**
 * The two badges, told apart by colour as well as by word: blue says "this
 * is where you are", yellow says "this is what we suggest". Both green, as
 * they were, they read as one badge said twice.
 */
function CurrentBadge() {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{ background: C.infoBg, color: C.infoDark }}
    >
      המסלול שלך
    </span>
  );
}

function FitsBadge() {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ background: C.yellow, color: C.text }}
    >
      מתאים לך
    </span>
  );
}

function Meter({ label, meter }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="text-[12px]" style={{ color: C.gray500 }}>{label}</span>
        <span
          className="text-[13px] font-medium whitespace-nowrap"
          style={{ color: meter.near ? C.warnDark : C.gray800 }}
        >
          {meter.limit === null
            ? <><Num>{meter.used}</Num> · ללא הגבלה</>
            : <><Num>{meter.used}</Num> מתוך <Num>{meter.limit}</Num></>}
        </span>
      </div>
      {meter.limit !== null && (
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.border }} aria-hidden="true">
          <div
            className="h-1.5 rounded-full"
            style={{ width: `${meter.pct}%`, background: meter.near ? C.warnMid : C.primary }}
          />
        </div>
      )}
    </div>
  );
}

/** "Where you stand": the plan, and how full it is. The screen's first read. */
function StatusStrip({ plan, meters }) {
  return (
    <section className="rounded-2xl px-3.5 pt-3 pb-3.5 space-y-2.5" style={{ background: C.light }} aria-label="המסלול שלך">
      <p className="text-[14px]" style={{ color: C.gray800 }}>
        המסלול שלך: <span className="font-bold" style={{ color: C.primary }}>{plan.labelHe}</span>
      </p>
      {meters.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {meters.map((m) => <Meter key={m.label} label={m.label} meter={m.meter} />)}
        </div>
      )}
    </section>
  );
}

function Legend() {
  return (
    <div className={`${ROW_GRID} px-3.5 text-[11px] leading-tight text-center`} style={{ color: C.gray500 }} aria-hidden="true">
      <span />
      <span />
      {COLUMNS.map((key) => (
        <span key={key} className="flex flex-col items-center gap-1">
          <Chip column={key} />
          <span>{COLUMN_META[key].label}</span>
        </span>
      ))}
    </div>
  );
}

function ClosedRow({ plan, isCurrent, isRec, price, priceLoading, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded="false"
      className={`${ROW_GRID} w-full min-h-[56px] px-3.5 py-2 rounded-2xl bg-white border text-right`}
      style={{ borderColor: C.gray200, color: C.gray800 }}
    >
      <span
        aria-hidden="true"
        className="justify-self-center w-[18px] h-[18px] rounded-full border-2"
        style={{ borderColor: C.gray400 }}
      />
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="flex flex-wrap items-center gap-1">
          <span className="text-[15px] font-bold">{plan.labelHe}</span>
          {isCurrent && <CurrentBadge />}
          {isRec && <FitsBadge />}
        </span>
        {price && (
          <span className="text-[12px]" style={{ color: C.gray500 }}><Num>{price}</Num> לחודש</span>
        )}
        {priceLoading && (
          <span className="block h-2.5 w-14 rounded animate-pulse" style={{ background: C.gray200 }} aria-hidden="true" />
        )}
      </span>
      {COLUMNS.map((key) => (
        <span key={key} className={`${key === 'ai' ? 'text-[12px]' : 'text-[14px]'} font-medium text-center tabular-nums`}>
          {cellValue(key, plan)}
        </span>
      ))}
    </button>
  );
}

function ManageBlock({ note, canOpen }) {
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-relaxed" style={{ color: C.gray700 }}>{note}</p>
      {canOpen && (
        <button
          type="button"
          onClick={openStoreSubscriptionManagement}
          className="w-full h-12 rounded-2xl text-[15px] font-bold bg-white"
          style={{ color: C.primary, border: `1.5px solid ${C.primary}` }}
        >
          ניהול המנוי ב-Google Play
        </button>
      )}
    </div>
  );
}

function OpenRow({ plan, reference, gain, isCurrent, isRec, isBusiness, price, vehicleNote, action, reduceMotion, rowRef }) {
  const extrasGain = gain && reference?.priceIlsMonth === 0 && plan.priceIlsMonth > 0;
  return (
    // ⚠️ TRANSFORM ONLY, NEVER OPACITY. Found in the preview: the animation
    // timeline there stood still, and a fade frozen part-way left the open
    // row, its price and its button at 57% opacity. A stalled slide costs
    // six pixels; a stalled fade hides the one control on the screen.
    <motion.section
      ref={rowRef}
      initial={reduceMotion ? false : { y: 6 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="rounded-3xl p-3.5 shadow-sm space-y-3"
      style={{ background: C.bgSubtle, boxShadow: `0 0 0 2px ${C.primary}` }}
      aria-label={plan.labelHe}
    >
      <header className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            aria-hidden="true"
            className="w-[18px] h-[18px] rounded-full bg-white shrink-0"
            style={{ border: `5px solid ${C.primary}` }}
          />
          <span className="text-[18px] font-bold" style={{ color: C.gray800 }}>{plan.labelHe}</span>
          {isCurrent && <CurrentBadge />}
          {isRec && <FitsBadge />}
        </div>
        {price && (
          <p className="text-[13px] ps-7" style={{ color: C.gray500 }}><Num>{price}</Num> לחודש</p>
        )}
      </header>

      <div className="space-y-2">
        <dl className="bg-white rounded-2xl px-3 divide-y" style={{ borderColor: C.gray100 }}>
          {COLUMNS.map((key) => {
            const delta = deltaNote(key, plan, reference);
            const emphasised = gain && !!delta;
            return (
              <div key={key} className="py-2.5" style={{ borderColor: C.gray100 }}>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-2 min-w-0 text-[13px]" style={{ color: C.gray500 }}>
                    <Chip column={key} size={22} />
                    <span className="truncate">{COLUMN_META[key].detail}</span>
                  </dt>
                  <dd className="flex items-baseline gap-1.5 shrink-0 text-end">
                    <span
                      className={`text-[14px] tabular-nums ${emphasised ? 'font-bold' : ''}`}
                      style={{ color: emphasised ? C.primary : C.gray800 }}
                    >
                      {detailValue(key, plan)}
                    </span>
                    {delta && <span className="text-[12px]" style={{ color: C.gray500 }}>{delta}</span>}
                  </dd>
                </div>
                {key === 'vehicles' && vehicleNote && (
                  <p className="text-[12px] mt-1.5 flex items-start gap-1 leading-snug" style={{ color: C.primary }}>
                    <CornerDownLeft className="h-3 w-3 shrink-0 mt-0.5 rtl:rotate-180" aria-hidden="true" />
                    <span>{vehicleNote}</span>
                  </p>
                )}
              </div>
            );
          })}
        </dl>
        <p
          className={`text-[13px] leading-snug px-0.5 ${extrasGain ? 'font-medium' : ''}`}
          style={{ color: extrasGain ? C.primary : C.gray500 }}
        >
          {extrasLine(plan, isBusiness)}
        </p>
      </div>

      {action}
    </motion.section>
  );
}

function SkeletonScreen() {
  // The structure is known before the data is, so the structure is delivered
  // first. A spinner says "something is happening"; this says what.
  return (
    <div className="space-y-3.5" aria-hidden="true">
      <div className="h-[86px] rounded-2xl animate-pulse" style={{ background: C.light }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-14 rounded-2xl bg-white border animate-pulse" style={{ borderColor: C.gray200 }} />
      ))}
    </div>
  );
}

/**
 * Hand the purchase token to the server, which asks Google about it.
 *
 * ⚠️ IT RETURNS `data.granted`, NOT "the call succeeded". The function
 * answers HTTP 200 with `granted:false` for every rejection, deliberately.
 *
 * ⚠️ AND ANY FAILURE HERE RESOLVES TO PENDING, NOT FAILED. By the time this
 * runs the card is charged, so a throw, a rejection and a timeout all mean
 * the same thing: the money arrived, activation is late. See
 * lib/billing/purchaseMachine.afterVerification.
 */
async function verifyPurchase({ purchaseToken, productId, accountId }) {
  const { data, error } = await supabase.functions.invoke('verify-play-purchase', {
    body: { purchaseToken, productId, accountId },
  });
  if (error) return false;
  return data?.granted === true;
}

export default function Plans() {
  const catalog = usePlanCatalog();
  const { plan: currentPlan, subscription, graceDaysLeft, isGuest } = useAccountPlan();
  const { isBusiness } = useWorkspaceRole();
  const { accountId } = useAccountRole();
  const capacity = useVehicleCapacity();
  const documents = useDocumentUsage();
  const surface = billingSurface();
  const reduceMotion = useReducedMotion();

  // ⚠️ EVERY HOOK SITS ABOVE THE EARLY RETURNS. The loading and error
  // branches return before the rows render, so a hook placed after them runs
  // on some renders and not others, the class react-hooks/rules-of-hooks
  // exists to stop.
  //
  // ⚠️ AND WITH THE FLAG OFF NOTHING CAN BE BOUGHT. Everything that sells is
  // behind `offering`, which also needs a billing backend on this platform.
  const { enabled: billingFlag } = useFeatureFlag('play_billing_enabled');
  const offering = mayOfferPurchase(billingFlag, getBillingBackend() !== null);

  /**
   * ⚠️ WITHOUT THIS, PAYING US CHANGED NOTHING THE USER COULD SEE.
   *
   * The grant lands in the database, but useAccountPlan holds a 60-second
   * staleTime. Every key that reads an entitlement is invalidated, not just
   * the plan: a refreshed plan beside a stale "4 מתוך 5" is the same
   * contradiction one level down.
   */
  const queryClient = useQueryClient();
  const onGranted = useCallback(() => {
    [ACCOUNT_PLAN_QUERY_KEY, VEHICLE_CAPACITY_QUERY_KEY, DOCUMENT_USAGE_QUERY_KEY, FEATURE_USAGE_QUERY_KEY]
      .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  }, [queryClient]);

  const { state: purchaseState, products, activeProductId, online, buy, restore } = usePurchaseFlow({
    enabled: offering,
    accountId,
    verifyPurchase,
    onGranted,
  });

  // The open row is the user's choice once they have made one, and the
  // derived default until then, so the default can still follow the data as
  // the plan and the counts arrive.
  const [picked, setPicked] = useState(null);
  const [scrollTo, setScrollTo] = useState(false);
  const openRef = useRef(null);
  useEffect(() => {
    if (!scrollTo || !openRef.current) return;
    openRef.current.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    setScrollTo(false);
  }, [scrollTo, reduceMotion]);

  const plans = catalog.plans;
  const free = catalog.free;

  if (catalog.isLoading) {
    return (
      <PageShell title="המסלולים" subtitle="מה כל מסלול כולל" backTo="MyPlan">
        <SkeletonScreen />
      </PageShell>
    );
  }

  // `!free` is folded into the error branch rather than the loading one on
  // purpose: a catalogue that loads without a zero-price row is a real fault,
  // and treating it as "still loading" is how a screen spins forever.
  if (catalog.isError || !free) {
    return (
      <PageShell title="המסלולים" subtitle="מה כל מסלול כולל" backTo="MyPlan">
        <SystemErrorBanner
          message="לא הצלחנו לטעון את המסלולים. בדוק את החיבור לאינטרנט ונסה שוב."
          onRetry={catalog.refetch}
        />
      </PageShell>
    );
  }

  const known = !isGuest && !!currentPlan;
  const reference = known ? (plans.find((p) => p.code === currentPlan.code) || null) : null;
  const currentRank = reference ? plans.indexOf(reference) : -1;
  const onTopPlan = known && currentPlan.priceIlsMonth > 0 && currentRank === plans.length - 1;

  // ⚠️ NULL UNTIL THE SERVER HAS ANSWERED. useVehicleCapacity reports a
  // count of 0 while its query is still disabled (no accountId yet), and a
  // meter reading "0 מתוך 5" for a moment is a fabricated number.
  const vehiclesHeld = known && accountId && !capacity.isLoading && !capacity.isError
    ? capacity.count : null;

  const meters = [];
  if (known) {
    const v = usageMeter(vehiclesHeld, currentPlan.maxVehicles);
    if (v) meters.push({ label: 'כלי תחבורה', meter: v });
    const d = usageMeter(documents.count, currentPlan.maxDocuments);
    if (d) meters.push({ label: 'מסמכים', meter: d });
  }

  const recCode = known
    ? recommendPlan(plans, currentPlan, { vehicles: vehiclesHeld, documents: documents.count })
    : null;
  const openCode = picked && plans.some((p) => p.code === picked)
    ? picked
    : defaultOpenCode(plans, known ? currentPlan.code : null, recCode);

  const storeManaged = isStoreManaged(subscription, known ? currentPlan : null);
  const canOpenManagement = canOpenStoreSubscriptionManagement();

  const priceFor = (p) => {
    if (p.priceIlsMonth === 0) return null;
    if (offering) return products.find((x) => x.planCode === p.code)?.priceFormatted || null;
    if (catalogPriceAllowed(surface) && !labelStatesPrice(p)) return `₪${p.priceIlsMonth}`;
    return null;
  };

  const actionFor = (p) => {
    const product = offering ? products.find((x) => x.planCode === p.code) : null;
    // Only the row being acted on shows the busy state.
    const isActive = !!product && product.productId === activeProductId;
    const kind = actionKind({
      plan: p, isCurrent: known && p.code === currentPlan.code, isGuest, offering, storeManaged, isActive,
    });

    if (kind === 'guest') {
      return (
        <div className="space-y-2.5">
          <p className="text-[13px] leading-relaxed" style={{ color: C.gray700 }}>
            אחרי הרשמה בחינם תוכל לבחור מסלול.
          </p>
          <Link
            to={createPageUrl('Auth')}
            className="flex items-center justify-center w-full h-12 rounded-2xl text-[15px] font-bold text-white"
            style={{ background: C.primary }}
          >
            הרשמה בחינם
          </Link>
        </div>
      );
    }
    if (kind === 'current') {
      return <ManageBlock note={currentNote(p, storeManaged)} canOpen={storeManaged && p.priceIlsMonth > 0 && canOpenManagement} />;
    }
    if (kind === 'manage') {
      return <ManageBlock note={manageNote(p)} canOpen={canOpenManagement} />;
    }
    if (kind === 'purchase') {
      const stateForCard = isActive ? purchaseState
        : purchaseState === PurchaseState.LOADING_PRODUCTS ? PurchaseState.LOADING_PRODUCTS
        : !product ? PurchaseState.UNAVAILABLE
        : PurchaseState.IDLE;
      return (
        <PurchaseAction
          state={stateForCard}
          priceFormatted={product?.priceFormatted}
          offline={!online}
          onBuy={() => product && buy(product.productId)}
          onRestore={restore}
        />
      );
    }
    return null;
  };

  const pick = (code) => {
    setPicked(code);
    setScrollTo(true);
  };

  return (
    <PageShell
      title="המסלולים"
      subtitle={isGuest ? 'מצב אורח' : offering ? 'בחר את המסלול שמתאים לך' : 'מה כל מסלול כולל'}
      backTo="MyPlan"
    >
      <div className="space-y-3.5">

        {/* Sticky, so it survives the scrolling a worried user starts doing
            in exactly this moment. */}
        {(purchaseState === PurchaseState.VERIFYING
          || purchaseState === PurchaseState.PENDING) && (
          <VerifyingBanner pending={purchaseState === PurchaseState.PENDING} />
        )}

        {/* The framing line leads rather than closes: said at the end, it
            walks the reader through four plans building an intent the screen
            then refuses. ⚠️ And once purchase IS available it has to go, or
            the screen declares itself unbuyable above a working button. */}
        {!offering && (
          <p className="text-[13px] px-1" style={{ color: C.gray500 }}>
            {onTopPlan ? 'אתה במסלול הגבוה ביותר.' : unavailableCopy(surface)}
          </p>
        )}

        {/* Grace. Wording matches /MyPlan exactly: the same situation on two
            screens must not sound like two different situations. */}
        {graceDaysLeft !== null && graceDaysLeft !== undefined && (
          <div className="rounded-2xl p-4" style={{ background: C.warnSubtle }}>
            <p className="text-sm font-bold" style={{ color: C.warnDark }}>
              תקופת התאמה, נותרו <Num>{graceDaysLeft}</Num> ימים
            </p>
            <p className="text-[13px] mt-1" style={{ color: C.warnDark }}>
              עד אז המגבלות לא חלות על החשבון שלך.
            </p>
          </div>
        )}

        {known && <StatusStrip plan={currentPlan} meters={meters} />}

        <Legend />

        <div className="space-y-2">
          {plans.map((p, i) => {
            const isCurrent = known && p.code === currentPlan.code;
            const price = priceFor(p);
            const priceLoading = offering && p.priceIlsMonth > 0 && !price
              && purchaseState === PurchaseState.LOADING_PRODUCTS;
            if (p.code !== openCode) {
              return (
                <ClosedRow
                  key={p.code}
                  plan={p}
                  isCurrent={isCurrent}
                  isRec={p.code === recCode}
                  price={price}
                  priceLoading={priceLoading}
                  onOpen={() => pick(p.code)}
                />
              );
            }
            return (
              <OpenRow
                key={p.code}
                rowRef={openRef}
                plan={p}
                reference={reference}
                gain={currentRank >= 0 && i > currentRank}
                isCurrent={isCurrent}
                isRec={p.code === recCode}
                isBusiness={isBusiness}
                // With a purchase on offer PurchaseAction prints the price in
                // its own zone, so the header stays quiet: one price per row.
                price={offering ? null : price}
                vehicleNote={isCurrent ? personalNote(currentPlan.maxVehicles, p.maxVehicles) : null}
                action={actionFor(p)}
                reduceMotion={reduceMotion}
              />
            );
          })}
        </div>

        {/* Closes on what the reader already has, not on what they lack. */}
        <p className="text-[12px] leading-relaxed px-1" style={{ color: C.gray500 }}>
          כלול בכל המסלולים, גם בחינם: תזכורות טסט וביטוח, מסמכים, צ׳קליסטים, דיווח תאונות ומצא מוסך.
        </p>

      </div>
    </PageShell>
  );
}
