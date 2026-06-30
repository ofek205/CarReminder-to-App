-- ═══════════════════════════════════════════════════════════════════════════
-- Redesign the reminder_test email — countdown hero + gov.il renewal CTA
-- 2026-06-26  (rev 2 — incorporates the 3-agent design review)
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT: visual upgrade of the "test about to expire" reminder email.
--   • Days-left is the hero (big tabular number) instead of buried in a
--     sentence; expiry date shown as a pill.
--   • URGENCY TIER colors the hero by days-left (driven by the dispatcher,
--     which injects {{heroBg/Fg/Num}} + {{pillBorder}}):
--       > 14 days  → green   (#EAF3EC / #2D5233)
--       4-14 days  → amber   (#FFF7E8 / #B25E09)
--       <= 3 days  → red     (#FDECEA / #C0341D)
--     The CTA button stays brand-green in every tier (protects identity).
--   • Hebrew grammar is correct at the edges (dispatcher computes the strings):
--       0 days → "הטסט פג / היום"   1 day → "נשאר / 1 / יום לטסט"
--   • Framing decision (Ofek): keep "טסט" as the subject; the body CLARIFIES
--     the two distinct steps — pass the טסט at a מכון, pay the רישוי at gov.il.
--   • PRIMARY CTA = renew/pay the annual licence on gov.il
--     (https://www.gov.il/he/service/car_licence_renewal) — same link the
--     vehicle detail page uses. SECONDARY = open the vehicle in the app.
--
-- EMAIL-RENDERING fixes from the review:
--   • Inter-block spacing via td padding-bottom (MSO drops table margins).
--   • CTA is an inline-block padded <a> (MSO/Word doesn't collapse the tap area).
--   • Arrows dropped (a "←" in RTL reads as "back" and screen readers announce
--     "left arrow").  • word-break on the vehicle name for 320px screens.
--
-- HOW: all structure lives in body_html (per-template). The generic shell
--   (buildShell / buildEmailHtml) got its own pass separately (neutral canvas,
--   footer contrast, logo images-off fallback). cta_label/cta_url are cleared
--   so the shell's auto-CTA doesn't add a duplicate button.
--
-- DEPENDENCY: the dispatcher must be redeployed (it now computes the hero/grammar
--   vars + a TZ-safe expiryDate). Vessels still get the car gov link (no type in
--   the candidate RPC) — tracked follow-up.
--
-- ⚠ Phase 4 made get_email_template() return the PUBLISHED snapshot, so we
--   re-publish after the update.  Idempotent. Run ONCE in the SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.email_templates
   SET subject     = 'תזכורת: הטסט של {{vehicleName}} {{daysPhrase}}',
       preheader   = 'פג בתאריך {{expiryDate}}. חדש/י את הרישוי עכשיו',
       title       = 'הטסט של {{vehicleName}} מתקרב',
       cta_label   = '',
       cta_url     = '',
       footer_note = 'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
       body_html   =
'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">'
|| '<tr><td style="padding:0 0 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="background:{{heroBg}};border-radius:18px;padding:24px 16px">'
|| '<div style="font-size:13px;color:{{heroFg}};font-weight:700;margin:0 0 2px">{{heroTop}}</div>'
|| '<div dir="ltr" style="font-size:54px;line-height:60px;font-weight:800;color:{{heroNum}}">{{heroBig}}</div>'
|| '<div style="font-size:14px;color:{{heroFg}};font-weight:700;margin:2px 0 0">{{heroSub}}</div>'
|| '<div style="margin:14px 0 0"><span style="display:inline-block;background:#FFFFFF;border:1px solid {{pillBorder}};border-radius:999px;padding:6px 16px;font-size:13px;color:#1C3620;font-weight:700">פג בתאריך <span dir="ltr">{{expiryDate}}</span></span></div>'
|| '</td></tr></table></td></tr>'
|| '<tr><td style="padding:0 0 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="background:#F8FAF8;border:1px solid #E5EAE6;border-radius:14px;padding:14px 16px">'
|| '<span style="font-size:15px;font-weight:800;color:#1C3620;word-break:break-word">{{vehicleName}}</span>'
|| '<span dir="ltr" style="display:inline-block;vertical-align:middle;background:#1C3620;color:#FFFFFF;border-radius:6px;padding:2px 10px;font-size:13px;margin-right:8px">{{licensePlate}}</span>'
|| '</td></tr></table></td></tr>'
|| '<tr><td style="padding:0 0 20px;text-align:center;font-size:14px;color:#4B5563;line-height:1.7">את הטסט עוברים במכון מורשה, ואת אגרת הרישוי משלמים באתר משרד התחבורה.</td></tr>'
|| '<tr><td align="center" style="padding:0 0 6px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="#2D5233" style="border-radius:14px;background:#2D5233"><a href="https://www.gov.il/he/service/car_licence_renewal" target="_blank" style="display:inline-block;padding:16px 30px;color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px">חידוש ותשלום רישוי באתר הממשלה</a></td></tr></table></td></tr>'
|| '<tr><td align="center" style="padding:8px 0 0"><a href="https://car-reminder.app/VehicleDetail?id={{vehicleId}}" target="_blank" style="display:inline-block;padding:10px 12px;color:#2D5233;font-size:14px;font-weight:700;text-decoration:underline">פתיחת פרטי הרכב באפליקציה</a></td></tr>'
|| '</table>',
       updated_at  = now()
 WHERE notification_key = 'reminder_test';

-- Re-publish so get_email_template() (which serves published_snapshot) returns
-- the new copy. Mirrors email_template_publish().
UPDATE public.email_templates et
   SET published_at       = now(),
       published_snapshot = to_jsonb(et.*)
 WHERE et.notification_key = 'reminder_test';

-- Verify:
--   SELECT subject, cta_label, left(body_html,50) AS body_start,
--          published_at IS NOT NULL AS published
--     FROM public.email_templates WHERE notification_key = 'reminder_test';
--   -- Then in /EmailCenter → תבנית → "בדיקה" send yourself a test at a few
--   -- daysLeft values (e.g. 1, 3, 14, 30) to see the grammar + urgency tiers.
