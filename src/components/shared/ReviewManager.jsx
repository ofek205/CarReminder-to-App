import { useEffect, useState } from "react";
// ReviewManager is temporarily disabled during Base44→Supabase migration.
// The review entities (UserReviewSettings, Review) need to be created in Supabase first.

export default function ReviewManager() {
  // Disabled - will re-enable after Supabase migration
  return null;
}

// Utility to track user actions - no-op during migration
export async function trackUserAction(userId) {
  // Will be re-enabled after Supabase migration
}
