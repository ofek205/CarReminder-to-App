import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/supabaseEntities';
import { useAuth } from '../components/shared/GuestContext';
import { C } from '@/lib/designTokens';
import { isVessel } from '../components/shared/DateStatusUtils';
import PageHeader from '../components/shared/PageHeader';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import SignUpPromptDialog from '../components/shared/SignUpPromptDialog';
import PostCard from '../components/community/PostCard';
import PostCreateDialog from '../components/community/PostCreateDialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Search, Plus, Users, Ship, Car, MessageSquare } from 'lucide-react';

// Teal theme for vessel forum
const marine = {
  primary: '#0C7B93', accent: '#0E9AB2', light: '#E0F7FA',
  border: '#B2EBF2', text: '#0A3D4D', muted: '#6B9EA8',
};

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

  // Detect vessel ownership + load user vehicles
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

  // Fetch posts for current domain
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['community_posts', domain],
    queryFn: async () => {
      const { data } = await supabase
        .from('community_posts')
        .select('*')
        .eq('domain', domain)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    },
    staleTime: 30 * 1000,
  });

  // Fetch comment counts per post
  const postIds = posts.map(p => p.id);
  const { data: commentCounts = {} } = useQuery({
    queryKey: ['community_comment_counts', domain, [...postIds].sort().join(',')],
    queryFn: async () => {
      if (postIds.length === 0) return {};
      const { data } = await supabase
        .from('community_comments')
        .select('post_id')
        .in('post_id', postIds);
      const counts = {};
      (data || []).forEach(c => { counts[c.post_id] = (counts[c.post_id] || 0) + 1; });
      return counts;
    },
    enabled: postIds.length > 0,
    staleTime: 30 * 1000,
  });

  // Filter vehicles for current domain
  const domainVehicles = useMemo(() => {
    return userVehicles.filter(v =>
      domain === 'vessel' ? isVessel(v.vehicle_type, v.nickname) : !isVessel(v.vehicle_type, v.nickname)
    );
  }, [userVehicles, domain]);

  // Search filter
  const filteredPosts = useMemo(() => {
    if (!search.trim()) return posts;
    const q = search.trim().toLowerCase();
    return posts.filter(p =>
      p.body?.toLowerCase().includes(q) || p.author_name?.toLowerCase().includes(q)
    );
  }, [posts, search]);

  // Vehicle lookup for linked posts
  const vehicleMap = useMemo(() => {
    const map = {};
    userVehicles.forEach(v => { map[v.id] = v; });
    return map;
  }, [userVehicles]);

  const handleFab = () => {
    if (!canInteract) { setShowSignUp(true); return; }
    setShowCreate(true);
  };

  return (
    <div dir="rtl" className="-mx-4 -mt-4 pb-4" style={{ background: '#F9FAFB', minHeight: '100dvh' }}>
      <div className="px-4 pt-4">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: T.primary }}>
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black" style={{ color: '#1F2937' }}>קהילה וייעוץ</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>שאלו, שתפו וקבלו עזרה מיוסי המוסכניק</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="vehicle" value={domain} onValueChange={v => { setDomain(v); setSearch(''); }}>
          <TabsList className="w-full mb-3" style={{ background: '#F3F4F6' }}>
            <TabsTrigger value="vehicle" className="flex-1 gap-1.5 text-sm font-bold data-[state=active]:shadow-sm"
              style={domain === 'vehicle' ? { background: C.primary, color: '#fff' } : {}}>
              <Car className="w-4 h-4" /> פורום רכבים
              {posts.length > 0 && domain === 'vehicle' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full mr-1" style={{ background: 'rgba(255,255,255,0.3)' }}>{posts.length}</span>
              )}
            </TabsTrigger>
            {hasVessel && (
              <TabsTrigger value="vessel" className="flex-1 gap-1.5 text-sm font-bold data-[state=active]:shadow-sm"
                style={domain === 'vessel' ? { background: marine.primary, color: '#fff' } : {}}>
                <Ship className="w-4 h-4" /> פורום כלי שייט
              </TabsTrigger>
            )}
          </TabsList>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: '#9CA3AF' }} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חפש שאלה או נושא..."
              className="pr-10 text-sm h-10 rounded-xl"
              style={{ background: '#fff', border: `1.5px solid ${T.border}` }}
            />
          </div>

          {/* Quick post prompt */}
          <button onClick={handleFab}
            className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl mb-4 text-sm transition-all active:scale-[0.99]"
            style={{ background: '#fff', border: `1.5px dashed ${T.border}`, color: T.muted }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: T.light }}>
              <Plus className="w-4 h-4" style={{ color: T.primary }} />
            </div>
            מה תרצה לשאול?
          </button>

          {/* Feed */}
          <TabsContent value="vehicle" className="mt-0">
            <Feed posts={filteredPosts} T={C} canComment={canInteract} commentCounts={commentCounts}
              vehicleMap={vehicleMap} queryClient={queryClient} domain="vehicle" isLoading={isLoading} />
          </TabsContent>
          <TabsContent value="vessel" className="mt-0">
            <Feed posts={filteredPosts} T={marine} canComment={canInteract} commentCounts={commentCounts}
              vehicleMap={vehicleMap} queryClient={queryClient} domain="vessel" isLoading={isLoading} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Create dialog */}
      <PostCreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        domain={domain}
        vehicles={domainVehicles}
        T={T}
      />

      {/* Guest signup prompt */}
      <SignUpPromptDialog
        open={showSignUp}
        onClose={() => setShowSignUp(false)}
        reason="כדי לפרסם או להגיב בקהילה, יש להירשם"
      />
    </div>
  );
}

// ── Feed component ────────────────────────────────────────────────────────
function Feed({ posts, T, canComment, commentCounts, vehicleMap, queryClient, domain, isLoading }) {
  if (isLoading) return <LoadingSpinner />;

  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center"
          style={{ background: T.light }}>
          <MessageSquare className="w-8 h-8" style={{ color: T.primary, opacity: 0.5 }} />
        </div>
        <h3 className="text-base font-black mb-1" style={{ color: '#374151' }}>אין עדיין שאלות</h3>
        <p className="text-sm" style={{ color: '#9CA3AF' }}>
          היה הראשון לשאול ב{domain === 'vessel' ? 'פורום כלי השייט' : 'פורום הרכבים'}!
        </p>
      </div>
    );
  }

  return (
    <div>
      {posts.map(post => (
        <PostCard
          key={post.id}
          post={post}
          T={T}
          canComment={canComment}
          commentCount={commentCounts[post.id] || 0}
          vehicle={post.linked_vehicle_id ? vehicleMap[post.linked_vehicle_id] : null}
          onCommentAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['community_comment_counts', domain] });
          }}
        />
      ))}
    </div>
  );
}
