import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/shared/GuestContext';
import { toast } from 'sonner';
import { Ban, RotateCcw, Loader2 } from 'lucide-react';
import { C } from '@/lib/designTokens';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

function timeAgo(date) {
  try { return formatDistanceToNow(new Date(date), { addSuffix: true, locale: he }); }
  catch { return ''; }
}

/**
 * BlockedUsersList — surfaces the current user's blocked list with an
 * unblock affordance per row. Required by Apple Guideline 1.2: once a
 * user can block, they must also be able to undo the block.
 *
 * Reads from blocked_users (RLS scopes rows to blocker_id = auth.uid()).
 * Deletes by row id — also RLS-scoped, so a user can only delete their
 * own block rows.
 */
export default function BlockedUsersList() {
  const { user, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [unblockingId, setUnblockingId] = React.useState(null);

  const { data: blocks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['blocked_users', user?.id],
    enabled: !!user && !isGuest,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocked_users')
        .select('id, blocked_id, blocked_name, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    staleTime: 30 * 1000,
    retry: 1,
  });

  const handleUnblock = async (blockId, blockedName) => {
    const safeName = String(blockedName || '').replace(/[^\p{L}\p{N} .\-#]/gu, '').slice(0, 60) || 'משתמש';
    if (!confirm(`להסיר חסימה של ${safeName}? תראו שוב פוסטים ותגובות שלהם.`)) return;
    setUnblockingId(blockId);
    try {
      const { error } = await supabase.from('blocked_users').delete().eq('id', blockId);
      if (error) {
        console.warn('Unblock failed:', error.message);
        toast.error('שגיאה בהסרת החסימה');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['blocked_users'] });
      await queryClient.invalidateQueries({ queryKey: ['community_posts'] });
      toast.success('החסימה הוסרה');
    } catch (e) {
      console.warn('Unblock network error:', e?.message);
      toast.error('שגיאה ברשת');
    } finally {
      setUnblockingId(null);
    }
  };

  if (isGuest || !user) return null;

  if (isLoading) {
    return (
      <div className="rounded-2xl p-5 flex items-center justify-center gap-2"
        style={{ background: '#fff', border: `1px solid ${C.primary}20` }}>
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: C.muted }} />
        <span className="text-sm" style={{ color: C.muted }}>טוען...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl p-5" style={{ background: '#fff', border: '1px solid #FECACA' }}>
        <p className="text-sm font-semibold mb-3" style={{ color: '#DC2626' }}>שגיאה בטעינת רשימת החסומים</p>
        <button onClick={() => refetch()}
          className="text-xs font-bold px-3 py-1.5 rounded-lg"
          style={{ background: '#DC2626', color: '#fff' }}>
          נסה שוב
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: '#fff', border: `1px solid ${C.primary}20` }}>
      {/* Section header */}
      <div className="px-4 py-3 flex items-center gap-2.5"
        style={{ background: `${C.primary}06`, borderBottom: `1px solid ${C.primary}15` }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${C.primary}15` }}>
          <Ban className="w-4 h-4" style={{ color: C.primary }} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: C.text }}>משתמשים חסומים</p>
          <p className="text-[11px]" style={{ color: C.muted }}>
            {blocks.length === 0 ? 'אין משתמשים חסומים' : `${blocks.length} משתמש${blocks.length === 1 ? '' : 'ים'} בחסימה`}
          </p>
        </div>
      </div>

      {/* List or empty state */}
      {blocks.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm" style={{ color: C.muted }}>
            כשתחסמו משתמש בקהילה, הוא יופיע כאן.
          </p>
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: `${C.primary}10` }}>
          {blocks.map(b => {
            const isUnblocking = unblockingId === b.id;
            return (
              <li key={b.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ background: '#F3F4F6', color: '#6B7280' }}>
                  {(b.blocked_name || '?').trim().charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.text }}>
                    {b.blocked_name || 'משתמש'}
                  </p>
                  <p className="text-[11px]" style={{ color: C.muted }}>
                    נחסם {timeAgo(b.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleUnblock(b.id, b.blocked_name)}
                  disabled={isUnblocking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.95] disabled:opacity-50 flex-shrink-0"
                  style={{ background: `${C.primary}10`, color: C.primary }}>
                  {isUnblocking
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RotateCcw className="w-3.5 h-3.5" />}
                  {isUnblocking ? 'מסיר...' : 'בטל'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
