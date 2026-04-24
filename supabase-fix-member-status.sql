-- ==========================================================================
-- URGENT PRODUCTION FIX — account_members.status normalization
--
-- Symptom: specific users (Ilan Miller ilanmi.technion@gmail.com,
-- Eyal Artzi eyal1413@gmail.com, and possibly others) see an infinite
-- loading spinner on Dashboard and Vehicles after login.
--
-- Root cause: the client filtered `account_members` with status = 'פעיל'.
-- Migrated / legacy rows have status = NULL, 'active', 'ממתין', etc.
-- The filter returned 0 rows, accountId stayed null forever, and every
-- query gated on `enabled: !!accountId` never fired.
--
-- Fix (client): useAccountRole + Vehicles.jsx + Dashboard.jsx now fall
-- back to any membership row when no 'פעיל' row exists.
--
-- Fix (data, this file): normalize any non-'פעיל' membership rows for
-- account owners to 'פעיל'. Non-owners with explicit 'ממתין' or similar
-- pending statuses are left alone (those are legitimate).
--
-- Safe to re-run.
-- ==========================================================================


-- 1. Inspect (read-only) — shows the status distribution before any change.
--    Uncomment and run first to understand what you're fixing.
-- select status, count(*) from public.account_members group by status;


-- 2. Normalize owners.
--    Owners with a missing/legacy status should always be active on their
--    own account — a 'ממתין' owner row doesn't make sense. This flip is
--    what unblocks Ilan / Eyal and any other user with the same pattern.
update public.account_members
set status = 'פעיל'
where role = 'בעלים'
  and (status is null or status not in ('פעיל'));


-- 3. Optional targeted fix (if the above didn't catch everything) —
--    uncomment to force-activate the two specific users reported:
--
-- update public.account_members
--   set status = 'פעיל'
--   where user_id in (
--     select id from auth.users
--     where lower(email) in ('ilanmi.technion@gmail.com', 'eyal1413@gmail.com')
--   )
--   and status is distinct from 'פעיל';


-- 4. Report the distribution after the fix so it's obvious the flip worked.
select status, count(*) as rows from public.account_members group by status order by rows desc;
