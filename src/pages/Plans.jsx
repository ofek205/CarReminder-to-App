/**
 * /Plans — what each plan includes.
 *
 * ⚠️ THIS IS A SPEC SHEET, NOT A PRICING PAGE, and that is the decision the
 * whole screen rests on. There is no purchase button on any surface: there is
 * no checkout and no StoreKit, and a disabled button is a promise that breaks
 * on tap. A pricing page without a buy button looks broken; a SPEC SHEET
 * without one looks normal, and users of this app already read spec tables
 * here, because that is exactly what a plate check returns. The genre is
 * borrowed from the product's own domain rather than from a SaaS catalogue.
 *
 * ⚠️ EVERY NUMBER COMES FROM plan_limits. Not one limit is typed into this
 * file. §5.1 requires it so marketing and enforcement cannot contradict each
 * other, and it matters right now: the free vehicle cap is not finally
 * decided, and tuning it is an UPDATE with no deploy. A hardcoded 5 would
 * become a lie the moment that happens.
 *
 * Structure follows §1.1's two engines: free vs paid is the decision almost
 * everyone actually makes, and fleet size is a secondary axis that 97.7% of
 * personal accounts never reach. A four-column table would give both equal
 * weight and bury the one that matters.
 *
 * @see docs/spec-monetization-plans-v2.md §1.1, §5.1, §5.4
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Car, Sparkles, ScanLine, Share2, Briefcase, CornerDownLeft } from 'lucide-react';
import PageShell from '@/components/business/system/PageShell';
import SystemErrorBanner from '@/components/shared/SystemErrorBanner';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';
import usePlanCatalog from '@/hooks/usePlanCatalog';
import useAccountPlan from '@/hooks/useAccountPlan';
import { billingSurface, IAP, NONE } from '@/lib/billingGate';

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
 * The note that stops this screen lying to 21 accounts.
 *
 * account_plan() applies the override, so the plan a frozen user is ON says
 * "up to 5" while their app allows the 8 they actually hold. Showing the
 * catalogue value alone would contradict the app; showing only their value
 * would misdescribe the product. So the row shows the PLAN and annotates the
 * difference.
 *
 * "נשמר מהמצב הקודם" is the half that matters: without a reason, a user
 * reading 5 in the table and 8 in their account concludes one of them is a
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
 */
export function unavailableCopy(surface) {
  if (surface === IAP)  return 'רכישה אינה זמינה בגרסה הזו של האפליקציה.';
  if (surface === NONE) return 'רכישה אינה זמינה באפליקציה. המנוי מנוהל באתר.';
  return 'רכישה אינה זמינה כרגע.';
}

/** Numerals stay LTR inside Hebrew, or "עד 10" renders reversed. */
function Num({ children }) {
  return <span dir="ltr" className="tabular-nums">{children}</span>;
}

/**
 * One spec row: label on its own line, then the two values side by side.
 * A single card with a 2-column grid, not two cards: two cards would restore
 * the binary contrast the design set out to avoid.
 */
function SpecRow({ icon: Icon, label, freeValue, paidValue, note }) {
  return (
    <div className="py-3.5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 shrink-0" style={{ color: C.gray500 }} aria-hidden="true" />
        <span className="text-[13px] font-semibold" style={{ color: C.gray500 }}>{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[15px] font-bold tabular-nums" style={{ color: C.gray800 }}>{freeValue}</p>
          {note && (
            <p className="text-[12px] mt-1 flex items-start gap-1 leading-snug" style={{ color: C.primary }}>
              <CornerDownLeft className="h-3 w-3 shrink-0 mt-0.5 rtl:rotate-180" aria-hidden="true" />
              <span>{note}</span>
            </p>
          )}
        </div>
        <p className="text-[15px] font-bold tabular-nums" style={{ color: C.gray800 }}>{paidValue}</p>
      </div>
    </div>
  );
}

function SkeletonCard() {
  // Same shape as the real card, because the structure is known before the
  // data is. A spinner would say "something is happening"; this says what.
  return (
    <div className="bg-white rounded-3xl shadow-sm p-5" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="h-10 rounded-lg animate-pulse" style={{ background: C.gray100 }} />
        <div className="h-10 rounded-lg animate-pulse" style={{ background: C.gray100 }} />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="py-3.5 border-t" style={{ borderColor: C.gray100 }}>
          <div className="h-3 w-24 rounded animate-pulse mb-2" style={{ background: C.gray100 }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-4 rounded animate-pulse" style={{ background: C.gray100 }} />
            <div className="h-4 rounded animate-pulse" style={{ background: C.gray100 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Plans() {
  const catalog = usePlanCatalog();
  const { plan: currentPlan, graceDaysLeft, isGuest } = useAccountPlan();
  const surface = billingSurface();

  // Which paid tier the spec column describes. Defaults to the account's own
  // paid plan when it has one, otherwise the entry tier: the reader should
  // land on the column that already describes them.
  const [selectedCode, setSelectedCode] = React.useState(null);

  const paid = catalog.paid;
  const selected =
    paid.find((p) => p.code === selectedCode)
    || paid.find((p) => p.code === currentPlan?.code)
    || paid[0]
    || null;

  const free = catalog.free;

  if (catalog.isError) {
    return (
      <PageShell title="המסלולים" subtitle="מה כל מסלול כולל" backTo="MyPlan">
        <SystemErrorBanner
          message="לא הצלחנו לטעון את המסלולים. בדוק את החיבור לאינטרנט ונסה שוב."
          onRetry={catalog.refetch}
        />
      </PageShell>
    );
  }

  if (catalog.isLoading || !free || !selected) {
    return (
      <PageShell title="המסלולים" subtitle="מה כל מסלול כולל" backTo="MyPlan">
        <SkeletonCard />
      </PageShell>
    );
  }

  // The account is on the top tier when nothing sells more vehicles than it.
  const onTopPlan =
    !isGuest
    && currentPlan
    && currentPlan.priceIlsMonth > 0
    && currentPlan.maxVehicles === null;

  const isOnFree = !isGuest && currentPlan && currentPlan.priceIlsMonth === 0;

  // Only annotate the column the account is actually on, and only where the
  // effective limit really differs from what that plan advertises.
  const noteFor = (field) => {
    if (isGuest || !currentPlan) return null;
    const catalogueRow = currentPlan.priceIlsMonth === 0 ? free : paid.find((p) => p.code === currentPlan.code);
    if (!catalogueRow) return null;
    return personalNote(currentPlan[field], catalogueRow[field]);
  };
  const vehiclesNote = isOnFree ? noteFor('maxVehicles') : null;

  return (
    <PageShell
      title="המסלולים"
      subtitle={isGuest ? 'מצב אורח' : 'מה כל מסלול כולל'}
      backTo="MyPlan"
    >
      <div className="space-y-4">

        {/* Grace. Wording matches /MyPlan exactly: the same situation on two
            screens must not sound like two different situations. The second
            line is what this screen specifically needs, because a limits
            table is misleading to someone the limits do not yet apply to. */}
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

        {/* The comparison. One card, two columns, hairline rules between
            rows. The only colour that separates the columns is the paid
            heading: free must not read as punished. */}
        <div className="bg-white rounded-3xl shadow-sm p-5">
          <div className="grid grid-cols-2 gap-3 pb-3">
            <div>
              <p className="text-[15px] font-bold" style={{ color: C.gray800 }}>חינם</p>
              <p className="text-[13px] mt-0.5 tabular-nums" style={{ color: C.gray500 }}>
                <Num>₪0</Num>
              </p>
              {isOnFree && (
                <span
                  className="inline-block mt-2 px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                  style={{ background: C.primary }}
                >
                  המסלול שלך
                </span>
              )}
            </div>
            <div>
              <p className="text-[15px] font-bold" style={{ color: C.primary }}>בתשלום</p>
              <p className="text-[13px] mt-0.5" style={{ color: C.gray500 }}>
                <Num>₪{selected.priceIlsMonth}</Num> לחודש
              </p>
              {!isGuest && currentPlan?.code === selected.code && (
                <span
                  className="inline-block mt-2 px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
                  style={{ background: C.primary }}
                >
                  המסלול שלך
                </span>
              )}
            </div>
          </div>

          <div className="divide-y" style={{ borderColor: C.gray100 }}>
            <div className="border-t" style={{ borderColor: C.gray100 }}>
              <SpecRow
                icon={Car}
                label="כלי תחבורה"
                freeValue={capLabel(free.maxVehicles)}
                paidValue={capLabel(selected.maxVehicles)}
                note={vehiclesNote}
              />
            </div>
            <SpecRow
              icon={Sparkles}
              label="מומחה AI"
              freeValue={advisorLabel(free)}
              paidValue={advisorLabel(selected)}
            />
            <SpecRow
              icon={ScanLine}
              label="בדיקת רכב"
              freeValue={monthlyLabel(free.plateChecksPerMonth)}
              paidValue={monthlyLabel(selected.plateChecksPerMonth)}
            />
            <SpecRow
              icon={Share2}
              label="שיתוף רכבים"
              freeValue={capLabel(free.maxShares)}
              paidValue={capLabel(selected.maxShares)}
            />
            <SpecRow
              icon={Briefcase}
              label="ממשק עסקי"
              freeValue={includedLabel(free.businessUi)}
              paidValue={includedLabel(selected.businessUi)}
            />
          </div>
        </div>

        {/* Fleet size. A single segmented control, not three cards: three
            cards say "choose one of us", a divided control says "this is an
            axis". The sentence above is what actually does the work for the
            97.7% who never reach it, so it leads with "זהים לגמרי". */}
        {paid.length > 1 && (
          <div>
            <p className="text-[15px] font-bold mb-1" style={{ color: C.gray800 }}>גודל הצי</p>
            <p className="text-[13px] mb-3 leading-relaxed" style={{ color: C.gray500 }}>
              שלושת המסלולים בתשלום זהים לגמרי. ההבדל היחיד הוא כמה כלי תחבורה אפשר לנהל.
            </p>
            <div
              role="radiogroup"
              aria-label="גודל הצי"
              className="flex rounded-xl overflow-hidden border"
              style={{ borderColor: C.gray200 }}
            >
              {paid.map((p, i) => {
                const active = p.code === selected.code;
                return (
                  <button
                    key={p.code}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedCode(p.code)}
                    className="flex-1 flex flex-col items-center justify-center transition-colors"
                    style={{
                      minHeight: 44,
                      background: active ? C.primary : 'transparent',
                      color: active ? '#FFFFFF' : C.gray800,
                      borderInlineStart: i === 0 ? 'none' : `1px solid ${C.gray200}`,
                      transitionDuration: '150ms',
                    }}
                  >
                    <span className="text-[13px] font-bold">{capLabel(p.maxVehicles)}</span>
                    <span className="text-[11px] opacity-90">
                      <Num>₪{p.priceIlsMonth}</Num>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* One line, one place. Not beside every plan. On the top tier there
            is nothing to buy, so saying purchase is unavailable would be
            noise; that case gets its own sentence instead. */}
        <p className="text-[13px] text-center px-2" style={{ color: C.gray500 }}>
          {onTopPlan
            ? 'אתה במסלול הגבוה ביותר, ללא הגבלת כלי תחבורה.'
            : unavailableCopy(surface)}
        </p>

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
