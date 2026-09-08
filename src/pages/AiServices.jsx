/**
 * AiServices — view and withdraw consent to share data with AI providers.
 *
 * WHY THIS SCREEN IS NOT OPTIONAL
 *   Without it, pressing "לא לשלוח" in AiConsentSheet is a one-way door:
 *   the refusal is stored as a DENIED row, shouldAsk() then returns false
 *   forever, and the user has no way back to AI. A consent control that
 *   cannot be withdrawn AND re-granted is not a consent control, and the
 *   sheet's own copy promises this screen exists.
 *
 * Reads and writes public.ai_consents for the signed-in user only.
 *
 * @see docs/ux-ai-consent.md §7
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ScanLine, AlertCircle, RotateCw } from 'lucide-react';
import PageShell from '@/components/business/system/PageShell';
import Card from '@/components/business/system/Card';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/designTokens';
import { toast } from 'sonner';
import {
  AI_TEXT,
  AI_IMAGES,
  AI_PROVIDERS,
  GRANTED,
  UNKNOWN,
  fetchConsents,
  grantConsent,
  revokeConsent,
} from '@/lib/aiConsent';

const ROWS = [
  {
    kind: AI_TEXT,
    icon: Sparkles,
    label: 'שיתוף טקסט',
    sub: 'צ׳אט היועץ, תגובות בקהילה ועצות תחזוקה',
  },
  {
    kind: AI_IMAGES,
    icon: ScanLine,
    label: 'שיתוף תמונות',
    sub: 'סריקת רישיון, ביטוח, קבלות ולוחית רישוי',
  },
];

export default function AiServices() {
  const qc = useQueryClient();
  const [saving, setSaving] = React.useState(null);

  const { data: user } = useQuery({
    queryKey: ['auth-user-id'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data?.session?.user?.id || null;
    },
    staleTime: 5 * 60 * 1000,
  });

  // fetchConsents wraps its Supabase call in withTimeout and never
  // throws: it returns UNKNOWN for both kinds on any failure. So a stuck
  // read cannot leave isLoading true forever, and UNKNOWN is what drives
  // the retry state below rather than isError.
  const { data: states, isLoading, refetch } = useQuery({
    queryKey: ['ai-consents', user],
    queryFn: () => fetchConsents(user),
    enabled: !!user,
    retry: 1,
    retryDelay: 500,
  });

  const readFailed =
    !!states && states[AI_TEXT] === UNKNOWN && states[AI_IMAGES] === UNKNOWN;

  const toggle = async (kind, next) => {
    if (!user || saving) return;
    setSaving(kind);
    const ok = next
      ? await grantConsent(user, kind)
      : await revokeConsent(user, kind);
    setSaving(null);
    if (!ok) {
      // Say which direction failed. "לא הצלחנו לשמור" alone leaves the
      // user unsure whether sharing is now on or off, which is the one
      // thing this screen exists to make unambiguous.
      toast.error(
        next
          ? 'לא הצלחנו לשמור את האישור. השיתוף נשאר כבוי.'
          : 'לא הצלחנו לבטל את האישור. נסה שוב.',
      );
      return;
    }
    await qc.invalidateQueries({ queryKey: ['ai-consents', user] });
    toast.success(next ? 'השיתוף הופעל' : 'השיתוף כובה');
  };

  return (
    <PageShell
      title="שירותי AI"
      subtitle="מה מותר לשלוח לשירותי ה-AI, ומה לא"
      backTo="Settings"
    >
      <div className="space-y-3">
        {/* Guest state. A consent belongs to an account, so there is
            nothing here to switch. Without this line a guest gets two
            dead toggles and no idea why they will not move. */}
        {user === null && !isLoading && (
          <Card>
            <p className="text-[13px] leading-relaxed" style={{ color: C.gray700 }}>
              שירותי ה-AI זמינים לחשבון רשום. ההרשאות כאן נשמרות בחשבון, ולכן במצב אורח אין מה להגדיר.
            </p>
          </Card>
        )}

        {readFailed ? (
          <Card>
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: C.error }} />
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: C.gray800 }}>
                  לא הצלחנו לטעון את ההגדרות
                </p>
                <p className="text-[13px] mt-1 leading-relaxed" style={{ color: C.gray500 }}>
                  עד שזה ייטען, השיתוף עם שירותי AI כבוי.
                </p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="flex items-center gap-1.5 mt-3 px-3.5 font-bold rounded-xl text-white"
                  style={{ height: 44, background: C.primary, fontSize: 14 }}
                >
                  <RotateCw className="h-4 w-4" />
                  נסה שוב
                </button>
              </div>
            </div>
          </Card>
        ) : (
          ROWS.map(({ kind, icon: Icon, label, sub }) => {
            const on = states?.[kind] === GRANTED;
            return (
              <Card key={kind}>
                <div className="flex items-center gap-3">
                  <div
                    className="flex items-center justify-center shrink-0"
                    style={{
                      width: 42, height: 42, borderRadius: 13,
                      background: on ? C.successSubtle : C.gray100,
                    }}
                  >
                    <Icon
                      className="w-5 h-5"
                      style={{ color: on ? C.primary : C.gray400 }}
                      strokeWidth={2}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold" style={{ color: C.gray800 }}>
                      {label}
                    </p>
                    <p className="text-[12px] mt-0.5 leading-snug" style={{ color: C.gray500 }}>
                      {sub}
                    </p>
                  </div>
                  {/* Loading shows a skeleton rather than an off switch.
                      An off switch is a claim about the user's setting,
                      and showing the wrong one for a moment invites them
                      to "fix" a toggle that was never wrong. */}
                  {isLoading ? (
                    <div
                      className="shrink-0 animate-pulse rounded-full"
                      style={{ width: 44, height: 24, background: C.gray200 }}
                    />
                  ) : (
                    <Switch
                      checked={on}
                      disabled={saving === kind || !user}
                      onCheckedChange={(v) => toggle(kind, v)}
                      aria-label={label}
                    />
                  )}
                </div>
              </Card>
            );
          })
        )}

        <Card>
          <p className="text-[13px] font-bold" style={{ color: C.gray800 }}>
            למי נשלח
          </p>
          <ul className="mt-2 space-y-1">
            {AI_PROVIDERS.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 4, height: 4, background: C.primary }}
                />
                <span dir="ltr" className="text-[13px]" style={{ color: C.gray700 }}>
                  {name}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] mt-3 leading-relaxed" style={{ color: C.gray500 }}>
            נשלחים גם פרטי הרכב שבחרת: יצרן, דגם, שנה, קילומטראז‏&apos; והיסטוריית הטיפולים.
            לא נשלחים השם שלך, כתובת המייל ומספר הרישוי.
          </p>
          {/* Says out loud what turning this off does NOT undo. Staying
              quiet about it would let someone believe a switch retracts
              an answer that other people are already replying to. */}
          <p className="text-[12px] mt-2 leading-relaxed" style={{ color: C.gray500 }}>
            כיבוי עוצר שליחה מכאן והלאה. תגובות AI שכבר פורסמו בקהילה נשארות.
          </p>
        </Card>
      </div>
    </PageShell>
  );
}
