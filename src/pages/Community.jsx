import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '../components/shared/GuestContext';
import { C } from '@/lib/designTokens';
import { isVessel } from '../components/shared/DateStatusUtils';
import { ListSkeleton } from '../components/shared/Skeletons';
import SignUpPromptDialog from '../components/shared/SignUpPromptDialog';
import PostCard from '../components/community/PostCard';
import PostCreateDialog from '../components/community/PostCreateDialog';
import { Input } from '@/components/ui/input';
import { Search, Plus, Ship, Car, MessageSquare, PenLine, Users, X, Loader2 } from 'lucide-react';

const marine = { primary: '#0C7B93', light: '#E0F7FA', border: '#B2EBF2', text: '#0A3D4D', muted: '#6B9EA8', grad: 'linear-gradient(135deg, #065A6E 0%, #0C7B93 100%)' };

export default function Community() {
  const { isGuest, isAuthenticated, user, guestVehicles } = useAuth();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState('vehicle');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResultPostIds, setSearchResultPostIds] = useState(null); // null = no search active
  const [showCreate, setShowCreate] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [hasVessel, setHasVessel] = useState(false);
  const [userVehicles, setUserVehicles] = useState([]);
  const searchInputRef = useRef(null);

  const T = domain === 'vessel' ? marine : C;
  const canInteract = isAuthenticated && !isGuest;

  useEffect(() => {
    if (isGuest) {
      setHasVessel((guestVehicles || []).some(v => isVessel(v.vehicle_type, v.nickname)));
      return;
    }
    if (!isAuthenticated || !user) return;
    (async () => {
      try {
        const members = await db.account_members.filter({ user_id: user.id, status: 'פעיל' });
        if (members.length === 0) return;
        const vehicles = await db.vehicles.filter({ account_id: members[0].account_id });
        setUserVehicles(vehicles);
        setHasVessel(vehicles.some(v => isVessel(v.vehicle_type, v.nickname)));
      } catch {}
    })();
  }, [isGuest, isAuthenticated, user]);

  // Debounce search input
  useEffect(() => {
    if (!search.trim()) { setDebouncedSearch(''); setSearchResultPostIds(null); return; }
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Server-side search: posts + comments
  useEffect(() => {
    if (!debouncedSearch) { setSearchResultPostIds(null); return; }
    let cancelled = false;
    (async () => {
      setSearching(true);
      try {
        const q = `%${debouncedSearch}%`;
        // Search in posts body + author_name
        const [postsRes, commentsRes] = await Promise.all([
          supabase.from('community_posts').select('id').eq('domain', domain)
            .or(`body.ilike.${q},author_name.ilike.${q}`).limit(100),
          supabase.from('community_comments').select('post_id').ilike('body', q).limit(100),
        ]);
        if (cancelled) return;
        const postIdSet = new Set();
        (postsRes.data || []).forEach(p => postIdSet.add(p.id));
        (commentsRes.data || []).forEach(c => postIdSet.add(c.post_id));
        setSearchResultPostIds(postIdSet);
      } catch { if (!cancelled) setSearchResultPostIds(new Set()); }
      finally { if (!cancelled) setSearching(false); }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, domain]);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['community_posts', domain],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('community_posts').select('*').eq('domain', domain)
          .order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        return data || [];
      } catch { return []; }
    },
    staleTime: 30 * 1000,
  });

  const postIds = posts.map(p => p.id).filter(Boolean);
  const { data: commentCounts = {} } = useQuery({
    queryKey: ['community_comment_counts', domain, [...postIds].sort().join(',')],
    queryFn: async () => {
      if (postIds.length === 0) return {};
      try {
        const { data } = await supabase.from('community_comments').select('post_id').in('post_id', postIds);
        const counts = {};
        (data || []).forEach(c => { counts[c.post_id] = (counts[c.post_id] || 0) + 1; });
        return counts;
      } catch { return {}; }
    },
    enabled: postIds.length > 0,
    staleTime: 30 * 1000,
  });

  const { data: interactionsData = {} } = useQuery({
    queryKey: ['community_interactions', domain, user?.id, postIds.length],
    queryFn: async () => {
      if (!user || postIds.length === 0) return {};
      try {
        const [likesRes, reactionsRes, savedRes] = await Promise.all([
          supabase.from('community_likes').select('post_id, user_id').in('post_id', postIds),
          supabase.from('community_reactions').select('post_id, user_id, emoji').in('post_id', postIds),
          supabase.from('community_saved').select('post_id').eq('user_id', user.id).in('post_id', postIds),
        ]);
        const result = {};
        postIds.forEach(pid => { result[pid] = { likeCount: 0, liked: false, reactionCounts: {}, myReaction: null, saved: false }; });
        (likesRes.data || []).forEach(l => {
          if (result[l.post_id]) {
            result[l.post_id].likeCount++;
            if (l.user_id === user.id) result[l.post_id].liked = true;
          }
        });
        (reactionsRes.data || []).forEach(r => {
          if (result[r.post_id]) {
            result[r.post_id].reactionCounts[r.emoji] = (result[r.post_id].reactionCounts[r.emoji] || 0) + 1;
            if (r.user_id === user.id) result[r.post_id].myReaction = r.emoji;
          }
        });
        (savedRes.data || []).forEach(s => {
          if (result[s.post_id]) result[s.post_id].saved = true;
        });
        return result;
      } catch { return {}; }
    },
    enabled: !!user && postIds.length > 0,
    staleTime: 15 * 1000,
  });

  const domainVehicles = useMemo(() =>
    userVehicles.filter(v => domain === 'vessel' ? isVessel(v.vehicle_type, v.nickname) : !isVessel(v.vehicle_type, v.nickname)),
  [userVehicles, domain]);

  const filteredPosts = useMemo(() => {
    let blockedUsers = [];
    let reportedPosts = [];
    try { blockedUsers = JSON.parse(localStorage.getItem('blocked_users') || '[]'); } catch {}
    try { reportedPosts = JSON.parse(localStorage.getItem('reported_posts') || '[]'); } catch {}
    const blockedSet = new Set(blockedUsers);
    const reportedSet = new Set(reportedPosts);
    let result = posts.filter(p => !blockedSet.has(p.user_id) && !reportedSet.has(p.id));
    // Apply server-side search filter
    if (searchResultPostIds !== null) {
      result = result.filter(p => searchResultPostIds.has(p.id));
    }
    return result;
  }, [posts, searchResultPostIds]);

  const vehicleMap = useMemo(() => {
    const map = {};
    userVehicles.forEach(v => { map[v.id] = v; });
    return map;
  }, [userVehicles]);

  const handleFab = () => {
    if (!canInteract) { setShowSignUp(true); return; }
    setShowCreate(true);
  };

  const tabs = [
    { key: 'vehicle', label: 'רכבים', icon: Car, color: C.primary },
    ...(hasVessel ? [{ key: 'vessel', label: 'כלי שייט', icon: Ship, color: marine.primary }] : []),
  ];

  return (
    <div dir="rtl" className="-mx-4 -mt-4" style={{ background: '#F3F4F6', minHeight: '100dvh' }}>

      {/* ── Hero Header ── */}
      <div className="sticky top-0 z-30 relative" style={{ background: T.grad || C.grad }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-16 -left-16 w-48 h-48 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="absolute -bottom-8 -right-8 w-32 h-32 rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </div>
        <div className="relative z-10 px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.2)' }}>
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-black text-white">קהילה וייעוץ</h1>
                <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  {posts.length > 0 ? `${posts.length} שאלות` : 'שאלו את הקהילה'}
                </p>
              </div>
            </div>
          </div>

          {/* Search bar — always visible */}
          <div className="relative mb-2.5">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'rgba(255,255,255,0.5)' }} />
            {searching && <Loader2 className="absolute left-10 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: 'rgba(255,255,255,0.5)' }} />}
            <input ref={searchInputRef} value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חפש בפוסטים ובתגובות..."
              dir="rtl"
              className="w-full h-10 pr-10 pl-10 rounded-xl text-sm font-medium outline-none placeholder:text-white/40"
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }} />
            {search && (
              <button onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.25)' }}>
                <X className="w-3 h-3 text-white" />
              </button>
            )}
          </div>

          {/* Quick post bar */}
          <button onClick={handleFab}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl transition-all active:scale-[0.99]"
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'rgba(255,255,255,0.25)' }}>
              <PenLine className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.7)' }}>מה השאלה שלך?</span>
          </button>
        </div>

        {/* Tabs */}
        {tabs.length > 1 && (
        <div className="flex px-4 gap-2 pb-3">
          {tabs.map(tab => {
            const active = domain === tab.key;
            return (
              <button key={tab.key} onClick={() => { setDomain(tab.key); setSearch(''); }}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full text-xs font-bold transition-all active:scale-[0.95]"
                style={{
                  background: active ? '#fff' : 'rgba(255,255,255,0.2)',
                  color: active ? tab.color : '#fff',
                  boxShadow: active ? '0 2px 10px rgba(0,0,0,0.12)' : 'none',
                  border: active ? 'none' : '1px solid rgba(255,255,255,0.25)',
                }}>
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* ── Search result count ── */}
      {debouncedSearch && !searching && (
        <div className="px-4 py-2 flex items-center justify-between" style={{ background: '#fff', borderBottom: '1px solid #E5E7EB' }}>
          <p className="text-xs font-bold" style={{ color: filteredPosts.length > 0 ? T.primary : '#9CA3AF' }}>
            {filteredPosts.length > 0
              ? `נמצאו ${filteredPosts.length} תוצאות עבור "${debouncedSearch}"`
              : `לא נמצאו תוצאות עבור "${debouncedSearch}"`
            }
          </p>
          <button onClick={() => setSearch('')} className="text-[10px] font-bold underline" style={{ color: '#9CA3AF' }}>
            נקה חיפוש
          </button>
        </div>
      )}

      {/* ── Feed ── */}
      <div className="px-3 pt-3 pb-28">
        {isLoading ? <ListSkeleton count={4} variant="post" /> : filteredPosts.length === 0 ? (
          debouncedSearch ? (
            /* No search results — suggest posting */
            <div className="text-center py-16 px-6 card-animate">
              <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: T.light || '#F3F4F6' }}>
                <Search className="w-8 h-8" style={{ color: T.primary, opacity: 0.3 }} />
              </div>
              <h3 className="text-base font-black mb-2" style={{ color: '#1F2937' }}>לא מצאנו תוצאות</h3>
              <p className="text-sm mb-5 leading-relaxed max-w-[250px] mx-auto" style={{ color: '#9CA3AF' }}>
                נראה שעוד לא שאלו על זה. אולי תהיה הראשון?
              </p>
              <button onClick={handleFab}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.97]"
                style={{ background: T.grad || T.primary, boxShadow: `0 6px 24px ${T.primary}40` }}>
                <PenLine className="w-4 h-4" /> שאל את הקהילה
              </button>
            </div>
          ) : (
            /* Empty feed — no posts at all */
            <div className="text-center py-20 px-6 card-animate">
              <div className="relative w-24 h-24 mx-auto mb-5">
                <div className="absolute inset-0 rounded-full" style={{ background: T.light || '#F3F4F6' }} />
                <div className="absolute inset-0 rounded-full flex items-center justify-center">
                  <MessageSquare className="w-11 h-11" style={{ color: T.primary, opacity: 0.25 }} />
                </div>
                <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: '#FFBF00', boxShadow: '0 2px 8px rgba(255,191,0,0.4)' }}>
                  <PenLine className="w-4 h-4 text-white" />
                </div>
              </div>
              <h3 className="text-lg font-black mb-2" style={{ color: '#1F2937' }}>הקהילה מחכה לך</h3>
              <p className="text-sm mb-6 leading-relaxed max-w-[250px] mx-auto" style={{ color: '#9CA3AF' }}>
                שאל כל שאלה על הרכב או הסירה. הקהילה, ברוך ויוסי עונים.
              </p>
              <button onClick={handleFab}
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.97]"
                style={{ background: T.grad || T.primary, boxShadow: `0 6px 24px ${T.primary}40` }}>
                <PenLine className="w-4 h-4" /> פרסם שאלה ראשונה
              </button>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {filteredPosts.map((post, i) => (
              <div key={post.id} className="card-animate" style={{ animationDelay: `${Math.min(i * 60, 300)}ms` }}>
              <PostCard post={post} T={T} canComment={canInteract}
                commentCount={commentCounts[post.id] || 0}
                vehicle={post.linked_vehicle_id ? vehicleMap[post.linked_vehicle_id] : null}
                interactions={interactionsData[post.id] || {}}
                onCommentAdded={() => queryClient.invalidateQueries({ queryKey: ['community_comment_counts', domain] })}
                searchQuery={debouncedSearch}
              />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Floating Action Button ── */}
      <button onClick={handleFab}
        className="fixed z-40 flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm text-white transition-all active:scale-[0.95]"
        style={{ background: T.grad || T.primary, bottom: '72px', left: '50%', transform: 'translateX(-50%)', boxShadow: `0 4px 20px ${T.primary}50` }}>
        <PenLine className="w-4 h-4" /> פוסט חדש
      </button>

      <PostCreateDialog open={showCreate} onClose={() => setShowCreate(false)} domain={domain} vehicles={domainVehicles} T={T} />
      <SignUpPromptDialog open={showSignUp} onClose={() => setShowSignUp(false)} reason="כדי לפרסם בקהילה, יש להירשם" />
    </div>
  );
}
