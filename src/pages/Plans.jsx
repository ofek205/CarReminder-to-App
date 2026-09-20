/**
 * /Plans — where you stand, and what each plan includes.
 *
 * ⚠️ THIS IS A POSITIONING SCREEN, NOT A PRICING PAGE, and that is the
 * decision the whole layout rests on. There is no purchase button on any
 * surface: there is no checkout and no StoreKit, and a disabled button is a
 * promise that breaks on tap. So the screen's job is "where am I, and what
 * would change", in that order, and it is built to answer the first half
 * without scrolling at all.
 *
 * ⚠️ EVERY NUMBER COMES FROM plan_limits. Not one limit is typed into this
 * file. §5.1 requires it so marketing and enforcement cannot contradict each
 * other, and it matters operationally: tuning a cap is an UPDATE with no
 * deploy, and a hardcoded number becomes a lie the moment that happens.
 *
 * Two card genres, because §1.1 describes two engines and they are not
 * equals. Free and the entry paid tier get FULL cards carrying all six
 * dimensions in identical positions, because free vs paid is the decision
 * almost everyone actually makes. The tiers above get COMPACT cards carrying
 * only the delta, because they are feature-identical and differ solely in
 * ceiling; four full cards would print the same feature list three times and
 * imply three new offers where there is one axis. 97.7% of personal accounts
 * never reach the second engine at all.
 *
 * ⚠️ NO "RECOMMENDED" BADGE, AND IT IS NOT AN OVERSIGHT. A recommendation
 * presumes an action this screen cannot offer, and worse, it is false for a
 * real segment: a static badge on the entry tier recommends a 15-vehicle
 * ceiling to the account holding 86. The entry tier earns its prominence from
 * a fact instead — it is the only plan that changes WHAT you can do, while the
 * ones above change only HOW MANY.
 *
 * @see docs/spec-monetization-plans-v2.md §1.1, §5.1, §5.4
 */

import React, { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Car, FileText, Sparkles, ScanLine, Share2, Briefcase, CornerDownLeft } from 'lucide-react';
import PageShell from '@/components/business/system/PageShell';
import SystemErrorBanner from '@/components/shared/SystemErrorBanner';
import { createPageUrl } from '@/utils';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/designTokens';
import usePlanCatalog from '@/hooks/usePlanCatalog';
import useAccountPlan, { ACCOUNT_PLAN_QUERY_KEY } from '@/hooks/useAccountPlan';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { VEHICLE_CAPACITY_QUERY_KEY } from '@/hooks/useVehicleCapacity';
import { FEATURE_USAGE_QUERY_KEY } from '@/hooks/useFeatureUsage';
import { billingSurface, IAP, NONE } from '@/lib/billingGate';
import { getBillingBackend, openStoreSubscriptionManagement } from '@/lib/billing';
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

/** "3 בחודש" / "ללא הגבלה" */
export function monthlyLabel(n) {
  return n === null || n === undefined ? 'ללא הגבלה' : `${n} בחודש`;
}

/**
 * The advisor row.
 *
 * ⚠️ "להתרשמות" IS LOAD-BEARING. The free allowance is one question for the
 * lifetime of the account, not one a month, and "שאלה אחת" alone reads as a
 * monthly quota. The word carries "one off" without a sentence of
 * explanation.
 */
export function advisorLabel(plan) {
  const teaser = plan?.aiLifetimeTeaser;
  if (teaser === null || teaser === undefined) return 'פתוח';
  return teaser === 1 ? 'שאלה אחת להתרשמות' : `${teaser} שאלות להתרשמות`;
}

/** "כלול" / "לא כלול". Never a ✗: the design forbids marking free as broken. */
export function includedLabel(b) {
  return b ? 'כלול' : 'לא כלול';
}

/**
 * The note that stops this screen lying to the grandfathered accounts.
 *
 * account_plan() applies the override, so the plan a frozen user is ON says
 * "up to 10" while their app allows the 17 they actually hold. Showing the
 * catalogue value alone would contradict the app; showing only their value
 * would misdescribe the product. So the row shows the PLAN and annotates the
 * difference.
 *
 * "נשמר מהמצב הקודם" is the half that matters: without a reason, a user
 * reading 10 in the card and 17 in their account concludes one of them is a
 * bug. Words like "חריג" or "override" were rejected for implying something
 * is wrong with their account.
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
 * "בגרסה הזו של האפליקציה" says temporary without pointing anywhere.
 *
 * ⚠️ AND NONE OF THEM SAYS "בקרוב". That is a promise with a date nobody
 * has, and it costs more when it is missed than it buys now.
 *
 * These three strings now render at the TOP of the screen rather than the
 * bottom, so the reader is not walked through four cards building an intent
 * the screen then refuses. They were not reworded for the move: the page
 * subtitle gives "רכישה" its antecedent, which was the only thing the new
 * position actually needed.
 *
 * ⚠️ "המנוי מנוהל באתר" WAS REMOVED ON 2026-09-20, AND IT WAS LIVE ON THE
 * INTERNAL TRACK WHEN IT SHOULD NOT HAVE BEEN.
 *
 * It was the 'none' string, and 'none' was Android. That wording is only
 * lawful under Play's consumption-only exemption, which the app stopped
 * qualifying for the moment the Billing library shipped inside the binary.
 * Play Billing present AND an external purchase referred to is the hybrid
 * Play forbids outright. Android is now an 'iap' surface (see billingGate),
 * so it no longer reaches this branch at all, and the branch itself no
 * longer points anywhere: 'none' now means an unrecognised native platform,
 * which is the last place that should be handed a website.
 */
export function unavailableCopy(surface) {
  if (surface === IAP)  return 'רכישה אינה זמינה בגרסה הזו של האפליקציה.';
  if (surface === NONE) return 'רכישה אינה זמינה באפליקציה.';
  return 'רכישה אינה זמינה כרגע.';
}

/**
 * The six dimensions, in the order this account should read them.
 *
 * ⚠️ THE ORDER IS DERIVED, NOT FIXED. For a business account sitting on free,
 * "ממשק עסקי: לא כלול" is the single most consequential line on the screen,
 * and as the last row it is the last thing read. It moves to the top for
 * them. Both full cards reorder together, so the vertical alignment that
 * makes the comparison readable is never broken.
 */
export function rowOrder(isBusiness) {
  return isBusiness
    ? ['business', 'vehicles', 'documents', 'ai', 'plate', 'shares']
    : ['vehicles', 'documents', 'ai', 'plate', 'shares', 'business'];
}

/** One dimension's value for one plan. Every branch goes through the helpers. */
export function rowValue(key, plan) {
  if (!plan) return '';
  if (key === 'vehicles') return capLabel(plan.maxVehicles);
  if (key === 'documents') return capLabel(plan.maxDocuments);
  if (key === 'ai')       return advisorLabel(plan);
  if (key === 'plate')    return monthlyLabel(plan.plateChecksPerMonth);
  if (key === 'shares')   return capLabel(plan.maxShares);
  if (key === 'business') return includedLabel(plan.businessUi);
  return '';
}

/**
 * Does this plan's own name already state its price?
 *
 * ⚠️ FOUND IN THE PREVIEW, NOT BY READING THE CODE. `label_he` for the paid
 * plans is seeded as "₪9 לחודש", so a card that printed the label AND a
 * price built from price_ils_month rendered "₪9 לחודש" twice, one line under
 * the other. The free plan does not have the problem, because "חינם" states
 * the price in words.
 *
 * Checked against the label rather than hardcoded, so renaming a plan to
 * "בסיסי" in the database brings the price line back instead of silently
 * removing the price from the screen.
 */
export function labelStatesPrice(plan) {
  if (!plan) return false;
  if (plan.priceIlsMonth === 0) return true;
  return String(plan.labelHe || '').includes(String(plan.priceIlsMonth));
}

/**
 * The paid tiers worth showing ABOVE a given one.
 *
 * ⚠️ STRICTLY HIGHER, WHICH IS WHAT MAKES THE TOP-TIER CASE NEED NO SPECIAL
 * CASE. An account on the unlimited plan has nothing above it, so this
 * returns empty and the whole "more vehicles" group disappears on its own. It
 * also stops the screen offering a downgrade, which is noise on a screen with
 * no purchase.
 */
export function higherTiers(paid, featured) {
  if (!Array.isArray(paid) || !featured) return [];
  // null is unlimited: nothing outranks it, and it outranks every number.
  if (featured.maxVehicles === null || featured.maxVehicles === undefined) return [];
  return paid.filter((p) => {
    if (p.code === featured.code) return false;
    if (p.maxVehicles === null || p.maxVehicles === undefined) return true;
    return p.maxVehicles > featured.maxVehicles;
  });
}

// ── presentation ────────────────────────────────────────────────────────

const ROW_META = {
  vehicles:  { icon: Car,      label: 'כלי תחבורה' },
  documents: { icon: FileText, label: 'מסמכים שמורים' },
  ai:       { icon: Sparkles,  label: 'מומחה AI' },
  plate:    { icon: ScanLine,  label: 'בדיקת רכב' },
  shares:   { icon: Share2,    label: 'שיתוף רכבים' },
  business: { icon: Briefcase, label: 'ממשק עסקי' },
};

/** Numerals stay LTR inside Hebrew, or "₪9" renders reversed. */
function Num({ children }) {
  return <span dir="ltr" className="tabular-nums">{children}</span>;
}

/** A pill. Only ever one per screen, on the card that describes this account. */
function Badge({ children, muted }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold${muted ? '' : ' text-white'}`}
      style={muted ? { background: C.gray100, color: C.gray700 } : { background: C.primary }}
    >
      {children}
    </span>
  );
}

/**
 * A full plan card: the six dimensions as a definition list.
 *
 * `accent` colours the VALUES, not the card chrome. That is the whole
 * mechanism that gives the paid tier its lift without a badge and without
 * painting free as broken: same size, same rows, same weight, warmer values.
 */
function PlanCard({ plan, order, accent, current, badge, note, action }) {
  return (
    <section
      className={`rounded-3xl shadow-sm p-5${accent ? '' : ' bg-white'}`}
      style={{
        background: accent ? C.bgSubtle : undefined,
        boxShadow: current ? `0 0 0 2px ${C.primary}` : undefined,
      }}
      aria-label={plan.labelHe}
    >
      <header className="pb-3">
        <p className="text-[17px] font-bold" style={{ color: accent ? C.primary : C.gray800 }}>
          {plan.labelHe}
        </p>
        {!labelStatesPrice(plan) && (
          <p className="text-[13px] mt-0.5" style={{ color: C.gray500 }}>
            <Num>₪{plan.priceIlsMonth}</Num> לחודש
          </p>
        )}
        {badge && <span className="inline-block mt-2"><Badge muted={!current}>{badge}</Badge></span>}
      </header>

      <dl className="divide-y border-t" style={{ borderColor: accent ? C.gray200 : C.gray100 }}>
        {order.map((key) => {
          const meta = ROW_META[key];
          const Icon = meta.icon;
          return (
            <div key={key} className="py-3" style={{ borderColor: accent ? C.gray200 : C.gray100 }}>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 min-w-0">
                  <Icon className="h-4 w-4 shrink-0" style={{ color: C.gray500 }} aria-hidden="true" />
                  <span className="text-[13px] font-semibold truncate" style={{ color: C.gray500 }}>
                    {meta.label}
                  </span>
                </dt>
                <dd
                  className="text-[15px] font-bold tabular-nums text-end shrink-0"
                  style={{ color: accent ? C.primary : C.gray800 }}
                >
                  {rowValue(key, plan)}
                </dd>
              </div>
              {key === 'vehicles' && note && (
                <p
                  className="text-[12px] mt-1.5 flex items-start gap-1 leading-snug"
                  style={{ color: C.primary }}
                >
                  <CornerDownLeft className="h-3 w-3 shrink-0 mt-0.5 rtl:rotate-180" aria-hidden="true" />
                  <span>{note}</span>
                </p>
              )}
            </div>
          );
        })}
      </dl>
      {action}
    </section>
  );
}

/**
 * A higher tier: price and ceiling, and deliberately nothing else.
 *
 * The group heading directly above already says the features are identical.
 * Repeating that inside each card would state one fact three times in one
 * screen, which is the duplication this whole layout exists to avoid. A card
 * holding only the delta IS the statement that there is nothing more to it.
 */
function TierCard({ plan, current, action }) {
  return (
    <section
      className="rounded-2xl bg-white shadow-sm px-4 py-3.5"
      style={{ boxShadow: current ? `0 0 0 2px ${C.primary}` : undefined }}
      aria-label={plan.labelHe}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* The label, not a price rebuilt from the number. Two sources for
              one string is how they drift. */}
          <p className="text-[15px] font-bold" style={{ color: C.gray800 }}>
            {plan.labelHe}
          </p>
          {current && <span className="inline-block mt-1.5"><Badge>המסלול שלך</Badge></span>}
        </div>
        <p className="text-[15px] font-bold tabular-nums shrink-0" style={{ color: C.gray800 }}>
          {capLabel(plan.maxVehicles)}
        </p>
      </div>
      {action}
    </section>
  );
}

function SkeletonScreen() {
  // The structure is known before the data is, so the structure is delivered
  // first. A spinner says "something is happening"; this says what.
  const bar = (w) => (
    <div className={`h-4 ${w} rounded animate-pulse`} style={{ background: C.gray100 }} />
  );
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1].map((card) => (
        <div key={card} className="bg-white rounded-3xl shadow-sm p-5">
          <div className="flex justify-between pb-3">
            {bar('w-20')}
            {bar('w-14')}
          </div>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="py-3 border-t flex justify-between" style={{ borderColor: C.gray100 }}>
              {bar('w-24')}
              {bar('w-16')}
            </div>
          ))}
        </div>
      ))}
      {[0, 1].map((i) => (
        <div key={i} className="bg-white rounded-2xl shadow-sm px-4 py-3.5 flex justify-between">
          {bar('w-16')}
          {bar('w-16')}
        </div>
      ))}
    </div>
  );
}

/**
 * Hand the purchase token to the server, which asks Google about it.
 *
 * ⚠️ IT RETURNS `data.granted`, NOT "the call succeeded". The function
 * answers HTTP 200 with `granted:false` for every rejection, deliberately, so
 * a declined or expired subscription is a normal answer rather than a
 * transport error. Treating a 200 as success would grant a plan on the
 * strength of having reached the server.
 *
 * ⚠️ AND ANY FAILURE HERE RESOLVES TO PENDING, NOT FAILED. By the time this
 * runs the card is charged. Telling that user their payment failed is the one
 * message this whole flow is built to avoid, so the machine treats a throw,
 * a rejection and a timeout identically: the money arrived, activation is
 * late. See lib/billing/purchaseMachine.afterVerification.
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
  const surface = billingSurface();

  // ⚠️ ABOVE THE EARLY RETURNS, AND eslint CAUGHT ME PUTTING THEM BELOW.
  // The loading and error branches return before the cards render, so hooks
  // placed after them run on some renders and not others. That is the exact
  // class react-hooks/rules-of-hooks exists to stop, and CLAUDE.md records a
  // production break from the same family.
  //
  // ⚠️ AND THE INVARIANT THIS WHOLE WIRING RESTS ON: with the flag off the
  // screen must render exactly what it rendered before purchase existed.
  // Everything new is behind `offering`, which is false for every account
  // today, because mayOfferPurchase also needs a backend and Android native
  // has none until the Play plugin is installed.
  const { enabled: billingFlag } = useFeatureFlag('play_billing_enabled');
  const offering = mayOfferPurchase(billingFlag, getBillingBackend() !== null);

  /**
   * ⚠️ WITHOUT THIS, PAYING US CHANGED NOTHING THE USER COULD SEE.
   *
   * The grant lands in the database, but useAccountPlan holds a 60-second
   * staleTime and nothing told React Query the world had moved. The card
   * flipped to "המסלול שלך" while isCurrent() twelve lines below still
   * matched the free plan, so ONE SCREEN showed two different answers to
   * "which plan am I on", and /MyPlan showed the free one too.
   *
   * Every key that reads an entitlement is invalidated, not just the plan:
   * the caps and the usage meters are all derived from it, and a refreshed
   * plan sitting next to a stale "4 מתוך 5" is the same contradiction one
   * level down.
   */
  const queryClient = useQueryClient();
  const onGranted = useCallback(() => {
    [ACCOUNT_PLAN_QUERY_KEY, VEHICLE_CAPACITY_QUERY_KEY, FEATURE_USAGE_QUERY_KEY]
      .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  }, [queryClient]);

  const { state: purchaseState, products, activeProductId, online, buy, restore } = usePurchaseFlow({
    enabled: offering,
    accountId,
    verifyPurchase,
    onGranted,
  });

  const free = catalog.free;
  const paid = catalog.paid;

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

  const isOnPaid = !isGuest && !!currentPlan && currentPlan.priceIlsMonth > 0;

  // The paid tier that gets the full card: the account's own when it has one,
  // otherwise the entry tier. So a paying account reads its own plan in full
  // rather than reading about the tier below it.
  const featured = (isOnPaid && paid.find((p) => p.code === currentPlan.code)) || paid[0] || null;
  const others   = higherTiers(paid, featured);
  const onTopPlan = isOnPaid && currentPlan.maxVehicles === null;

  const isCurrent = (p) => !isGuest && !!currentPlan && p?.code === currentPlan.code;

  // The override note belongs to the card the account is actually on, and
  // only where the effective ceiling really differs from what that plan
  // advertises.
  const noteFor = (p) => {
    if (!isCurrent(p)) return null;
    return personalNote(currentPlan.maxVehicles, p.maxVehicles);
  };

  const order = rowOrder(isBusiness);

  // Two full cards. The account's own comes first, so "where do I stand" is
  // answered without scrolling. For every account today that is free anyway,
  // which is why this costs nothing and covers the paid case for free.
  const fullCards = isOnPaid && featured ? [featured, free] : [free, featured];

  /**
   * The action strip for one plan.
   *
   * ⚠️ THE PRICE COMES FROM PLAY AND IS NEVER REBUILT FROM plan_limits. The
   * number in our table is internal bookkeeping; the store knows the currency,
   * the tax treatment and the buyer's locale. Showing a price that differs
   * from the one charged is a removable offence under Play policy, not a
   * cosmetic bug, so a plan with no matching Play product renders as
   * UNAVAILABLE, which shows no price and no control at all.
   */
  const actionFor = (p) => {
    const product = products.find((x) => x.planCode === p.code);
    // Only the card being acted on shows the busy state. Without this, tapping
    // one plan would spin every button on the screen.
    const isActive = product && product.productId === activeProductId;
    const stateForCard = isActive ? purchaseState
      : purchaseState === PurchaseState.LOADING_PRODUCTS ? PurchaseState.LOADING_PRODUCTS
      : !product ? PurchaseState.UNAVAILABLE
      : PurchaseState.IDLE;

    /**
     * ⚠️ A SECOND PURCHASE WAS ONE TAP AWAY, ON EVERY OTHER CARD.
     *
     * Nothing here asked whether the account was already subscribed, so once
     * a purchase landed, the remaining paid cards kept a live "בחר מסלול"
     * and so did the card for the plan the user had just bought. Tapping any
     * of them calls purchaseProduct() with no replacement mode, which Play
     * treats as a NEW subscription rather than a change: two live
     * subscriptions, two charges, one account.
     *
     * ⚠️ GATED ON source === 'iap_google', NOT ON "is on a paid plan".
     * An admin grant also puts an account on p19, and sending that person to
     * Play would open a subscriptions list their plan is not in. The source
     * column is the only thing that actually says "Google holds this
     * relationship", and useAccountPlan already reads it.
     */
    const storeManaged = subscription?.source === 'iap_google';
    const manage = storeManaged && !!product && !isActive;

    return (
      <PurchaseAction
        state={stateForCard}
        priceFormatted={product?.priceFormatted}
        offline={!online}
        manage={manage}
        onBuy={() => product && buy(product.productId)}
        onRestore={restore}
        onManage={openStoreSubscriptionManagement}
      />
    );
  };

  return (
    <PageShell
      title="המסלולים"
      subtitle={isGuest ? 'מצב אורח' : 'מה כל מסלול כולל, ואיפה אתה עומד'}
      backTo="MyPlan"
    >
      <div className="space-y-4">

        {/* Sticky, so it survives the scrolling a worried user starts doing
            in exactly this moment. */}
        {(purchaseState === PurchaseState.VERIFYING
          || purchaseState === PurchaseState.PENDING) && (
          <VerifyingBanner pending={purchaseState === PurchaseState.PENDING} />
        )}

        {/* The framing line. It leads rather than closes: telling the reader
            at the end that nothing here can be bought walks them through four
            cards building an intent the screen then refuses. Said first, it
            frames the screen as information, which is what it is.
            ⚠️ And once purchase IS available the line has to go, or the screen
            declares itself unbuyable directly above a working buy button. */}
        {!offering && (
          <p className="text-[13px] px-1" style={{ color: C.gray500 }}>
            {onTopPlan
              ? 'אתה במסלול הגבוה ביותר, ללא הגבלת כלי תחבורה.'
              : unavailableCopy(surface)}
          </p>
        )}
        {offering && onTopPlan && (
          <p className="text-[13px] px-1" style={{ color: C.gray500 }}>
            אתה במסלול הגבוה ביותר, ללא הגבלת כלי תחבורה.
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

        {isGuest && (
          <div className="rounded-2xl p-4 bg-white shadow-sm">
            <p className="text-[13px] leading-relaxed" style={{ color: C.gray500 }}>
              הנתונים במצב אורח נשמרים במכשיר בלבד. אחרי הרשמה תראה כאן איפה אתה עומד.
            </p>
            <Link
              to={createPageUrl('Auth')}
              className="inline-flex items-center mt-3 px-4 font-bold rounded-xl text-white"
              style={{ height: 44, background: C.primary, fontSize: 14 }}
            >
              הרשמה בחינם
            </Link>
          </div>
        )}

        {fullCards.filter(Boolean).map((p) => (
          <PlanCard
            key={p.code}
            plan={p}
            order={order}
            accent={p.priceIlsMonth > 0}
            current={isCurrent(p)}
            badge={
              isCurrent(p) ? 'המסלול שלך'
              : (isGuest && p.priceIlsMonth === 0) ? 'כלול בהרשמה'
              : null
            }
            note={noteFor(p)}
            action={offering && p.priceIlsMonth > 0 ? actionFor(p) : null}
          />
        ))}

        {/* The second engine. A heading that names its audience rather than
            asking everyone a question: it is relevant to nine accounts and
            would be read by seven hundred, and naming the cohort lets the
            97.7% stop reading in one line without feeling they skipped
            something. */}
        {others.length > 0 && (
          <div className="space-y-2">
            <div className="px-1">
              <h2 className="text-[15px] font-bold" style={{ color: C.gray800 }}>
                למי שמנהל יותר כלי תחבורה
              </h2>
              <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: C.gray500 }}>
                אותם פיצ׳רים בדיוק. משתנה רק כמה כלי תחבורה אפשר לנהל.
              </p>
            </div>
            {others.map((p) => (
              <TierCard
                key={p.code}
                plan={p}
                current={isCurrent(p)}
                action={offering ? actionFor(p) : null}
              />
            ))}
          </div>
        )}

        {/* Closes on what the reader already has, not on what they lack. A
            screen that ends on a gap it cannot resolve is a frustrating
            screen. */}
        <div className="rounded-2xl p-4" style={{ background: C.gray50 }}>
          <p className="text-[13px] font-bold mb-1" style={{ color: C.gray800 }}>
            מה שכלול בכל המסלולים, גם בחינם
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: C.gray500 }}>
            תזכורות טסט וביטוח · מסמכים · צ׳קליסטים · דיווח תאונות · מצא מוסך
          </p>
        </div>

      </div>
    </PageShell>
  );
}
