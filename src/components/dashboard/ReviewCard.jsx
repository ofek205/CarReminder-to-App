import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Star } from "lucide-react";
import ReviewPopup from "../shared/ReviewPopup";

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

export default function ReviewCard() {
  const [show, setShow] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function check() {
      try {
        const u = await base44.auth.me();
        if (!u) return;
        setUser(u);

        const existing = await base44.entities.UserReviewSettings.filter({ user_id: u.id });
        if (existing.length === 0) { setShow(true); return; }

        const settings = existing[0];
        if (!settings.last_review_submitted_at || daysSince(settings.last_review_submitted_at) >= 14) {
          setShow(true);
        }
      } catch (e) {}
    }
    check();
  }, []);

  if (!show || !user) return null;

  return (
    <>
      <Card className="p-4 border border-[#D8E5D9] bg-[#E8F2EA] flex items-center justify-between gap-4 mt-6" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#2D5233] flex items-center justify-center shrink-0">
            <Star className="h-4 w-4 text-white fill-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">איך האפליקציה?</p>
            <p className="text-xs text-gray-500">הפידבק שלך עוזר לי לשפר ולהוסיף פיצ'רים חדשים</p>
          </div>
        </div>
        <Button
          size="sm"
          className="bg-[#2D5233] hover:bg-[#1E3D24] text-white shrink-0"
          onClick={() => setShowPopup(true)}
        >
          דרג את האפליקציה
        </Button>
      </Card>

      {showPopup && (
        <ReviewPopup
          open={showPopup}
          onClose={(reason) => {
            setShowPopup(false);
            if (reason === "submitted") setShow(false);
          }}
          userId={user.id}
          userEmail={user.email}
          userName={user.full_name}
        />
      )}
    </>
  );
}