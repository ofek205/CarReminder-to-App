import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import ReviewPopup from "./ReviewPopup";

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
}

export default function ReviewManager() {
  const [showPopup, setShowPopup] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [userName, setUserName] = useState(null);
  const [settingsId, setSettingsId] = useState(null);

  useEffect(() => {
    async function check() {
      try {
        const user = await base44.auth.me();
        if (!user) return;

        setUserId(user.id);
        setUserEmail(user.email);
        setUserName(user.full_name);

        // Load or create settings
        let settings;
        const existing = await base44.entities.UserReviewSettings.filter({ user_id: user.id });

        if (existing.length === 0) {
          settings = await base44.entities.UserReviewSettings.create({
            user_id: user.id,
            first_login_at: new Date().toISOString(),
            user_actions_count: 0,
            review_prompt_dismiss_count: 0,
          });
        } else {
          settings = existing[0];
        }

        setSettingsId(settings.id);

        // Check conditions
        const daysSinceFirstLogin = daysSince(settings.first_login_at);
        if (daysSinceFirstLogin < 1) return;
        if ((settings.user_actions_count || 0) < 1) return;
        if (settings.last_review_submitted_at && daysSince(settings.last_review_submitted_at) < 14) return;
        if (settings.last_review_prompt_at && daysSince(settings.last_review_prompt_at) < 1) return;
        if (settings.prompt_snoozed_until && new Date(settings.prompt_snoozed_until) > new Date()) return;
        if (settings.last_review_prompt_at && daysSince(settings.last_review_prompt_at) < 14 && settings.last_review_submitted_at == null) {
          // Only re-show after 14 days if never submitted
          return;
        }

        // Small delay so it doesn't pop up immediately on page load
        setTimeout(() => setShowPopup(true), 3000);
      } catch (e) {
        // silent
      }
    }
    check();
  }, []);

  if (!showPopup || !userId) return null;

  return (
    <ReviewPopup
      open={showPopup}
      onClose={() => setShowPopup(false)}
      userId={userId}
      userEmail={userEmail}
      userName={userName}
    />
  );
}

// Utility to track user actions - call this from relevant pages
export async function trackUserAction(userId) {
  try {
    const existing = await base44.entities.UserReviewSettings.filter({ user_id: userId });
    if (existing.length > 0) {
      const current = existing[0];
      await base44.entities.UserReviewSettings.update(current.id, {
        user_actions_count: (current.user_actions_count || 0) + 1,
      });
    }
  } catch (e) {
    // silent
  }
}