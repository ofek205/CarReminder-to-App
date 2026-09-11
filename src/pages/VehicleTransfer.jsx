/**
 * VehicleTransfer — the recipient's side of a digital ownership transfer.
 *
 * ⚠️ THIS PAGE DOES NOT AUTO-ACCEPT, and that is the one place it deliberately
 * departs from JoinInvite, which it otherwise mirrors. JoinInvite calls
 * accept_vehicle_share the moment it mounts, because a share only ADDS
 * something to your account and there is nothing to weigh. A transfer copies a
 * stranger's history into your account and permanently archives theirs, so the
 * recipient sees what is being offered and chooses. That is what Ofek asked
 * for: "צריך את אישור הצד השני לקבל".
 *
 * Two ways in, one screen:
 *   ?id=<uuid>     an existing user, arriving from the in-app notification
 *   ?token=<hex>   anybody, arriving from the link in the email or WhatsApp
 *
 * ⚠️ AND IT IS REACHABLE LOGGED OUT, on purpose. /VehicleTransfer is in
 * Layout's PUBLIC_PAGES so a stranger holding the link sees the offer BEFORE
 * being asked to sign up. preview_vehicle_transfer is granted to `anon` for
 * exactly this: counts and a date range, never row content and never the
 * licence plate. Then the only way to actually take the vehicle is to
 * register, which is the growth path Ofek described — "הלינק מחייב אותו
 * להירשם ולהוריד".
 *
 * Accepting still needs a signed-in user whose own email matches the invited
 * address; the server enforces that, this page only explains it.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { dal } from '@/lib/dal';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import {
  CheckCircle, XCircle, Loader2, LogIn, Car, Wrench, AlertTriangle, Calendar, Clock,
} from 'lucide-react';
import { C } from '@/lib/designTokens';
import { capWallAction } from '@/lib/billingGate';
import { toastError } from '@/lib/userErrorReport';
import { rpcErrorCode } from '@/lib/rpcErrors';

// Errors raised by accept_vehicle_transfer / decline_vehicle_transfer.
//
// ⚠️ vehicle_plan_cap_exceeded is NOT in this map, and that is deliberate:
// it is the one failure whose wording depends on the platform, so it is
// resolved in acceptErrorCopy() below. It is also the most likely failure
// here by a wide margin — it fires whenever the recipient's account is
// already full — so letting it fall through to a generic message would send
// the most common case to the least helpful copy.
const ACCEPT_ERROR_COPY = {
  not_authenticated:        'צריך להתחבר כדי לקבל את הרכב',
  transfer_not_found:       'ההעברה לא נמצאה. ייתכן שהקישור שגוי.',
  transfer_not_pending:     'ההעברה כבר טופלה, בוטלה או פגה',
  transfer_expired:         'ההצעה פגה. אפשר לבקש מהשולח לשלוח אותה מחדש.',
  transfer_email_mismatch:  'ההצעה נשלחה לכתובת מייל אחרת. צריך להתחבר עם הכתובת שאליה היא נשלחה.',
  no_account_for_recipient: 'לא נמצא חשבון פעיל. נסה/י להתנתק ולהתחבר מחדש.',
};

function acceptErrorCopy(code) {
  if (code === 'vehicle_plan_cap_exceeded') {
    return capWallAction('plan').mayMentionPlans
      // The remedy is real and worth naming, because the offer stays pending:
      // nothing was lost, and accepting again after making room just works.
      ? 'הגעת למספר הרכבים שהמסלול הנוכחי כולל. ההצעה נשארת פתוחה, אז אפשר לפנות מקום או לעבור למסלול גדול יותר ואז לקבל את הרכב.'
      // iOS: Guideline 3.1.1(a) covers prose, not only buttons, so this names
      // the limit and the one action available inside the app.
      : 'הגעת למספר הרכבים שהמסלול הנוכחי כולל. ההצעה נשארת פתוחה, אז אפשר למחוק רכב קיים ואז לקבל את הרכב הזה.';
  }
  return ACCEPT_ERROR_COPY[code];
}

// The scrape lives in @/lib/rpcErrors — it was written six times across this
// project before it was written once.

const fmtDate = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString('he-IL');
};

export default function VehicleTransfer() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const transferId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('loading'); // loading | offer | accepted | declined | error
  const [message, setMessage] = useState('');
  const [offer, setOffer] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [acting, setActing] = useState(null); // 'accept' | 'decline' | null
  const [newVehicleId, setNewVehicleId] = useState(null);

  const load = useCallback(async () => {
    if (!token && !transferId) {
      setStatus('error');
      setMessage('קישור לא תקין');
      return;
    }

    // ⚠️ RACED, not awaited bare. supabase.auth.getUser() can hang in this
    // app — Layout's own bootstrap already carries a `getSession timeout`
    // fallback for exactly that — and this call gates the only path out of
    // status='loading'. Unguarded, a wedged auth bridge leaves a permanent
    // spinner, which CLAUDE.md forbids outright.
    //
    // Timing out resolves to "not signed in", which is the safe reading: the
    // page then offers the sign-up CTA. Nothing is granted on this answer —
    // accept_vehicle_transfer re-checks the caller server-side and matches
    // their email against the invited address.
    let user = null;
    try {
      const res = await Promise.race([
        supabase.auth.getUser(),
        new Promise((resolve) => setTimeout(() => resolve({ data: { user: null } }), 5000)),
      ]);
      user = res?.data?.user ?? null;
    } catch { /* treated as signed out */ }
    setSignedIn(!!user);

    try {
      // BOTH identifiers, so the in-app recipient sees the same card as a
      // stranger holding a link. An earlier version previewed by token only,
      // which left the ?id= path — the common one for an existing user —
      // approving a transfer on a generic card with no counts, no date range
      // and no vehicle named. Less information for the person the app
      // already knows is the wrong way round.
      const { data, error } = await dal.run('vehicleTransfer.preview', {
        token,
        transferId,
      });
      if (error) {
        setStatus('error');
        setMessage('לא הצלחנו לטעון את ההצעה. נסה/י שוב.');
        return;
      }
      // The RPC RETURNS TABLE, so an unknown or expired token comes back as
      // an empty array rather than an error — a stranger guessing tokens
      // learns nothing from the difference.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        setStatus('error');
        setMessage('ההצעה לא נמצאה, כבר טופלה, או שפג תוקפה');
        return;
      }
      setOffer(row);
      setStatus('offer');
    } catch (e) {
      if (import.meta.env.DEV) console.warn('transfer preview failed:', e);
      setStatus('error');
      setMessage('אירעה שגיאה. נסה/י שוב.');
    }
  }, [token, transferId]);

  useEffect(() => { load(); }, [load]);

  const goToAuth = () => {
    const safe = encodeURIComponent(String(token || '').replace(/[^a-zA-Z0-9_-]/g, ''));
    const returnUrl = `/VehicleTransfer?token=${safe}`;
    window.location.href = `/Auth?redirect=${encodeURIComponent(returnUrl)}`;
  };

  const accept = async () => {
    setActing('accept');
    try {
      const { data, error } = await dal.run('vehicleTransfer.accept', {
        transferId: transferId || null,
        token: token || null,
      });
      if (error) {
        const msg = acceptErrorCopy(rpcErrorCode(error)) || 'לא הצלחנו להשלים את ההעברה. נסה/י שוב.';
        toastError(msg, { action: 'vehicle_transfer_accept', err: error });
        if (import.meta.env.DEV) console.warn('accept_vehicle_transfer:', error);
        setActing(null);
        return;
      }
      setNewVehicleId(data?.vehicle_id || null);
      // ⚠️ ['vehicles'], NOT ['my-vehicles']. Nothing in this app defines a
      // query under the key 'my-vehicles' — it is only ever invalidated,
      // never registered — so that call matched zero queries and did
      // nothing. The real list is useMyVehicles' ['vehicles', accountId],
      // and React Query matches invalidations by key PREFIX, so the bare
      // ['vehicles'] reaches it for every account.
      //
      // The symptom was quiet and would have read as a server problem: the
      // recipient accepts, taps through to the vehicle list, and the car
      // they just received is missing until the 30s staleTime lapses.
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      setStatus('accepted');
    } catch (e) {
      toastError('אירעה שגיאה. נסה/י שוב.', { action: 'vehicle_transfer_accept_exception', err: e });
    } finally {
      setActing(null);
    }
  };

  const decline = async () => {
    setActing('decline');
    try {
      // Same pair as accept. The preview deliberately does not return the row
      // id — a token holder identifies the offer by the token they already
      // have, and handing out the id would add an identifier the screen has
      // no use for.
      const { error } = await dal.run('vehicleTransfer.decline', {
        transferId: transferId || null,
        token: token || null,
      });
      if (error) {
        const msg = acceptErrorCopy(rpcErrorCode(error)) || 'לא הצלחנו לדחות את ההצעה. נסה/י שוב.';
        toastError(msg, { action: 'vehicle_transfer_decline', err: error });
        setActing(null);
        return;
      }
      setStatus('declined');
    } catch (e) {
      toastError('אירעה שגיאה. נסה/י שוב.', { action: 'vehicle_transfer_decline_exception', err: e });
    } finally {
      setActing(null);
    }
  };

  const vehicleLabel = offer
    ? [offer.manufacturer, offer.model].filter(Boolean).join(' ') || 'רכב'
    : 'רכב';
  const oldest = fmtDate(offer?.oldest_record);
  const newest = fmtDate(offer?.newest_record);
  const expires = fmtDate(offer?.expires_at);

  const card = { background: '#FFFFFF', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-5 py-8" dir="rtl">
      <div className="max-w-sm w-full">

        {status === 'loading' && (
          <div className="rounded-3xl p-10 text-center" style={card}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
              style={{ background: C.light }}>
              <Loader2 className="h-10 w-10 animate-spin" style={{ color: C.primary }} />
            </div>
            <p className="text-lg font-bold text-gray-700">טוען את ההצעה...</p>
          </div>
        )}

        {status === 'offer' && (
          <div className="rounded-3xl p-7 space-y-5" style={card}>
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
                style={{ background: C.light }}>
                <Car className="h-10 w-10" style={{ color: C.primary }} />
              </div>
              <h2 className="font-bold text-xl text-gray-900">מעבירים אליך רכב</h2>
              {/* No fallback branch. status==='offer' is only reached after
                  the preview returned a row, so an offer with nothing to
                  describe cannot occur, and a second paragraph for it would
                  be copy for a state that does not exist. That branch was
                  live until the ?id= path stopped skipping the preview. */}
              <p className="text-base text-gray-700 leading-relaxed">
                <strong>{offer.sender_name || 'משתמש'}</strong>
                {' '}מעביר/ה אליך את <strong>{vehicleLabel}</strong>
                {offer.year ? ` ${offer.year}` : ''}
                {' '}יחד עם ההיסטוריה שלו.
              </p>
            </div>

            {/* What is actually in the package. Counts and a date range, never
                the rows themselves: this screen is visible to anyone holding
                the link, including before they have an account. */}
            {offer && (
              <div className="rounded-2xl p-4 space-y-3" style={{ background: C.grayBg }}>
                <div className="flex items-center gap-2.5">
                  <Wrench className="w-4 h-4 shrink-0" style={{ color: C.primary }} />
                  <span className="text-sm font-bold text-gray-800">
                    {offer.service_count || 0} רשומות טיפול ותיקון
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: C.orange }} />
                  <span className="text-sm font-bold text-gray-800">
                    {offer.accident_count || 0} תאונות
                  </span>
                </div>
                {oldest && newest && (
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-4 h-4 shrink-0" style={{ color: C.gray500 }} />
                    {/* The span is the only honest signal of authenticity this
                        feature can offer: twelve rows written last week read
                        very differently from twelve across three years. */}
                    <span className="text-sm font-medium text-gray-600" dir="rtl">
                      מ-{oldest} עד {newest}
                    </span>
                  </div>
                )}
                {expires && (
                  <div className="flex items-center gap-2.5 pt-1 border-t" style={{ borderColor: C.gray200 }}>
                    <Clock className="w-4 h-4 shrink-0" style={{ color: C.warn }} />
                    <span className="text-xs font-medium" style={{ color: C.gray500 }}>
                      ההצעה בתוקף עד {expires}
                    </span>
                  </div>
                )}
              </div>
            )}

            {signedIn ? (
              <div className="flex flex-col gap-2">
                <Button onClick={accept} disabled={!!acting}
                  className="w-full h-14 rounded-2xl font-bold text-base gap-2"
                  style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
                  {acting === 'accept' ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
                  קבל את הרכב
                </Button>
                <Button onClick={decline} disabled={!!acting} variant="ghost"
                  className="w-full h-12 rounded-2xl font-bold text-sm"
                  style={{ color: C.gray500 }}>
                  {acting === 'decline' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'לא תודה'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button onClick={goToAuth}
                  className="w-full h-14 rounded-2xl font-bold text-base gap-2"
                  style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
                  <LogIn className="h-5 w-5" />
                  הירשם כדי לקבל את הרכב
                </Button>
                <p className="text-[11px] text-center leading-relaxed" style={{ color: C.gray400 }}>
                  ההרשמה חינם. אחרי שתתחבר/י נחזיר אותך בדיוק לכאן כדי לאשר.
                </p>
              </div>
            )}
          </div>
        )}

        {status === 'accepted' && (
          <div className="rounded-3xl p-8 text-center space-y-5" style={card}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: C.successBg }}>
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <div className="space-y-2">
              <h2 className="font-bold text-xl text-gray-900">הרכב שלך</h2>
              <p className="text-base text-gray-700 leading-relaxed">
                הרכב וההיסטוריה שלו נוספו לחשבון. כל טיפול שמור עם התאריך המקורי שלו.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {newVehicleId && (
                <Button onClick={() => navigate(`${createPageUrl('VehicleDetail')}?id=${newVehicleId}`)}
                  className="w-full h-14 rounded-2xl font-bold text-base"
                  style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
                  פתח את הרכב
                </Button>
              )}
              <Button onClick={() => navigate(createPageUrl('Dashboard'))}
                variant="outline" className="w-full h-12 rounded-2xl font-bold text-sm">
                למסך הבית
              </Button>
            </div>
          </div>
        )}

        {status === 'declined' && (
          <div className="rounded-3xl p-8 text-center space-y-5" style={card}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: C.grayBg }}>
              <XCircle className="h-10 w-10" style={{ color: C.gray500 }} />
            </div>
            <h2 className="font-bold text-xl text-gray-900">ההצעה נדחתה</h2>
            <p className="text-base text-gray-500 leading-relaxed">
              הודענו לשולח. הרכב נשאר אצלו ללא שינוי.
            </p>
            <Button onClick={() => navigate(createPageUrl('Dashboard'))}
              variant="outline" className="w-full h-12 rounded-2xl font-bold text-base">
              למסך הבית
            </Button>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-3xl p-8 text-center space-y-5" style={card}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: C.errorBg }}>
              <XCircle className="h-10 w-10 text-red-500" />
            </div>
            <h2 className="font-bold text-xl text-gray-900">{message}</h2>
            <Button onClick={() => navigate(createPageUrl('Dashboard'))}
              variant="outline" className="w-full h-12 rounded-2xl font-bold text-base">
              למסך הבית
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
