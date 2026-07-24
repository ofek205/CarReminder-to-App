import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { withTimeout } from '@/lib/supabaseQuery';
import { useAuth } from '@/components/shared/GuestContext';
import useViewAs from '@/hooks/useViewAs';
import { toastError } from '@/lib/userErrorReport';
import { C } from '@/lib/designTokens';

/**
 * PendingInviteBanner — makes an account invitation impossible to miss.
 *
 * Why this exists: an invite to someone who ALREADY has an account takes
 * PATH A of invite_account_member_by_email — it writes an account_members
 * row with status 'ממתין' and one app_notifications row, and nothing else.
 * The invitee cannot discover it any other way, because both
 * `members_select` and `accounts_select` resolve through
 * user_account_ids(), which selects status = 'פעיל'. A pending row is
 * therefore invisible to the very person it belongs to: it is absent from
 * v_user_workspaces, and a direct account_members query returns nothing.
 *
 * So the notification is a single point of failure. Miss it, mark it read,
 * or simply not open the bell, and the invitation is unreachable — then
 * expire_pending_invites() deletes the row after 14 days without telling
 * either party, while the inviter was shown "ההזמנה נשלחה". That is the
 * "I invited them and they can't see anything" bug.
 *
 * This banner reads the same app_notifications row the bell does — the
 * only channel the invitee can actually see — and surfaces it on the page
 * they land on instead of behind an icon.
 *
 * Deliberately renders nothing while loading or on failure: it is
 * additive UI, and a spinner or error card at the top of the dashboard
 * would be worse than a quiet no-op. The invite stays reachable via the
 * notification bell either way.
 */
export default function PendingInviteBanner() {
  const { user, isGuest } = useAuth();
  const viewAs = useViewAs();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState(null);

  // Hidden during view-as: accept/decline runs as the admin's JWT, which
  // is meaningless for the target's invite. NotificationBell blocks the
  // action for the same reason — offering a button that cannot work is
  // worse than not offering it.
  const enabled = !!user?.id && !isGuest && !viewAs;

  const { data: invites = [], refetch } = useQuery({
    queryKey: ['pending-account-invites', user?.id],
    queryFn: async () => {
      const { data, error } = await withTimeout(
        supabase
          .from('app_notifications')
          .select('id, title, body, data, created_at')
          .eq('user_id', user.id)
          .eq('type', 'account_invite_offered')
          .eq('is_read', false)
          .order('created_at', { ascending: false }),
        'pending_account_invites'
      );
      if (error) throw error;
      return data || [];
    },
    enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
    retryDelay: 500,
  });

  const handle = async (invite, action) => {
    const memberId = invite.data?.member_id;
    if (!memberId) return;
    setActing(`${invite.id}-${action}`);
    try {
      const rpc = action === 'accept' ? 'accept_account_invite' : 'decline_account_invite';
      const { error } = await supabase.rpc(rpc, { p_member_id: memberId });
      if (error) throw error;

      // Mark the source notification read so the banner and the bell agree
      // — both key off is_read, so skipping this leaves the banner up
      // until the next full refetch.
      await supabase.from('app_notifications').update({ is_read: true }).eq('id', invite.id);
      window.dispatchEvent(new CustomEvent('cr:notifications-changed'));

      // On accept the membership flips to 'פעיל', which is what makes the
      // workspace appear at all — user_account_ids() only returns active
      // rows, so until this invalidation lands the switcher still has no
      // idea the account exists.
      await queryClient.invalidateQueries({ queryKey: ['user-workspaces', user.id] });
      await refetch();

      toast.success(action === 'accept' ? 'הצטרפת לחשבון בהצלחה' : 'ההזמנה נדחתה');
    } catch (e) {
      const msg = (e?.message || '').includes('invite_not_pending')
        ? 'ההזמנה כבר טופלה'
        : `שגיאה: ${e?.message || 'נסה שוב'}`;
      toastError(msg, { action: 'pending_invite_banner', err: e });
    } finally {
      setActing(null);
    }
  };

  if (!enabled || invites.length === 0) return null;

  return (
    <>
      {invites.filter(i => i.data?.member_id).map(invite => (
        <div key={invite.id}
          className="rounded-2xl p-4 flex items-start gap-3 mb-4"
          style={{
            background: C.warnBg,
            border: `1.5px solid ${C.warnBorder || C.warnDark}`,
            boxShadow: '0 2px 8px rgba(217,119,6,0.06)',
          }}
          dir="rtl"
          role="status">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: C.warnLight || C.warnBg }}>
            <UserPlus className="w-[18px] h-[18px]" style={{ color: C.warnDark }} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: C.warnDark }}>
              {invite.title || 'הוזמנת להצטרף לחשבון'}
            </p>
            {invite.body && (
              <p className="text-xs mt-0.5" style={{ color: C.gray700 }}>
                {invite.body}
              </p>
            )}

            <div className="flex gap-2 mt-2.5">
              <button
                type="button"
                onClick={() => handle(invite, 'accept')}
                disabled={!!acting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-60"
                style={{ background: '#059669', color: '#fff' }}>
                {acting === `${invite.id}-accept`
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Check className="w-3.5 h-3.5" />}
                אישור
              </button>
              <button
                type="button"
                onClick={() => handle(invite, 'decline')}
                disabled={!!acting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-60"
                style={{ background: C.errorBg, color: C.error, border: `1px solid ${C.errorBorder}` }}>
                {acting === `${invite.id}-decline`
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <X className="w-3.5 h-3.5" />}
                דחייה
              </button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
