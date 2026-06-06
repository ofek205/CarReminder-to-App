-- ═══════════════════════════════════════════════════════════════════════════
-- Admin analytics — vehicle-count distribution per user — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- Feature: a histogram on the Analytics page — "how many users have 0 vehicles,
-- how many have 1, how many have 2, …". A user here = a PERSONAL account (each
-- signed-up individual owns exactly one). Vehicles belong to accounts, so we
-- LEFT JOIN so that accounts with ZERO vehicles are counted too (that 0-bucket
-- is the interesting activation signal: signed up, never added a vehicle).
--
-- Returns one row per distinct vehicle-count value: { vehicle_count, user_count }.
-- The client groups the long tail (>= 10) into a "10+" bucket for readability.
--
-- Admin-gated (is_admin), SECURITY DEFINER so it can read across all accounts.
-- Purely additive: new function, no schema/table/policy change. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_vehicle_count_distribution()
RETURNS TABLE(vehicle_count int, user_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with per_account as (
    select a.id, count(v.id)::int as vc
    from public.accounts a
    left join public.vehicles v on v.account_id = a.id
    where a.type = 'personal'          -- one personal account ≈ one user
    group by a.id
  )
  select pa.vc as vehicle_count, count(*)::bigint as user_count
  from per_account pa
  group by pa.vc
  order by pa.vc;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_vehicle_count_distribution() TO authenticated;

-- Verify (as an admin / service role):
--   SELECT * FROM public.admin_vehicle_count_distribution();
