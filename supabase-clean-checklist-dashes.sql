-- ==========================================================================
-- Strip em-dashes (U+2014) and en-dashes (U+2013) from checklist item text
-- stored in vessel_checklists (templates) and vessel_checklist_runs (runs).
--
-- The code-side defaults were cleaned in an earlier commit, but rows
-- saved before that still carry the old strings with dashes in them.
-- This one-shot migration rewrites those rows by doing a regex replace
-- on the jsonb representation as text and casting back.
--
-- " — " becomes ": ".  " – " becomes ", ".  A bare "—" / "–" is dropped.
-- ==========================================================================

update public.vessel_checklists
set items = replace(
              replace(
                replace(
                  replace(items::text, ' — ', ': '),
                  ' – ', ', '
                ),
                '—', ''
              ),
              '–', ''
            )::jsonb
where items::text ~ '[—–]';

update public.vessel_checklist_runs
set items = replace(
              replace(
                replace(
                  replace(items::text, ' — ', ': '),
                  ' – ', ', '
                ),
                '—', ''
              ),
              '–', ''
            )::jsonb
where items::text ~ '[—–]';
