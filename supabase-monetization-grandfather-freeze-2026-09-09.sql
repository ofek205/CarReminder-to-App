-- ═══════════════════════════════════════════════════════════════════════════
-- supabase-monetization-grandfather-freeze-2026-09-09.sql
--
-- Grandfather every existing over-cap account at the number of vehicles it
-- actually holds today. Keeps what they have; growth costs money.
--
--   Ofek's decision, 2026-09-09: "לחשבונות שכבר קיימים ניתן את האפשרות
--   להישאר כפי שהם, אבל אם יעברו את הכמות הם יצטרכו לשלם."
--
-- ⚠️ DEPENDS ON PHASES 1 AND 2B (the ovr_* columns come from 2b).
--
-- WHY A FILE AND NOT THE AUDITED RPC
--   admin_set_account_overrides() is the sanctioned path and it writes an
--   audit row, but it cannot be used here: admin_plan_guard() calls
--   is_admin(), which matches auth.uid() against a hardcoded email, and
--   auth.uid() is NULL in the SQL editor. Every call would raise
--   'unauthorized'. Doing 21 accounts by hand through the admin UI is the
--   only other option.
--
--   So the rationale goes into ovr_note instead, which is the column the
--   exceptions screen renders as THE reason an account is an exception. That
--   plus this file's ledger entry is the audit trail for a bulk operation.
--
-- WHY FREEZING AT THE CURRENT COUNT, NOT AT A FLAT NUMBER
--   A flat override of 10 would hand an account holding 6 four free slots it
--   never had. Freezing at the held count takes nothing away and grants
--   nothing: the eleventh vehicle costs money for an account at 10, and the
--   seventh costs money for an account at 6.
--
-- APPLY: Supabase SQL Editor, after phases 1 and 2b. Then:
--   node scripts/sql-ledger.cjs record supabase-monetization-grandfather-freeze-2026-09-09.sql
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 0. preflight ──────────────────────────────────────────────────────────
do $$
declare
  missing text[] := '{}';
begin
  if to_regclass('public.plan_limits')            is null then missing := missing || 'table public.plan_limits (phase 1)'; end if;
  if to_regclass('public.account_subscriptions')  is null then missing := missing || 'table public.account_subscriptions (phase 1)'; end if;
  if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name   = 'account_subscriptions'
           and column_name  = 'ovr_max_vehicles'
      ) then missing := missing || 'column account_subscriptions.ovr_max_vehicles (phase 2b)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'grandfather freeze preflight failed, nothing was written. Missing: %',
      array_to_string(missing, ', ');
  end if;
end $$;


-- ── 1. what it is about to do ─────────────────────────────────────────────
-- Read this BEFORE the update below. It is the same predicate, so the row
-- count here is exactly what will be written.
with free_cap as (
  select max_vehicles as cap from public.plan_limits where plan = 'free'
),
owned as (
  select a.id,
         (a.type is distinct from 'personal')                                  as is_business,
         (select count(*) from public.vehicles v where v.account_id = a.id)::int as n
    from public.accounts a
)
select
  case when o.is_business then 'עסקי' else 'פרטי' end as kind,
  o.n                                                 as vehicles,
  count(*)                                            as accounts
  from owned o
  cross join free_cap fc
  join public.account_subscriptions s on s.account_id = o.id
 where fc.cap is not null
   and o.n > fc.cap
   and s.ovr_max_vehicles is null
 group by 1, 2
 order by 1, 2;


-- ── 2. the freeze ─────────────────────────────────────────────────────────
--
-- ⚠️ SAFE TO RE-RUN, AND `s.ovr_max_vehicles is null` IS THE REASON.
--   Without that guard, a second run would re-freeze each account at
--   whatever it holds THEN. An account that added vehicles in the meantime
--   would have its ceiling raised to match, which turns the freeze into a
--   ratchet that rewards adding vehicles while nobody is enforcing. First
--   run wins.
--
--   The same guard also means a deliberate override set later by hand is
--   never clobbered by re-running this.
--
-- ⚠️ RUN IT SOON. The vehicle cap is not enforced yet (the flag is false),
--   so an account CAN still grow past the number it will be frozen at. The
--   longer the gap between this file and the decision, the further the
--   frozen numbers drift from the ones the decision was made about.
--
-- ⚠️ fc.cap IS NULL MEANS UNLIMITED FREE, and then nobody is over the cap.
--   The `fc.cap is not null` test makes that a no-op rather than comparing
--   against NULL and silently matching nothing, which would look the same
--   but for the wrong reason.
with free_cap as (
  select max_vehicles as cap from public.plan_limits where plan = 'free'
),
owned as (
  select a.id,
         (select count(*) from public.vehicles v where v.account_id = a.id)::int as n
    from public.accounts a
)
update public.account_subscriptions s
   set ovr_max_vehicles = o.n,
       ovr_note = 'גרנדפאדר 2026-09-09: הוקפא על ' || o.n ||
                  ' רכבים, הכמות שהוחזקה בפועל במעבר למסלולים. ' ||
                  'שמירה על הקיים; הוספה מעבר לכך דורשת מסלול בתשלום.',
       updated_at = now()
  from owned o
  cross join free_cap fc
 where s.account_id = o.id
   and fc.cap is not null
   and o.n > fc.cap
   and s.ovr_max_vehicles is null;


-- ── 3. VERIFICATION ───────────────────────────────────────────────────────
--
-- 1) Who is now frozen, and at what:
--      select s.account_id, a.name, s.ovr_max_vehicles, s.ovr_note
--        from public.account_subscriptions s
--        join public.accounts a on a.id = s.account_id
--       where s.ovr_max_vehicles is not null
--       order by s.ovr_max_vehicles desc;
--      -- expect 21 rows given the 2026-09-09 distribution
--      -- (17 personal over 5, plus 4 business over 5)
--
-- 2) Every frozen ceiling equals the count actually held. If any row comes
--    back, the freeze and reality disagree and the account would be refused
--    on a vehicle it already owns:
--      select s.account_id, s.ovr_max_vehicles,
--             (select count(*) from public.vehicles v where v.account_id = s.account_id) as owned
--        from public.account_subscriptions s
--       where s.ovr_max_vehicles is not null
--         and s.ovr_max_vehicles <> (select count(*) from public.vehicles v where v.account_id = s.account_id);
--      -- expect: 0 rows
--
-- 3) Nobody under the free cap was touched:
--      select count(*) as wrongly_frozen
--        from public.account_subscriptions s
--       where s.ovr_max_vehicles is not null
--         and (select count(*) from public.vehicles v where v.account_id = s.account_id)
--             <= (select max_vehicles from public.plan_limits where plan = 'free');
--      -- expect: 0
--
-- 4) The effective plan really reports the frozen ceiling, which is the only
--    proof that plan_ovr() and account_plan() honour it:
--      select max_vehicles from public.account_plan('<a frozen account id>');
--      -- expect: the frozen number, NOT the free plan's cap
--
-- 5) And the room helper agrees with the trigger:
--      select public.vehicle_cap_room('<a frozen account id>', 1);
--      -- expect: fits false once grace has expired, cap = the frozen number
--      -- NOTE: while grace_until is still in the future this returns
--      -- fits TRUE, because grace suspends the cap. That is correct and not
--      -- a contradiction: the freeze is the ceiling, grace is a pause.
--
-- ROLLBACK (clears the freeze, keeps nothing else):
--   update public.account_subscriptions
--      set ovr_max_vehicles = null, ovr_note = null
--    where ovr_note like 'גרנדפאדר 2026-09-09:%';
--
-- ⚠️ The rollback matches on ovr_note ON PURPOSE, so it cannot wipe an
--   override that a human set for a commercial reason. Do not loosen it to
--   `where ovr_max_vehicles is not null`.
