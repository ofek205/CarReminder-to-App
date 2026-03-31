import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
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
import { Star, Search, PlusCircle, LogIn } from "lucide-react";
import { format } from "date-fns";

function StarDisplay({ rating }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`h-4 w-4 ${s <= rating ? "text-yellow-400 fill-yellow-400" : "text-gray-200"}`}
        />
      ))}
    </div>
  );
}

export default function AdminReviews() {
  const { isGuest, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [ratingFilter, setRatingFilter] = useState("all");
  const [searchText, setSearchText]     = useState("");
  const [sortOrder, setSortOrder]       = useState("desc");
  const [isAdmin, setIsAdmin]           = useState(null);
  const [currentUser, setCurrentUser]   = useState(null);
  const [showReviewPopup, setShowReviewPopup] = useState(false);

  // Guests skip the auth.me() call — they are never admin and have no currentUser
  useEffect(() => {
    if (isGuest) {
      setIsAdmin(false);
      setCurrentUser(null);
      return;
    }
    base44.auth.me()
      .then((user) => {
        setCurrentUser(user || null);
        setIsAdmin(user?.role === "admin");
      })
      .catch(() => { setIsAdmin(false); setCurrentUser(null); });
  }, [isGuest]);

  // Load reviews for everyone (guests and authenticated users)
  const { data: reviews = [], isLoading, refetch } = useQuery({
    queryKey: ["reviews-public"],
    queryFn: () => base44.entities.Review.list(),
    enabled: isAdmin !== null,
  });

  if (isAdmin === null || isLoading) return <LoadingSpinner />;

  const filtered = reviews
    .filter((r) => {
      if (ratingFilter !== "all" && r.rating !== parseInt(ratingFilter)) return false;
      if (searchText) {
        const q = searchText.toLowerCase();
        return (
          (r.comment || "").toLowerCase().includes(q) ||
          (r.user_name || "").toLowerCase().includes(q) ||
          (isAdmin && (r.user_email || "").toLowerCase().includes(q))
        );
      }
      return true;
    })
    .sort((a, b) => {
      const da = new Date(a.created_date || 0);
      const db = new Date(b.created_date || 0);
      return sortOrder === "desc" ? db - da : da - db;
    });

  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : "—";

  return (
    <div dir="rtl">
      <PageHeader
        title="חוות דעת משתמשים"
        subtitle={`${reviews.length} חוות דעת · ממוצע: ${avgRating} ⭐`}
      />

      {/* ── CTA bar: different for guest vs authenticated ── */}
      {isGuest ? (
        /* Guest: read-only notice with register CTA */
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium text-blue-800">
              רוצה לשתף את החוות דעת שלך?
            </p>
            <p className="text-xs text-blue-600 mt-0.5">
              הצטרף בחינם ושתף את הניסיון שלך עם האפליקציה
            </p>
          </div>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shrink-0"
            onClick={() => navigate(createPageUrl("Auth"))}
          >
            <LogIn className="h-4 w-4" />
            הרשמה חינמית
          </Button>
        </div>
      ) : currentUser ? (
        /* Authenticated: show add review button */
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 gap-3 flex-wrap">
          <p className="text-sm text-amber-800">
            מה דעתך על האפליקציה? הפידבק שלך עוזר לנו להשתפר 🙏
          </p>
          <Button
            size="sm"
            className="bg-[#2D5233] hover:bg-[#1E3D24] text-white gap-1.5 shrink-0"
            onClick={() => setShowReviewPopup(true)}
          >
            <PlusCircle className="h-4 w-4" />
            הוסף חוות דעת
          </Button>
        </div>
      ) : null}

      {/* ── Filters (available to all) ── */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="חיפוש בטקסט..."
            className="pr-9 text-right"
          />
        </div>
        <Select value={ratingFilter} onValueChange={setRatingFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="כל הדירוגים" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הדירוגים</SelectItem>
            <SelectItem value="5">⭐⭐⭐⭐⭐ (5)</SelectItem>
            <SelectItem value="4">⭐⭐⭐⭐ (4)</SelectItem>
            <SelectItem value="3">⭐⭐⭐ (3)</SelectItem>
            <SelectItem value="2">⭐⭐ (2)</SelectItem>
            <SelectItem value="1">⭐ (1)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortOrder} onValueChange={setSortOrder}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">החדש ביותר</SelectItem>
            <SelectItem value="asc">הישן ביותר</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Reviews list (read-only for guests, same for all) ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">אין חוות דעת להצגה</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((review) => (
            <Card key={review.id} className="p-4 border border-gray-100">
              <div className="flex items-start justify-between gap-4">
                <div className="text-xs text-gray-400 shrink-0">
                  {review.created_date
                    ? format(new Date(review.created_date), "dd/MM/yyyy")
                    : "—"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <StarDisplay rating={review.rating} />
                    <span className="text-sm font-medium text-gray-700">
                      {review.user_name || "משתמש"}
                    </span>
                    {/* Email only visible to admin */}
                    {isAdmin && review.user_email && (
                      <span className="text-xs text-gray-400">{review.user_email}</span>
                    )}
                  </div>
                  {review.comment && (
                    <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                      {review.comment}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── "Sign up" nudge at the bottom for guests ── */}
      {isGuest && reviews.length > 0 && (
        <div className="mt-6 border border-dashed border-blue-200 rounded-xl p-5 text-center bg-blue-50/50">
          <p className="text-sm font-medium text-blue-800 mb-1">נהנית לקרוא?</p>
          <p className="text-xs text-blue-600 mb-3">
            הצטרף לאפליקציה בחינם כדי לשתף גם את החוות דעת שלך
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-100 gap-1.5"
            onClick={() => navigate(createPageUrl("Auth"))}
          >
            <LogIn className="h-4 w-4" />
            הרשמה חינמית
          </Button>
        </div>
      )}

      {/* ── Review submission popup (authenticated only) ── */}
      {showReviewPopup && currentUser && (
        <ReviewPopup
          open={showReviewPopup}
          onClose={(result) => {
            setShowReviewPopup(false);
            if (result === "submitted") refetch();
          }}
          userId={currentUser.id}
          userEmail={currentUser.email}
          userName={currentUser.full_name}
        />
      )}
    </div>
  );
}
