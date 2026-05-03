import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, Users, LogIn } from "lucide-react";
import { C } from '@/lib/designTokens';
import { ROLE_INFO } from '@/lib/permissions';

export default function JoinInvite() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  // type=vehicle → per-vehicle share invite (new flow). Anything else
  // (or missing) routes through the legacy account-level redeem flow.
  // We default to 'account' rather than 'vehicle' so older invite
  // links still work after this change.
  const inviteType = urlParams.get('type') === 'vehicle' ? 'vehicle' : 'account';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('loading'); // loading, success, error, needsAuth
  const [message, setMessage] = useState('');
  const [assignedRole, setAssignedRole] = useState('');
  // Vehicle-share flow context for the success screen — set from the
  // RPC return so we can render "X שיתף איתך את Y" instead of the
  // generic "השיתוף אושר".
  const [shareContext, setShareContext] = useState(null); // { vehicle_id, vehicle_label, inviter_name, role }

  useEffect(() => {
    join();
  }, [token]);

  async function join() {
    // Guard: token must be present
    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      setStatus('error');
      setMessage('קישור הזמנה לא תקין');
      return;
    }

    // Check if user is logged in
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setStatus('needsAuth');
      setMessage('צריך להתחבר או להירשם כדי להצטרף');
      return;
    }

    // ── Vehicle-share flow ──────────────────────────────────────────
    // The new ShareVehicleDialog generates links of the shape
    //   /JoinInvite?token=<hex>&type=vehicle
    // and the underlying token lives in vehicle_shares.invite_token.
    // accept_vehicle_share expects the token (or share_id); it
    // validates email-match server-side, fires share_accepted
    // notification, and grants access via vehicle_shares.status='accepted'.
    if (inviteType === 'vehicle') {
      try {
        const { data, error } = await supabase.rpc('accept_vehicle_share', { p_token: token });
        if (error) {
          const code = String(error.message || '').toLowerCase();
          let friendly = 'אירעה שגיאה באישור השיתוף.';
          if (code.includes('share_not_found')) friendly = 'הזמנת השיתוף לא נמצאה';
          else if (code.includes('share_not_pending')) friendly = 'הזמנת השיתוף כבר אושרה או בוטלה';
          else if (code.includes('share_email_mismatch')) friendly = 'ההזמנה הזו נשלחה למייל אחר. התחבר/י עם המייל שאליו היא נשלחה.';
          else if (code.includes('share_expired')) friendly = 'הזמנת השיתוף פגה (אחרי 7 ימים)';
          else if (code.includes('not_authenticated')) friendly = 'יש להתחבר מחדש';
          setStatus('error');
          setMessage(friendly);
          return;
        }
        setAssignedRole(data?.role === 'editor' ? 'מנהל' : 'שותף');
        setShareContext({
          vehicle_id:    data?.vehicle_id || null,
          vehicle_label: data?.vehicle_label || 'הרכב',
          inviter_name:  data?.inviter_name  || 'משתמש',
          role:          data?.role          || 'viewer',
        });
        // Invalidate the cached vehicles list so the newly-shared
        // vehicle is visible the moment the user clicks "למסך הבית".
        queryClient.invalidateQueries({ queryKey: ['my-vehicles'] });
        setStatus('success');
        setMessage('');                    // success render uses shareContext, not the generic message
      } catch (e) {
        if (import.meta.env.DEV) console.error('Vehicle share accept error:', e);
        setStatus('error');
        setMessage('אירעה שגיאה. נסה שוב.');
      }
      return;
    }

    // ── Legacy account-level invite flow (unchanged) ────────────────
    try {
      // All validation, role-safety, expiry, max-uses checks, and the
      // membership insert run atomically inside the SECURITY DEFINER RPC.
      // This closes M7 (race condition) and prevents a direct-from-client
      // invites table walk that previously let clients peek at invite rows.
      const { data, error: rpcError } = await supabase.rpc('redeem_invite_token', { tok: token });

      if (rpcError) {
        const code = String(rpcError.message || '').toLowerCase();
        let friendly = 'אירעה שגיאה. נסה שוב.';
        if (code.includes('not_authenticated')) friendly = 'יש להתחבר מחדש';
        else if (code.includes('invite_not_found')) friendly = 'ההזמנה לא נמצאה';
        else if (code.includes('invite_expired')) friendly = 'ההזמנה פגה תוקף';
        else if (code.includes('invite_exhausted')) friendly = 'ההזמנה כבר מומשה';
        else if (code.includes('invite_not_active')) friendly = 'ההזמנה אינה פעילה';
        // invalid_invite_role is raised by the strict-role RPC when a
        // role-string outside ('מנהל','שותף') is stored on the invite —
        // typically a mis-configured invite; tell the user to ask the
        // sender to re-issue.
        else if (code.includes('invalid_invite_role')) friendly = 'תפקיד לא חוקי בהזמנה. בקש מהשולח ליצור הזמנה חדשה.';
        setStatus('error');
        setMessage(friendly);
        return;
      }

      // Supabase RPC can return an array, a single object, or null
      // depending on how the return type was declared. Defensively normalize
      // and then check the shape — an empty/malformed response previously
      // got past the `!row` guard and crashed downstream at row.role_to_assign.
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object' || !row.role_to_assign) {
        setStatus('error');
        setMessage('ההזמנה לא נמצאה');
        return;
      }

      if (row.already_member) {
        setStatus('error');
        setMessage('אתה כבר חבר בחשבון זה');
        return;
      }

      setAssignedRole(row.role_to_assign);
      setStatus('success');
      const vehicleCount = row.vehicle_ids?.length;
      setMessage(vehicleCount
        ? `הצטרפת בהצלחה! גישה ל-${vehicleCount} רכבים`
        : 'הצטרפת בהצלחה לחשבון!'
      );

    } catch (e) {
      if (import.meta.env.DEV) console.error('Join invite error:', e);
      setStatus('error');
      setMessage('אירעה שגיאה. נסה שוב.');
    }
  }

  const goToAuth = () => {
    // Redirect to auth with return URL - sanitize token to prevent injection
    const safeToken = encodeURIComponent(String(token).replace(/[^a-zA-Z0-9_-]/g, ''));
    const returnUrl = `/JoinInvite?token=${safeToken}`;
    window.location.href = `/Auth?redirect=${encodeURIComponent(returnUrl)}`;
  };

  const roleInfo = ROLE_INFO[assignedRole];

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-5" dir="rtl">
      <div className="max-w-sm w-full">

        {/* Loading */}
        {status === 'loading' && (
          <div className="rounded-3xl p-10 text-center" style={{ background: '#FFFFFF', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
              style={{ background: C.light }}>
              <Loader2 className="h-10 w-10 animate-spin" style={{ color: C.primary }} />
            </div>
            <p className="text-lg font-bold text-gray-700">מעבד את ההזמנה...</p>
          </div>
        )}

        {/* Needs auth */}
        {status === 'needsAuth' && (
          <div className="rounded-3xl p-8 text-center space-y-5"
            style={{ background: '#FFFFFF', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: C.light }}>
              <Users className="h-10 w-10" style={{ color: C.primary }} />
            </div>
            <h2 className="font-bold text-xl text-gray-900">הוזמנת להצטרף לחשבון!</h2>
            <p className="text-base text-gray-500">{message}</p>
            <Button onClick={goToAuth}
              className="w-full h-14 rounded-2xl font-bold text-base gap-2"
              style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
              <LogIn className="h-5 w-5" />
              התחבר / הירשם
            </Button>
          </div>
        )}

        {/* Success.
            Two flavors:
              * Vehicle-share flow (shareContext set): personalized — names
                the inviter, the vehicle, and explains in plain Hebrew
                what the granted permission lets you do. Adds a CTA
                straight to the vehicle page so the user immediately
                sees what they got access to.
              * Account-level flow (legacy): the original generic
                message, kept for back-compat. */}
        {status === 'success' && (
          <div className="rounded-3xl p-8 text-center space-y-5"
            style={{ background: '#FFFFFF', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: '#E8F5E9' }}>
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>

            {shareContext ? (
              <>
                <div className="space-y-2">
                  <h2 className="font-bold text-xl text-gray-900">השיתוף אושר</h2>
                  <p className="text-base text-gray-700 leading-relaxed">
                    <strong>{shareContext.inviter_name}</strong>
                    {' '}שיתף/ה איתך את <strong>{shareContext.vehicle_label}</strong>
                  </p>
                </div>
                <div className="rounded-2xl p-4 text-right" style={{ background: shareContext.role === 'editor' ? '#E8F5E9' : '#E3F2FD' }}>
                  <p className="text-sm font-bold mb-1" style={{ color: shareContext.role === 'editor' ? '#2D5233' : '#1565C0' }}>
                    {shareContext.role === 'editor' ? 'הרשאת עורך' : 'הרשאת צופה'}
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: '#374151' }}>
                    {shareContext.role === 'editor'
                      ? 'אפשר להוסיף ולערוך טיפולים, מסמכים ופרטים. אי אפשר למחוק את הרכב או לשתף עם אחרים.'
                      : 'אפשר לראות הכל — טיפולים, מסמכים ופרטים. בלי הרשאת עריכה.'}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  {shareContext.vehicle_id && (
                    <Button onClick={() => navigate(`${createPageUrl('VehicleDetail')}?id=${shareContext.vehicle_id}`)}
                      className="w-full h-14 rounded-2xl font-bold text-base gap-2"
                      style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
                      פתח את הרכב
                    </Button>
                  )}
                  <Button onClick={() => navigate(createPageUrl('Dashboard'))}
                    variant="outline" className="w-full h-12 rounded-2xl font-bold text-sm">
                    למסך הבית
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-bold text-xl text-gray-900">{message}</h2>
                {roleInfo && (
                  <div className="rounded-2xl p-4 inline-block" style={{ background: roleInfo.bg }}>
                    <p className="text-sm font-bold" style={{ color: roleInfo.color }}>
                      הצטרפת כ{roleInfo.label} - {roleInfo.description}
                    </p>
                  </div>
                )}
                <Button onClick={() => navigate(createPageUrl('Dashboard'))}
                  className="w-full h-14 rounded-2xl font-bold text-base gap-2"
                  style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
                  למסך הבית
                </Button>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="rounded-3xl p-8 text-center space-y-5"
            style={{ background: '#FFFFFF', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: '#FEF2F2' }}>
              <XCircle className="h-10 w-10 text-red-500" />
            </div>
            <h2 className="font-bold text-xl text-gray-900">{message}</h2>
            <Button onClick={() => navigate(createPageUrl('Dashboard'))}
              variant="outline"
              className="w-full h-12 rounded-2xl font-bold text-base">
              למסך הבית
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
