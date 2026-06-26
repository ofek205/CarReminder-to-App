-- ═══════════════════════════════════════════════════════════════════════════
-- Mark reminder_license + reminder_maintenance as NOT implemented — 2026-06-26
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY:
--   The email reminder dispatcher resolves candidates via
--   email_dispatch_candidates(notification_key), which only has UNION
--   clauses for reminder_insurance (insurance_due_date) and reminder_test
--   (test_due_date). There is NO clause for reminder_license or
--   reminder_maintenance — so if an admin enables either trigger, the
--   dispatcher runs, returns 0 candidates, records matched=0, and reports
--   a "successful" run while sending nothing. A silent no-op footgun.
--
--   These two are NOT a missing SQL clause — they're an unbuilt feature,
--   and the data model doesn't fit the date-based email pipeline:
--     • maintenance (טיפול) is USAGE-based (km / engine-hours / service
--       logs), computed in src/components/shared/ReminderEngine.js with
--       dueDate=null. There is no maintenance_due_date column to key on.
--     • license (רישוי) has no dedicated date column; in IL it tracks the
--       annual test (test_due_date is authoritative) or document expiry.
--   Both are correctly served TODAY by local device notifications (the
--   ReminderEngine), not by the date-based email path.
--
--   supabase-email-center-full-control.sql (2026-05-17) had flipped ALL
--   reminder rows to is_implemented=true for UI completeness. This reverts
--   the two that aren't actually wired, so the EmailCenter UI shows the
--   "לא מיושם עדיין" badge again and (with the matching UI change in
--   NotificationTypeRow.jsx + TriggersTab.jsx) disables their enable toggle.
--
-- Idempotent. Run ONCE in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.email_notifications
   SET is_implemented = false,
       updated_at     = now()
 WHERE key IN ('reminder_license', 'reminder_maintenance')
   AND is_implemented IS DISTINCT FROM false;

-- Belt-and-suspenders: ensure their dispatch triggers are OFF (they default
-- false, but make it explicit so a stale UI flip can't leave them armed).
UPDATE public.email_triggers
   SET enabled    = false,
       updated_at = now()
 WHERE notification_key IN ('reminder_license', 'reminder_maintenance')
   AND enabled IS DISTINCT FROM false;

-- Verify:
--   SELECT key, display_name, enabled, is_implemented
--     FROM public.email_notifications
--    WHERE key LIKE 'reminder_%' ORDER BY key;
--   SELECT notification_key, enabled FROM public.email_triggers ORDER BY notification_key;
