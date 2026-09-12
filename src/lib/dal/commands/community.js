/**
 * Community (social feed) write commands.
 *
 * ALL offlineCapable: false. Everything here is inherently multi-party: posts
 * and comments are published to other people, likes/reactions attach to
 * someone else's content, and block/report are moderation actions with safety
 * consequences. Replaying a stale social action after hours offline is worse
 * than refusing it — the §3 boundary again.
 *
 * The like / reaction / saved toggles read the existing row id first (a READ,
 * which stays on supabase at the call site) and then delete BY ID, so the
 * remove commands take an id rather than a filter.
 *
 * Both community_comments inserts (the CommentSection AI reply and the
 * PostCreateDialog expert reply) are unified onto db.community_comments here —
 * one of them used a raw insert before. Both call sites already sit inside a
 * try/catch that logs, so the entity layer's throw-on-error is safe.
 *
 * The report commands keep the raw { data, error } envelope: their call sites
 * inspect `error.code === '23505'` (unique violation = the user already
 * reported this post) and treat it as success.
 */
import { defineCommand } from '../registry';
import { db } from '@/lib/supabaseEntities';
import { supabase } from '@/lib/supabase';

const online = { offlineCapable: false };
const envelope = { ...online, kind: 'rpc', returnsEnvelope: true };

// ── Posts ──────────────────────────────────────────────────────────────────
defineCommand('community.postCreate', {
  ...online, table: 'community_posts',
  run: (payload) => db.community_posts.create(payload),
});

defineCommand('community.postDelete', {
  ...online, table: 'community_posts',
  run: ({ id }) => db.community_posts.delete(id),
});

defineCommand('community.postUpdateBody', {
  ...online, table: 'community_posts', returnsEnvelope: true,
  run: ({ id, body }) => supabase.from('community_posts').update({ body }).eq('id', id),
});

// ── Comments ───────────────────────────────────────────────────────────────
defineCommand('community.commentPost', {
  ...envelope, table: 'community_comments',
  run: ({ postId, body, isAnonymous, authorName }) =>
    supabase.rpc('post_comment', {
      p_post_id: postId, p_body: body,
      p_is_anonymous: !!isAnonymous, p_author_name: authorName,
    }),
});

defineCommand('community.commentNotify', {
  ...envelope, table: 'community_notifications',
  run: ({ postId, commenterName, bodySnippet }) =>
    supabase.rpc('notify_community_comment', {
      p_post_id: postId, p_commenter_name: commenterName, p_body_snippet: bodySnippet,
    }),
});

defineCommand('community.commentCreate', {
  ...online, table: 'community_comments',
  run: (payload) => db.community_comments.create(payload),
});

// ── Likes / reactions / saved ──────────────────────────────────────────────
defineCommand('community.likeAdd', {
  ...online, table: 'community_likes', returnsEnvelope: true,
  run: ({ userId, postId }) =>
    supabase.from('community_likes').insert({ user_id: userId, post_id: postId }),
});

defineCommand('community.likeRemove', {
  ...online, table: 'community_likes', returnsEnvelope: true,
  run: ({ id }) => supabase.from('community_likes').delete().eq('id', id),
});

defineCommand('community.reactionAdd', {
  ...online, table: 'community_reactions', returnsEnvelope: true,
  run: ({ userId, postId, emoji }) =>
    supabase.from('community_reactions').insert({ user_id: userId, post_id: postId, emoji }),
});

defineCommand('community.reactionUpdate', {
  ...online, table: 'community_reactions', returnsEnvelope: true,
  run: ({ userId, postId, emoji }) =>
    supabase.from('community_reactions').update({ emoji })
      .eq('user_id', userId).eq('post_id', postId),
});

defineCommand('community.reactionRemove', {
  ...online, table: 'community_reactions', returnsEnvelope: true,
  run: ({ id }) => supabase.from('community_reactions').delete().eq('id', id),
});

defineCommand('community.savedAdd', {
  ...online, table: 'community_saved', returnsEnvelope: true,
  run: ({ userId, postId }) =>
    supabase.from('community_saved').insert({ user_id: userId, post_id: postId }),
});

defineCommand('community.savedRemove', {
  ...online, table: 'community_saved', returnsEnvelope: true,
  run: ({ id }) => supabase.from('community_saved').delete().eq('id', id),
});

// ── Moderation ─────────────────────────────────────────────────────────────
defineCommand('community.userBlock', {
  ...online, table: 'blocked_users', returnsEnvelope: true,
  run: (payload) => supabase.from('blocked_users').insert(payload),
});

defineCommand('community.userUnblock', {
  ...online, table: 'blocked_users', returnsEnvelope: true,
  run: ({ id }) => supabase.from('blocked_users').delete().eq('id', id),
});

// Envelope matters here: callers check error.code === '23505' (already reported).
defineCommand('community.postReport', {
  ...online, table: 'reported_posts', returnsEnvelope: true,
  run: (payload) => supabase.from('reported_posts').insert(payload),
});
