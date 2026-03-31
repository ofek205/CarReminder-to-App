import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function ReviewPopup({ open, onClose, userId, userEmail, userName }) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!rating) return;
    setLoading(true);
    try {
      await base44.entities.Review.create({
        user_id: userId,
        user_email: userEmail,
        user_name: userName,
        rating,
        comment: comment.trim() || undefined,
        app_version: "1.0",
      });

      const now = new Date().toISOString();
      const existing = await base44.entities.UserReviewSettings.filter({ user_id: userId });
      if (existing.length > 0) {
        await base44.entities.UserReviewSettings.update(existing[0].id, {
          last_review_submitted_at: now,
          last_review_prompt_at: now,
        });
      }

      toast.success("תודה! הפידבק נשמר 🙏");
      onClose("submitted");
    } finally {
      setLoading(false);
    }
  };

  const handleSnooze = async () => {
    const snoozeUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const existing = await base44.entities.UserReviewSettings.filter({ user_id: userId });
    if (existing.length > 0) {
      await base44.entities.UserReviewSettings.update(existing[0].id, {
        prompt_snoozed_until: snoozeUntil,
        last_review_prompt_at: now,
      });
    }
    onClose("snoozed");
  };

  const handleDismiss = async () => {
    const now = new Date().toISOString();
    const existing = await base44.entities.UserReviewSettings.filter({ user_id: userId });
    if (existing.length > 0) {
      const current = existing[0];
      await base44.entities.UserReviewSettings.update(current.id, {
        last_review_prompt_at: now,
        review_prompt_dismiss_count: (current.review_prompt_dismiss_count || 0) + 1,
      });
    }
    onClose("dismissed");
  };

  const displayRating = hoveredRating || rating;

  return (
    <Dialog open={open} onOpenChange={() => handleDismiss()}>
      <DialogContent className="max-w-md text-right" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 text-center">
            מה דעתך על האפליקציה? 😊
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-gray-600 text-center text-sm leading-relaxed">
            הפידבק שלך עוזר לי לשפר ולהוסיף פיצ'רים חדשים 🙏
          </p>

          {/* Stars */}
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoveredRating(star)}
                onMouseLeave={() => setHoveredRating(0)}
                className="transition-transform hover:scale-110"
              >
                <Star
                  className={`h-9 w-9 transition-colors ${
                    star <= displayRating
                      ? "text-yellow-400 fill-yellow-400"
                      : "text-gray-300"
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Comment field - shows after rating selected */}
          {rating > 0 && (
            <div className="space-y-1">
              <p className="text-sm text-gray-600">יש משהו שהיית רוצה שנשפר או נוסיף?</p>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="כתוב כאן..."
                className="text-right resize-none"
                rows={3}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-1">
            <Button
              onClick={handleSubmit}
              disabled={!rating || loading}
              className="w-full bg-[#2D5233] hover:bg-[#1E3D24] text-white"
            >
              שלח
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 text-sm"
                onClick={handleSnooze}
              >
                אולי אחר כך
              </Button>
              <Button
                variant="ghost"
                className="flex-1 text-sm text-gray-400"
                onClick={handleDismiss}
              >
                לא עכשיו
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}