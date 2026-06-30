-- ==========================================================================
-- Expire pending invites — 2026-06-27  (spec §9 ה7)
--
-- A registered "ממתין" membership never expires on its own, so a forgotten
-- invite holds the account_members_active_uq slot forever and blocks
-- re-inviting that person. This adds a daily sweep that:
--   1. deletes pending memberships older than 14 days, and
--   2. cleans up expired unregistered invite tokens.
-- (Owners/managers can still cancel a pending invite manually at any time via
--  cancel_pending_invite — this is just the automatic tail.)
--
-- Idempotent. Requires pg_cron (already used by the reminder/orphan crons).
-- Run in Supabase SQL Editor.
-- ==========================================================================

create or replace function public.expire_pending_invites()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_members int := 0;
  v_invites int := 0;
begin
  -- 1. Registered pending memberships older than 14 days. Deleting (not just
  --    flagging) frees the partial unique index so the person can be re-invited.
  with del as (
    delete from public.account_members
     where status = 'ממתין'
       and joined_at < now() - interval '14 days'
     returning 1
  )
  select count(*) into v_members from del;

  -- 2. Unregistered invite tokens past their expiry (PATH B, 7-day TTL).
  with del as (
    delete from public.invites
     where status = 'פעיל'
       and expires_at < now()
     returning 1
  )
  select count(*) into v_invites from del;

  return jsonb_build_object('expired_members', v_members, 'expired_invites', v_invites);
end $$;

-- Cron-only: no execute grant to authenticated (the daily job runs it).
revoke all on function public.expire_pending_invites() from public;

-- Daily sweep at 03:17. Unschedule first so re-running this file doesn't
-- stack duplicate jobs.
do $$
begin
  perform cron.unschedule('expire-pending-invites');
exception when others then
  null;  -- not scheduled yet
end $$;

select cron.schedule(
  'expire-pending-invites',
  '17 3 * * *',
  $$ select public.expire_pending_invites(); $$
);

notify pgrst, 'reload schema';
