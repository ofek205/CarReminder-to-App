import React, { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "../components/shared/PageHeader";
import LoadingSpinner from "../components/shared/LoadingSpinner";
import ReviewPopup from "../components/shared/ReviewPopup";
import { useAuth } from "../components/shared/GuestContext";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Star, Search, PlusCircle, LogIn, BadgeCheck, Car, Ship, Bike, Truck } from "lucide-react";
import { format } from "date-fns";
import { C } from "@/lib/designTokens";

//  Helpers 
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
}

// Deterministic hue from name so the same person always gets the same avatar color.
function hueFromName(name) {
  if (!name) return 120;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 360;
}

const VEHICLE_TYPE_ICON = {
  'רכב': Car,
  'אופנוע': Bike,
  'משאית': Truck,
  'כלי שייט': Ship,
  'כלי שטח': Car,
};

//  Star rendering (display only) 
function StarDisplay({ rating, size = 16 }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} מתוך 5 כוכבים`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s}
          style={{ width: size, height: size }}
          className={s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'} />
      ))}
    </div>
  );
}

//  Avatar with initials 
function Avatar({ name, size = 44 }) {
  const hue = hueFromName(name);
  return (
    <div className="flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, hsl(${hue}, 55%, 45%), hsl(${(hue + 30) % 360}, 55%, 35%))`,
      }}
      aria-hidden="true">
      {initials(name)}
    </div>
  );
}

//  Rating distribution bar 
function RatingBar({ stars, count, total }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-3 text-gray-600 font-medium text-left" dir="ltr">{stars}</span>
      <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#F3F4F6' }}>
        <div className="h-full rounded-full transition-all" style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #FBBF24, #F59E0B)',
        }} />
      </div>
      <span className="w-5 text-gray-500 text-left" dir="ltr">{count}</span>
    </div>
  );
}

//  Hero with average + distribution 
function ReviewsHero({ reviews }) {
  const total = reviews.length;
  const avg = total ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / total : 0;
  const dist = [5, 4, 3, 2, 1].map(n => ({
    stars: n,
    count: reviews.filter(r => r.rating === n).length,
  }));

  if (total === 0) {
    return (
      <div className="rounded-2xl p-6 mb-5 text-center"
        style={{ background: 'linear-gradient(135deg, #F0FDF4, #ECFDF5)', border: '1.5px solid #BBF7D0' }}>
        <div className="text-5xl mb-2">💬</div>
        <p className="font-black text-lg" style={{ color: C.greenDark }}>היה הראשון/ה לשתף</p>
        <p className="text-sm text-gray-600 mt-1">עדיין אין חוות דעת. הדעה שלך תעזור לאחרים</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-5 mb-5"
      style={{ background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)', border: '1.5px solid #FDE68A' }}>
      <div className="flex items-center gap-5">
        {/* Big average number */}
        <div className="text-center shrink-0">
          <div className="text-5xl font-black leading-none" style={{ color: '#B45309' }}>
            {avg.toFixed(1)}
          </div>
          <div className="mt-2 flex justify-center">
            <StarDisplay rating={Math.round(avg)} size={14} />
          </div>
          <div className="text-xs text-gray-600 mt-1.5 font-medium">
            {total} חוות דעת
          </div>
        </div>

        {/* Distribution bars */}
        <div className="flex-1 space-y-1.5 min-w-0">
          {dist.map(d => <RatingBar key={d.stars} stars={d.stars} count={d.count} total={total} />)}
        </div>
      </div>
    </div>
  );
}

//  Single review card 
function ReviewCard({ review }) {
  const Icon = VEHICLE_TYPE_ICON[review.vehicle_type] || Car;
  return (
    <Card className="p-4 transition-all hover:shadow-md">
      <div className="flex items-start gap-3">
        <Avatar name={review.author_name} />
        <div className="flex-1 min-w-0">
          {/* Header row: name + stars + verified */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm truncate" style={{ color: '#1C2E20' }}>
              {review.author_name || 'משתמש'}
            </span>
            <StarDisplay rating={review.rating} size={14} />
            {review.is_verified && (
              <span title="חוות דעת שאומתה על ידי הצוות"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ background: '#DCFCE7', color: '#166534' }}>
                <BadgeCheck className="w-3 h-3" />
                מאומת
              </span>
            )}
          </div>

          {/* Title */}
          {review.title && (
            <h3 className="font-bold text-base mt-1.5" style={{ color: '#1C2E20' }}>
              {review.title}
            </h3>
          )}

          {/* Body */}
          {review.body && (
            <p className="text-sm text-gray-700 mt-1 leading-relaxed whitespace-pre-wrap">
              {review.body}
            </p>
          )}

          {/* Meta row: vehicle type + date */}
          <div className="flex items-center gap-3 mt-3 text-xs text-gray-500">
            {review.vehicle_type && (
              <span className="inline-flex items-center gap-1">
                <Icon className="w-3.5 h-3.5" />
                {review.vehicle_type}
              </span>
            )}
            {review.vehicle_type && review.created_at && <span className="text-gray-300">·</span>}
            {review.created_at && (
              <span>{format(new Date(review.created_at), 'dd/MM/yyyy')}</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

//  Main page 
export default function AdminReviews() {
  const { isGuest, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [ratingFilter, setRatingFilter] = useState('all');
  const [searchText, setSearchText]     = useState('');
  const [sortOrder, setSortOrder]       = useState('desc');
  const [currentUser, setCurrentUser]   = useState(null);
  const [isAdmin, setIsAdmin]           = useState(null);
  const [showReviewPopup, setShowReviewPopup] = useState(false);

  useEffect(() => {
    if (isGuest) { setIsAdmin(false); setCurrentUser(null); return; }
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsAdmin(false); setCurrentUser(null); return; }
        setCurrentUser({ id: user.id, email: user.email, full_name: user.user_metadata?.full_name });
        setIsAdmin(user.email === 'ofek205@gmail.com' || user.user_metadata?.role === 'admin');
      } catch { setIsAdmin(false); setCurrentUser(null); }
    })();
  }, [isGuest]);

  const { data: reviews = [], isLoading, refetch } = useQuery({
    queryKey: ['reviews-public'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
        if (error) return [];
        return data || [];
      } catch { return []; }
    },
    enabled: isAdmin !== null,
  });

  const filtered = useMemo(() => {
    const list = Array.isArray(reviews) ? reviews : [];
    return list
      .filter(r => {
        if (ratingFilter !== 'all' && r.rating !== parseInt(ratingFilter)) return false;
        if (searchText) {
          const q = searchText.toLowerCase();
          return (
            (r.body || '').toLowerCase().includes(q) ||
            (r.title || '').toLowerCase().includes(q) ||
            (r.author_name || '').toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const da = new Date(a.created_at || 0);
        const db = new Date(b.created_at || 0);
        return sortOrder === 'desc' ? db - da : da - db;
      });
  }, [reviews, ratingFilter, searchText, sortOrder]);

  if (isAdmin === null || isLoading) return <LoadingSpinner />;

  const hasActiveFilter = ratingFilter !== 'all' || !!searchText;

  return (
    <div dir="rtl" className="pb-4">
      <PageHeader title="חוות דעת משתמשים" />

      {/* Hero: average + distribution */}
      <ReviewsHero reviews={reviews} />

      {/* CTA: guest / authenticated / not signed in */}
      {isGuest ? (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-5 flex-wrap"
          style={{ background: '#EFF6FF', border: '1.5px solid #BFDBFE' }}>
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: '#1E40AF' }}>רוצה לשתף את הדעה שלך?</p>
            <p className="text-xs mt-0.5" style={{ color: '#3B82F6' }}>הצטרף בחינם ושתף את החוויה</p>
          </div>
          <Button size="sm" className="gap-1.5 shrink-0"
            style={{ background: '#2563EB', color: '#fff' }}
            onClick={() => navigate(createPageUrl('Auth'))}>
            <LogIn className="h-4 w-4" />
            הרשמה חינמית
          </Button>
        </div>
      ) : currentUser ? (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-5 flex-wrap"
          style={{ background: '#F0FDF4', border: '1.5px solid #BBF7D0' }}>
          <p className="text-sm flex-1 min-w-0" style={{ color: '#166534' }}>
            💬 מה דעתך על האפליקציה? הפידבק שלך עוזר לנו להשתפר
          </p>
          <Button size="sm" className="gap-1.5 shrink-0"
            style={{ background: C.greenDark, color: '#fff' }}
            onClick={() => setShowReviewPopup(true)}>
            <PlusCircle className="h-4 w-4" />
            כתוב חוות דעת
          </Button>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          <Input value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="חיפוש בתוכן..." className="pr-9 text-right" />
        </div>
        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הדירוגים</SelectItem>
            <SelectItem value="5">⭐⭐⭐⭐⭐</SelectItem>
            <SelectItem value="4">⭐⭐⭐⭐</SelectItem>
            <SelectItem value="3">⭐⭐⭐</SelectItem>
            <SelectItem value="2">⭐⭐</SelectItem>
            <SelectItem value="1">⭐</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">החדש ביותר</SelectItem>
            <SelectItem value="asc">הישן ביותר</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 rounded-2xl" style={{ background: '#FAFAFA', border: '1.5px dashed #E5E7EB' }}>
          <div className="text-4xl mb-2">{hasActiveFilter ? '🔍' : '💬'}</div>
          <p className="text-sm font-bold text-gray-700">
            {hasActiveFilter ? 'אין חוות דעת בסינון הזה' : 'אין חוות דעת להצגה'}
          </p>
          {hasActiveFilter && (
            <Button size="sm" variant="outline" className="mt-3"
              onClick={() => { setRatingFilter('all'); setSearchText(''); }}>
              נקה סינון
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => <ReviewCard key={r.id} review={r} />)}
        </div>
      )}

      {/* Add-review dialog */}
      {showReviewPopup && currentUser && (
        <ReviewPopup
          open={showReviewPopup}
          onClose={(result) => {
            setShowReviewPopup(false);
            if (result === 'submitted') refetch();
          }}
          userId={currentUser.id}
          userEmail={currentUser.email}
          userName={currentUser.full_name}
        />
      )}
    </div>
  );
}
