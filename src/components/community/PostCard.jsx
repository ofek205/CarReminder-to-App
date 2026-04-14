import React, { useState } from 'react';
import { MessageCircle, ChevronDown, ChevronUp, Car, Ship, Trash2, Bookmark } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import { useAuth } from '../shared/GuestContext';
import { db } from '@/lib/supabaseEntities';
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
      style={{ background: color }}>
      {letters}
    </div>
  );
}

export default function PostCard({ post, T, canComment, commentCount, vehicle, onCommentAdded }) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isLong = post.body?.length > 200;
  const isOwner = user?.id === post.user_id;

  const handleDelete = async () => {
    if (!confirm('למחוק את השאלה?')) return;
    setDeleting(true);
    try {
      await db.community_posts.delete(post.id);
      queryClient.invalidateQueries({ queryKey: ['community_posts', post.domain] });
    } catch { alert('שגיאה במחיקה'); }
    setDeleting(false);
  };

  return (
    <div dir="rtl" style={{ background: '#fff', borderBottom: '8px solid #F5F5F5' }}>

      {/* Header row: avatar + name + category + time */}
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
        {/* Actions */}
        <div className="flex items-center gap-1">
          {isOwner && (
            <button onClick={handleDelete} disabled={deleting}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-50 transition-all">
              <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
            </button>
          )}
        </div>
      </div>

      {/* Body text */}
      <div className="px-4 pb-2">
        <p className={`text-[14px] leading-relaxed ${!expanded && isLong ? 'line-clamp-4' : ''}`} style={{ color: '#374151' }}>
          {post.body}
        </p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-[13px] font-bold mt-1" style={{ color: T.primary }}>
            {expanded ? 'הצג פחות' : 'קראי עוד'}
          </button>
        )}
      </div>

      {/* Image — full width like Forti */}
      {post.image_url && (
        <div className="w-full">
          <img src={post.image_url} alt="" className="w-full object-cover" style={{ maxHeight: '400px' }} />
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

      {/* AI thinking */}
      {commentCount === 0 && (
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-sm animate-pulse">🔧</span>
          <span className="text-[11px] font-medium" style={{ color: '#92400E' }}>
            {post.domain === 'vessel' ? 'יוסי מומחה כלי שייט חושב...' : 'יוסי המוסכניק חושב...'}
          </span>
        </div>
      )}

      {/* Footer actions — Forti style */}
      <div className="flex items-center px-4 py-2" style={{ borderTop: '1px solid #F3F4F6' }}>
        <button onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-all active:scale-[0.97]"
          style={{ color: commentCount > 0 ? T.primary : '#9CA3AF' }}>
          <MessageCircle className="w-4 h-4" />
          {commentCount || 0}
        </button>
        <div className="flex-1" />
        <Bookmark className="w-4 h-4" style={{ color: '#D1D5DB' }} />
      </div>

      {/* Comments expandable */}
      {showComments && (
        <CommentSection postId={post.id} postOwnerId={post.user_id} canComment={canComment} T={T} onCommentAdded={onCommentAdded} />
      )}
    </div>
  );
}
