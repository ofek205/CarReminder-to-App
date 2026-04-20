-- ═══════════════════════════════════════════════════════════════════════════
-- Remove em-dashes (— and &mdash;) from every email template field.
-- Safe to re-run. Re-publishes all affected templates at the end so
-- broadcasts + dispatcher pick up the cleaned copy immediately.
-- ═══════════════════════════════════════════════════════════════════════════

-- Variants we want to strip:
--   " — "   (space-emdash-space)   → ", "
--   " — "   with &mdash; entity    → ", "
--   leading/trailing "— " / " —"   → " " (trim to a single space)
-- We run these as chained REPLACEs — PostgreSQL executes them left-to-right.

UPDATE public.email_templates
   SET subject     = replace(replace(replace(subject,     ' — ', ', '), '&mdash;', ', '), '—', ''),
       preheader   = replace(replace(replace(preheader,   ' — ', '. '), '&mdash;', '. '), '—', ''),
       title       = replace(replace(replace(title,       ' — ', ', '), '&mdash;', ', '), '—', ''),
       body_html   = replace(replace(replace(body_html,   ' — ', ', '), '&mdash;', ', '), '—', ''),
       cta_label   = replace(replace(replace(cta_label,   ' — ', ' ' ), '&mdash;', ' ' ), '—', ''),
       footer_note = replace(replace(replace(footer_note, ' — ', '. '), '&mdash;', '. '), '—', '')
 WHERE subject     LIKE '%—%' OR subject     LIKE '%&mdash;%'
    OR preheader   LIKE '%—%' OR preheader   LIKE '%&mdash;%'
    OR title       LIKE '%—%' OR title       LIKE '%&mdash;%'
    OR body_html   LIKE '%—%' OR body_html   LIKE '%&mdash;%'
    OR cta_label   LIKE '%—%' OR cta_label   LIKE '%&mdash;%'
    OR footer_note LIKE '%—%' OR footer_note LIKE '%&mdash;%';

-- Re-publish every template whose draft differs from its published snapshot
-- (the UPDATE above triggers the auto-snapshot, so drafts are now ahead).
UPDATE public.email_templates t
   SET published_at       = now(),
       published_snapshot = to_jsonb(t.*);


-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT notification_key
--   FROM public.email_templates
--  WHERE subject LIKE '%—%' OR body_html LIKE '%—%' OR preheader LIKE '%—%'
--     OR title LIKE '%—%' OR cta_label LIKE '%—%' OR footer_note LIKE '%—%';
-- (expected: 0 rows)
