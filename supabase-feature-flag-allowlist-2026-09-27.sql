-- =========================================================================
-- Feature flags: switch a flag on for named accounts only.
--
-- WHY THIS EXISTS
--   A flag in public.app_config is either on for everyone or off for
--   everyone, and the only way past it has been is_admin(). Two people need
--   the purchase screens before everyone does, and neither may be an admin:
--
--   1. A test account for real sandbox purchases. The admin account cannot
--      be the one: it carries a grandfathered override, and
--      grant_iap_entitlement() clears ovr_max_vehicles when the plan's own
--      cap is higher, so one test purchase there quietly ends it.
--   2. Apple's reviewer. The first subscription is reviewed together with
--      an app version, and a reviewer who cannot find the purchase rejects
--      it. Until now that meant turning the flag on for EVERY user during
--      review. Making the demo account an admin instead would hand a
--      stranger every admin screen, including other users' data.
--
--   So: one row per (flag, user). The client shows a flag's feature to
--   admins, to users listed for that flag, or to everyone once the flag is
--   on. Nothing changes for anyone who is not listed.
--
-- ⚠️ CLIENT FLAGS ONLY. This is read by src/lib/featureFlags.js. SQL that
--   reads app_config itself (the *_enforced caps inside account RPCs) does
--   not consult this table, so listing someone under vehicle_cap_enforced
--   does nothing. Say so here rather than let a row look like it works.
--
-- ⚠️ THE LIST IS NOT PUBLIC. It names test and reviewer accounts. RLS keeps
--   the table to admins, and a user learns only their own flags, through
--   my_allowlisted_flags().
--
-- Safe to apply before the client code ships: nothing reads it until then.
-- =========================================================================


-- ── 1. The list ───────────────────────────────────────────────────────────
-- Keyed by user id, not email: an email can change hands, a uid cannot.
-- Deleting the user drops their rows with them.
create table if not exists public.feature_flag_allowlist (
  flag_key   text        not null,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now(),
  primary key (flag_key, user_id)
);

comment on table public.feature_flag_allowlist is
  'Client feature flags switched on for named users before app_config turns them on for everyone. Read via my_allowlisted_flags().';


-- ── 2. Access: admins only ────────────────────────────────────────────────
-- Same shape as public.sql_ledger. No policy for anyone else, so a regular
-- user selecting from the table gets zero rows, including their own.
alter table public.feature_flag_allowlist enable row level security;
revoke all on public.feature_flag_allowlist from anon;

drop policy if exists feature_flag_allowlist_admin_read  on public.feature_flag_allowlist;
drop policy if exists feature_flag_allowlist_admin_write on public.feature_flag_allowlist;

create policy feature_flag_allowlist_admin_read on public.feature_flag_allowlist
  for select using (public.is_current_user_admin());

create policy feature_flag_allowlist_admin_write on public.feature_flag_allowlist
  for all using (public.is_current_user_admin())
          with check (public.is_current_user_admin());


-- ── 3. What the client asks: "which flags are on for ME?" ─────────────────
-- Scoped to auth.uid(), so it can never answer about anyone else. One call
-- returns every listed flag, so the client asks once, not once per flag.
-- An empty array, never null, for a user with no rows.
create or replace function public.my_allowlisted_flags()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(flag_key order by flag_key), '{}'::text[])
    from public.feature_flag_allowlist
   where user_id = auth.uid();
$$;

revoke all on function public.my_allowlisted_flags() from public;
revoke all on function public.my_allowlisted_flags() from anon;
grant execute on function public.my_allowlisted_flags() to authenticated;


-- ── 4. The first account: the test account ────────────────────────────────
-- The two flags that together reach a purchase on iOS:
--   monetization_ui_enabled  the "המסלול והחיוב" row in Settings
--   apple_billing_enabled    the plan list and the App Store purchase sheet
-- Not play_billing_enabled: on Android a purchase by a Google account that
-- is not a Play license tester is charged for real. Add it deliberately,
-- with its own line, when that has been checked.
--
-- If the email matches no user this inserts nothing and says nothing. The
-- verification below is what tells you.
insert into public.feature_flag_allowlist (flag_key, user_id, note)
select f.flag_key, u.id, 'test account: App Store sandbox purchases (2026-09-27)'
  from auth.users u
 cross join (values ('monetization_ui_enabled'), ('apple_billing_enabled')) as f (flag_key)
 where lower(u.email) = 'natanzone2024@gmail.com'
on conflict (flag_key, user_id) do nothing;


-- =========================================================================
-- VERIFICATION. Run this and paste what you actually saw.
--
--   select
--     (select count(*) from public.feature_flag_allowlist)                  as rows_total,
--     (select string_agg(a.flag_key, ', ' order by a.flag_key)
--        from public.feature_flag_allowlist a
--        join auth.users u on u.id = a.user_id
--       where lower(u.email) = 'natanzone2024@gmail.com')                   as test_account_flags,
--     (select relrowsecurity from pg_class
--       where oid = 'public.feature_flag_allowlist'::regclass)              as rls_on,
--     (select has_function_privilege('anon',
--        'public.my_allowlisted_flags()', 'execute'))                       as anon_can_call;
--
-- Expected: 2 | apple_billing_enabled, monetization_ui_enabled | true | false
--
-- ⚠️ If test_account_flags is NULL and rows_total is 0, the email matched
--    no user (a Google or Apple sign-in may have stored it differently).
--    Find the account's real email and re-run section 4 with it.
-- ⚠️ Before this file: the first subquery fails with "relation does not
--    exist". That is the "before" state, not a result.
--
-- ADDING SOMEONE LATER (for example Apple's demo account), one statement:
--
--   insert into public.feature_flag_allowlist (flag_key, user_id, note)
--   select f.flag_key, u.id, '<who, and why>'
--     from auth.users u
--    cross join (values ('monetization_ui_enabled'), ('apple_billing_enabled')) as f (flag_key)
--    where lower(u.email) = lower('<email>')
--   on conflict (flag_key, user_id) do nothing;
--
-- The app picks it up the next time a screen asks, at most a minute later.
--
-- ROLLBACK
--   drop function if exists public.my_allowlisted_flags();
--   drop table if exists public.feature_flag_allowlist;
-- The client treats a missing function as "no flags listed", so rolling
-- back hides the features again for listed users and breaks nothing.
-- =========================================================================
