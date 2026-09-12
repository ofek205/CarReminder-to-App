-- ============================================================================
-- Business accounts keep the business interface, and the screen says so
-- 2026-09-11
-- ============================================================================
--
-- WHY THIS EXISTS
--
-- Decision of 2026-09-11 (open question 2): existing business accounts stay
-- on the FREE plan after the 60 day grace. Not admin_grant, not "must pay".
--
-- That decision is safe for their vehicles, because the grandfather freeze
-- set ovr_max_vehicles with NO ovr_expires_at, so the nine over-cap accounts
-- hold what they have indefinitely and simply cannot add.
--
-- But it creates a contradiction on screen. `business_ui` is a DISPLAY-ONLY
-- field in the client: it is read by useAccountPlan, usePlanCatalog,
-- MyPlan.jsx and Plans.jsx, and NO business screen is gated on it. The
-- business interface is driven by useWorkspaceRole().isBusiness, which comes
-- from the account type, not from the plan.
--
-- So the interface will NOT switch off. What happens instead is worse in a
-- quiet way: /Plans and /MyPlan will tell every business account
-- "ממשק עסקי: לא כלול" while they use it every day. That is the same class
-- of defect personalNote was written to prevent for vehicle caps, a screen
-- that contradicts the application, and it lands the moment
-- monetization_ui_enabled is turned on.
--
-- This file removes the contradiction at the data layer, using machinery that
-- already exists: account_plan() applies ovr_business_ui (phase 2b, lines
-- 234-235), and planExceptions.js already renders it.
--
-- ⚠️ RUN SECTION 1 FIRST AND READ IT. It is read-only, and it also tells you
-- which column this database actually uses for the account type. The repo is
-- inconsistent about it: 33 SQL references say accounts.type, while a comment
-- in supabase-admin-account-details.sql claims account_type. The statements
-- below do not depend on the answer (they read whichever exists via to_jsonb),
-- but you should see the real shape before writing to production.
--
-- ⚠️ THIS FILE DOES NOT TOUCH ovr_max_vehicles OR ovr_expires_at, and it does
-- not overwrite an existing ovr_note. Nine accounts carry the grandfather
-- rationale in that column and losing it would strip the only record of why
-- they are pinned.
--
-- Safe to re-run: every statement is guarded on ovr_business_ui IS NULL.
-- ============================================================================


-- ── 0. PREFLIGHT ──────────────────────────────────────────────────────────
-- Fails loudly and changes nothing if phase 2b was never applied.

do $$
declare missing text := '';
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'account_subscriptions'
       and column_name  = 'ovr_business_ui'
  ) then missing := missing || 'column account_subscriptions.ovr_business_ui (phase 2b); '; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'account_subscriptions'
       and column_name  = 'ovr_note'
  ) then missing := missing || 'column account_subscriptions.ovr_note (phase 2b); '; end if;

  if missing <> '' then
    raise exception 'business-ui override preflight failed, nothing was changed. Missing: %', missing;
  end if;
end $$;


-- ── 1. READ THIS BEFORE WRITING ANYTHING ──────────────────────────────────
--
-- Read-only. Shows every business account, which type column is populated,
-- and the override state it already carries.
--
-- `to_jsonb(a) -> 'x'` yields NULL for a column that does not exist instead
-- of raising, which is what makes this work without knowing the schema.
--
-- Expect roughly eleven rows. If you get zero, the type value is not the
-- string 'business' and NOTHING below will match either: stop and tell me.

select a.id,
       a.name,
       to_jsonb(a) ->> 'type'          as col_type,
       to_jsonb(a) ->> 'account_type'  as col_account_type,
       s.plan,
       s.ovr_business_ui,
       s.ovr_max_vehicles,
       s.ovr_note
  from public.accounts a
  left join public.account_subscriptions s on s.account_id = a.id
 where coalesce(to_jsonb(a) ->> 'type', to_jsonb(a) ->> 'account_type') = 'business'
 order by a.name;


-- Business accounts with NO subscription row at all. The UPDATE below cannot
-- reach these, so if this returns anything, say so rather than assuming the
-- write covered everyone.

select count(*) as business_accounts_without_subscription_row
  from public.accounts a
 where coalesce(to_jsonb(a) ->> 'type', to_jsonb(a) ->> 'account_type') = 'business'
   and not exists (select 1 from public.account_subscriptions s where s.account_id = a.id);


-- ── 2. THE WRITE ──────────────────────────────────────────────────────────
--
-- ⚠️ `s.ovr_business_ui is null` IS THE REPLAY GUARD. An account that already
-- carries a deliberate value, including a deliberate false set by a human in
-- the admin drawer, is left alone.
--
-- ⚠️ The ovr_note CASE preserves what is already there. Overwriting it would
-- erase the grandfather rationale from the nine frozen accounts.

update public.account_subscriptions s
   set ovr_business_ui = true,
       ovr_note = case
         when s.ovr_note is null or btrim(s.ovr_note) = ''
           then 'ממשק עסקי 2026-09-11: חשבון עסקי שנשאר במסלול החינם בהחלטה, ' ||
                'והממשק העסקי נשמר לו. ללא תפוגה.'
         else s.ovr_note || ' | ממשק עסקי 2026-09-11: הממשק העסקי נשמר, ' ||
              'חשבון עסקי שנשאר במסלול החינם בהחלטה.'
       end,
       updated_at = now()
  from public.accounts a
 where a.id = s.account_id
   and coalesce(to_jsonb(a) ->> 'type', to_jsonb(a) ->> 'account_type') = 'business'
   and s.ovr_business_ui is null;


-- ── 3. VERIFICATION ───────────────────────────────────────────────────────
--
-- Expect: every business account with a subscription row now shows
-- ovr_business_ui = true, and every ovr_note that held the grandfather text
-- still holds it.

select count(*)                                            as business_subs,
       count(*) filter (where s.ovr_business_ui is true)    as with_business_ui,
       count(*) filter (where s.ovr_business_ui is null)    as still_null,
       count(*) filter (where s.ovr_note like 'גרנדפאדר%')  as grandfather_note_intact
  from public.account_subscriptions s
  join public.accounts a on a.id = s.account_id
 where coalesce(to_jsonb(a) ->> 'type', to_jsonb(a) ->> 'account_type') = 'business';


-- And the thing this file exists to fix, asked of the function the screens
-- actually call. business_ui must come back true for a business account.
-- Replace the id with one from section 1.
--
--   select (public.account_plan('<account-id-here>'::uuid)).business_ui;


-- ── 4. ROLLBACK ───────────────────────────────────────────────────────────
--
-- Clears ONLY what this file set. The ovr_note match is on this file's own
-- wording, so it cannot wipe a grandfather note or a human's commercial note.
-- Note that the appended form has to be unwound by trimming the suffix, which
-- is why the two cases are separate.
--
--   update public.account_subscriptions s
--      set ovr_business_ui = null,
--          ovr_note = nullif(btrim(replace(replace(s.ovr_note,
--            ' | ממשק עסקי 2026-09-11: הממשק העסקי נשמר, חשבון עסקי שנשאר במסלול החינם בהחלטה.', ''),
--            'ממשק עסקי 2026-09-11: חשבון עסקי שנשאר במסלול החינם בהחלטה, והממשק העסקי נשמר לו. ללא תפוגה.', '')), ''),
--          updated_at = now()
--    where s.ovr_business_ui is true
--      and s.ovr_note like '%ממשק עסקי 2026-09-11%';
