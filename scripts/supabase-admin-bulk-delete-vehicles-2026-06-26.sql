-- ═══════════════════════════════════════════════════════════════════════════
-- admin_delete_vehicles — bulk vehicle delete for the admin control center
-- 2026-06-26
--
-- Lets an admin delete many vehicles at once from the AdminUserDrawer
-- "בחירה מרובה" (multi-select) flow, instead of one-by-one.
--
-- Design: it does NOT reimplement the delete — it loops and calls the existing
-- single-vehicle admin_delete_vehicle(uuid) for each id, so the admin gate
-- (is_current_user_admin) and the per-vehicle workspace_audit_log entry stay
-- byte-for-byte identical to a single delete. One audit row per vehicle.
--
-- Deployed live to the shared prod DB on 2026-06-26 via the Supabase
-- Management API. This file is the repo record / idempotent re-runner.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_delete_vehicles(p_vehicle_ids uuid[])
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  n integer := 0;
  vid uuid;
begin
  if not is_current_user_admin() then raise exception 'forbidden_not_admin'; end if;
  if p_vehicle_ids is null then return 0; end if;
  foreach vid in array p_vehicle_ids loop
    -- reuse the single-delete path so cleanup + per-vehicle audit log stay identical
    perform public.admin_delete_vehicle(vid);
    n := n + 1;
  end loop;
  return n;
end;
$fn$;

grant execute on function public.admin_delete_vehicles(uuid[]) to authenticated;
