import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ShieldCheck, Loader2, AlertTriangle, ChevronLeft } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { C } from '@/lib/designTokens';
import {
  AI_IMAGES,
  AI_PROVIDERS,
  grantConsent,
  revokeConsent,
} from '@/lib/aiConsent';
import {
  onAiConsentRequested,
  resolveAiConsentRequest,
  cancelAllAiConsentRequests,
} from '@/lib/aiConsentGate';
import { supabase } from '@/lib/supabase';

/**
 * AiConsentSheet
 *
 * Singleton bottom sheet that asks for permission to share data with a
 * third-party AI provider, per App Store 5.1.2(i). Mounted once in
 * Layout; any aiRequest anywhere raises it through the pub-sub in
 * lib/aiConsentGate.js, which then waits for the answer and continues the
 * original request. That is why the user does not have to press send
 * twice, and why the chat draft is never lost.
 *
 * Sister to AiScanUnavailableDialog, with one structural difference: that
 * one only informs, so it fires and forgets. This one decides, so every
 * exit path has to answer the waiting request. Three exits:
 *
 *   אשר ושלח   grant, then resolve true, but ONLY if the row stored
 *   לא לשלוח   record the refusal, resolve false, do not ask again
 *   dismiss    resolve false WITHOUT recording, so the next attempt asks
 *
 * That last distinction is the point. Pressing "לא לשלוח" is a decision
 * and is remembered, which is what keeps us from re-prompting on every
 * use, the thing store review reads as a dark pattern. Swiping the sheet
 * away is not a decision. Since the sheet only ever appears in response
 * to an action the user just took, asking again next time they take that
 * action is not nagging.
 *
 * @see docs/ux-ai-consent.md §5, §6
 */

/**
 * Per-kind copy. Kept in one object so the two variants can be read
 * side by side, which is how you notice one of them making a promise the
 * other does not.
 *
 * ⚠️ EVERY CLAIM HERE WAS CHECKED AGAINST WHAT THE CODE ACTUALLY SENDS.
 * An earlier draft said the vehicle list is not shared. It is:
 * buildVehicleContext() in lib/aiExpert.js appends manufacturer, model,
 * year, engine, mileage and tyre size to the system prompt, and
 * AiAssistant adds maintenance history. A privacy sheet that overstates
 * the boundary is worse than no sheet, so if you change what is sent,
 * change this text in the same commit.
 */
const COPY = {
  ai_text: {
    title: 'שיתוף עם שירות AI',
    intro: 'כדי לענות לך, נשלח את מה שכתבת לאחד משירותי ה-AI האלה:',
    alsoSent:
      'נשלחים גם פרטי הרכב שבחרת: יצרן, דגם, שנה, קילומטראז‏\' והיסטוריית הטיפולים. בלעדיהם התשובה תהיה כללית.',
    notSent: 'לא נשלחים השם שלך, כתובת המייל ומספר הרישוי.',
    confirm: 'אשר ושלח',
  },
  ai_images: {
    title: 'שליחת תמונות לשירות AI',
    intro: 'כדי לקרוא את הפרטים מהתמונה, נשלח אותה לאחד משירותי ה-AI האלה:',
    // The most important sentence in this feature. Someone photographing
    // a licence to save typing has not necessarily thought about what
    // else is in the frame. Saying it out loud is the difference between
    // a real permission and a formality.
    warn:
      'בתמונה של רישיון נהיגה או רישיון רכב מופיעים גם מספר זהות, כתובת ותאריך לידה. הם נשלחים יחד עם התמונה.',
    notSent: 'לא נשלחים השם שלך וכתובת המייל.',
    confirm: 'אשר ושלח את התמונה',
  },
};

export default function AiConsentSheet() {
  // A MIRROR of the gate's pending set, never a queue of our own. One
  // request can need both consents (a chat message with a photo
  // attached), so there can be two, and they are shown one at a time,
  // first in first shown. Holding a private copy let the two drift: an
  // ask settled elsewhere left a prompt on screen that answered nothing.
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const kind = queue[0] || null;

  useEffect(() => {
    const off = onAiConsentRequested((kinds) => setQueue(kinds));
    return () => {
      off();
      // A route change while the sheet is open must fail the waiting
      // request, not leave its promise unsettled. An unsettled ask keeps
      // the caller's spinner up forever, which is the stuck-loading class
      // of bug this project has already paid for six times.
      cancelAllAiConsentRequests();
    };
  }, []);

  // Answering the gate is what removes this kind from the queue: the
  // resolve notifies every subscriber with the new pending set, and our
  // listener sets state from it. No local splice, so there is one source
  // of truth for what is on screen.
  const finish = (answer) => {
    setSaveFailed(false);
    setBusy(false);
    if (kind) resolveAiConsentRequest(kind, answer);
  };

  const handleConfirm = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setSaveFailed(false);
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      const stored = userId ? await grantConsent(userId, kind) : false;
      // A consent we failed to store is a consent we cannot show we
      // obtained. Keep the sheet up and send nothing.
      if (!stored) {
        setSaveFailed(true);
        setBusy(false);
        return;
      }
      finish(true);
    } catch {
      setSaveFailed(true);
      setBusy(false);
    }
  };

  const handleRefuse = async () => {
    if (!kind || busy) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      // Best effort. If the write fails the state stays NOT_ASKED and
      // they get asked again next time, which is the harmless direction:
      // nothing was sent either way.
      if (userId) await revokeConsent(userId, kind);
    } catch { /* refusal is honoured regardless of the write */ }
    finish(false);
  };

  // Dismiss (swipe, overlay tap, X, Esc) is not a decision and is not
  // recorded, so the next attempt asks again.
  const handleDismiss = () => {
    if (busy) return;
    finish(false);
  };

  if (!kind) return null;
  const copy = COPY[kind] || COPY.ai_text;
  const isImages = kind === AI_IMAGES;

  return (
    <Sheet open onOpenChange={(v) => { if (!v) handleDismiss(); }}>
      <SheetContent
        side="bottom"
        dir="rtl"
        className="rounded-t-3xl border-0 p-0 max-h-[92vh] overflow-y-auto"
      >
        {/* pb restores the safe-area inset by hand. The `bottom` variant
            of SheetContent carries pb-[calc(1.5rem+env(safe-area-inset-
            bottom))], but the `p-0` above goes through tailwind-merge and
            wins over it, which left the caption under the iOS home
            indicator. Padding the inner wrapper keeps the sheet edge-to-
            edge while the content still clears the indicator. */}
        <div className="px-6 pt-7 pb-[calc(0.75rem+var(--inset-bottom,env(safe-area-inset-bottom,0px)))]">
          <div className="flex items-center justify-center">
            <div
              className="flex items-center justify-center"
              style={{
                width: 52, height: 52, borderRadius: 17,
                background: C.successSubtle,
                border: `1.5px solid ${C.successLight}`,
              }}
            >
              <ShieldCheck className="w-7 h-7" style={{ color: C.primary }} strokeWidth={2} />
            </div>
          </div>

          <p
            className="text-center mt-3 text-[11px] font-bold"
            style={{ letterSpacing: '0.25em', color: C.gray400 }}
          >
            פרטיות
          </p>
          <SheetTitle className="text-center mt-1 text-xl font-bold leading-tight" style={{ color: C.gray800 }}>
            {copy.title}
          </SheetTitle>

          <SheetDescription className="text-center mt-3 text-sm leading-relaxed" style={{ color: C.gray700 }}>
            {copy.intro}
          </SheetDescription>

          {/* Named recipients. Sourced from lib/aiConsent so this list
              cannot drift from the providers the proxy can reach. */}
          <ul className="mt-3 space-y-1.5">
            {AI_PROVIDERS.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: C.gray50, border: `1px solid ${C.gray200}` }}
              >
                <span
                  className="shrink-0 rounded-full"
                  style={{ width: 5, height: 5, background: C.primary }}
                />
                <span dir="ltr" className="text-[13px] font-semibold" style={{ color: C.gray800 }}>
                  {name}
                </span>
              </li>
            ))}
          </ul>

          {isImages ? (
            <div
              className="flex gap-2 mt-3 rounded-xl px-3 py-2.5"
              style={{ background: C.warnSubtle, border: `1px solid ${C.warnBorder}` }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.warn }} />
              <p className="text-[12px] leading-relaxed font-medium" style={{ color: C.warnDark }}>
                {copy.warn}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12px] leading-relaxed" style={{ color: C.gray500 }}>
              {copy.alsoSent}
            </p>
          )}

          {/* The boundary. This is what turns the sheet from "grant me
              access" into "here is the edge of what I take". */}
          <p className="mt-2.5 text-[12px] font-semibold leading-relaxed" style={{ color: C.gray700 }}>
            {copy.notSent}
          </p>

          <Link
            to={createPageUrl('PrivacyPolicy')}
            onClick={handleDismiss}
            className="flex items-center justify-between mt-3 rounded-xl px-3 py-2.5"
            style={{ background: C.gray50, border: `1px solid ${C.gray200}` }}
          >
            <span className="text-[13px] font-semibold" style={{ color: C.gray700 }}>
              מדיניות הפרטיות
            </span>
            <ChevronLeft className="h-4 w-4" style={{ color: C.gray400 }} />
          </Link>

          {saveFailed && (
            <div
              className="mt-3 rounded-xl px-3 py-2.5"
              style={{ background: C.errorBg, border: `1px solid ${C.errorBorder}` }}
            >
              <p className="text-[12px] font-semibold leading-relaxed" style={{ color: C.errorDark }}>
                לא הצלחנו לשמור את האישור, ולכן לא נשלח שום דבר. נסה שוב.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="w-full text-white font-bold transition-all active:translate-y-px mt-4 flex items-center justify-center gap-2 disabled:opacity-70"
            style={{
              height: 52, borderRadius: 16, fontSize: 16,
              background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryDark} 100%)`,
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.confirm}
          </button>

          {/* Not "לא עכשיו". That label promises a later ask, and this
              button records a choice we then honour by NOT asking again.
              The caption carries the reversibility instead. */}
          <button
            type="button"
            onClick={handleRefuse}
            disabled={busy}
            className="w-full font-bold transition-all hover:bg-gray-50 mt-2 disabled:opacity-70"
            style={{ height: 46, borderRadius: 12, color: C.gray500, fontSize: 14 }}
          >
            לא לשלוח
          </button>
          <p className="text-center mt-2 text-[11px]" style={{ color: C.gray400 }}>
            אפשר לשנות בכל שלב בהגדרות, במסך שירותי AI
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
