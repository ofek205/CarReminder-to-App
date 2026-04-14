import React, { useState } from 'react';
import { MessageCircle, ChevronDown, ChevronUp, Car, Ship, Trash2, MoreVertical } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import { useAuth } from '../shared/GuestContext';
import { db } from '@/lib/supabaseEntities';
import { useQueryClient } from '@tanstack/react-query';
import CommentSection from './CommentSection';

function timeAgo(date) {
  try { return formatDistanceToNow(new Date(date), { addSuffix: true, locale: he }); }
  catch { return ''; }
}

function Initials({ name, size = 'w-9 h-9 text-sm' }) {
  const letters = (name || '??').split(' ').map(w => w[0]).join('').slice(0, 2);
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ background: '#6B7280' }}>
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
    } catch (err) {
      console.error('Delete post error:', err);
      alert('שגיאה במחיקה');
    }
    setDeleting(false);
  };

  return (
    <div className="rounded-2xl mb-3 overflow-hidden" dir="rtl"
      style={{ background: '#fff', border: `1.5px solid ${T.border}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>

      {/* Header: avatar + name + time + delete */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-1">
        <Initials name={post.author_name} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: '#1F2937' }}>{post.author_name}</p>
          <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{timeAgo(post.created_at)}</p>
        </div>
        {isOwner && (
          <button onClick={handleDelete} disabled={deleting}
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 hover:bg-red-50 transition-all"
            title="מחק">
            <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-2">
        <p className={`text-sm leading-relaxed ${!expanded && isLong ? 'line-clamp-4' : ''}`} style={{ color: '#374151' }}>
          {post.body}
        </p>
        {isLong && (
          <button onClick={() => setExpanded(!expanded)}
            className="text-xs font-bold mt-1" style={{ color: T.primary }}>
            {expanded ? 'הצג פחות' : 'קרא עוד...'}
          </button>
        )}
      </div>

      {/* Image */}
      {post.image_url && (
        <div className="px-4 pb-2">
          <img src={post.image_url} alt="" className="w-full rounded-xl object-cover" style={{ maxHeight: '280px' }} />
        </div>
      )}

      {/* Linked vehicle chip */}
      {vehicle && (
        <div className="px-4 pb-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{ background: T.light, color: T.primary, border: `1px solid ${T.border}` }}>
            {post.domain === 'vessel' ? <Ship className="w-3 h-3" /> : <Car className="w-3 h-3" />}
            {vehicle.nickname || [vehicle.manufacturer, vehicle.model].filter(Boolean).join(' ')}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
          </div>
        </div>
      )}

      {/* AI thinking indicator — for new posts without AI response yet */}
      {commentCount === 0 && (
        <div className="flex items-center gap-2 px-4 py-2" style={{ background: '#FFFBEB', borderTop: `1px solid ${T.border}20` }}>
          <span className="text-sm animate-pulse">🔧</span>
          <span className="text-[11px] font-medium" style={{ color: '#92400E' }}>
            {post.domain === 'vessel' ? 'יוסי מומחה כלי שייט חושב...' : 'יוסי המוסכניק חושב...'}
          </span>
        </div>
      )}

      {/* Footer: comments toggle */}
      <button onClick={() => setShowComments(!showComments)}
        className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold transition-all"
        style={{ color: T.muted, borderTop: `1px solid ${T.border}40` }}>
        <MessageCircle className="w-3.5 h-3.5" />
        <span>{commentCount || 0} תגובות</span>
        {showComments ? <ChevronUp className="w-3 h-3 mr-auto" /> : <ChevronDown className="w-3 h-3 mr-auto" />}
      </button>

      {/* Comments section */}
      {showComments && (
        <CommentSection
          postId={post.id}
          postOwnerId={post.user_id}
          canComment={canComment}
          T={T}
          onCommentAdded={onCommentAdded}
        />
      )}
    </div>
  );
}
