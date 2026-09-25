-- ═══════════════════════════════════════════════════════════════════════════
-- צמ"ה versions of the two test-reminder emails, 2026-09-25
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: a צמ"ה licence is renewed by paying the licence fee to the Ministry
--   of Transport, not by a test at a station, and it has its own gov.il
--   page. The test reminders say "טסט", send the reader to a מכון מורשה and
--   link to the car licence page. Ofek, 2026-09-25: separate templates, so
--   the צמ"ה wording stays editable in EmailCenter and car emails are not
--   touched at all.
--
-- WHAT: two notification rows and two published templates:
--   reminder_test_cme          the צמ"ה version of reminder_test
--   reminder_test_overdue_cme  the צמ"ה version of reminder_test_overdue
--   Each is built from the LIVE published version of its car template:
--   subject and title rewritten, the advice sentence swapped, the gov.il
--   link swapped. Everything else (layout, hero, pill, footer, sender) is
--   the car template's as it is today.
--
-- NOT TOUCHED: reminder_test, reminder_test_overdue, and every other row.
--   No trigger rows: the dispatcher uses these only as the template for a
--   צמ"ה recipient of the regular trigger. Switching one off in EmailCenter
--   means "send that vehicle the regular template", not "send nothing".
--
-- ORDER: either. Until dispatch-reminder-emails is deployed from
--   fix/cme-email-templates (or later) the rows are simply never read.
--
-- SAFETY: one transaction. Stops with an error, changing nothing, if a car
--   template no longer holds the exact sentence or link being swapped
--   exactly once (someone edited it since). Re-running is safe: a צמ"ה
--   template that already exists is left as it is, admin edits included,
--   and is not re-published.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  c_car_url constant text := 'https://www.gov.il/he/service/car_licence_renewal';
  c_cme_url constant text := 'https://www.gov.il/he/service/license_fee_for_heavy_construction_equipment';
  r      record;
  b      record;
  v_body text;
  v_rows int;
begin
  for r in
    select * from (values
      ('reminder_test', 'reminder_test_cme',
       'תזכורת רישוי צמ"ה',
       'נשלח לכלי צמ"ה במקום תזכורת הטסט. כבוי: הכלי יקבל את תזכורת הטסט הרגילה.',
       'תזכורת: תוקף הרישוי של {{vehicleName}} {{daysPhrase}}',
       'תוקף הרישוי של {{vehicleName}} עומד לפוג',
       'את הטסט עוברים במכון מורשה, ואת אגרת הרישוי משלמים באתר משרד התחבורה.',
       'את הרישוי מחדשים בתשלום אגרת רישוי צמ"ה באתר משרד התחבורה.'),
      ('reminder_test_overdue', 'reminder_test_overdue_cme',
       'התראת איחור: רישוי צמ"ה',
       'נשלח לכלי צמ"ה במקום התראת האיחור של הטסט. כבוי: הכלי יקבל את ההתראה הרגילה.',
       'התראה: תוקף הרישוי של {{vehicleName}} {{daysPhrase}}',
       'תוקף הרישוי של {{vehicleName}} פג',
       'הטסט פג ועדיין לא חודש. נהיגה ללא טסט בתוקף היא עבירה ועלולה לפסול את כיסוי הביטוח. מומלץ לטפל בהקדם.',
       'תוקף הרישוי פג ועדיין לא חודש. הפעלת כלי ללא רישוי בתוקף אסורה ועלולה לפגוע בכיסוי הביטוח. מומלץ לטפל בהקדם.')
    ) as t(base_key, cme_key, display_name, description, subject, title, car_sentence, cme_sentence)
  loop
    if exists (select 1 from public.email_templates where notification_key = r.cme_key) then
      raise notice '% already exists, left as it is', r.cme_key;
      continue;
    end if;

    -- The version the dispatcher serves today (get_email_template() reads the
    -- published snapshot first, then the columns).
    select coalesce(et.published_snapshot->>'preheader',   et.preheader)   as preheader,
           coalesce(et.published_snapshot->>'body_html',   et.body_html)   as body_html,
           coalesce(et.published_snapshot->>'cta_label',   et.cta_label)   as cta_label,
           coalesce(et.published_snapshot->>'cta_url',     et.cta_url)     as cta_url,
           coalesce(et.published_snapshot->>'footer_note', et.footer_note) as footer_note,
           coalesce(et.published_snapshot->>'from_name',   et.from_name)   as from_name,
           coalesce(et.published_snapshot->>'from_email',  et.from_email)  as from_email,
           coalesce(et.published_snapshot->>'reply_to',    et.reply_to)    as reply_to,
           coalesce(et.published_snapshot->'variables',    et.variables)   as variables
      into b
      from public.email_templates et
     where et.notification_key = r.base_key;
    if not found then
      raise exception '% has no template; nothing was changed', r.base_key;
    end if;

    -- Exactly one of each, or stop: a partial swap would send a צמ"ה owner
    -- half-car advice, or a car link under צמ"ה wording.
    if (length(b.body_html) - length(replace(b.body_html, r.car_sentence, ''))) / length(r.car_sentence) <> 1 then
      raise exception '% no longer holds the advice sentence exactly once; nothing was changed', r.base_key;
    end if;
    if (length(b.body_html) - length(replace(b.body_html, c_car_url, ''))) / length(c_car_url) <> 1 then
      raise exception '% no longer holds the gov.il link exactly once; nothing was changed', r.base_key;
    end if;

    v_body := replace(replace(b.body_html, r.car_sentence, r.cme_sentence), c_car_url, c_cme_url);

    insert into public.email_notifications
      (key, display_name, description, category, enabled, trigger_type, is_implemented)
    values
      (r.cme_key, r.display_name, r.description, 'reminder', true, 'time', true)
    on conflict (key) do nothing;

    insert into public.email_templates
      (notification_key, subject, preheader, title, body_html, cta_label, cta_url, footer_note,
       from_name, from_email, reply_to, variables)
    values
      (r.cme_key, r.subject, b.preheader, r.title, v_body, b.cta_label, b.cta_url, b.footer_note,
       b.from_name, b.from_email, b.reply_to, b.variables)
    on conflict (notification_key) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise notice '% appeared meanwhile, left as it is', r.cme_key;
      continue;
    end if;

    -- Publish, as email_template_publish() does: the dispatcher serves the
    -- snapshot, not the columns.
    update public.email_templates et
       set published_at = now(), published_snapshot = to_jsonb(et.*)
     where et.notification_key = r.cme_key;

    raise notice '% created and published from %', r.cme_key, r.base_key;
  end loop;
end $$;

commit;

-- Verify: expect two rows, every column true, and the two subjects.
select t.notification_key,
       n.enabled                                                                                      as enabled,
       t.published_snapshot is not null                                                               as published,
       strpos(t.published_snapshot->>'body_html', 'license_fee_for_heavy_construction_equipment') > 0 as cme_link,
       strpos(t.published_snapshot->>'body_html', 'car_licence_renewal') = 0                          as no_car_link,
       strpos(t.published_snapshot->>'body_html' || (t.published_snapshot->>'title')
              || (t.published_snapshot->>'subject'), 'טסט') = 0                                       as no_test_word,
       t.published_snapshot->>'subject'                                                               as subject
  from public.email_templates t
  join public.email_notifications n on n.key = t.notification_key
 where t.notification_key in ('reminder_test_cme', 'reminder_test_overdue_cme')
 order by 1;
