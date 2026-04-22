-- ==========================================================================
-- Fix: documents RLS used an inline subquery against account_members that
-- depends on its own RLS for visibility. In some edge cases (e.g. fresh
-- membership row, cached session) the subquery returns an empty set even
-- though the user IS a valid owner/admin, so inserts fail with:
--   "new row violates row-level security policy for table documents"
--
-- Fix: replace the subquery with a SECURITY DEFINER helper that runs
-- with the owner role and bypasses account_members RLS for the check.
-- ==========================================================================

create or replace function public.user_can_edit_account(acc uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.account_members
    where user_id    = auth.uid()
      and account_id = acc
      and role       in ('בעלים', 'מנהל')
      and status     = 'פעיל'
  );
$$;

create or replace function public.user_can_delete_account(acc uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.account_members
    where user_id    = auth.uid()
      and account_id = acc
      and role       = 'בעלים'
      and status     = 'פעיל'
  );
$$;

-- Documents: swap the inline subquery policies for helper-based ones.
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert with check (public.user_can_edit_account(account_id));

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update using (public.user_can_edit_account(account_id));

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete using (public.user_can_delete_account(account_id));

-- Bonus: apply the same helper to a couple of other tables that
-- historically used the same inline pattern. Safe to re-run.
do $$
begin
  if exists (select 1 from pg_policies where tablename = 'accidents' and policyname = 'accidents_insert') then
    drop policy accidents_insert on public.accidents;
    create policy accidents_insert on public.accidents
      for insert with check (public.user_can_edit_account(account_id));
  end if;
exception when others then null;
end $$;
