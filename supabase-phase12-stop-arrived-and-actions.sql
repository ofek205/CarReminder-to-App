-- ============================================================================
-- Phase 12 — Driver actions on route stops.
--
-- Updates `update_stop_status` to:
--   1. Accept the wider status enum from phase 10
--      (pending, in_progress, completed, failed, overdue,
--       plus legacy skipped/issue retained for old rows).
--   2. Populate the new `arrived_at` column whenever a stop transitions
--      into in_progress and has no arrived_at yet — supports the
--      "הגעתי" driver action without a separate RPC.
--   3. Treat in_progress and overdue as "still open" when auto-advancing
--      the route status — the route only auto-completes when every stop
--      is in a terminal state (completed / skipped / issue / failed).
--   4. Set `completed_at` for the terminal-failure status `failed` too,
--      not only for completed / skipped / issue.
--
-- Preserves the activity-log writes that phase 7 added:
--   stop.complete / stop.skip / stop.issue / stop.reopen
--   + new stop.arrive (in_progress) / stop.fail (failed) / stop.overdue.
-- Plus the route auto-advance log entries:
--   route.complete / route.reopen / route.start
-- All with identical signatures to the phase-7 calls so downstream
-- readers (Activity Log page, Reports) keep working unchanged.
--
-- Function signature is unchanged — old callers (passing only the legacy
-- values) keep working untouched.
-- ============================================================================

create or replace function public.update_stop_status(
  p_stop_id   uuid,
  p_status    text,
  p_note      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_account_id uuid;
  v_route_id uuid;
  v_vehicle_id uuid;
  v_stop_seq int;
  v_old_route_status text;
  v_remaining int;
  v_action text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  -- Allowed statuses: the new enum + legacy values (for compatibility
  -- with rows created before phase 10).
  if p_status not in (
    'pending', 'in_progress',
    'completed', 'failed', 'overdue',
    'skipped', 'issue'
  ) then
    raise exception 'invalid_status';
  end if;

  select s.account_id, s.route_id, s.sequence
    into v_account_id, v_route_id, v_stop_seq
    from public.route_stops s
   where s.id = p_stop_id;
  if v_account_id is null then raise exception 'stop_not_found'; end if;

  if not (
    public.is_workspace_manager(v_account_id)
    or public.is_assigned_driver_for_route(v_route_id)
  ) then raise exception 'forbidden'; end if;

  select vehicle_id, status into v_vehicle_id, v_old_route_status
    from public.routes where id = v_route_id;

  -- Terminal statuses: a stop in any of these is "done" for the route.
  --   completed / skipped / issue (legacy) + failed (new).
  -- in_progress and overdue are still "open" (driver active / deadline
  -- passed but unresolved) and stop the route from auto-completing.

  update public.route_stops
     set status               = p_status,
         completion_note      = coalesce(p_note, completion_note),
         completed_at         = case
           when p_status in ('completed','skipped','issue','failed')
             then now()
           when p_status in ('pending','in_progress','overdue')
             then null
           else completed_at
         end,
         completed_by_user_id = case
           when p_status in ('completed','skipped','issue','failed')
             then uid
           when p_status in ('pending','in_progress','overdue')
             then null
           else completed_by_user_id
         end,
         arrived_at = case
           when p_status = 'in_progress' and arrived_at is null
             then now()
           else arrived_at
         end
   where id = p_stop_id;

  -- Activity log entry for the stop transition.
  v_action := case p_status
                when 'completed'   then 'stop.complete'
                when 'skipped'     then 'stop.skip'
                when 'issue'       then 'stop.issue'
                when 'failed'      then 'stop.fail'
                when 'in_progress' then 'stop.arrive'
                when 'overdue'     then 'stop.overdue'
                else                    'stop.reopen'
              end;
  perform public.log_activity(
    v_account_id, v_action,
    'route_stop', p_stop_id,
    v_vehicle_id, v_route_id, p_note, null,
    jsonb_build_object('sequence', v_stop_seq, 'new_status', p_status)
  );

  -- Auto-advance route status, with corresponding log entries.
  -- Three transitions handled:
  --   (A) no stops are open (open = pending|in_progress|overdue) and
  --       route was pending/in_progress → completed
  --   (B) reopen of a stop on a completed route                → in_progress
  --   (C) first non-pending stop + route was pending           → in_progress
  select count(*) into v_remaining
    from public.route_stops
   where route_id = v_route_id
     and status in ('pending', 'in_progress', 'overdue');

  if v_remaining = 0 and v_old_route_status in ('pending','in_progress') then
    update public.routes set status = 'completed', updated_at = now()
     where id = v_route_id;
    perform public.log_activity(
      v_account_id, 'route.complete',
      'route', v_route_id, v_vehicle_id, v_route_id,
      null, null,
      jsonb_build_object('previous_status', v_old_route_status)
    );
  elsif v_remaining > 0 and v_old_route_status = 'completed' then
    -- KI-1 fix preserved: a stop was reopened on a completed route.
    -- Move the route back to in_progress so reports + UI stay consistent.
    update public.routes set status = 'in_progress', updated_at = now()
     where id = v_route_id;
    perform public.log_activity(
      v_account_id, 'route.reopen',
      'route', v_route_id, v_vehicle_id, v_route_id,
      null, null,
      jsonb_build_object('reopened_stop_id', p_stop_id)
    );
  elsif v_old_route_status = 'pending' and p_status <> 'pending' then
    update public.routes set status = 'in_progress', updated_at = now()
     where id = v_route_id;
    perform public.log_activity(
      v_account_id, 'route.start',
      'route', v_route_id, v_vehicle_id, v_route_id,
      null, null, null
    );
  end if;
end;
$$;

-- Signature unchanged — re-state grants idempotently.
revoke all on function public.update_stop_status(uuid, text, text) from public;
grant execute on function public.update_stop_status(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
