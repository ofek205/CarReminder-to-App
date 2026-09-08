/**
 * MyPlan — "המסלול והחיוב". Which plan the ACTIVE ACCOUNT is on.
 *
 * Monetization phase 2: DISPLAY ONLY. No purchase, no cancel, no invoices,
 * no enforcement. Its whole job is that a user understands the limits
 * BEFORE being blocked by them, which is also why the vehicle meter is the
 * one thing on this screen carrying colour.
 *
 * @see docs/ux-my-plan.md
 * @see docs/spec-monetization-plans-v2.md §5.3
 *
 * ⚠️ THE RULE THIS SCREEN IS BUILT AROUND
 *   A failed read renders a banner, never a number. "0 מתוך 5" after a
 *   failed query looks like a completely empty account, which reports an
 *   allowance the user does not have. So every numeric branch below is
 *   gated on `plan` being genuinely loaded, and the error state renders no
 *   figures at all. See plan §3.4ה.
 *
 * ⚠️ ANTI-STEERING
 *   Nothing here links to, prices, or mentions a web purchase on iOS. The
 *   decision comes from lib/billingGate.js and not from an isIOS check, so
 *   there is one place to be right about Guideline 3.1.1(a). Phase 2 ships
 *   no purchase control on any platform, so the rule cannot be broken yet;
 *   the gate is wired now so phase 6 adds the CTA behind a check that
 *   already exists.
 */
import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CreditCard, Car, Search, Share2, Sparkles,
  AlertCircle, RotateCw, ShieldCheck, Info, UserPlus,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageShell from '@/components/business/system/PageShell';
import Card from '@/components/business/system/Card';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';
import useAccountPlan, { usagePercent, usageLevel, ACCOUNT_PLAN_QUERY_KEY } from '@/hooks/useAccountPlan';
import useVehicleCapacity from '@/hooks/useVehicleCapacity';
import useFeatureUsage, { LIFETIME, MONTH, DAY } from '@/hooks/useFeatureUsage';
import { AI_ADVISOR, AI_FORUM, PLATE_CHECK } from '@/lib/usageCounters';
import useWorkspaceRole from '@/hooks/useWorkspaceRole';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { canMentionExternalPurchase, canReferToWeb } from '@/lib/billingGate';

const UNLIMITED = 'ללא הגבלה';

// Three named steps, not a gradient, so the meaning is unambiguous.
const METER_COLOR = {
  ok:   C.primary,
  near: C.warn,
  full: C.error,
};

/**
 * Does this string contain Hebrew letters?
 *
 * ⚠️ This decides the `dir` of a limit value, and getting it wrong is a
 * real rendering bug rather than a nicety. "3 בחודש" forced to LTR puts the
 * numeral on the wrong side of the phrase. Only a value that is PURELY
 * numeric or symbolic ("12 / 30") belongs in an LTR run; anything with a
 * Hebrew word in it is a Hebrew phrase that happens to contain a digit.
 */
const HEBREW = /[֐-׿]/;

/** Exported so the bidi rule above is pinned by a test, not by intent. */
export function valueDir(value) {
  return HEBREW.test(String(value ?? '')) ? 'rtl' : 'ltr';
}

/**
 * The subscription status, as the user should read it.
 *
 * ⚠️ NEVER hardcode this. account_subscriptions.status is constrained to
 * active | grace | past_due | canceled, so a fixed "פעיל" badge would
 * cheerfully sit above a cancelled subscription and assert the opposite of
 * the row it is rendering. Nothing writes a non-active status yet, which is
 * exactly why the label has to be derived now: phase 6 starts writing
 * past_due, and by then nobody will remember this badge.
 *
 * A missing row reads as active-on-free, matching account_plan()'s
 * fail-closed default: an account with no subscription is a live free
 * account, not a broken one.
 */
const STATUS_LABEL = {
  active:   { text: 'פעיל',        bg: C.successSubtle, fg: C.primary },
  grace:    { text: 'תקופת התאמה', bg: C.warnSubtle,    fg: C.warnDark },
  past_due: { text: 'תשלום לא עבר', bg: C.errorBg,       fg: C.errorDark },
  canceled: { text: 'בוטל',        bg: C.gray100,       fg: C.gray500 },
};

/**
 * The vehicles allowance, as a label.
 *
 * ⚠️ THE TWO QUERIES FAIL INDEPENDENTLY, AND THAT IS THE TRAP. The plan can
 * load while the vehicle count does not, and useVehicleCapacity defaults
 * `count` to 0. Interpolating that gives "0 / 30" for an account that may
 * hold thirty: a real cap beside a fabricated numerator, which is exactly
 * the "looks like a full allowance" failure this whole screen exists to
 * prevent. When the count is not genuinely known, show the CAP ALONE.
 *
 * @param {number} count      live owned-vehicle count
 * @param {number|null} cap   plan cap, null meaning unlimited
 * @param {boolean} countKnown  false while the count query is loading or errored
 */
export function vehiclesLabel(count, cap, countKnown) {
  if (cap === null || cap === undefined) return UNLIMITED;
  if (!countKnown || !Number.isFinite(count)) return `עד ${cap}`;
  return `${count} / ${cap}`;
}

/**
 * The label for one metered allowance.
 *
 * ⚠️ THE ENTIRE POINT IS THE `used === null` BRANCH. null means the usage
 * read has not succeeded, and it must fall back to the plan's limit with NO
 * figure, never to "0 / 3". A zero numerator beside a real cap reports an
 * untouched allowance to someone who may have spent all of it, which is the
 * failure this screen exists to prevent. A genuine zero arrives as the
 * number 0, not as null: the hook distinguishes them.
 *
 * @param {number|null} used     consumption, or null when not yet known
 * @param {number|null} cap      plan limit, null meaning unlimited
 * @param {(u:number,c:number)=>string} withUsage  formatter when both known
 * @param {string} fallback      what to show when there is no usable figure
 */
export function meteredValue(used, cap, withUsage, fallback) {
  if (cap === null || cap === undefined) return fallback;   // unlimited
  if (used === null || used === undefined) return fallback; // not known yet
  if (!Number.isFinite(used)) return fallback;
  return withUsage(used, cap);
}

export function statusBadge(status) {
  // An unrecognised status must not silently render as "פעיל". Showing the
  // raw value is ugly and correct: it says "we do not know", which is
  // information, where a green "active" would be a claim.
  return STATUS_LABEL[status] || (status
    ? { text: String(status), bg: C.gray100, fg: C.gray500 }
    : STATUS_LABEL.active);
}

function Meter({ pct, level }) {
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height: 6, background: C.gray200 }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: METER_COLOR[level] || C.primary }}
      />
    </div>
  );
}

/** One limit row. `used` is optional: a limit is a fact, usage is a claim. */
function LimitRow({ icon: Icon, label, value, used, cap }) {
  const pct = used === undefined ? null : usagePercent(used, cap);
  const level = usageLevel(pct);

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0" style={{ color: C.gray400 }} strokeWidth={2} />
        <span className="flex-1 text-[13px] font-semibold" style={{ color: C.gray700 }}>
          {label}
        </span>
        <span
          className="text-[13px] font-bold"
          style={{ color: pct === null ? C.gray500 : METER_COLOR[level] }}
          dir={valueDir(value)}
        >
          {value}
        </span>
      </div>
      {pct !== null && (
        <div className="mt-2 ms-[26px]">
          <Meter pct={pct} level={level} />
        </div>
      )}
    </div>
  );
}

export default function MyPlan() {
  const qc = useQueryClient();
  const { plan, subscription, graceDaysLeft, isGuest, isLoading, isError, refetch } = useAccountPlan();
  const capacity = useVehicleCapacity();
  // Independent of useAccountPlan on purpose: if usage fails, the limits
  // still render and only the numbers go missing.
  const usage = useFeatureUsage();
  const { isBusiness } = useWorkspaceRole();
  const { activeWorkspace } = useWorkspace();

  const accountName = activeWorkspace?.account_name || 'החשבון שלי';

  const retry = () => {
    qc.invalidateQueries({ queryKey: [ACCOUNT_PLAN_QUERY_KEY] });
    refetch();
    capacity.refetch?.();
  };

  // ── guest ───────────────────────────────────────────────────────────────
  // A plan belongs to an account, so there is genuinely nothing to show.
  if (isGuest) {
    // Subtitle carries the CONTEXT, not a restatement of the card beneath
    // it: "מסלול נשמר בחשבון" as a subtitle above a card headed
    // "המסלול נשמר בחשבון" said the same thing twice.
    return (
      <PageShell title="המסלול והחיוב" subtitle="מצב אורח" backTo="Settings">
        <Card>
          <div className="flex items-start gap-2.5">
            <UserPlus className="h-5 w-5 shrink-0 mt-0.5" style={{ color: C.primary }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: C.gray800 }}>
                המסלול נשמר בחשבון
              </p>
              <p className="text-[13px] mt-1 leading-relaxed" style={{ color: C.gray500 }}>
                במצב אורח הנתונים נשמרים במכשיר בלבד, ולכן אין מסלול להציג. הרכבים שהוספת יעברו לחשבון כשתירשם.
              </p>
              <Link
                to={createPageUrl('AuthPage')}
                className="inline-flex items-center mt-3 px-4 font-bold rounded-xl text-white"
                style={{ height: 44, background: C.primary, fontSize: 14 }}
              >
                הרשמה בחינם
              </Link>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  // ── error ───────────────────────────────────────────────────────────────
  // No numbers. Not zeros, not dashes. See the header note.
  if (isError) {
    return (
      <PageShell title="המסלול והחיוב" subtitle={accountName} backTo="Settings">
        <Card>
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: C.error }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: C.gray800 }}>
                לא הצלחנו לטעון את המסלול
              </p>
              <p className="text-[13px] mt-1 leading-relaxed" style={{ color: C.gray500 }}>
                לא נציג מספרים שאינם מדויקים. בדוק את החיבור ונסה שוב.
              </p>
              <button
                type="button"
                onClick={retry}
                className="flex items-center gap-1.5 mt-3 px-3.5 font-bold rounded-xl text-white"
                style={{ height: 44, background: C.primary, fontSize: 14 }}
              >
                <RotateCw className="h-4 w-4" />
                נסה שוב
              </button>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  // ── loading ─────────────────────────────────────────────────────────────
  if (isLoading || !plan) {
    return (
      <PageShell title="המסלול והחיוב" subtitle={accountName} backTo="Settings">
        <div className="space-y-3">
          <Card>
            <div className="animate-pulse space-y-3">
              <div className="rounded-lg" style={{ height: 26, width: '55%', background: C.gray200 }} />
              <div className="rounded-lg" style={{ height: 14, width: '35%', background: C.gray100 }} />
            </div>
          </Card>
          <Card>
            <div className="animate-pulse space-y-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg" style={{ height: 14, background: C.gray100 }} />
              ))}
            </div>
          </Card>
        </div>
      </PageShell>
    );
  }

  // ── loaded ──────────────────────────────────────────────────────────────
  const isFree = plan.code === 'free';

  // The count comes from my_vehicle_capacity(); the CAP comes from the plan.
  // Two sources on purpose: the plan is what this screen is about, and the
  // live count is the only honest numerator.
  //
  // ⚠️ THE TWO QUERIES FAIL INDEPENDENTLY, AND THAT IS THE TRAP. The plan
  // can load while the count does not. useVehicleCapacity defaults `count`
  // to 0, so `${capacity.count} / ${cap}` renders "0 / 30" for an account
  // that may hold thirty vehicles: a real cap paired with a fabricated
  // numerator, which is precisely the "looks like a full allowance" failure
  // this screen is built to prevent. When the count is not genuinely
  // known, show the CAP ALONE.
  const countKnown = !capacity.isError && !capacity.isLoading;
  const showVehicleUsage = plan.maxVehicles !== null && countKnown;
  const vehiclesValue = vehiclesLabel(capacity.count, plan.maxVehicles, countKnown);

  // Only true when we can actually prove it. An unknown count or an
  // unlimited cap is not evidence of being over the cap, and the grace
  // card must not claim a reason it cannot demonstrate.
  const overCap =
    countKnown && plan.maxVehicles !== null && capacity.count > plan.maxVehicles;

  // Metered allowances. Each is a number when the counter has been read
  // (including a genuine 0), or null while loading or after a failure.
  const usedPlate       = usage.used(PLATE_CHECK, MONTH);
  const usedAiLifetime  = usage.used(AI_ADVISOR, LIFETIME);
  // BOTH buckets, because the daily ceiling is enforced in SQL against
  // ai_advisor + ai_forum together. Reading only the advisor here would draw
  // a smaller number against the same cap, and the user would be refused at
  // what this screen showed as room to spare.
  const usedAiToday     = usage.usedSum([AI_ADVISOR, AI_FORUM], DAY);
  // The AI row's meter tracks whichever ceiling the plan actually uses: a
  // one-question teaser on free, a daily fair-use cap on the paid plans.
  const aiCap  = isFree ? plan.aiLifetimeTeaser : plan.aiDailyCap;
  const aiUsed = isFree ? usedAiLifetime : usedAiToday;

  // No subtitle here: the identity row below names the account AND its
  // type, so passing accountName as a subtitle too would stack the same
  // name twice. The error and loading states DO use it, because they have
  // no identity row.
  return (
    <PageShell title="המסלול והחיוב" backTo="Settings">
      <div className="space-y-3">

        {/* Account identity. Required, not decorative: the plan is per
            ACCOUNT, and someone who owns both a personal and a business
            account sees one screen that depends on the active workspace.
            A card reading "you are on ₪19" without saying WHICH account
            invites a costly mistake (membership spec ג14). */}
        <div className="flex items-center gap-2 px-1">
          <span className="text-[12px] font-semibold" style={{ color: C.gray500 }}>
            {accountName}
          </span>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: isBusiness ? C.infoSubtle : C.gray100, color: isBusiness ? C.infoDark : C.gray500 }}
          >
            {isBusiness ? 'עסקי' : 'אישי'}
          </span>
        </div>

        {/* The hero: which plan, and its state. */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 shrink-0" style={{ color: C.primary }} strokeWidth={2} />
                <p className="text-xl font-bold leading-tight" style={{ color: C.gray800 }}>
                  {plan.labelHe}
                </p>
              </div>
              {subscription?.currentPeriodEnd && !isFree && (
                <p className="text-[12px] mt-1.5" style={{ color: C.gray500 }}>
                  מתחדש ב
                  <span dir="ltr" className="mx-1">
                    {new Date(subscription.currentPeriodEnd).toLocaleDateString('he-IL')}
                  </span>
                </p>
              )}
            </div>
            {(() => {
              const badge = statusBadge(subscription?.status);
              return (
                <span
                  className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full"
                  style={{ background: badge.bg, color: badge.fg }}
                >
                  {badge.text}
                </span>
              );
            })()}
          </div>
        </Card>

        {/* Grace. Counts DAYS, not a date: "47 days left" needs no mental
            arithmetic. And it says out loud that nothing is deleted, which
            is the sentence that stops someone holding 12 vehicles from
            panicking at a cap of 5. */}
        {graceDaysLeft !== null && (
          <Card>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: C.warn }} />
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: C.warnDark }}>
                  תקופת התאמה, נותרו {graceDaysLeft} ימים
                </p>
                {/* ⚠️ The REASON is conditional, because grace is granted
                    for two different reasons. The phase-1 backfill gives a
                    window to accounts over the free cap AND to every
                    business account, since a business account has no cap
                    today and was approved by an admin rather than paid for.
                    Telling a business account with three vehicles that it
                    "holds more than the cap" is simply false, and a false
                    explanation on a reassurance card is worse than no
                    explanation. Only claim the over-cap reason when the
                    count is known AND actually exceeds the cap. */}
                {overCap && (
                  <p className="text-[13px] mt-1 leading-relaxed" style={{ color: C.gray700 }}>
                    החשבון מחזיק יותר כלי תחבורה מהתקרה במסלול הנוכחי.
                  </p>
                )}
                <p className="text-[13px] mt-1 leading-relaxed" style={{ color: C.gray700 }}>
                  <strong>שום דבר לא נמחק ושום תזכורת לא מכובה</strong>, והכל ממשיך לעבוד כרגיל.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Limits. `used` is passed ONLY for vehicles, because that is the
            only allowance we can currently count. The other three show the
            plan's limit without a usage figure: a limit is a fact of the
            plan, a usage number is a claim about the user, and phase 3's
            counters are what will make that claim true. */}
        <Card>
          <p className="text-[11px] font-bold mb-1" style={{ letterSpacing: '0.08em', color: C.gray400 }}>
            מה כלול במסלול
          </p>
          <div className="divide-y" style={{ borderColor: C.gray100 }}>
            <LimitRow
              icon={Car}
              label="כלי תחבורה"
              value={vehiclesValue}
              used={showVehicleUsage ? capacity.count : undefined}
              cap={plan.maxVehicles}
            />
            {/* Plate checks: a real meter once the counter has been read.
                usedPlate is null while the usage query is loading or has
                failed, and LimitRow then renders the limit with no figure
                and no bar, rather than "0 / 3" for someone who may have
                used all three. */}
            <LimitRow
              icon={Search}
              label="בדיקת רכב לפי מספר רישוי"
              value={meteredValue(
                usedPlate,
                plan.plateChecksPerMonth,
                (u, c) => `${u} / ${c} בחודש`,
                plan.plateChecksPerMonth === null ? UNLIMITED : `${plan.plateChecksPerMonth} בחודש`,
              )}
              used={plan.plateChecksPerMonth !== null && usedPlate !== null ? usedPlate : undefined}
              cap={plan.plateChecksPerMonth}
            />
            {/* ⚠️ NO METER FOR SHARES, ON PURPOSE. Shares are not a
                counter: the allowance is a live count of vehicle_shares
                rows, which go up AND down as invitations are revoked, so a
                monotonic usage counter would be wrong. §3.3 puts that cap
                in a trigger on the table. Showing the plan limit alone is
                honest; showing a number from the wrong source would not
                be. */}
            <LimitRow
              icon={Share2}
              label="שיתוף רכבים"
              value={plan.maxShares === null ? UNLIMITED : `עד ${plan.maxShares}`}
            />
            {/* AI: the free plan is bounded by a lifetime teaser, the paid
                plans by a daily fair-use ceiling. Two different horizons,
                so two different rows from the same counter. */}
            <LimitRow
              icon={Sparkles}
              label="יועץ AI"
              value={
                isFree
                  ? meteredValue(
                    usedAiLifetime,
                    plan.aiLifetimeTeaser,
                    (u, c) => (u >= c ? 'נוצלה' : `${c - u} מתוך ${c}`),
                    plan.aiLifetimeTeaser ? `${plan.aiLifetimeTeaser} שאלה להתרשמות` : 'לא זמין',
                  )
                  : meteredValue(
                    usedAiToday,
                    plan.aiDailyCap,
                    (u, c) => `${u} / ${c} היום`,
                    UNLIMITED,
                  )
              }
              used={aiCap !== null && aiUsed !== null ? aiUsed : undefined}
              cap={aiCap}
            />
            <LimitRow
              icon={CreditCard}
              label="ממשק עסקי"
              value={plan.businessUi ? 'כלול' : 'לא כלול'}
            />
          </div>
        </Card>

        {/* ⚠️ The only platform-dependent copy on the screen, and the reason
            billingGate exists. On iOS this renders NOTHING: no price, no
            domain, no "manage online". On Android it may say a paid plan
            exists but must not link (consumption-only exemption). In a
            browser it may say so and will gain a real CTA in phase 6. */}
        {isFree && canMentionExternalPurchase() && (
          <Card>
            <div className="flex items-start gap-2.5">
              <Info className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.gray400 }} />
              <p className="text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
                {canReferToWeb()
                  ? 'קיימים מסלולים בתשלום שפותחים את כל היכולות ומעלים את תקרת כלי התחבורה. אפשרות המעבר תיפתח כאן בקרוב.'
                  : 'קיימים מסלולים בתשלום שפותחים את כל היכולות ומעלים את תקרת כלי התחבורה.'}
              </p>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
