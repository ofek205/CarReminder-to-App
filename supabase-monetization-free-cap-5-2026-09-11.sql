-- ============================================================================
-- The free plan tops out at 5 vehicles: the 6th requires a paid plan
-- 2026-09-11
-- ============================================================================
--
-- WHAT THIS CHANGES
--
-- plan_limits.free.max_vehicles from 10 to 5. That is the number that makes
-- vehicle number 6 require payment, and it is the FREE plan's number, not the
-- ₪9 plan's: the ₪9 tier is what someone moves TO, so its ceiling decides how
-- many they get after paying, never when they start paying.
--
-- The ₪9 ceiling is left alone by this file. See section 5 if it should move.
--
-- ⚠️ THE CAP IS CONCURRENT, NOT CUMULATIVE, AND ALWAYS WAS.
-- enforce_vehicle_plan_cap_stmt() counts rows that exist right now
-- (`select count(*) from public.vehicles where account_id = ...`, phase 4
-- line 148). Deleting a vehicle frees its slot immediately and the next add
-- succeeds. Nothing here changes that and nothing needs to.
--
-- ⚠️ AND HERE IS THE PART THAT NEEDS A DECISION, NOT JUST A RUN.
--
-- On 2026-09-09 every account over the then-cap of 5 was frozen at the count
-- it held. When free rose to 10, twelve of those overrides were CLEARED,
-- because an override that sits below the plan stops protecting and starts
-- limiting (plan_ovr ends in `else p_ovr`, so the override wins even when it
-- is lower). Those twelve accounts hold between 6 and 10 vehicles and carry
-- no override today.
--
-- Lowering free back to 5 therefore puts them over the cap again, with
-- nothing holding their place. Section 2b re-freezes them at what they hold,
-- which is what the original decision chose and what keeps the promise that
-- no existing user loses something they already had. Skipping 2b is a
-- deliberate choice to tighten them instead, and it should be made on
-- purpose, with the number from section 1 in front of you.
--
-- Nothing here is enforced today: vehicle_cap_enforced is still false, so
-- this changes what the screens SAY before it changes what the server does.
-- ============================================================================


-- ── 0. PREFLIGHT ──────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from public.plan_limits where plan = 'free') then
    raise exception 'free plan row missing, nothing was changed';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'account_subscriptions'
       and column_name = 'ovr_max_vehicles'
  ) then
    raise exception 'ovr_max_vehicles missing (phase 2b), nothing was changed';
  end if;
end $$;


-- ── 1. READ THIS FIRST. IT IS THE DECISION ────────────────────────────────
--
-- How many accounts would be over a cap of 5 the moment it is applied, and
-- how many of them have no override to hold their place.

select count(*) filter (where n > 5)                             as over_5_today,
       count(*) filter (where n > 5 and ovr is null)             as over_5_unprotected,
       count(*) filter (where n between 6 and 10 and ovr is null) as the_twelve,
       max(n)                                                    as largest_account
  from (
    select a.id,
           (select count(*) from public.vehicles v where v.account_id = a.id)::int as n,
           s.ovr_max_vehicles as ovr
      from public.accounts a
      left join public.account_subscriptions s on s.account_id = a.id
  ) x;

-- The same accounts, by name, so the decision is about people and not a
-- number. Run it; it is read-only.

select a.name,
       coalesce(to_jsonb(a) ->> 'type', to_jsonb(a) ->> 'account_type') as account_type,
       (select count(*) from public.vehicles v where v.account_id = a.id) as vehicles,
       s.ovr_max_vehicles,
       s.ovr_note
  from public.accounts a
  left join public.account_subscriptions s on s.account_id = a.id
 where (select count(*) from public.vehicles v where v.account_id = a.id) > 5
 order by 3 desc;


-- ── 2a. THE CAP ───────────────────────────────────────────────────────────

update public.plan_limits set max_vehicles = 5 where plan = 'free';


-- ── 2b. HOLD THE PLACE OF EVERYONE ALREADY ABOVE IT ───────────────────────
--
-- Run this UNLESS you have decided to tighten existing accounts.
--
-- ⚠️ ORDER MATTERS: this must run AFTER 2a, because it reads the new cap out
-- of plan_limits. Run it first and it compares against 10 and freezes nobody.
--
-- ⚠️ `s.ovr_max_vehicles is null` is the replay guard AND the protection for
-- anyone carrying a deliberate commercial override: they are left alone.
--
-- The note deliberately carries a NEW date. The 2026-09-09 prefix is what the
-- clearing query matches on, and reusing it would make a future cap change
-- silently wipe these too.

with owned as (
  select a.id, (select count(*) from public.vehicles v where v.account_id = a.id)::int as n
    from public.accounts a
),
cap as (select max_vehicles as c from public.plan_limits where plan = 'free')
update public.account_subscriptions s
   set ovr_max_vehicles = o.n,
       ovr_note = coalesce(nullif(btrim(s.ovr_note), '') || ' | ', '') ||
                  'גרנדפאדר 2026-09-11: הוקפא על ' || o.n ||
                  ' רכבים בעת הורדת החינם ל-5. שמירה על הקיים; ' ||
                  'הוספה מעבר לכך דורשת מסלול בתשלום.',
       updated_at = now()
  from owned o cross join cap
 where s.account_id = o.id
   and cap.c is not null
   and o.n > cap.c
   and s.ovr_max_vehicles is null;


-- ── 3. VERIFICATION ───────────────────────────────────────────────────────

select (select max_vehicles from public.plan_limits where plan = 'free') as free_cap,
       (select max_vehicles from public.plan_limits where plan = 'p9')   as p9_cap;
-- expect: free_cap = 5, p9_cap unchanged (15 unless you ran section 5)

select count(*) as unprotected_over_cap
  from public.accounts a
  left join public.account_subscriptions s on s.account_id = a.id
 where (select count(*) from public.vehicles v where v.account_id = a.id)
       > (select max_vehicles from public.plan_limits where plan = 'free')
   and s.ovr_max_vehicles is null;
-- expect 0 if you ran 2b. Anything else is an account that will be blocked
-- from adding the day vehicle_cap_enforced goes true.


-- ── 4. ROLLBACK ───────────────────────────────────────────────────────────
--
--   update public.plan_limits set max_vehicles = 10 where plan = 'free';
--
--   update public.account_subscriptions s
--      set ovr_max_vehicles = null,
--          ovr_note = nullif(btrim(regexp_replace(s.ovr_note,
--            '(\s*\|\s*)?גרנדפאדר 2026-09-11:[^|]*', '', 'g')), ''),
--          updated_at = now()
--    where s.ovr_note like '%גרנדפאדר 2026-09-11%';
--
-- Matches only this file's own note, so it cannot wipe the 2026-09-09 freeze
-- or a human's commercial override.


-- ── 5. OPTIONAL, AND A SEPARATE DECISION: THE ₪9 CEILING ──────────────────
--
-- p9 sits at 15. It was raised from 10 to 15 only because free had gone to
-- 10 and the two collided, which made the paid tier buy nothing. With free
-- back at 5 that reason is gone, and 10 restores the ladder as designed:
-- 5 / 10 / 30 / unlimited.
--
-- The cost of leaving it at 15, measured when it was raised: three accounts
-- sit between 11 and 15 vehicles, so they are served by ₪9 instead of ₪19,
-- about ₪30 a month.
--
--   update public.plan_limits set max_vehicles = 10 where plan = 'p9';
--
-- Do not run this without also re-reading section 1: dropping p9 to 10 does
-- not strand anyone today, because nobody is on a paid plan at all.
