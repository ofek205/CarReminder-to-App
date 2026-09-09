-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-offline-insert-id-check-2026-09-09.sql
--
-- READ-ONLY. Changes nothing. Answers the second open prerequisite in
-- src/lib/dal/queueWrite.js, which is currently sidestepped rather than
-- settled:
--
--     "CLIENT-SUPPLIED IDS on insert are unverified against each table's RLS
--      `WITH CHECK`. So none is sent: a queued create carries no `id`, the
--      server assigns it, and the optimistic row's local id is replaced when
--      `invalidates` refetches after the flush."
--
-- WHY IT IS WORTH SETTLING RATHER THAN LEAVING SIDESTEPPED
--   Sending no id works, but it costs idempotent replay. Today a queued
--   insert that reaches the server and then loses its acknowledgement (the
--   flush dies mid-request, the tab is closed, the process is killed) has no
--   way to be retried safely: the retry is a second insert with no key to
--   collide on, so the user gets a duplicate row. The outbox handles this by
--   treating 23505 unique-violation as SUCCESS on replay, which only works
--   for tables that HAVE a unique constraint to violate.
--
--   With a client-supplied id, a replay becomes `on conflict (id) do nothing`
--   and the duplicate class disappears. That is the reason to ask this
--   question before widening insert coverage, not after.
--
-- WHAT TO LOOK FOR IN THE OUTPUT
--   Section 1 lists every RLS policy on the offline-write tables. For a
--   client id to be safe on insert, a table's INSERT policy's `with_check`
--   must not depend on `id` at all — it should constrain ownership
--   (`account_id`, `user_id`, `auth.uid()`), which a client-chosen uuid does
--   not affect. If any `with_check` references `id`, that table is a NO and
--   must keep sending nothing.
--
--   Section 2 confirms `id` has a server default (gen_random_uuid or similar).
--   A client id is only additive if the column can still generate its own
--   when none is sent, otherwise every non-queued insert path breaks.
--
--   Section 3 lists unique constraints, which is what the outbox's
--   23505-means-success rule actually leans on today. A table with none of
--   them and no client id has no idempotency story at all.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Section 1: RLS policies, with the INSERT check expressions ────────────
select
  p.tablename,
  p.policyname,
  p.cmd,
  p.qual        as using_expression,
  p.with_check,
  -- The answer, spelled out per policy rather than left to the reader.
  case
    when p.cmd not in ('INSERT', 'ALL')      then 'n/a (not an insert path)'
    when p.with_check is null                then 'no with_check — nothing to violate'
    when p.with_check ilike '%id%'
     and p.with_check !~* '(account_id|user_id|vehicle_id|owner_id|created_by)'
                                             then 'REVIEW — references a bare id'
    else 'ok — constrains ownership, not id'
  end as client_id_verdict
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in (
    'accidents', 'app_notifications', 'cork_notes', 'documents',
    'maintenance_logs', 'maintenance_reminder_prefs', 'notification_log',
    'reminder_settings', 'reminder_snoozes', 'repair_logs', 'repair_types',
    'user_notification_preferences', 'user_preferences', 'user_profiles',
    'vehicles', 'vessel_checklist_runs', 'vessel_checklists', 'vessel_issues'
  )
order by p.tablename, p.cmd, p.policyname;

-- ── Section 2: can `id` still default itself if the client sends none? ────
select
  c.relname                as table_name,
  a.attname                as column_name,
  format_type(a.atttypid, a.atttypmod) as type,
  pg_get_expr(d.adbin, d.adrelid)      as column_default,
  (d.adbin is not null)    as has_default
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a  on a.attrelid = c.oid and a.attname = 'id'
                    and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relname in (
    'accidents', 'app_notifications', 'cork_notes', 'documents',
    'maintenance_logs', 'maintenance_reminder_prefs', 'notification_log',
    'reminder_settings', 'reminder_snoozes', 'repair_logs', 'repair_types',
    'user_notification_preferences', 'user_preferences', 'user_profiles',
    'vehicles', 'vessel_checklist_runs', 'vessel_checklists', 'vessel_issues'
  )
order by has_default, c.relname;

-- ── Section 3: unique constraints, i.e. what 23505-means-success relies on ─
select
  c.relname   as table_name,
  con.conname as constraint_name,
  con.contype as type,          -- p = primary key, u = unique
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c      on c.oid = con.conrelid
join pg_namespace n  on n.oid = c.relnamespace
where n.nspname = 'public'
  and con.contype in ('p', 'u')
  and c.relname in (
    'accidents', 'app_notifications', 'cork_notes', 'documents',
    'maintenance_logs', 'maintenance_reminder_prefs', 'notification_log',
    'reminder_settings', 'reminder_snoozes', 'repair_logs', 'repair_types',
    'user_notification_preferences', 'user_preferences', 'user_profiles',
    'vehicles', 'vessel_checklist_runs', 'vessel_checklists', 'vessel_issues'
  )
order by c.relname, con.contype desc, con.conname;
