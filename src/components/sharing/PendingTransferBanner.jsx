/**
 * PendingTransferBanner — what the seller sees while an ownership offer is open.
 *
 * ⚠️ THIS IS NOT DECORATION. Sending an offer FREEZES the vehicle's history in
 * the database: maintenance_logs and accidents both carry a trigger that
 * refuses client writes while a transfer is pending, so what was promised is
 * what arrives. Without this banner the seller meets that freeze as a bare
 * `vehicle_history_frozen` error on a save they expected to work, with nothing
 * on screen explaining why and no way out — the offer sits for seven days and
 * the vehicle is unusable for all of them.
 *
 * So the banner has three jobs, in this order of importance:
 *   1. Say the vehicle is frozen, BEFORE the user discovers it by being refused.
 *   2. Give the way out. Cancelling is what unfreezes it.
 *   3. Say who it was sent to and until when.
 *
 * Renders nothing at all when there is no open offer, which is almost always.
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dal } from '@/lib/dal';
import { withTimeout } from '@/lib/supabaseQuery';
import { ArrowLeftRight, Loader2, Snowflake } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@/lib/userErrorReport';
import { C } from '@/lib/designTokens';

const fmtDate = (d) => {
  if (!d) return null;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString('he-IL');
};

export default function PendingTransferBanner({ vehicleId, isOwner }) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  const { data: pending, isError, refetch } = useQuery({
    queryKey: ['vehicle-transfers', vehicleId],
    queryFn: async () => {
      // withTimeout even though this goes through the DAL rather than a bare
      // supabase call: the check-query-timeouts gate only recognises literal
      // supabase.from/.rpc, but a hung RPC leaves isLoading true forever just
      // the same, and an eternal spinner is exactly what that gate exists to
      // prevent.
      const { data, error } = await withTimeout(
        dal.run('vehicleTransfer.list', { vehicleId }),
        'vehicle_transfers_list'
      );
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      // Only an offer that is still live. An expired row keeps status
      // 'pending' until something sweeps it, and the freeze trigger already
      // ignores those, so the banner must ignore them too or it would claim a
      // freeze that is not in force.
      return rows.find(r => r.status === 'pending' && new Date(r.expires_at) > new Date()) || null;
    },
    enabled: !!vehicleId && !!isOwner,
    retry: 1,
    retryDelay: 500,
    staleTime: 30_000,
  });

  const cancel = async () => {
    setCancelling(true);
    try {
      const { error } = await dal.run('vehicleTransfer.cancel', { transferId: pending.id });
      if (error) {
        const code = (error.message || '').match(/[a-z_]+/)?.[0] || '';
        toastError(
          code === 'transfer_not_pending'
            ? 'ההצעה כבר טופלה'
            : 'לא הצלחנו לבטל את ההצעה. נסה/י שוב.',
          { action: 'vehicle_transfer_cancel', err: error },
        );
        return;
      }
      toast.success('ההצעה בוטלה, הרכב שוב פתוח לעריכה');
      queryClient.invalidateQueries({ queryKey: ['vehicle-transfers', vehicleId] });
    } catch (e) {
      toastError('אירעה שגיאה. נסה/י שוב.', { action: 'vehicle_transfer_cancel_exception', err: e });
    } finally {
      setCancelling(false);
    }
  };

  // A failed lookup is shown rather than swallowed. Staying silent here would
  // leave a seller whose vehicle IS frozen with no banner and no explanation,
  // which is the exact situation this component exists to prevent.
  if (isError) {
    return (
      <div className="rounded-2xl p-3 mb-3 flex items-center justify-between gap-2"
        style={{ background: C.grayBg, border: `1px solid ${C.gray200}` }} dir="rtl">
        <span className="text-xs" style={{ color: C.gray500 }}>
          לא הצלחנו לבדוק אם יש הצעת העברה פתוחה
        </span>
        <button type="button" onClick={() => refetch()}
          className="text-xs font-bold shrink-0" style={{ color: C.primary }}>
          נסה שוב
        </button>
      </div>
    );
  }

  if (!pending) return null;

  const expires = fmtDate(pending.expires_at);

  return (
    <div className="rounded-2xl p-4 mb-3 space-y-3" dir="rtl"
      style={{ background: C.warnBg, border: `1px solid ${C.warn}33` }}>
      <div className="flex items-start gap-2.5">
        <ArrowLeftRight className="w-5 h-5 shrink-0 mt-0.5" style={{ color: C.warn }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold" style={{ color: C.gray800 }}>הצעת העברה ממתינה לאישור</p>
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: C.gray700 }}>
            נשלחה אל <span className="font-bold" dir="ltr">{pending.to_email}</span>
            {expires ? ` ותקפה עד ${expires}` : ''}.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl p-2.5" style={{ background: '#FFFFFF99' }}>
        <Snowflake className="w-4 h-4 shrink-0 mt-0.5" style={{ color: C.gray500 }} />
        <p className="text-xs leading-relaxed" style={{ color: C.gray700 }}>
          עד שההצעה תיענה או תבוטל אי אפשר להוסיף או לערוך טיפולים ותאונות ברכב הזה,
          כדי שמה שהובטח יהיה בדיוק מה שיתקבל.
        </p>
      </div>

      <button type="button" onClick={cancel} disabled={cancelling}
        className="w-full h-10 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        style={{ background: '#FFFFFF', color: C.gray800, border: `1px solid ${C.gray200}` }}>
        {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
        ביטול ההצעה
      </button>
    </div>
  );
}
