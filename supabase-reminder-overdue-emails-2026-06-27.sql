-- ═══════════════════════════════════════════════════════════════════════════
-- Overdue reminder emails (test + insurance) — 2026-06-27
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds a one-time "you're overdue" email for a test/insurance whose date has
-- already PASSED and still wasn't renewed. Product decision (Ofek): fire once,
-- a week after the date.
--
-- HOW IT FITS:
--   • New keys reminder_test_overdue + reminder_insurance_overdue — separate
--     from the upcoming keys so the email_send_log idempotency (user, key,
--     reference_date) doesn't clash. A user can get the upcoming reminder
--     (reminder_test, ~14d before) AND, later, the overdue one (reminder_test_
--     overdue, ~7d after) — each once, for the same due date.
--   • Candidate window for overdue: due_date BETWEEN current_date-30 AND
--     current_date-7. So it first qualifies at 7 days overdue, fires once
--     (idempotency), and the -30 floor avoids nagging about ancient/abandoned
--     vehicles. days_left comes back NEGATIVE; the dispatcher + emailRender
--     derive the red "באיחור / N / ימים מאז הפקיעה" hero from dl < 0.
--   • Local device notifications already escalate overdue every 3 days; this
--     email is the single complementary nudge, not a repeating one.
--
-- DEPENDENCY: redeploy dispatch-reminder-emails (already computes the overdue
--   hero vars after this session's change) and deploy the frontend (emailRender
--   overdue branch). Triggers are seeded enabled=FALSE — flip them on in
--   /EmailCenter when ready.
--
-- ⚠ Re-publish after the template upsert (Phase 4 serves published_snapshot).
-- Idempotent. Run ONCE in the Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Candidate RPC: add 4 overdue branches (8 total) ──────────────────────
CREATE OR REPLACE FUNCTION public.email_dispatch_candidates(p_notification_key text)
 RETURNS TABLE(user_id uuid, recipient_email text, vehicle_id uuid, vehicle_name text, license_plate text, reference_date date, days_left integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with trig as (
    select days_before, cooldown_days, conditions
    from public.email_triggers
    where notification_key = p_notification_key
      and enabled = true
  ),
  raw as (
    -- ── insurance · UPCOMING · owner ──────────────────────────────
    select am.user_id, u.email as recipient_email, v.id as vehicle_id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')) as vehicle_name,
      v.license_plate, v.insurance_due_date as reference_date,
      (v.insurance_due_date - current_date)::int as days_left, u.created_at as user_created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_insurance, true) = true
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date and current_date + coalesce(rs.remind_insurance_days_before, trig.days_before)

    union all
    -- ── insurance · UPCOMING · driver ─────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.insurance_due_date, (v.insurance_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_insurance'
      and v.insurance_due_date between current_date and current_date + coalesce(rs.remind_insurance_days_before, trig.days_before)
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_insurance, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')

    union all
    -- ── test · UPCOMING · owner ───────────────────────────────────
    select am.user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_test, true) = true
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date and current_date + coalesce(rs.remind_test_days_before, trig.days_before)

    union all
    -- ── test · UPCOMING · driver ──────────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_test'
      and v.test_due_date between current_date and current_date + coalesce(rs.remind_test_days_before, trig.days_before)
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_test, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')

    union all
    -- ── insurance · OVERDUE · owner (7..30 days past) ─────────────
    select am.user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.insurance_due_date, (v.insurance_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_insurance, true) = true
    cross join trig
    where p_notification_key = 'reminder_insurance_overdue'
      and v.insurance_due_date between current_date - 30 and current_date - 7

    union all
    -- ── insurance · OVERDUE · driver ──────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.insurance_due_date, (v.insurance_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_insurance_overdue'
      and v.insurance_due_date between current_date - 30 and current_date - 7
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_insurance, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')

    union all
    -- ── test · OVERDUE · owner ────────────────────────────────────
    select am.user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.account_members am on am.account_id = v.account_id and am.role = 'בעלים'
    join auth.users u on u.id = am.user_id
    join public.reminder_settings rs on rs.user_id = am.user_id
      and rs.email_enabled = true and coalesce(rs.notify_test, true) = true
    cross join trig
    where p_notification_key = 'reminder_test_overdue'
      and v.test_due_date between current_date - 30 and current_date - 7

    union all
    -- ── test · OVERDUE · driver ───────────────────────────────────
    select da.driver_user_id, u.email, v.id,
      coalesce(v.nickname, v.manufacturer || ' ' || coalesce(v.model, '')),
      v.license_plate, v.test_due_date, (v.test_due_date - current_date)::int, u.created_at
    from public.vehicles v
    join public.driver_assignments da on da.vehicle_id = v.id and da.status = 'active' and (da.valid_to is null or da.valid_to > now())
    join auth.users u on u.id = da.driver_user_id
    left join public.reminder_settings rs on rs.user_id = da.driver_user_id
    cross join trig
    where p_notification_key = 'reminder_test_overdue'
      and v.test_due_date between current_date - 30 and current_date - 7
      and coalesce(rs.email_enabled, false) = true and coalesce(rs.notify_test, true) = true
      and not exists (select 1 from public.account_members am2 where am2.account_id = v.account_id and am2.user_id = da.driver_user_id and am2.role = 'בעלים')
  )
  select r.user_id, r.recipient_email, r.vehicle_id, r.vehicle_name, r.license_plate, r.reference_date, r.days_left
  from raw r
  cross join trig t
  where not exists (
    select 1 from public.email_send_log esl
    where esl.user_id = r.user_id and esl.notification_key = p_notification_key
      and esl.reference_date = r.reference_date
      and esl.sent_at > now() - (t.cooldown_days || ' days')::interval
  )
  and (
    (t.conditions->>'min_days_since_signup') is null
    or r.user_created_at < now() - ((t.conditions->>'min_days_since_signup')::int || ' days')::interval
  );
$function$;

-- ── 2. Catalog rows (enabled so the template can render; trigger gates send) ─
INSERT INTO public.email_notifications (key, display_name, description, category, enabled, trigger_type, is_implemented)
VALUES
  ('reminder_test_overdue',      'התראת איחור — טסט',   'נשלח פעם אחת כ-7 ימים אחרי שתוקף הטסט פג ולא חודש.',  'reminder', true, 'time', true),
  ('reminder_insurance_overdue', 'התראת איחור — ביטוח', 'נשלח פעם אחת כ-7 ימים אחרי שתוקף הביטוח פג ולא חודש.', 'reminder', true, 'time', true)
ON CONFLICT (key) DO NOTHING;

-- ── 3. Trigger rows (OFF by default — flip on in EmailCenter when ready) ─────
INSERT INTO public.email_triggers (notification_key, enabled, days_before, cooldown_days)
VALUES
  ('reminder_test_overdue',      false, 7, 60),
  ('reminder_insurance_overdue', false, 7, 60)
ON CONFLICT (notification_key) DO NOTHING;

-- ── 4. Templates ─────────────────────────────────────────────────────────────
-- Shared body shell (hero + vehicle row + action + CTA), {{...}} placeholders
-- the dispatcher/emailRender fill. Hero vars resolve to the red overdue tier.
INSERT INTO public.email_templates (notification_key, subject, preheader, title, body_html, cta_label, cta_url, footer_note, variables)
VALUES
  ('reminder_test_overdue',
   'התראה: הטסט של {{vehicleName}} {{daysPhrase}}',
   'פג בתאריך {{expiryDate}} ועדיין לא חודש',
   'הטסט של {{vehicleName}} באיחור',
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
   || '<tr><td style="padding:0 0 20px;text-align:center;font-size:14px;color:#4B5563;line-height:1.7">הטסט פג ועדיין לא חודש. נהיגה ללא טסט בתוקף היא עבירה ועלולה לפסול את כיסוי הביטוח. מומלץ לטפל בהקדם.</td></tr>'
   || '<tr><td align="center" style="padding:0 0 6px"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="#2D5233" style="border-radius:14px;background:#2D5233"><a href="https://www.gov.il/he/service/car_licence_renewal" target="_blank" style="display:inline-block;padding:16px 30px;color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px">חידוש ותשלום רישוי באתר הממשלה</a></td></tr></table></td></tr>'
   || '<tr><td align="center" style="padding:8px 0 0"><a href="https://car-reminder.app/VehicleDetail?id={{vehicleId}}" target="_blank" style="display:inline-block;padding:10px 12px;color:#2D5233;font-size:14px;font-weight:700;text-decoration:underline">פתיחת פרטי הרכב באפליקציה</a></td></tr>'
   || '</table>',
   '', '', 'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
   '["vehicleName","licensePlate","expiryDate","vehicleId"]'::jsonb),

  ('reminder_insurance_overdue',
   'התראה: הביטוח של {{vehicleName}} {{daysPhrase}}',
   'פג בתאריך {{expiryDate}} ועדיין לא חודש',
   'הביטוח של {{vehicleName}} באיחור',
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
   || '<tr><td style="padding:0 0 20px;text-align:center;font-size:14px;color:#4B5563;line-height:1.7">הביטוח פג ועדיין לא חודש. נהיגה ללא ביטוח בתוקף אסורה ומסוכנת. מומלץ לחדש מיד מול חברת הביטוח.</td></tr>'
   || '<tr><td align="center" style="padding:0"><table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center"><tr><td align="center" bgcolor="#2D5233" style="border-radius:14px;background:#2D5233"><a href="https://car-reminder.app/VehicleDetail?id={{vehicleId}}" target="_blank" style="display:inline-block;padding:16px 30px;color:#FFFFFF;font-size:16px;font-weight:800;text-decoration:none;border-radius:14px">פתיחת פרטי הרכב באפליקציה</a></td></tr></table></td></tr>'
   || '</table>',
   '', '', 'אפשר להשבית תזכורות מייל מההגדרות > התראות.',
   '["vehicleName","licensePlate","expiryDate","vehicleId"]'::jsonb)
ON CONFLICT (notification_key) DO NOTHING;

-- Re-publish so get_email_template() serves the new copy.
UPDATE public.email_templates et
   SET published_at = now(), published_snapshot = to_jsonb(et.*)
 WHERE et.notification_key IN ('reminder_test_overdue', 'reminder_insurance_overdue');

-- Verify:
--   SELECT notification_key, enabled FROM public.email_triggers WHERE notification_key LIKE '%overdue';
--   SELECT count(*) FROM public.email_dispatch_candidates('reminder_test_overdue');
