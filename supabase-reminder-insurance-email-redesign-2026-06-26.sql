-- ═══════════════════════════════════════════════════════════════════════════
-- Redesign the reminder_insurance email — match the reminder_test treatment
-- 2026-06-26
-- ═══════════════════════════════════════════════════════════════════════════
-- Same visual system as supabase-reminder-test-email-redesign-2026-06-26.sql:
--   • Countdown hero with the urgency tier the dispatcher injects
--     (green > 14d · amber 4-14d · red <= 3d) via {{heroBg/Fg/Num}} +
--     {{pillBorder}} + {{heroTop/Big/Sub}}. The dispatcher now says
--     "ימים לביטוח" (not "לטסט") for this key.
--   • Clean vehicle row, no em-dashes, no redundant intro line.
--
-- DIFFERENCE vs the test email: insurance is renewed with the user's PRIVATE
--   insurer — there is NO government link. So the primary (only) CTA opens the
--   vehicle in the app, where the user can review the policy and upload the
--   renewed one. cta_label/cta_url stay cleared (button lives in body_html).
--
-- DEPENDENCY: dispatcher must be redeployed (computes the hero/grammar/urgency
--   vars + TZ-safe date). reminder_insurance is currently enabled=false in
--   email_triggers — flip it on in /EmailCenter when ready (after test settles,
--   mind the Resend 100/day cap).
--
-- ⚠ Re-publish after the update (Phase 4 get_email_template serves the snapshot).
-- Idempotent. Run ONCE in the SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.email_templates
   SET subject     = 'תזכורת: הביטוח של {{vehicleName}} {{daysPhrase}}',
       preheader   = 'פג בתאריך {{expiryDate}}. כדאי לחדש בזמן',
       title       = 'הביטוח של {{vehicleName}} מתקרב',
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
|| '<tr><td style="padding:0 0 20px;text-align:center;font-size:14px;color:#4B5563;line-height:1.7">כדאי לחדש את הביטוח מול חברת הביטוח לפני מועד הפקיעה.</td></tr>'
|| '<tr><td align="center" style="padding:0"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="#2D5233" style="border-radius:14px;background:#2D5233"><a href="https://car-reminder.app/VehicleDetail?id={{vehicleId}}" target="_blank" style="display:inline-block;padding:16px 30px;color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px">פתיחת פרטי הרכב באפליקציה</a></td></tr></table></td></tr>'
|| '</table>',
       updated_at  = now()
 WHERE notification_key = 'reminder_insurance';

UPDATE public.email_templates et
   SET published_at       = now(),
       published_snapshot = to_jsonb(et.*)
 WHERE et.notification_key = 'reminder_insurance';

-- Verify:
--   SELECT subject, left(body_html,50) AS body_start, published_at IS NOT NULL
--     FROM public.email_templates WHERE notification_key = 'reminder_insurance';
