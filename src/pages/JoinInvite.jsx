import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from "@/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function JoinInvite() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function join() {
      // Guard: token must be present and non-empty
      if (!token || typeof token !== 'string' || token.trim().length < 10) {
        setStatus('error');
        setMessage('קישור הזמנה לא תקין');
        return;
      }

      const user = await supabase.auth.getUser().then(r => r.data.user);

      // Find invite
      const invites = await /* TODO: migrate */ [].filter && db.vehicles.filter({ token, status: 'פעיל' });
      if (invites.length === 0) {
        setStatus('error');
        setMessage('ההזמנה לא נמצאה או שפג תוקפה');
        return;
      }

      const invite = invites[0];

      // Check expiry
      if (new Date(invite.expires_at) < new Date()) {
        await base44.entities.Invite.update(invite.id, { status: 'פג תוקף' });
        setStatus('error');
        setMessage('ההזמנה פגה תוקף');
        return;
      }

      // Check max uses — re-fetch fresh state to mitigate race condition
      // Two concurrent requests could both pass a stale uses_count check.
      // By re-fetching just before writing, we reduce (but cannot eliminate
      // without a backend atomic transaction) the race window.
      const freshInvites = await /* TODO: migrate */ [].filter && db.vehicles.filter({ token, status: 'פעיל' });
      const freshInvite = freshInvites[0];
      if (!freshInvite || freshInvite.uses_count >= freshInvite.max_uses) {
        setStatus('error');
        setMessage('ההזמנה כבר מומשה');
        return;
      }

      // Check if already a member
      const existing = await /* TODO: migrate */ [].filter && db.vehicles.filter({
        account_id: invite.account_id,
        user_id: user.id,
        status: 'פעיל',
      });
      if (existing.length > 0) {
        setStatus('error');
        setMessage('אתה כבר חבר בחשבון זה');
        return;
      }

      // Join!
      await base44.entities.AccountMember.create({
        account_id: invite.account_id,
        user_id: user.id,
        role: invite.role_to_assign,
        status: 'פעיל',
        joined_at: new Date().toISOString(),
      });

      // Increment usage counter immediately after join
      // NOTE: A true atomic check-and-increment requires backend support.
      // This double-check significantly reduces but does not fully eliminate
      // the race condition — backend transaction is the complete fix.
      await base44.entities.Invite.update(freshInvite.id, {
        uses_count: freshInvite.uses_count + 1,
        // Mark as used if this was the last allowed use
        ...(freshInvite.uses_count + 1 >= freshInvite.max_uses ? { status: 'מומש' } : {}),
      });

      // Create default reminder settings if needed
      const settings = await /* TODO: migrate */ [].filter && db.vehicles.filter({ user_id: user.id });
      if (settings.length === 0) {
        await base44.entities.ReminderSettings.create({
          user_id: user.id,
          remind_test_days_before: 14,
          remind_insurance_days_before: 14,
          remind_maintenance_days_before: 7,
          overdue_repeat_every_days: 3,
          daily_job_hour: 8,
        });
      }

      setStatus('success');
      setMessage('הצטרפת בהצלחה לחשבון!');
    }
    join();
  }, [token]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Card className="p-8 max-w-sm w-full text-center border border-gray-100">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-amber-600 mx-auto mb-4" />
            <p className="text-gray-600">מעבד את ההזמנה...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
            <p className="text-lg font-semibold text-gray-900 mb-2">{message}</p>
            <Button onClick={() => navigate(createPageUrl('Dashboard'))} className="bg-amber-600 hover:bg-amber-700 text-white mt-4">
              למסך הבית שלי
            </Button>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-lg font-semibold text-gray-900 mb-2">{message}</p>
            <Button onClick={() => navigate(createPageUrl('Dashboard'))} variant="outline" className="mt-4">
              למסך הבית שלי
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}