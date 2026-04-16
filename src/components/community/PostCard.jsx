import React, { useState } from 'react';
import { MessageCircle, Car, Ship, Bike, Truck, Trash2, Bookmark, BookmarkCheck, ThumbsUp, Share2, Flag, Ban, MoreHorizontal, Wrench, Pencil, X as XIcon, Check as CheckIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getVehicleCategory } from '@/lib/designTokens';
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

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #2D5233, #4A8C5C)',
  'linear-gradient(135deg, #0C7B93, #14B8C8)',
  'linear-gradient(135deg, #7C3AED, #A78BFA)',
  'linear-gradient(135deg, #D97706, #FBBF24)',
  'linear-gradient(135deg, #DC2626, #F87171)',
  'linear-gradient(135deg, #0369A1, #38BDF8)',
];

function Avatar({ name, size = 40, isAnonymous = false, anonymousNumber = null }) {
  if (isAnonymous) {
    return (
      <div className="rounded-full flex items-center justify-center font-bold shrink-0"
        style={{ width: size, height: size, background: '#E5E7EB', color: '#6B7280', fontSize: size * 0.3 }}>
        {anonymousNumber ? `#${anonymousNumber}` : '?'}
      </div>
    );
  }
  const letters = (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2);
  const grad = AVATAR_GRADIENTS[(name || '').length % AVATAR_GRADIENTS.length];
  return (
    <div className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{ width: size, height: size, background: grad, fontSize: size * 0.35 }}>{letters}</div>
  );
}

const EMOJIS = ['👍', '❤️', '🔥', '👀'];

export default function PostCard({ post, T, canComment, commentCount, vehicle, onCommentAdded, interactions }) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.body || '');
  const [savingEdit, setSavingEdit] = useState(false);
  const { user, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const isLong = post.body?.length > 200;
  const isOwner = user?.id === post.user_id;
  const canInteract = !isGuest && !!user;

  const liked = interactions?.liked || false;
  const likeCount = interactions?.likeCount || 0;
  const saved = interactions?.saved || false;
  const myReaction = interactions?.myReaction || null;
  const reactionCounts = interactions?.reactionCounts || {};
  const myChoice = myReaction || (liked ? '👍' : null);

  const handleQuickLike = async () => {
    if (!canInteract) return;
    try {
      if (liked) {
        const { data } = await supabase.from('community_likes').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
        if (data) await supabase.from('community_likes').delete().eq('id', data.id);
      } else {
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
      if (liked) {
        const { data } = await supabase.from('community_likes').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
        if (data) await supabase.from('community_likes').delete().eq('id', data.id);
      }
      if (myReaction === emoji) {
        const { data } = await supabase.from('community_reactions').select('id').eq('user_id', user.id).eq('post_id', post.id).maybeSingle();
        if (data) await supabase.from('community_reactions').delete().eq('id', data.id);
      } else if (myReaction) {
        await supabase.from('community_reactions').update({ emoji }).eq('user_id', user.id).eq('post_id', post.id);
      } else {
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
      try { await navigator.share({ title: 'CarReminder - קהילה', text, url }); } catch {}
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

  const handleSaveEdit = async () => {
    const trimmed = editText.trim();
    if (trimmed.length < 10) { alert('יש לכתוב לפחות 10 תווים'); return; }
    if (trimmed === post.body) { setEditing(false); return; }
    setSavingEdit(true);
    try {
      await supabase.from('community_posts').update({ body: trimmed }).eq('id', post.id);
      queryClient.invalidateQueries({ queryKey: ['community_posts', post.domain] });
      setEditing(false);
    } catch (err) {
      alert('שגיאה בעדכון: ' + (err?.message || 'נסה שוב'));
    } finally { setSavingEdit(false); }
  };

  const cancelEdit = () => {
    setEditText(post.body || '');
    setEditing(false);
  };

  const totalReactions = Object.values(reactionCounts).reduce((a, b) => a + b, 0);

  // Vehicle icon
  const ICON_MAP = { vessel: Ship, motorcycle: Bike, truck: Truck, car: Car };
  const vCat = vehicle ? getVehicleCategory(vehicle.vehicle_type, vehicle.nickname, vehicle.manufacturer) : null;
  const VIcon = vCat ? (ICON_MAP[vCat] || Car) : null;

  return (
    <div dir="rtl" className="rounded-2xl overflow-hidden"
      style={{ background: '#fff', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-2">
        <Avatar name={post.author_name} size={40} isAnonymous={post.is_anonymous} anonymousNumber={post.anonymous_number} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold" style={{ color: '#1F2937' }}>
              {post.is_anonymous ? `אנונימי${post.anonymous_number ? ` #${post.anonymous_number}` : ''}` : post.author_name}
            </span>
            {!post.is_anonymous && vehicle && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: T.light || '#F3F4F6', color: T.primary }}>
                {VIcon && <VIcon className="w-2.5 h-2.5" />}
                {vehicle.nickname || vehicle.manufacturer}
              </span>
            )}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: '#9CA3AF' }}>{timeAgo(post.created_at)}</p>
        </div>

        {(isOwner || canInteract) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-all shrink-0 mt-0.5">
                <MoreHorizontal className="w-4 h-4" style={{ color: '#9CA3AF' }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" dir="rtl" className="w-44">
              {isOwner && (
                <>
                  <DropdownMenuItem onClick={() => { setEditText(post.body || ''); setEditing(true); }}
                    className="gap-2 text-sm font-medium cursor-pointer">
                    <Pencil className="w-4 h-4" /> ערוך פוסט
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} disabled={deleting}
                    className="gap-2 text-sm font-medium cursor-pointer text-red-600">
                    <Trash2 className="w-4 h-4" /> מחק פוסט
                  </DropdownMenuItem>
                </>
              )}
              {!isOwner && canInteract && (
                <>
                  <DropdownMenuItem onClick={() => {
                    try {
                      const reports = JSON.parse(localStorage.getItem('reported_posts') || '[]');
                      if (!reports.includes(post.id)) { reports.push(post.id); localStorage.setItem('reported_posts', JSON.stringify(reports)); }
                      alert('הדיווח נשלח. תודה!');
                    } catch {}
                  }} className="gap-2 text-sm font-medium cursor-pointer">
                    <Flag className="w-4 h-4" /> דווח על תוכן
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    if (!confirm(`לחסום את ${post.author_name}? לא תראה את הפוסטים שלו.`)) return;
                    try {
                      const blocked = JSON.parse(localStorage.getItem('blocked_users') || '[]');
                      if (!blocked.includes(post.user_id)) { blocked.push(post.user_id); localStorage.setItem('blocked_users', JSON.stringify(blocked)); }
                      queryClient.invalidateQueries({ queryKey: ['community_posts'] });
                    } catch {}
                  }} className="gap-2 text-sm font-medium cursor-pointer text-red-600">
                    <Ban className="w-4 h-4" /> חסום משתמש
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : <div className="w-8 h-8 shrink-0" />}
      </div>

      {/* Body */}
      <div className="px-4 pb-3">
        {editing ? (
          <div className="space-y-2">
            <textarea value={editText} onChange={e => setEditText(e.target.value.slice(0, 2000))}
              rows={4} maxLength={2000}
              className="w-full text-sm leading-relaxed rounded-xl p-3 outline-none focus:ring-2"
              style={{ background: '#FAFAFA', border: '1px solid #E5E7EB', color: '#374151' }} />
            <div className="flex items-center gap-2">
              <button onClick={handleSaveEdit} disabled={savingEdit || editText.trim().length < 10}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all active:scale-[0.97] disabled:opacity-50"
                style={{ background: T.primary }}>
                <CheckIcon className="w-3 h-3" />
                {savingEdit ? 'שומר...' : 'שמור'}
              </button>
              <button onClick={cancelEdit} disabled={savingEdit}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-[0.97]"
                style={{ background: '#F3F4F6', color: '#6B7280' }}>
                <XIcon className="w-3 h-3" />
                ביטול
              </button>
              <span className="text-[10px] mr-auto" style={{ color: editText.length > 1800 ? '#DC2626' : '#9CA3AF' }}>
                {editText.length}/2000
              </span>
            </div>
          </div>
        ) : (
          <>
            <p className={`text-sm leading-relaxed ${!expanded && isLong ? 'line-clamp-4' : ''}`} style={{ color: '#374151' }}>
              {post.body}
            </p>
            {isLong && (
              <button onClick={() => setExpanded(!expanded)}
                className="text-xs font-bold mt-1" style={{ color: T.primary }}>
                {expanded ? 'הצג פחות' : 'קראו עוד...'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Image */}
      {post.image_url && (
        <div className="mx-4 mb-3 rounded-xl overflow-hidden relative cursor-pointer"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          onClick={() => setShowFullImage(true)}>
          <img src={post.image_url} alt="" className="w-full object-cover" style={{ maxHeight: '350px' }} />
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
          <img src={post.image_url} alt="" className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl" />
        </div>
      )}

      {/* Reaction summary */}
      {(likeCount > 0 || totalReactions > 0 || commentCount > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 mx-4 rounded-lg mb-1" style={{ background: '#FAFAFA' }}>
          <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: '#6B7280' }}>
            {likeCount > 0 && <span className="flex items-center gap-0.5">👍 {likeCount}</span>}
            {EMOJIS.filter(e => e !== '👍').map(e => reactionCounts[e] ? <span key={e} className="flex items-center gap-0.5">{e} {reactionCounts[e]}</span> : null)}
          </div>
          {commentCount > 0 && (
            <button onClick={() => setShowComments(s => !s)}
              className="mr-auto text-[11px] font-medium hover:underline transition-all"
              style={{ color: showComments ? T.primary : '#9CA3AF' }}>
              {commentCount === 1 ? 'תגובה אחת' : `${commentCount} תגובות`}
            </button>
          )}
        </div>
      )}

      {/* AI thinking - only for recent posts (< 5 min) with no comments yet */}
      {commentCount === 0 && post.created_at && (Date.now() - new Date(post.created_at).getTime()) < 5 * 60 * 1000 && (
        <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-2 rounded-xl"
          style={{ background: '#FFFBEB', border: '1px solid #FEF3C7' }}>
          <Wrench className="w-3.5 h-3.5 animate-pulse" style={{ color: '#D97706' }} />
          <span className="text-[11px] font-medium" style={{ color: '#92400E' }}>
            {post.domain === 'vessel' ? 'יוסי מומחה כלי שייט חושב...' : 'יוסי המוסכניק חושב...'}
          </span>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center px-2 py-1.5 mx-2 mb-2 rounded-xl" style={{ background: '#FAFAFA' }}>
        {/* Like */}
        <div className="flex-1 relative">
          <button
            onClick={() => {
              if (!canInteract) return;
              if (showEmojis) { setShowEmojis(false); return; }
              if (myChoice) {
                if (liked) handleQuickLike();
                else if (myReaction) handleReaction(myReaction);
              } else {
                handleQuickLike();
              }
            }}
            onContextMenu={(e) => { e.preventDefault(); if (canInteract) setShowEmojis(!showEmojis); }}
            onDoubleClick={() => { if (canInteract) setShowEmojis(!showEmojis); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.95]"
            style={{ color: myChoice ? '#2563EB' : '#6B7280' }}>
            {myReaction
              ? <span className={`text-base leading-none ${myChoice ? 'like-pop' : ''}`}>{myReaction}</span>
              : <ThumbsUp className={`w-4 h-4 ${liked ? 'like-pop' : ''}`} fill={liked ? '#2563EB' : 'none'} />
            }
            <span>{myChoice ? 'אהבתי' : 'לייק'}</span>
          </button>
          {showEmojis && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowEmojis(false)} />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-40 flex gap-1 px-2 py-1.5 rounded-2xl bg-white"
                style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.15)', border: '1px solid #E5E7EB' }}>
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => handleReaction(e)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-all hover:scale-125 ${myReaction === e ? 'bg-blue-100 scale-110' : ''}`}>
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Comment */}
        <button onClick={() => setShowComments(!showComments)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.95]"
          style={{ color: showComments ? T.primary : '#6B7280' }}>
          <MessageCircle className="w-4 h-4" />
          <span>תגובה</span>
        </button>

        {/* Share */}
        <button onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all active:scale-[0.95]"
          style={{ color: '#6B7280' }}>
          <Share2 className="w-4 h-4" />
          <span>שיתוף</span>
        </button>

        {/* Save */}
        <button onClick={handleSave}
          className="w-10 flex items-center justify-center py-2 rounded-xl transition-all active:scale-[0.95]">
          {saved
            ? <BookmarkCheck className="w-4 h-4 bookmark-bounce" style={{ color: T.primary }} />
            : <Bookmark className="w-4 h-4" style={{ color: '#C4C4C4' }} />
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
