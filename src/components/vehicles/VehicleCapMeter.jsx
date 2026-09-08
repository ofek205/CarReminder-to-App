/**
 * VehicleCapMeter — the proactive "you're near the personal cap" nudge.
 *
 * Sits at the top of the personal vehicles list. Appears only when a personal
 * account is within NEAR of its cap, and strengthens at the cap itself. It is
 * guidance, NOT a hard block — the actual wall is VehicleCapReachedModal, shown
 * only when the server rejects an insert. So the copy here says what a personal
 * account is *designed for* and points to the business account; it never claims
 * "you cannot add", which would be false during the enforcement grace period.
 *
 * Self-hiding: for business accounts, guests, and accounts below the threshold,
 * useVehicleCapacity resolves isCapped=false / far from cap → renders null.
 *
 * Dismiss is remembered per (account, count): dismissing at 9/10 keeps it away
 * at 9, but a fresh nudge returns at 10. The frozen cohort (count == cap, never
 * changes) dismisses once and stays quiet.
 *
 * Copy rule (spec §5.7 / E-7): describe what the business account unlocks;
 * never promise "free" or "unlimited forever".
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, X, ArrowLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';
import useVehicleCapacity from '@/hooks/useVehicleCapacity';
import useAccountRole from '@/hooks/useAccountRole';

// Show the meter once the account is within this many slots of the cap.
const NEAR = 2;

const dismissKey = (accountId, count) => `cr_capmeter_dismiss:${accountId || 'anon'}:${count}`;

export default function VehicleCapMeter() {
  const navigate = useNavigate();
  const { accountId } = useAccountRole();
  const { isCapped, count, cap, remaining } = useVehicleCapacity();

  const [dismissed, setDismissed] = useState(() => {
    try { return !!localStorage.getItem(dismissKey(accountId, count)); } catch { return false; }
  });

  // Gate: personal + a real cap + within NEAR of it.
  if (!isCapped || !cap || count < cap - NEAR) return null;
  if (dismissed) return null;

  const atCap = remaining <= 0;
  const pct = Math.min(100, Math.round((count / cap) * 100));

  const dismiss = () => {
    try { localStorage.setItem(dismissKey(accountId, count), '1'); } catch { /* quota / private mode */ }
    setDismissed(true);
  };

  const accent = atCap ? C.warnDark : C.successDark;
  const tintBg = atCap ? C.warnSubtle : '#F1F8F3';

  return (
    <div
      dir="rtl"
      className="mb-3 rounded-2xl p-3.5"
      style={{ background: tintBg, border: `1px solid ${atCap ? C.warnIcon : C.successLight}` }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white"
          style={{ background: `linear-gradient(135deg, ${accent}, ${atCap ? C.warnIcon : C.successBright})` }}
        >
          <Briefcase className="h-[18px] w-[18px]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold" style={{ color: C.primaryDark }}>
              {atCap ? 'החשבון האישי מלא' : `נותרו ${remaining} רכבים עד התקרה`}
            </p>
            <button
              type="button" onClick={dismiss} aria-label="הסתר"
              className="shrink-0 p-1 rounded-lg transition-colors"
              style={{ color: C.muted }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: C.textAlt }}>
            חשבון אישי מיועד לניהול עד {cap} רכבים. לצי גדול יותר — חשבון עסקי.
          </p>

          {/* Capacity bar */}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#FFFFFF' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, ${atCap ? C.warnIcon : C.successBright})` }}
              />
            </div>
            <span dir="ltr" className="text-[11px] font-bold tabular-nums" style={{ color: accent }}>
              {count}/{cap}
            </span>
          </div>

          <button
            type="button"
            onClick={() => navigate(createPageUrl('CreateBusinessWorkspace'))}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-bold transition-colors"
            style={{ color: C.successDark }}
          >
            מה נותן חשבון עסקי <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
