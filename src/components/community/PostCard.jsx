import React, { useState } from 'react';
import { MessageCircle, ChevronDown, ChevronUp, Car, Ship, Trash2, Bookmark, BookmarkCheck, ThumbsUp, Share2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import { useAuth } from '../shared/GuestContext';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import CommentSection from './CommentSection';

function timeAgo(date) {
  try { return formatDistanceToNow(new Date(date), { addSuffix: false, locale: he }); }
  catch { return ''; }
}

function Avatar({ name, size = 'w-10 h-10 text-sm' }) {
  const letters = (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2);
  const colors = ['#2D5233', '#0C7B93', '#7C3AED', '#D97706', '#DC2626', '#0369A1'];
  const color = colors[(name || '').length % colors.length];
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: color }}>{letters}</div>
  );
}

const EMOJIS = ['👍', '❤️', '🔥', '👀'];

export default function PostCard({ post, T, canComment, commentCount, vehicle, onCommentAdded, interactions }) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { user, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const isLong = post.body?.length > 200;
  const isOwner = user?.id === post.user_id;
  const canInteract = !isGuest && !!user;

  // Interactions data (passed from parent)
  // Unified: user can EITHER like (👍) OR pick an emoji — not both
  const liked = interactions?.liked || false;
  const likeCount = interactions?.likeCount || 0;
  const saved = interactions?.saved || false;
  const myReaction = interactions?.myReaction || null;
  const reactionCounts = interactions?.reactionCounts || {};
  // User's current state: 'like' if liked, emoji string if reacted, null if neither
  const myChoice = myReaction || (liked ? '👍' : null);

  // Unified like/reaction: user can do ONE thing — like (👍) or emoji reaction
  const handleQuickLike = async () => {
    if (!canInteract) return;
    try {
      if (liked) {
        // Remove like
        const { data } = await supabase.from('community_likes').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
        if (data) await supabase.from('community_likes').delete().eq('id', data.id);
      } else {
        // Add like + remove emoji if exists
        if (myReaction) {
          const { data } = await supabase.from('community_reactions').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
          if (data) await supabase.from('community_reactions').delete().eq('id', data.id);
        }
        await supabase.from('community_likes').insert({ user_id: user.id, post_id: post.id });
      }
      queryClient.invalidateQueries({ queryKey: ['community_interactions'] });
    } catch (e) { console.error('Like error:', e); }
  };

  const handleReaction = async (emoji) => {
    if (!canInteract) return;
    setShowEmojis(false);
    try {
      // Remove like first if exists
      if (liked) {
        const { data } = await supabase.from('community_likes').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
        if (data) await supabase.from('community_likes').delete().eq('id', data.id);
      }
      if (myReaction === emoji) {
        // Toggle off — remove reaction
        const { data } = await supabase.from('community_reactions').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
        if (data) await supabase.from('community_reactions').delete().eq('id', data.id);
      } else if (myReaction) {
        // Switch emoji
        await supabase.from('community_reactions').update({ emoji }).eq('user_id', user.id).eq('post_id', post.id);
      } else {
        // New emoji reaction
        await supabase.from('community_reactions').insert({ user_id: user.id, post_id: post.id, emoji });
      }
      queryClient.invalidateQueries({ queryKey: ['community_interactions'] });
    } catch (e) { console.error('Reaction error:', e); }
  };

  const handleSave = async () => {
    if (!canInteract) return;
    try {
      if (saved) {
        const { data } = await supabase.from('community_saved').select('id').eq('user_id', user.id).eq('post_id', post.id).single();
        if (data) await supabase.from('community_saved').delete().eq('id', data.id);
      } else {
        await supabase.from('community_saved').insert({ user_id: user.id, post_id: post.id });
      }
      queryClient.invalidateQueries({ queryKey: ['community_interactions'] });
    } catch (e) { console.error('Save error:', e); }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/Community?post=${post.id}`;
    const text = post.body?.slice(0, 100) + '...';
    if (navigator.share) {
      try { await navigator.share({ title: 'CarReminder — קהילה', text, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      alert('הקישור הועתק!');
    }
  };

  const handleDelete = async () => {
    if (!confirm('למחוק את השאלה?')) return;
    setDeleting(true);
    try {
      await db.community_posts.delete(post.id);
      queryClient.invalidateQueries({ queryKey: ['community_posts', post.domain] });
    } catch { alert('שגיאה במחיקה'); }
    setDeleting(false);
  };

  const totalReactions = Object.values(reactionCounts).reduce((a, b) => a + b, 0);

  return (
    <div dir="rtl" style={{ background: '#fff', borderBottom: '8px solid #F5F5F5' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Avatar name={post.author_name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold" style={{ color: '#1F2937' }}>{post.author_name}</span>
            {vehicle && (
              <>
                <span className="text-[11px]" style={{ color: '#D1D5DB' }}>›</span>
                <span className="text-[11px] font-medium" style={{ color: T.primary }}>
                  {vehicle.nickname || vehicle.manufacturer}
                </span>
              </>
            )}
          </div>
          <p className="text-[11px]" style={{ color: '#9CA3AF' }}>{timeAgo(post.created_at)}</p>
        </div>
        {isOwner && (
          <button onClick={handleDelete} disabled={deleting}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-50 transition-all">
            <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 pb-2">
        <p className={`text-[14px] leading-relaxed ${!expanded && isLong ? 'line-clamp-4' : ''}`} style={{ color: '#374151' }}>
          {post.body}
        </p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-[13px] font-bold mt-1" style={{ color: T.primary }}>
            {expanded ? 'הצג פחות' : 'קראו עוד'}
          </button>
        )}
      </div>

      {/* Image — click to expand */}
      {post.image_url && (
        <div className="w-full relative cursor-pointer" onClick={() => setShowFullImage(true)}>
          <img src={post.image_url} alt="" className="w-full object-cover" style={{ maxHeight: '250px' }} />
          <div className="absolute bottom-2 left-2 px-2 py-1 rounded-lg text-[10px] font-bold"
            style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}>
            לחץ להגדלה
          </div>
        </div>
      )}

      {/* Full image lightbox */}
      {showFullImage && post.image_url && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
          onClick={() => setShowFullImage(false)}>
          <button onClick={() => setShowFullImage(false)}
            className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center z-10">
            <span className="text-white text-xl">✕</span>
          </button>
          <img src={post.image_url} alt="" className="max-w-[95vw] max-h-[90vh] object-contain rounded-lg" />
        </div>
      )}

      {/* Vehicle chip */}
      {vehicle && (
        <div className="px-4 py-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold"
            style={{ background: T.light || '#F3F4F6', color: T.primary, border: `1px solid ${T.border}` }}>
            {post.domain === 'vessel' ? <Ship className="w-3 h-3" /> : <Car className="w-3 h-3" />}
            {[vehicle.manufacturer, vehicle.model, vehicle.year].filter(Boolean).join(' · ')}
          </div>
        </div>
      )}

      {/* Reaction summary row */}
      {(likeCount > 0 || totalReactions > 0 || commentCount > 0) && (
        <div className="flex items-center gap-2 px-4 py-1.5 text-[11px]" style={{ color: '#9CA3AF' }}>
          {likeCount > 0 && <span>👍 {likeCount}</span>}
          {EMOJIS.filter(e => e !== '👍').map(e => reactionCounts[e] ? <span key={e}>{e} {reactionCounts[e]}</span> : null)}
          <span className="mr-auto">{commentCount > 0 ? `${commentCount} תגובות` : ''}</span>
        </div>
      )}

      {/* AI thinking */}
      {commentCount === 0 && (
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-sm animate-pulse">🔧</span>
          <span className="text-[11px] font-medium" style={{ color: '#92400E' }}>
            {post.domain === 'vessel' ? 'יוסי מומחה כלי שייט חושב...' : 'יוסי המוסכניק חושב...'}
          </span>
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="flex items-center px-2 py-1" style={{ borderTop: '1px solid #F3F4F6' }}>
        {/* Like / Reaction — unified: tap = 👍, long-press or second tap = emoji picker */}
        <div className="flex-1 relative">
          <button
            onClick={() => {
              if (!canInteract) return;
              if (showEmojis) { setShowEmojis(false); return; }
              if (myChoice) {
                // Already reacted — toggle off
                if (liked) handleQuickLike();
                else if (myReaction) handleReaction(myReaction);
              } else {
                handleQuickLike();
              }
            }}
            onContextMenu={(e) => { e.preventDefault(); if (canInteract) setShowEmojis(!showEmojis); }}
            onDoubleClick={() => { if (canInteract) setShowEmojis(!showEmojis); }}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12px] font-medium transition-all active:scale-[0.95]"
            style={{ color: myChoice ? '#2563EB' : '#6B7280' }}>
            {myReaction
              ? <span className="text-base">{myReaction}</span>
              : <ThumbsUp className="w-4 h-4" fill={liked ? '#2563EB' : 'none'} />
            }
            {(likeCount + totalReactions) > 0 && <span>{likeCount + totalReactions}</span>}
          </button>
          {showEmojis && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowEmojis(false)} />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-40 flex gap-1.5 px-3 py-2 rounded-full bg-white shadow-xl border"
                style={{ borderColor: '#E5E7EB' }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => handleReaction(e)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xl transition-all hover:scale-125 ${myReaction === e ? 'bg-blue-100 scale-110' : ''}`}>
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Comment */}
        <button onClick={() => setShowComments(!showComments)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12px] font-medium transition-all active:scale-[0.95]"
          style={{ color: showComments ? T.primary : '#6B7280' }}>
          <MessageCircle className="w-4 h-4" />
          {commentCount > 0 && <span>{commentCount}</span>}
        </button>

        {/* Share */}
        <button onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12px] font-medium transition-all active:scale-[0.95]"
          style={{ color: '#6B7280' }}>
          <Share2 className="w-4 h-4" />
        </button>

        {/* Save */}
        <button onClick={handleSave}
          className="flex items-center justify-center w-10 py-2.5 rounded-lg transition-all active:scale-[0.95]">
          {saved
            ? <BookmarkCheck className="w-4 h-4" style={{ color: T.primary }} />
            : <Bookmark className="w-4 h-4" style={{ color: '#D1D5DB' }} />
          }
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <CommentSection postId={post.id} postOwnerId={post.user_id} canComment={canComment} T={T} onCommentAdded={onCommentAdded} />
      )}
    </div>
  );
}
