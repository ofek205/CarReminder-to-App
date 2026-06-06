-- ═══════════════════════════════════════════════════════════════════════════
-- Admin analytics — "0-vehicle after signup" cohort trend — 2026-06-06
-- ═══════════════════════════════════════════════════════════════════════════
-- Goal: answer "is the share of users who never add a vehicle improving?" in a
-- TIME-NORMALISED way. The global 0-vehicle % is confounded by old inactive
-- accounts, so instead we measure, PER SIGNUP WEEK, the share of users who
-- still had 0 vehicles `p_window_days` after THEIR OWN signup. Every cohort is
-- measured at the same maturity, so a falling line = onboarding is improving.
--
-- A "user" = a personal account. "Activated within the window" = added at
-- least one vehicle whose created_at is within p_window_days of signup.
-- We EXCLUDE cohorts too recent to have had the full window (otherwise their
-- rate is biased high). Returns one row per signup week.
--
-- Admin-gated, SECURITY DEFINER, purely additive (new function only).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_zero_vehicle_cohort_trend(
  p_window_days int DEFAULT 7,
  p_weeks       int DEFAULT 12
)
RETURNS TABLE(week_start date, cohort_size bigint, zero_after_window bigint, zero_pct numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with acct as (
    select
      a.id,
      date_trunc('week', a.created_at)::date as wk,
      a.created_at,
      (select min(v.created_at) from public.vehicles v where v.account_id = a.id) as first_vehicle_at
    from public.accounts a
    where a.type = 'personal'
      -- look back p_weeks cohorts, plus the window so the oldest cohort is full
      and a.created_at >= (now() - make_interval(weeks => p_weeks) - make_interval(days => p_window_days))
      -- only accounts that have already had the FULL window to activate
      and a.created_at <= (now() - make_interval(days => p_window_days))
  )
  select
    acct.wk as week_start,
    count(*)::bigint as cohort_size,
    count(*) filter (
      where acct.first_vehicle_at is null
         or acct.first_vehicle_at > acct.created_at + make_interval(days => p_window_days)
    )::bigint as zero_after_window,
    round(
      100.0 * count(*) filter (
        where acct.first_vehicle_at is null
           or acct.first_vehicle_at > acct.created_at + make_interval(days => p_window_days)
      ) / nullif(count(*), 0)::numeric
    , 1) as zero_pct
  from acct
  group by acct.wk
  order by acct.wk;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_zero_vehicle_cohort_trend(int, int) TO authenticated;

-- Verify:
--   SELECT * FROM public.admin_zero_vehicle_cohort_trend();          -- 7d / 12w
--   SELECT * FROM public.admin_zero_vehicle_cohort_trend(14, 8);     -- 14d / 8w
