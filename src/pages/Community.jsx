import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '../components/shared/GuestContext';
import { C } from '@/lib/designTokens';
import { isVessel } from '../components/shared/DateStatusUtils';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import SignUpPromptDialog from '../components/shared/SignUpPromptDialog';
import PostCard from '../components/community/PostCard';
import PostCreateDialog from '../components/community/PostCreateDialog';
import { Input } from '@/components/ui/input';
import { Search, Plus, Ship, Car, MessageSquare, PenLine } from 'lucide-react';
import { DEMO_POSTS_VEHICLE, DEMO_POSTS_VESSEL, DEMO_COMMENTS } from '../components/community/demoPosts';

const marine = { primary: '#0C7B93', light: '#E0F7FA', border: '#B2EBF2', text: '#0A3D4D', muted: '#6B9EA8' };

export default function Community() {
  const { isGuest, isAuthenticated, user, guestVehicles } = useAuth();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState('vehicle');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [hasVessel, setHasVessel] = useState(false);
  const [userVehicles, setUserVehicles] = useState([]);

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

  const demoPosts = domain === 'vessel' ? DEMO_POSTS_VESSEL : DEMO_POSTS_VEHICLE;

  const { data: realPosts = [], isLoading } = useQuery({
    queryKey: ['community_posts', domain],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('community_posts').select('*').eq('domain', domain)
          .order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        return data || [];
      } catch {
        return []; // Table may not exist yet — show demo posts only
      }
    },
    staleTime: 30 * 1000,
  });

  // Merge: real posts first, then demo posts
  const posts = [...realPosts, ...demoPosts];

  const realPostIds = realPosts.map(p => p.id).filter(Boolean);
  const { data: realCommentCounts = {} } = useQuery({
    queryKey: ['community_comment_counts', domain, [...realPostIds].sort().join(',')],
    queryFn: async () => {
      if (realPostIds.length === 0) return {};
      try {
        const { data } = await supabase.from('community_comments').select('post_id').in('post_id', realPostIds);
        const counts = {};
        (data || []).forEach(c => { counts[c.post_id] = (counts[c.post_id] || 0) + 1; });
        return counts;
      } catch { return {}; }
    },
    enabled: realPostIds.length > 0,
    staleTime: 30 * 1000,
  });

  // Merge demo comment counts
  const commentCounts = useMemo(() => {
    const counts = { ...realCommentCounts };
    Object.entries(DEMO_COMMENTS).forEach(([postId, comments]) => {
      counts[postId] = (counts[postId] || 0) + comments.length;
    });
    return counts;
  }, [realCommentCounts]);

  const domainVehicles = useMemo(() =>
    userVehicles.filter(v => domain === 'vessel' ? isVessel(v.vehicle_type, v.nickname) : !isVessel(v.vehicle_type, v.nickname)),
  [userVehicles, domain]);

  const filteredPosts = useMemo(() => {
    if (!search.trim()) return posts;
    const q = search.trim().toLowerCase();
    return posts.filter(p => p.body?.toLowerCase().includes(q) || p.author_name?.toLowerCase().includes(q));
  }, [posts, search]);

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
    { key: 'vehicle', label: 'פורום רכבים', icon: Car, color: C.primary },
    ...(hasVessel ? [{ key: 'vessel', label: 'פורום כלי שייט', icon: Ship, color: marine.primary }] : []),
  ];

  return (
    <div dir="rtl" className="-mx-4 -mt-4" style={{ background: '#F5F5F5', minHeight: '100dvh' }}>

      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-30" style={{ background: '#fff', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: T.primary }}>
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-lg font-black flex-1" style={{ color: '#1F2937' }}>קהילה</h1>
          <Search className="w-5 h-5" style={{ color: '#9CA3AF' }} />
        </div>

        {/* Quick post bar */}
        <button onClick={handleFab}
          className="mx-4 mb-3 flex items-center gap-3 w-[calc(100%-32px)] px-4 py-3 rounded-full transition-all active:scale-[0.99]"
          style={{ background: '#F3F4F6', border: '1.5px solid #E5E7EB' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: T.primary }}>
            <PenLine className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm" style={{ color: '#9CA3AF' }}>שאלו את הקהילה...</span>
        </button>

        {/* Tabs */}
        <div className="flex px-4 gap-0" style={{ borderBottom: '1px solid #E5E7EB' }}>
          {tabs.map(tab => {
            const active = domain === tab.key;
            return (
              <button key={tab.key} onClick={() => { setDomain(tab.key); setSearch(''); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-bold transition-all relative"
                style={{ color: active ? tab.color : '#9CA3AF' }}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {active && (
                  <div className="absolute bottom-0 left-2 right-2 h-[3px] rounded-full" style={{ background: tab.color }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Search (conditional) ── */}
      {search !== '' && (
        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9CA3AF' }} />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="חפש שאלה..."
              className="pr-10 text-sm h-10 rounded-xl" style={{ background: '#fff' }} />
          </div>
        </div>
      )}

      {/* ── Feed ── */}
      <div className="pt-2 pb-24">
        {isLoading ? <LoadingSpinner /> : filteredPosts.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: T.light || '#F3F4F6' }}>
              <MessageSquare className="w-8 h-8" style={{ color: T.primary, opacity: 0.4 }} />
            </div>
            <h3 className="text-base font-black mb-1" style={{ color: '#374151' }}>אין עדיין שאלות</h3>
            <p className="text-sm mb-4" style={{ color: '#9CA3AF' }}>
              היה הראשון לשאול ב{domain === 'vessel' ? 'פורום כלי השייט' : 'פורום הרכבים'}!
            </p>
            <button onClick={handleFab}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-white transition-all active:scale-[0.97]"
              style={{ background: T.primary }}>
              <PenLine className="w-4 h-4" /> פרסם שאלה
            </button>
          </div>
        ) : (
          filteredPosts.map(post => (
            <PostCard key={post.id} post={post} T={T} canComment={canInteract}
              commentCount={commentCounts[post.id] || 0}
              vehicle={post.linked_vehicle_id ? vehicleMap[post.linked_vehicle_id] : null}
              onCommentAdded={() => queryClient.invalidateQueries({ queryKey: ['community_comment_counts', domain] })}
            />
          ))
        )}
      </div>

      {/* ── Floating Action Button ── */}
      <button onClick={handleFab}
        className="fixed z-40 flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm text-white shadow-lg transition-all active:scale-[0.95]"
        style={{ background: T.primary, bottom: '100px', left: '50%', transform: 'translateX(-50%)', boxShadow: `0 4px 20px ${T.primary}40` }}>
        <PenLine className="w-4 h-4" /> נושא חדש
      </button>

      <PostCreateDialog open={showCreate} onClose={() => setShowCreate(false)} domain={domain} vehicles={domainVehicles} T={T} />
      <SignUpPromptDialog open={showSignUp} onClose={() => setShowSignUp(false)} reason="כדי לפרסם בקהילה, יש להירשם" />
    </div>
  );
}
