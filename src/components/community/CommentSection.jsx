import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { Send, Wrench, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';

function timeAgo(date) {
  try { return formatDistanceToNow(new Date(date), { addSuffix: true, locale: he }); }
  catch { return ''; }
}

export default function CommentSection({ postId, postOwnerId, canComment, T, onCommentAdded }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const queryClient = useQueryClient();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['community_comments', postId],
    queryFn: async () => {
      const { data } = await supabase
        .from('community_comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      return data || [];
    },
    enabled: !!postId,
    staleTime: 30 * 1000,
  });

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const authorName = user.user_metadata?.full_name || user.email || 'משתמש';

      await db.community_comments.create({
        post_id: postId,
        user_id: user.id,
        author_name: authorName,
        body: text.trim(),
        is_ai: false,
      });

      // Notify post owner (if not self)
      if (postOwnerId && postOwnerId !== user.id) {
        try {
          await db.community_notifications.create({
            user_id: postOwnerId,
            post_id: postId,
            commenter_name: authorName,
          });
        } catch {}
      }

      setText('');
      queryClient.invalidateQueries({ queryKey: ['community_comments', postId] });
      onCommentAdded?.();
    } catch (err) {
      console.error('Comment send error:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}30`, background: '#FAFBFC' }}>
      {isLoading ? (
        <div className="py-4 text-center">
          <Loader2 className="w-4 h-4 animate-spin mx-auto" style={{ color: T.muted }} />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: T.muted }}>אין תגובות עדיין</p>
      ) : (
        <div className="divide-y" style={{ borderColor: `${T.border}30` }}>
          {comments.map(c => (
            <div key={c.id} className="px-4 py-2.5 flex gap-2.5" dir="rtl">
              {/* AI badge or user initial */}
              {c.is_ai ? (
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: '#FFF8E1', border: '1.5px solid #FDE68A' }}>
                  <Wrench className="w-3.5 h-3.5" style={{ color: '#D97706' }} />
                </div>
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
                  style={{ background: '#9CA3AF' }}>
                  {(c.author_name || '?')[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${c.is_ai ? 'text-amber-700' : ''}`} style={{ color: c.is_ai ? '#92400E' : '#374151' }}>
                    {c.author_name}
                  </span>
                  {c.is_ai && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#FEF3C7', color: '#92400E' }}>
                      AI
                    </span>
                  )}
                  <span className="text-[10px] mr-auto" style={{ color: '#9CA3AF' }}>{timeAgo(c.created_at)}</span>
                </div>
                <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: '#4B5563' }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add comment input */}
      {canComment && (
        <div className="flex items-center gap-2 px-3 py-2.5" dir="rtl" style={{ borderTop: `1px solid ${T.border}30` }}>
          <Input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="כתוב תגובה..."
            className="text-sm flex-1 h-9"
          />
          <button onClick={handleSend} disabled={!text.trim() || sending}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
            style={{ background: T.primary, color: '#fff' }}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
