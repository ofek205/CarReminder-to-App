import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { Send, Wrench, Loader2, Heart, Flag, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import { getAiExpertForDomain } from '@/lib/aiExpert';

function timeAgo(date) {
  try { return formatDistanceToNow(new Date(date), { addSuffix: false, locale: he }); }
  catch { return ''; }
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #2D5233, #4A8C5C)',
  'linear-gradient(135deg, #0C7B93, #14B8C8)',
  'linear-gradient(135deg, #7C3AED, #A78BFA)',
  'linear-gradient(135deg, #D97706, #FBBF24)',
  'linear-gradient(135deg, #DC2626, #F87171)',
  'linear-gradient(135deg, #0369A1, #38BDF8)',
];

export default function CommentSection({ postId, postOwnerId, postDomain, postBody, canComment: canCommentProp, T, onCommentAdded }) {
  const canComment = canCommentProp;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const queryClient = useQueryClient();

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['community_comments', postId],
    queryFn: async () => {
      try {
        // Cap comment fetch to avoid unbounded egress on popular threads.
        const { data, error } = await supabase.from('community_comments').select('*')
          .eq('post_id', postId).order('created_at', { ascending: true }).limit(200);
        if (error) throw error;
        return data || [];
      } catch { return []; }
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
      const realName = user.user_metadata?.full_name || user.email || 'משתמש';

      let authorName = realName;
      let anonymousNumber = null;

      if (anonymous) {
        try {
          const { data: numData } = await supabase.rpc('get_anonymous_number', {
            p_post_id: postId,
            p_user_id: user.id,
          });
          anonymousNumber = numData || 2;
        } catch {
          anonymousNumber = 2; // Fallback if RPC fails
        }
        authorName = `אנונימי #${anonymousNumber}`;
      }

      const userMessage = text.trim();
      await db.community_comments.create({
        post_id: postId, user_id: user.id, author_name: authorName, body: userMessage, is_ai: false,
        is_anonymous: anonymous,
        anonymous_number: anonymousNumber,
      });
      if (postOwnerId && postOwnerId !== user.id) {
        try {
          await db.community_notifications.create({ user_id: postOwnerId, post_id: postId, commenter_name: authorName });
        } catch {}
      }
      setText('');
      queryClient.invalidateQueries({ queryKey: ['community_comments', postId] });
      onCommentAdded?.();

      // If this is the post owner replying, check if Yossi AI should respond (up to 3 AI replies)
      const isPostOwner = postOwnerId === user.id;
      if (isPostOwner && !anonymous) {
        const aiCount = comments.filter(c => c.is_ai).length;
        if (aiCount < 3) {
          setAiThinking(true);
          try {
            const { aiRequest } = await import('@/lib/aiProxy');
            const expert = getAiExpertForDomain(postDomain);
            const isVessel = expert.domain === 'vessel';
            const systemPrompt = `אתה ${expert.fullName}, ${expert.role}. זו שיחת המשך בפורום. ענה ספציפית לשאלת ההמשך של השואל בקצרה (2-4 משפטים). היה חם ואישי.`;
            const conversationHistory = comments
              .filter(c => c.is_ai || c.user_id === postOwnerId)
              .slice(-4)
              .map(c => `${c.is_ai ? expert.firstName : 'השואל'}: ${c.body}`).join('\n');
            const json = await aiRequest({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 400,
              system: systemPrompt,
              messages: [{
                role: 'user',
                content: `פוסט מקורי: ${postBody || ''}\n\nשיחה עד כה:\n${conversationHistory}\n\nתגובה חדשה של השואל: ${userMessage}\n\nענה בקצרה.`,
              }],
            });
            const aiText = json?.content?.[0]?.text || '';
            if (aiText) {
              await db.community_comments.create({
                post_id: postId,
                user_id: null,
                author_name: expert.communityName,
                body: aiText.replace(/<[^>]*>/g, '').slice(0, 1000),
                is_ai: true,
              });
              queryClient.invalidateQueries({ queryKey: ['community_comments', postId] });
              onCommentAdded?.();
              // After 3rd reply, suggest moving to private AI chat
              if (aiCount + 1 >= 3) {
                setTimeout(async () => {
                  await db.community_comments.create({
                    post_id: postId,
                    user_id: null,
                    author_name: expert.communityName,
                    body: '💡 הגענו ל-3 תשובות כאן. להמשך שיחה מעמיקה יותר, אני ממליץ לעבור לצ\'אט הייעוץ הפרטי שלי. לחץ על "מומחה AI" בתפריט התחתון.',
                    is_ai: true,
                  });
                  queryClient.invalidateQueries({ queryKey: ['community_comments', postId] });
                }, 1500);
              }
            }
          } catch (err) { console.warn('AI reply error:', err?.message); }
          setAiThinking(false);
        }
      }
    } catch (err) {
      console.error('Comment send error:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-3 mb-3 rounded-xl overflow-hidden" style={{ background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
      {isLoading ? (
        <div className="py-6 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto" style={{ color: '#9CA3AF' }} /></div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-center py-5" style={{ color: '#B0B8C1' }}>אין תגובות עדיין</p>
      ) : (
        <div className="divide-y" style={{ borderColor: '#F0F0F0' }}>
          {comments.map(c => {
            const grad = AVATAR_GRADIENTS[(c.author_name || '').length % AVATAR_GRADIENTS.length];
            return (
            <div key={c.id} className="px-3 py-3">
              {c.is_ai ? (
                /* AI Comment - special card */
                <div className="rounded-xl p-3" style={{ background: '#FFFBEB', borderRight: '3px solid #FBBF24' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: '#FEF3C7' }}>
                      <Wrench className="w-3 h-3" style={{ color: '#D97706' }} />
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: '#92400E' }}>{c.author_name}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                      style={{ background: '#FDE68A', color: '#92400E' }}>AI</span>
                    <span className="text-[10px] mr-auto" style={{ color: '#D1B896' }}>{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="text-[13px] leading-relaxed" style={{ color: '#78350F' }}>{c.body}</p>
                </div>
              ) : (
                /* User Comment */
                <div className="flex gap-2.5">
                  {c.is_anonymous ? (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold"
                      style={{ background: '#E5E7EB', color: '#6B7280' }}>
                      {c.anonymous_number ? `#${c.anonymous_number}` : '?'}
                    </div>
                  ) : (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold text-white"
                      style={{ background: grad }}>
                      {(c.author_name || '?')[0]}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-bold" style={{ color: c.is_anonymous ? '#6B7280' : '#374151' }}>
                        {c.is_anonymous ? `אנונימי${c.anonymous_number ? ` #${c.anonymous_number}` : ''}` : c.author_name}
                      </span>
                      <span className="text-[10px] mr-auto" style={{ color: '#C4C4C4' }}>{timeAgo(c.created_at)}</span>
                      {canComment && (
                        <button className="p-1 rounded-full hover:bg-gray-100 transition-all"
                          onClick={() => {
                            try {
                              const reports = JSON.parse(localStorage.getItem('reported_comments') || '[]');
                              if (!reports.includes(c.id)) { reports.push(c.id); localStorage.setItem('reported_comments', JSON.stringify(reports)); }
                              toast.success('הדיווח נשלח. תודה!');
                            } catch {}
                          }}>
                          <Flag className="w-2.5 h-2.5" style={{ color: '#D1D5DB' }} />
                        </button>
                      )}
                    </div>
                    <p className="text-[13px] leading-relaxed" style={{ color: '#4B5563' }}>{c.body}</p>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* AI thinking indicator */}
      {aiThinking && (
        <div className="px-3 py-2 flex items-center gap-2" style={{ background: '#FFFBEB', borderTop: '1px solid #FEF3C7' }}>
          <Wrench className="w-3.5 h-3.5 animate-pulse" style={{ color: '#D97706' }} />
          <span className="text-[11px] font-medium" style={{ color: '#92400E' }}>{getAiExpertForDomain(postDomain).firstName} חושב על תשובה...</span>
        </div>
      )}

      {/* Add comment input */}
      {canComment && (
        <div style={{ background: '#fff', borderTop: '1px solid #F0F0F0' }}>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <button onClick={() => setAnonymous(a => !a)}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all"
              style={{
                background: anonymous ? T.primary : '#F3F4F6',
                color: anonymous ? '#fff' : '#9CA3AF',
              }}
              title={anonymous ? 'תגובה אנונימית פעילה' : 'כתוב אנונימית'}>
              <UserX className="w-3.5 h-3.5" />
            </button>
            <Input value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={anonymous ? 'תגובה אנונימית...' : 'כתוב תגובה...'}
              className="text-[13px] flex-1 h-9 rounded-full px-4"
              style={{ background: '#F3F4F6', border: '1px solid #E5E7EB' }} />
            <button onClick={handleSend} disabled={!text.trim() || sending}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all disabled:opacity-30"
              style={{ background: T.primary, color: '#fff' }}>
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 send-fly" style={{ transform: 'scaleX(-1)' }} />}
            </button>
          </div>
          {anonymous && (
            <div className="px-3 pb-2 text-[10px]" style={{ color: '#92400E' }}>
              ✓ תגובה זו תפורסם כ"אנונימי #מספר" - השם שלך לא יוצג
            </div>
          )}
        </div>
      )}
    </div>
  );
}
