import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2, Users, LogIn } from "lucide-react";
import { C } from '@/lib/designTokens';
import { ROLE_INFO } from '@/lib/permissions';

export default function JoinInvite() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, success, error, needsAuth
  const [message, setMessage] = useState('');
  const [assignedRole, setAssignedRole] = useState('');

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

    try {
      // Find invite by token
      const invites = await db.invites.filter({ token, status: 'פעיל' });
      if (invites.length === 0) {
        setStatus('error');
        setMessage('ההזמנה לא נמצאה או שפג תוקפה');
        return;
      }

      const invite = invites[0];

      // Check expiry
      if (new Date(invite.expires_at) < new Date()) {
        await db.invites.update(invite.id, { status: 'פג תוקף' });
        setStatus('error');
        setMessage('ההזמנה פגה תוקף');
        return;
      }

      // Check max uses (re-fetch for race condition mitigation)
      const freshInvites = await db.invites.filter({ token, status: 'פעיל' });
      const freshInvite = freshInvites[0];
      if (!freshInvite || freshInvite.uses_count >= freshInvite.max_uses) {
        setStatus('error');
        setMessage('ההזמנה כבר מומשה');
        return;
      }

      // Check if already a member
      const existing = await db.account_members.filter({
        account_id: invite.account_id,
        user_id: user.id,
        status: 'פעיל',
      });
      if (existing.length > 0) {
        setStatus('error');
        setMessage('אתה כבר חבר בחשבון זה');
        return;
      }

      // Validate role — only allow safe roles, never 'בעלים' via invite
      const ALLOWED_INVITE_ROLES = ['מנהל', 'שותף'];
      const safeRole = ALLOWED_INVITE_ROLES.includes(invite.role_to_assign) ? invite.role_to_assign : 'שותף';

      // Join the account!
      await db.account_members.create({
        account_id: invite.account_id,
        user_id: user.id,
        role: safeRole,
        status: 'פעיל',
        joined_at: new Date().toISOString(),
        vehicle_ids: invite.vehicle_ids || null, // null = all vehicles, array = specific
      });

      // Increment usage counter
      await db.invites.update(freshInvite.id, {
        uses_count: freshInvite.uses_count + 1,
        ...(freshInvite.uses_count + 1 >= freshInvite.max_uses ? { status: 'מומש' } : {}),
      });

      setAssignedRole(invite.role_to_assign);
      setStatus('success');
      const vehicleCount = invite.vehicle_ids?.length;
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
    // Redirect to auth with return URL — sanitize token to prevent injection
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
            <h2 className="font-black text-xl text-gray-900">הוזמנת להצטרף לחשבון!</h2>
            <p className="text-base text-gray-500">{message}</p>
            <Button onClick={goToAuth}
              className="w-full h-14 rounded-2xl font-bold text-base gap-2"
              style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
              <LogIn className="h-5 w-5" />
              התחבר / הירשם
            </Button>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="rounded-3xl p-8 text-center space-y-5"
            style={{ background: '#FFFFFF', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto"
              style={{ background: '#E8F5E9' }}>
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="font-black text-xl text-gray-900">{message}</h2>
            {roleInfo && (
              <div className="rounded-2xl p-4 inline-block" style={{ background: roleInfo.bg }}>
                <p className="text-sm font-bold" style={{ color: roleInfo.color }}>
                  הצטרפת כ{roleInfo.label} — {roleInfo.description}
                </p>
              </div>
            )}
            <Button onClick={() => navigate(createPageUrl('Dashboard'))}
              className="w-full h-14 rounded-2xl font-bold text-base gap-2"
              style={{ background: C.grad, color: 'white', boxShadow: `0 6px 24px ${C.primary}40` }}>
              למסך הבית
            </Button>
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
            <h2 className="font-black text-xl text-gray-900">{message}</h2>
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
