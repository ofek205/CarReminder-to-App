-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ Audit follow-up 2026-05-12 — unify admin checks to the email          ║
-- ║ allow-list (close residual privilege-escalation surface)              ║
-- ╠══════════════════════════════════════════════════════════════════════╣
-- ║ Problem:                                                              ║
-- ║   The earlier security commit closed the user_metadata.role privesc   ║
-- ║ in three Edge Functions, but a second pass found four more callsites   ║
-- ║ that still trusted that client-writable field:                        ║
-- ║                                                                       ║
-- ║   1. is_current_user_admin()  — old SECURITY DEFINER function used   ║
-- ║                                  by admin RPCs + RLS policies         ║
-- ║   2. app_errors RLS policies   — `... OR raw_user_meta_data->>'role'  ║
-- ║                                   = 'admin'`                          ║
-- ║   3. contact_messages RLS      — same pattern                         ║
-- ║                                                                       ║
-- ║   `raw_user_meta_data` is writable by the user via                   ║
-- ║   `supabase.auth.updateUser({ data: { role: 'admin' } })`. Any        ║
-- ║   authenticated user could self-elevate and bypass admin gates that   ║
-- ║   relied on these callsites.                                         ║
-- ║                                                                       ║
-- ║ Fix:                                                                 ║
-- ║   • Re-define is_current_user_admin() to use the email allow-list     ║
-- ║     (same logic as the canonical public.is_admin() function).         ║
-- ║   • Re-define the four vulnerable RLS policies on app_errors and      ║
-- ║     contact_messages to call public.is_admin() — but ONLY if those    ║
-- ║     tables actually exist on this database (the table-creation SQL    ║
-- ║     for app_errors/contact_messages may never have been run on the    ║
-- ║     live project).                                                   ║
-- ║                                                                       ║
-- ║ Impact:                                                              ║
-- ║   Any user who manually set user_metadata.role='admin' on themselves  ║
-- ║   (via admin_set_role or direct auth.updateUser) will lose admin     ║
-- ║   access via these callsites. They retain admin access ONLY if their ║
-- ║   email is on the public.is_admin() allow-list. Today the allow-list ║
-- ║   contains 'ofek205@gmail.com' only.                                  ║
-- ║                                                                      ║
-- ║   The admin_set_role RPC remains in place but its writes to           ║
-- ║   user_metadata.role are no longer load-bearing — they're a no-op as ║
-- ║   far as authorization goes. A future cleanup commit can deprecate    ║
-- ║   admin_set_role entirely or repurpose it to write to a server-       ║
-- ║   managed admins table.                                               ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── 1. is_current_user_admin() — switch to email allow-list ──────────────
-- Keeps the name + signature so every existing caller (RLS + RPCs) keeps
-- working without changes. The implementation now mirrors public.is_admin().
-- This is the critical fix that closes the privesc on every admin RPC
-- that calls is_current_user_admin().

create or replace function public.is_current_user_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  -- Server-controlled email allow-list. user_metadata.role IS NOT TRUSTED.
  -- See audit follow-up 2026-05-12 (privesc closure).
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) in ('ofek205@gmail.com')
  );
$$;

-- Keep the existing grant in place.
revoke all on function public.is_current_user_admin() from public;
grant execute on function public.is_current_user_admin() to authenticated;


-- ── 2. app_errors RLS — only if the table exists on this DB ──────────────
-- The table-creation SQL (supabase-add-app-errors.sql) may not have been
-- applied to every Supabase project. Wrap the policy fix in a guard so
-- the migration is idempotent across environments.

do $block$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'app_errors'
  ) then
    -- Drop old policies that included the vulnerable metadata clause.
    execute 'drop policy if exists app_errors_admin_read   on public.app_errors';
    execute 'drop policy if exists app_errors_admin_update on public.app_errors';

    -- Recreate with a clean is_admin() delegation.
    execute $sql$
      create policy app_errors_admin_read
        on public.app_errors
        for select to authenticated
        using (public.is_admin())
    $sql$;

    execute $sql$
      create policy app_errors_admin_update
        on public.app_errors
        for update to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $sql$;

    raise notice 'app_errors RLS policies updated';
  else
    raise notice 'app_errors table does not exist — skipping policy update';
  end if;
end
$block$;


-- ── 3. contact_messages RLS — same guard pattern ─────────────────────────

do $block$
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'contact_messages'
  ) then
    execute 'drop policy if exists contact_admin_read   on public.contact_messages';
    execute 'drop policy if exists contact_admin_update on public.contact_messages';

    execute $sql$
      create policy contact_admin_read
        on public.contact_messages
        for select to authenticated
        using (public.is_admin())
    $sql$;

    execute $sql$
      create policy contact_admin_update
        on public.contact_messages
        for update to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $sql$;

    raise notice 'contact_messages RLS policies updated';
  else
    raise notice 'contact_messages table does not exist — skipping policy update';
  end if;
end
$block$;


-- ── 4. Sanity probe (optional — run separately to verify) ───────────────
-- Run this AS a non-admin user (NOT as ofek205@gmail.com) to confirm the
-- closure:
--   select public.is_admin();              -- expect false
--   select public.is_current_user_admin(); -- expect false (was true if you'd
--                                          --   set user_metadata.role='admin')
