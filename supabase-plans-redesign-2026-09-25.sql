-- ============================================================================
-- /Plans redesign: ₪9 holds 15 documents, the plans get names, and the
-- screen can finally say how many documents an account holds.
-- 2026-09-25
-- ============================================================================
--
-- Three independent changes, each safe to run again:
--
--   1. p9 max_documents 16 -> 15              (Ofek, 2026-09-25)
--   2. label_he becomes a name, not a price   (Ofek approved the design)
--   3. my_document_usage(p_account_id)        (new, read-only RPC)
--
-- Nothing here enforces anything new. The document cap stays gated on
-- document_cap_enforced exactly as supabase-monetization-doc-cap-2026-09-16.sql
-- left it, and that file is NOT edited: it is applied and recorded, so a
-- change to its bytes would make sql-ledger drift report it forever.
-- ============================================================================


-- ── 0. PREFLIGHT ──────────────────────────────────────────────────────────

do $$
declare missing text := '';
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plan_limits'
                    and column_name='max_documents')
    then missing := missing || 'plan_limits.max_documents (doc-cap 2026-09-16); '; end if;
  if not exists (select 1 from pg_proc where proname='is_viewing')
    then missing := missing || 'is_viewing(); '; end if;
  if not exists (select 1 from pg_proc where proname='is_admin')
    then missing := missing || 'is_admin(); '; end if;
  if missing <> '' then
    raise exception 'plans-redesign preflight failed, nothing was changed. Missing: %', missing;
  end if;
end $$;


-- ── 1. READ-ONLY: WHO IS ALREADY ABOVE 15 ON p9 ──────────────────────────
--
-- Informational. Lowering the cap never deletes anything: the trigger only
-- refuses an INSERT that would take the total above the cap, so an account
-- already holding 16 keeps all 16 and simply cannot add a 17th. That is the
-- behaviour Ofek asked for ("keep what you have").

select count(*) as p9_accounts_above_15
  from public.accounts a
 where (select max_documents from public.account_plan(a.id)) = 16
   and (select count(*) from public.documents d where d.account_id = a.id) > 15;


-- ── 2. THE VALUE ──────────────────────────────────────────────────────────

update public.plan_limits set max_documents = 15 where plan = 'p9';


-- ── 3. NAMES ──────────────────────────────────────────────────────────────
--
-- ⚠️ THE OLD LABELS WERE PRICES ("₪9 לחודש"), AND EVERY SCREEN PRINTS THE
-- LABEL ON EVERY PLATFORM. On iOS that is a price for a plan the app cannot
-- sell, which guideline 3.1.1(a) does not allow. The redesigned /Plans shows
-- a price only where the platform permits one, so the name has to stop being
-- one. The free plan already says its price in words and is left alone.
--
-- Play Console titles are separate and should be renamed to match, so the
-- Google sheet shows the same name as the app.

update public.plan_limits set label_he = 'מורחב'     where plan = 'p9';
update public.plan_limits set label_he = 'מקצועי'    where plan = 'p19';
update public.plan_limits set label_he = 'ללא הגבלה' where plan = 'p49';


-- ── 4. my_document_usage() ────────────────────────────────────────────────
--
-- ⚠️ WHY A SERVER COUNT AND NOT A CLIENT ONE. documents_select_via_share lets
-- a user SEE documents beyond what their own account holds, so counting the
-- visible rows answers a different question from the one the cap trigger
-- enforces. The screen could read "3 מתוך 5" while the trigger counts seven.
-- The predicate below is the trigger's, character for character.
--
-- Access check copied from my_vehicle_capacity(): an active member, an admin,
-- or an admin viewing as the account. The number is not sensitive, but
-- scoping stops anyone reading the size of a stranger's account.

create or replace function public.my_document_usage(p_account_id uuid)
returns integer
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  uid     uuid := auth.uid();
  v_count int;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  if not exists (
        select 1 from public.account_members
         where account_id = p_account_id
           and user_id    = uid
           and status     = 'פעיל'
      )
     and not public.is_admin()
     and not public.is_viewing(p_account_id) then
    raise exception 'forbidden';
  end if;

  -- Identical predicate to enforce_document_plan_cap_stmt.
  select count(*) into v_count
    from public.documents where account_id = p_account_id;

  return v_count;
end;
$function$;

-- ⚠️ anon IS REVOKED BY NAME. Supabase grants EXECUTE to anon, authenticated
-- and service_role by default, and `revoke from public` does not remove a
-- grant made to a role directly. my_account_plan kept an anon grant for
-- exactly that reason.
revoke all on function public.my_document_usage(uuid) from public;
revoke all on function public.my_document_usage(uuid) from anon;
grant execute on function public.my_document_usage(uuid) to authenticated;


-- ── 5. VERIFICATION ───────────────────────────────────────────────────────

select plan, label_he, max_vehicles, max_documents
  from public.plan_limits order by sort_order;
-- expect: free חינם 5/5 · p9 מורחב 15/15 · p19 מקצועי 30/40 · p49 ללא הגבלה null/null

-- The function landed with the trigger's predicate, and only the right roles
-- may call it. Expect: true, true, false.
select position('from public.documents where account_id = p_account_id' in p.prosrc) > 0
         as predicate_matches_trigger,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_may_call,
       has_function_privilege('anon',          p.oid, 'execute') as anon_may_call
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'my_document_usage';

-- ⚠️ It cannot be CALLED from the SQL editor: auth.uid() is NULL there, so it
-- raises not_authenticated by design. Its first real call is from the app.
